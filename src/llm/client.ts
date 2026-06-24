import type {
  LlmCallOptions,
  LlmConfig,
  LlmResponse,
  LlmRetryOptions,
} from './types'
import { buildLlmRequest } from './llm-request'
import {
  parseChatCompletionResponse,
  parseResponsesApiResponse,
} from './llm-response'

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
