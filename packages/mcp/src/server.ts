import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  createContinuum,
  type Continuum,
  type DataPathOptions,
} from '@continuum/core'
import { registerContinuumTools } from './tools'

class OwnedContinuumMcpServer extends McpServer {
  readonly #continuum: Continuum
  #connectionAttempted = false
  #continuumClosed = false
  #closePromise: Promise<void> | undefined

  constructor(continuum: Continuum) {
    super({ name: 'continuum', version: '0.2.0' })
    this.#continuum = continuum
  }

  override async connect(transport: Transport): Promise<void> {
    if (this.#continuumClosed || this.#closePromise) {
      throw new Error('The Continuum MCP server is closed.')
    }
    if (this.#connectionAttempted) {
      throw new Error('The Continuum MCP server is already connected.')
    }
    this.#connectionAttempted = true

    const observedClose = this.server.onclose
    this.server.onclose = () => {
      try {
        observedClose?.()
      } finally {
        this.closeContinuum()
      }
    }

    try {
      await super.connect(transport)
      const protocolClose = transport.onclose
      transport.onclose = () => {
        try {
          protocolClose?.()
        } finally {
          this.closeContinuum()
        }
      }
    } catch (cause) {
      try {
        await this.close()
      } catch {
        // Preserve the connection failure rather than a secondary cleanup error.
      }
      throw cause
    }
  }

  override close(): Promise<void> {
    this.#closePromise ??= this.closeOnce()
    return this.#closePromise
  }

  closeContinuum(): void {
    if (this.#continuumClosed) return
    this.#continuumClosed = true
    this.#continuum.close()
  }

  private async closeOnce(): Promise<void> {
    let transportFailed = false
    let transportFailure: unknown
    try {
      await super.close()
    } catch (cause) {
      transportFailed = true
      transportFailure = cause
    }

    try {
      this.closeContinuum()
    } catch (cause) {
      if (!transportFailed) throw cause
    }

    if (transportFailed) throw transportFailure
  }
}

export function createContinuumMcpServer(
  options: DataPathOptions = {},
): McpServer {
  const continuum = createContinuum(options)
  const server = new OwnedContinuumMcpServer(continuum)

  try {
    registerContinuumTools(server, continuum)
    return server
  } catch (cause) {
    server.closeContinuum()
    throw cause
  }
}

export async function serveContinuumMcp(): Promise<void> {
  const server = createContinuumMcpServer()
  let bodyFailed = false
  let bodyFailure: unknown

  try {
    await server.connect(new StdioServerTransport())
    await waitForStdinEnd()
  } catch (cause) {
    bodyFailed = true
    bodyFailure = cause
  }

  try {
    await server.close()
  } catch (cause) {
    if (!bodyFailed) throw cause
  }

  if (bodyFailed) throw bodyFailure
}

function waitForStdinEnd(): Promise<void> {
  if (process.stdin.readableEnded || process.stdin.destroyed) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      process.stdin.off('end', onEnd)
      process.stdin.off('close', onEnd)
      process.stdin.off('error', onError)
    }
    const onEnd = () => {
      cleanup()
      resolve()
    }
    const onError = (cause: Error) => {
      cleanup()
      reject(cause)
    }

    process.stdin.once('end', onEnd)
    process.stdin.once('close', onEnd)
    process.stdin.once('error', onError)
  })
}
