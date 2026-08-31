import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import type {
  Transport,
  TransportSendOptions,
} from '@modelcontextprotocol/sdk/shared/transport.js'
import { z } from 'zod'

const unknownInputKey = '__continuum_unknown_input__'

/**
 * Preserves strict tool input validation across SDK 1.29's request parser,
 * which otherwise drops an own `__proto__` argument key before tool schemas run.
 */
export class ContinuumInputTransport implements Transport {
  onclose?: Transport['onclose']
  onerror?: Transport['onerror']
  onmessage?: Transport['onmessage']

  readonly #transport: Transport

  constructor(transport: Transport) {
    this.#transport = transport
    this.onclose = transport.onclose
    this.onerror = transport.onerror
    this.onmessage = transport.onmessage
  }

  get sessionId(): string | undefined {
    return this.#transport.sessionId
  }

  async start(): Promise<void> {
    this.#transport.onclose = () => this.onclose?.()
    this.#transport.onerror = (error) => this.onerror?.(error)
    this.#transport.onmessage = (message, extra) =>
      this.onmessage?.(preserveReservedUnknownInput(message), extra)
    await this.#transport.start()
  }

  send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    return this.#transport.send(message, options)
  }

  close(): Promise<void> {
    return this.#transport.close()
  }

  setProtocolVersion(version: string): void {
    this.#transport.setProtocolVersion?.call(this.#transport, version)
  }
}

export function strictInputObject<Shape extends z.ZodRawShape>(shape: Shape) {
  const knownKeys = new Set(Object.keys(shape))
  const objectSchema = z.object(shape).strict()
  const inputSchema = z.preprocess((value) => {
    if (!isPlainObject(value)) return value
    if (!Object.keys(value).some((key) => !knownKeys.has(key))) return value

    const bounded: Record<string, unknown> = {}
    for (const key of knownKeys) {
      if (Object.hasOwn(value, key)) bounded[key] = value[key]
    }
    bounded[unknownInputKey] = true
    return bounded
  }, objectSchema)

  // SDK 1.29 recognizes object schemas through this property before its JSON
  // Schema converter unwraps the preprocessing effect using the input shape.
  Object.defineProperty(inputSchema, 'shape', { value: objectSchema.shape })
  return inputSchema
}

export function boundedTextArray(item: z.ZodString, minimumLength?: number) {
  let arraySchema = z.array(item)
  if (minimumLength !== undefined) arraySchema = arraySchema.min(minimumLength)

  return z.preprocess((value) => {
    if (!Array.isArray(value)) return value
    for (const entry of value) {
      if (typeof entry !== 'string') return null
    }
    return value
  }, arraySchema)
}

function preserveReservedUnknownInput(message: JSONRPCMessage): JSONRPCMessage {
  if (!('method' in message) || message.method !== 'tools/call') return message
  if (!isPlainObject(message.params)) return message

  const arguments_ = message.params.arguments
  if (!isPlainObject(arguments_) || !Object.hasOwn(arguments_, '__proto__')) {
    return message
  }

  const descriptors = Object.getOwnPropertyDescriptors(arguments_)
  delete descriptors['__proto__']
  descriptors[unknownInputKey] = {
    value: true,
    enumerable: true,
    configurable: true,
    writable: true,
  }
  const preservedArguments = Object.defineProperties({}, descriptors)

  return {
    ...message,
    params: {
      ...message.params,
      arguments: preservedArguments,
    },
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
