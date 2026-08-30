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
  #continuumClosed = false

  constructor(continuum: Continuum) {
    super({ name: 'continuum', version: '0.2.0' })
    this.#continuum = continuum
    this.server.onclose = () => this.closeContinuum()
  }

  override async connect(transport: Transport): Promise<void> {
    if (this.#continuumClosed) {
      throw new Error('The Continuum MCP server is closed.')
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
        await super.close()
      } catch {
        // Preserve the connection failure; cleanup remains idempotent below.
      } finally {
        try {
          this.closeContinuum()
        } catch {
          // The original connection failure remains the actionable cause.
        }
      }
      throw cause
    }
  }

  override async close(): Promise<void> {
    try {
      await super.close()
    } finally {
      this.closeContinuum()
    }
  }

  closeContinuum(): void {
    if (this.#continuumClosed) return
    this.#continuumClosed = true
    this.#continuum.close()
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
  try {
    await server.connect(new StdioServerTransport())
    await waitForStdinEnd()
  } finally {
    await server.close()
  }
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
