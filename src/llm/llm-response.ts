import type {
  LlmResponse,
  LlmStructuredOutputOptions,
} from './types'

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

export function parseChatCompletionResponse<T>(
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

export function parseResponsesApiResponse<T>(
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
