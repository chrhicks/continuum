import { Command } from 'commander'
import { serveContinuumMcp } from '../../mcp/server'

export function createMcpCommand(): Command {
  return new Command('mcp')
    .description('Serve Continuum tools over MCP using stdio')
    .action(serveContinuumMcp)
}
