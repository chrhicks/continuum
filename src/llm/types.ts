export type LlmRole = 'system' | 'user' | 'assistant'

export type LlmMessage = {
  role: LlmRole
  content: string
}

export type LlmTransport = 'chat_completions' | 'responses'

export type LlmJsonSchema = {
  name: string
  schema: Record<string, unknown>
  strict?: boolean
}

export type LlmStructuredOutputOptions<T = unknown> = {
  jsonSchema: LlmJsonSchema
  validate?: (raw: unknown) => T
}

/**
 * Configuration for an LLM client. Intentionally provider-agnostic:
 * any OpenAI-compatible endpoint works (Anthropic via proxy, kimi, etc.).
 */
export type LlmConfig = {
  /** Full provider URL, e.g. https://opencode.ai/zen/v1/chat/completions */
  apiUrl: string
  apiKey: string
  model: string
  /** Default max output tokens per call */
  maxTokens: number
  /** Request timeout in milliseconds */
  timeoutMs: number
}

export type LlmResponse<T = unknown> = {
  content: string
  /** Raw finish_reason from the provider, e.g. 'stop' | 'length' | null */
  finishReason: string | null
  /** Parsed schema-constrained payload when structured output was requested. */
  structuredOutput: T | null
}

export type LlmCallOptions<T = unknown> = {
  messages: LlmMessage[]
  /** Override the config default max tokens for this specific call */
  maxTokens?: number
  structuredOutput?: LlmStructuredOutputOptions<T>
}

/**
 * Options for the token-bump retry strategy.
 * When a call ends with finish_reason='length' the client re-issues
 * the request with a larger max_tokens until it succeeds or hits the cap.
 */
export type LlmRetryOptions = {
  /** Ceiling on max_tokens; stop bumping once reached (default: 12000) */
  maxTokensCap?: number
  /** How many tokens to add on each retry (default: 2000) */
  tokenStep?: number
  /** How many times to retry on network/timeout errors (default: 1) */
  errorRetries?: number
  /** Delay between error retries in ms (default: 5000) */
  errorRetryDelayMs?: number
}
