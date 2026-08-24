import { Command } from 'commander'
import {
  resolveRuntimeContract,
  type RuntimeContract,
} from '../../runtime/contract'
import { runCommand } from '../io'

export function createRuntimeCommand(): Command {
  return new Command('runtime')
    .description('Show resolved runtime and canonical storage paths')
    .action(async (_options: unknown, command: Command) => {
      await runCommand(command, async () => resolveRuntimeContract(), render)
    })
}

function render(contract: RuntimeContract): void {
  console.log(`Storage generation: ${contract.storageGeneration}`)
  console.log(`Workspace: ${contract.workspace}`)
  console.log(`Entrypoint: ${contract.entrypoint}`)
  console.log(`HOME: ${contract.home}`)
  console.log(`XDG data home: ${contract.dataHome}`)
  console.log(`Database: ${contract.database}`)
}
