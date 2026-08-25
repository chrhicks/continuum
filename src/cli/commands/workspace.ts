import { Command } from 'commander'
import { Effect } from 'effect'
import { forkWorkspaceStorageEffect } from '../../db/workspace-fork'
import { resolveWorkspaceRoot } from '../../workspace/resolve'
import { runCommand } from '../io'

export function createWorkspaceCommand(): Command {
  const command = new Command('workspace').description(
    'Manage durable workspace identity',
  )

  command
    .command('fork')
    .description(
      'Give a copied workspace a new identity and independent database',
    )
    .action(async (_options: unknown, action: Command) => {
      await runCommand(
        action,
        async () => {
          const workspaceRoot = resolveWorkspaceRoot({
            startDir: process.cwd(),
          })
          return Effect.runPromise(forkWorkspaceStorageEffect(workspaceRoot))
        },
        (result) => {
          console.log('Forked Continuum workspace storage.')
          console.log(`Workspace: ${result.workspacePath}`)
          console.log(`Previous project ID: ${result.previousProjectId}`)
          console.log(`Project ID: ${result.projectId}`)
          console.log(`Database: ${result.databasePath}`)
        },
      )
    })

  return command
}
