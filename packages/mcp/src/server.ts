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
    } catch (cause) {
      this.closeContinuum()
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
  } catch (cause) {
    await server.close()
    throw cause
  }
}
