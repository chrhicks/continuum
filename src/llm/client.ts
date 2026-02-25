import type {
  LlmCallOptions,
  LlmConfig,
  LlmResponse,
  LlmRetryOptions,
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
  call(options: LlmCallOptions): Promise<LlmResponse>
  /**
   * Call with automatic token-bump retry: if the provider returns
   * finish_reason='length', max_tokens is increased by tokenStep and
   * the call is retried until finish_reason is something other than
   * 'length' or maxTokensCap is reached.
   */
  callWithRetry(
    options: LlmCallOptions,
    retry?: LlmRetryOptions,
  ): Promise<LlmResponse>
}

export function createLlmClient(config: LlmConfig): LlmClient {
  const frozen = Object.freeze({ ...config })
  return {
    config: frozen,
    call: (options) => callOnce(frozen, options),
    callWithRetry: (options, retry) => callWithRetry(frozen, options, retry),
  }
}

// ---------------------------------------------------------------------------
// Internal implementation
// ---------------------------------------------------------------------------

async function callOnce(
  config: LlmConfig,
  options: LlmCallOptions,
): Promise<LlmResponse> {
  const maxTokens = options.maxTokens ?? config.maxTokens

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)

  let response: Response
  try {
    response = await fetch(config.apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages: options.messages,
        temperature: 0.2,
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
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

  const data = (await response.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[]
  }

  const choice = data.choices?.[0]
  const content = choice?.message?.content
  if (!content) {
    throw new Error('LLM response missing content.')
  }

  return {
    content,
    finishReason: choice?.finish_reason ?? null,
  }
}

async function callWithRetry(
  config: LlmConfig,
  options: LlmCallOptions,
  retry: LlmRetryOptions = {},
): Promise<LlmResponse> {
  const step = retry.tokenStep ?? DEFAULT_TOKEN_STEP
  const cap = retry.maxTokensCap ?? DEFAULT_MAX_TOKENS_CAP
  let maxTokens = options.maxTokens ?? config.maxTokens

  while (true) {
    const result = await callOnce(config, { ...options, maxTokens })
    if (result.finishReason !== 'length') {
      return result
    }
    const next = maxTokens + step
    if (next > cap) {
      return result
    }
    maxTokens = next
  }
}
