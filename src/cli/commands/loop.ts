import { Command } from 'commander'
import { writeLoopRequest } from '../../loop/request'
import { runLoopRequest } from '../../loop/runner'

export function createLoopCommand(): Command {
  return new Command('loop')
    .description('Run loop request')
    .requiredOption('-n, --count <count>', 'Number of iterations')
    .action(async (options: { count: string }) => {
      const count = parseLoopCount(options.count)
      await handleLoop(count)
    })
}

export async function handleLoop(count: number): Promise<void> {
  const path = writeLoopRequest(count)
  console.log(`Loop request created: ${path}`)
  const result = await runLoopRequest(path)
  console.log(result.message)
  if (!result.invoked) {
    console.log(
      'Run the agent loop skill to process the request when available.',
    )
  }
}

function parseLoopCount(value: string): number {
  const count = Number(value)
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error('Count must be a positive integer.')
  }
  return count
}
