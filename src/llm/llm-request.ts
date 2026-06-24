import type {
  LlmCallOptions,
  LlmConfig,
  LlmJsonSchema,
  LlmMessage,
  LlmStructuredOutputOptions,
  LlmTransport,
} from './types'

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

export function buildLlmRequest(
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
