import type {
  LlmCallOptions,
  LlmConfig,
  LlmJsonSchema,
  LlmMessage,
  LlmResponse,
  LlmRetryOptions,
  LlmStructuredOutputOptions,
  LlmTransport,
} from './types'

const DEFAULT_TOKEN_STEP = 2000
const DEFAULT_MAX_TOKENS_CAP = 12000

/**
 * LlmClient is the single interface consumers use. Provider details,
 * HTTP transport, and retry behaviour are all hidden behind it.
 */
export type LlmClient = {
  readonly config: Readonly<LlmConfig>
  /**
   * Single call — no retry. Use when you want explicit control
   * or when the caller manages its own retry loop.
   */
  call<T = unknown>(options: LlmCallOptions<T>): Promise<LlmResponse<T>>
  /**
   * Call with automatic token-bump retry: if the provider returns
   * finish_reason='length', max_tokens is increased by tokenStep and
   * the call is retried until finish_reason is something other than
   * 'length' or maxTokensCap is reached.
   */
  callWithRetry<T = unknown>(
    options: LlmCallOptions<T>,
    retry?: LlmRetryOptions,
  ): Promise<LlmResponse<T>>
}

type ChatCompletionApiResponse = {
  choices?: { message?: { content?: string }; finish_reason?: string }[]
}

type ResponsesApiResponse = {
  error?: { message?: string | null } | null
  status?: string | null
  incomplete_details?: { reason?: string | null } | null
  output_text?: string | null
  output?: Array<{
    type?: string | null
    role?: string | null
    content?: Array<{
      type?: string | null
      text?: string | null
      refusal?: string | null
    }> | null
  }> | null
}

export function createLlmClient(config: LlmConfig): LlmClient {
  const frozen = Object.freeze({ ...config })
  return {
    config: frozen,
    call: <T = unknown>(options: LlmCallOptions<T>) =>
      callOnce(frozen, options),
    callWithRetry: <T = unknown>(
      options: LlmCallOptions<T>,
      retry?: LlmRetryOptions,
    ) => callWithRetry(frozen, options, retry),
  }
}

// ---------------------------------------------------------------------------
// Internal implementation
// ---------------------------------------------------------------------------

async function callOnce<T = unknown>(
  config: LlmConfig,
  options: LlmCallOptions<T>,
): Promise<LlmResponse<T>> {
  const maxTokens = options.maxTokens ?? config.maxTokens
  const request = buildLlmRequest(config, options, maxTokens)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)

  let response: Response
  try {
    response = await fetch(request.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request.body),
      signal: controller.signal,
    })
  } catch (error) {
    const isTimeout =
      error instanceof Error &&
      (error.name === 'AbortError' ||
        error.message.toLowerCase().includes('timed out') ||
        error.message.toLowerCase().includes('timeout'))
    if (isTimeout) {
      throw new Error(`LLM request timed out after ${config.timeoutMs}ms.`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`LLM API error (${response.status}): ${body}`)
  }

  const data = (await response.json()) as unknown

  if (request.transport === 'responses') {
    return parseResponsesApiResponse(data, options.structuredOutput)
  }

  return parseChatCompletionResponse(data, options.structuredOutput)
}

async function callWithRetry<T = unknown>(
  config: LlmConfig,
  options: LlmCallOptions<T>,
  retry: LlmRetryOptions = {},
): Promise<LlmResponse<T>> {
  const step = retry.tokenStep ?? DEFAULT_TOKEN_STEP
  const cap = retry.maxTokensCap ?? DEFAULT_MAX_TOKENS_CAP
  let maxTokens = options.maxTokens ?? config.maxTokens
  const errorRetries = retry.errorRetries ?? 1
  const errorRetryDelayMs = retry.errorRetryDelayMs ?? 5000
  let errorsRemaining = errorRetries

  while (true) {
    try {
      const result = await callOnce(config, { ...options, maxTokens })
      if (result.finishReason !== 'length') {
        return result
      }
      const next = maxTokens + step
      if (next > cap) {
        return result
      }
      maxTokens = next
    } catch (error) {
      const isTimeout =
        error instanceof Error &&
        (error.message.toLowerCase().includes('timed out') ||
          error.message.toLowerCase().includes('timeout'))
      if (isTimeout && errorsRemaining > 0) {
        console.error(
          `[llm] Request timed out, retrying in ${errorRetryDelayMs}ms... (${errorsRemaining} retries left)`,
        )
        errorsRemaining--
        await new Promise((resolve) => setTimeout(resolve, errorRetryDelayMs))
        continue
      }
      throw error
    }
  }
}

export function resolveLlmTransport(
  config: Pick<LlmConfig, 'apiUrl' | 'model'>,
): LlmTransport {
  if (config.apiUrl.endsWith('/responses')) {
    return 'responses'
  }

  if (
    isZenChatCompletionsUrl(config.apiUrl) &&
    isZenResponsesModel(config.model)
  ) {
    return 'responses'
  }

  return 'chat_completions'
}

export function resolveLlmApiUrl(
  config: Pick<LlmConfig, 'apiUrl' | 'model'>,
): string {
  if (resolveLlmTransport(config) !== 'responses') {
    return config.apiUrl
  }

  if (config.apiUrl.endsWith('/responses')) {
    return config.apiUrl
  }

  return config.apiUrl.replace(/\/chat\/completions$/, '/responses')
}

