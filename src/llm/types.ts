export type LlmRole = 'system' | 'user' | 'assistant'

export type LlmMessage = {
  role: LlmRole
  content: string
}

/**
 * Configuration for an LLM client. Intentionally provider-agnostic:
 * any OpenAI-compatible endpoint works (Anthropic via proxy, kimi, etc.).
 */
export type LlmConfig = {
  /** Full chat completions URL, e.g. https://opencode.ai/zen/v1/chat/completions */
  apiUrl: string
  apiKey: string
  model: string
  /** Default max output tokens per call */
  maxTokens: number
  /** Request timeout in milliseconds */
  timeoutMs: number
}

export type LlmResponse = {
  content: string
  /** Raw finish_reason from the provider, e.g. 'stop' | 'length' | null */
  finishReason: string | null
}

export type LlmCallOptions = {
  messages: LlmMessage[]
  /** Override the config default max tokens for this specific call */
  maxTokens?: number
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
}
