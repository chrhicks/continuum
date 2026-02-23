import { Command } from 'commander'
import { runCommand } from '../io'
import { installSkills } from '../../skills/setup'

export function createSetupCommand(): Command {
  return new Command('setup')
    .description('Install bundled skills into .agents/skills')
    .action(async (_options: unknown, command: Command) => {
      await runCommand(
        command,
        async () => installSkills(),
        (result) => {
          const count = result.skills.length
          const label = count === 1 ? 'skill' : 'skills'
          console.log(`Installed ${count} ${label} to ${result.targetDir}`)
          console.log('Skills:')
          for (const skill of result.skills) {
            console.log(`- ${skill}`)
          }
        },
      )
    })
}