function buildLlmRequest(
  config: LlmConfig,
  options: LlmCallOptions,
  maxTokens: number,
): {
  transport: LlmTransport
  url: string
  body: Record<string, unknown>
} {
  const transport = resolveLlmTransport(config)
  const url = resolveLlmApiUrl(config)
  const structuredOutput = normalizeStructuredOutput(options.structuredOutput)

  if (transport === 'responses') {
    return {
      transport,
      url,
      body: {
        model: config.model,
        input: mapMessagesToResponsesInput(options.messages),
        temperature: 0.2,
        max_output_tokens: maxTokens,
        text: structuredOutput
          ? {
              format: {
                type: 'json_schema',
                name: structuredOutput.name,
                strict: structuredOutput.strict,
                schema: structuredOutput.schema,
              },
            }
          : undefined,
      },
    }
  }

  return {
    transport,
    url,
    body: {
      model: config.model,
      messages: options.messages,
      temperature: 0.2,
      max_tokens: maxTokens,
      response_format: structuredOutput
        ? {
            type: 'json_schema',
            json_schema: {
              name: structuredOutput.name,
              strict: structuredOutput.strict,
              schema: structuredOutput.schema,
            },
          }
        : undefined,
    },
  }
}

function parseChatCompletionResponse<T>(
  data: unknown,
  structuredOutput: LlmStructuredOutputOptions<T> | undefined,
): LlmResponse<T> {
  const chat = data as ChatCompletionApiResponse
  const choice = chat.choices?.[0]
  const finishReason = choice?.finish_reason ?? null
  const content = choice?.message?.content
  if (!content && finishReason !== 'length') {
    throw new Error('LLM response missing content.')
  }

  return {
    content: content ?? '',
    finishReason,
    structuredOutput: parseStructuredOutputSafely(
      content ?? '',
      finishReason,
      structuredOutput,
    ),
  }
}

function parseResponsesApiResponse<T>(
  data: unknown,
  structuredOutput: LlmStructuredOutputOptions<T> | undefined,
): LlmResponse<T> {
  const response = data as ResponsesApiResponse
  if (response.error?.message) {
    throw new Error(`LLM response failed: ${response.error.message}`)
  }
  if (response.status === 'failed') {
    throw new Error('LLM response failed without an error message.')
  }

  const content = extractResponsesOutputText(response)
  const finishReason = mapResponsesFinishReason(response)

  if (!content && finishReason !== 'length') {
    throw new Error('LLM response missing content.')
  }

  return {
    content: content ?? '',
    finishReason,
    structuredOutput: parseStructuredOutputSafely(
      content ?? '',
      finishReason,
      structuredOutput,
    ),
  }
}

function extractResponsesOutputText(response: ResponsesApiResponse): string {
  if (
    typeof response.output_text === 'string' &&
    response.output_text.length > 0
  ) {
    return response.output_text
  }

  const chunks: string[] = []
  const refusals: string[] = []

  for (const item of response.output ?? []) {
    if (item?.type !== 'message') {
      continue
    }
    for (const part of item.content ?? []) {
      if (part?.type === 'output_text' && typeof part.text === 'string') {
        chunks.push(part.text)
      }
      if (part?.type === 'refusal' && typeof part.refusal === 'string') {
        refusals.push(part.refusal)
      }
    }
  }

  if (chunks.length > 0) {
    return chunks.join('')
  }

  if (refusals.length > 0) {
    throw new Error(`LLM response refused: ${refusals.join(' ')}`)
  }

  return ''
}

function mapResponsesFinishReason(
  response: ResponsesApiResponse,
): string | null {
  const reason = response.incomplete_details?.reason ?? null
  if (reason === 'max_output_tokens') {
    return 'length'
  }
  if (reason === 'content_filter') {
    return 'content_filter'
  }
  if (response.status === 'completed') {
    return 'stop'
  }
  return null
}

function parseStructuredOutput<T>(
  content: string,
  structuredOutput: LlmStructuredOutputOptions<T> | undefined,
): T | null {
  if (!structuredOutput) {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content) as unknown
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to parse structured LLM response: ${detail}`)
  }

  if (!structuredOutput.validate) {
    return parsed as T
  }

  return structuredOutput.validate(parsed)
}

function parseStructuredOutputSafely<T>(
  content: string,
  finishReason: string | null,
  structuredOutput: LlmStructuredOutputOptions<T> | undefined,
): T | null {
  try {
    return parseStructuredOutput(content, structuredOutput)
  } catch (error) {
    if (finishReason === 'length') {
      return null
    }
    throw error
  }
}

function normalizeStructuredOutput<T>(
  structuredOutput: LlmStructuredOutputOptions<T> | undefined,
): LlmJsonSchema | null {
  if (!structuredOutput) {
    return null
  }

  return {
    ...structuredOutput.jsonSchema,
    strict: structuredOutput.jsonSchema.strict ?? true,
  }
}

function mapMessagesToResponsesInput(
  messages: LlmMessage[],
): Array<{ role: 'developer' | 'user' | 'assistant'; content: string }> {
  return messages.map((message) => ({
    role: message.role === 'system' ? 'developer' : message.role,
    content: message.content,
  }))
}

function isZenResponsesModel(model: string): boolean {
  return /^gpt-/i.test(model.trim())
}

function isZenChatCompletionsUrl(apiUrl: string): boolean {
  return apiUrl === 'https://opencode.ai/zen/v1/chat/completions'
}
