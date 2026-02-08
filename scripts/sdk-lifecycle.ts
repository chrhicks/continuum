import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import continuum from '../src/sdk/index.ts'

const args = process.argv.slice(2)
const getFlag = (name: string) => args.includes(name)
const getArgValue = (name: string) => {
  const direct = args.find((arg) => arg.startsWith(`${name}=`))
  if (direct) return direct.split('=').slice(1).join('=')
  const index = args.findIndex((arg) => arg === name)
  if (index !== -1 && args[index + 1]) return args[index + 1]
  return null
}

const rootDir = process.cwd()
const dirArg = getArgValue('--dir') ?? '.tmp/sdk-lifecycle'
const targetDir = resolve(rootDir, dirArg)
const cleanup = getFlag('--cleanup')

const run = async () => {
  mkdirSync(targetDir, { recursive: true })
  process.chdir(targetDir)

  await continuum.task.init()

  const task = await continuum.task.create({
    title: `SDK lifecycle ${new Date().toISOString()}`,
    type: 'investigation',
    description: 'Exercise create, steps, notes, and completion.',
    intent: 'Validate task lifecycle via SDK',
    plan: [
      '## Plan',
      '- Create task',
      '- Add steps',
      '- Complete steps',
      '- Add discovery + decision',
      '- Mark task completed',
    ].join('\n'),
  })

  const withSteps = await continuum.task.update(task.id, {
    steps: {
      add: [
        {
          title: 'Add steps',
          description: 'Create two steps using SDK update.',
          position: 1,
        },
        {
          title: 'Complete steps',
          description: 'Mark steps completed.',
          position: 2,
        },
      ],
    },
  })

  await continuum.task.update(task.id, {
    steps: {
      update: withSteps.steps.map((step) => ({
        id: step.id,
        status: 'completed',
      })),
    },
  })

  await continuum.task.update(task.id, {
    discoveries: {
      add: [
        {
          content: 'SDK uses task.update for steps and notes.',
          source: 'agent',
          impact: 'One API surface for changes.',
        },
      ],
    },
  })

  await continuum.task.update(task.id, {
    decisions: {
      add: [
        {
          content: 'Record outcomes as discoveries/decisions.',
          rationale: 'No dedicated note endpoints.',
          source: 'agent',
        },
      ],
    },
  })

  await continuum.task.complete(task.id, {
    outcome: 'Lifecycle script completed and verified SDK flow.',
  })

  console.log('sdk-lifecycle: ok')
  console.log(`task: ${task.id}`)
  console.log(`dir: ${targetDir}`)

  if (cleanup) {
    await continuum.task.delete(task.id)
    console.log('sdk-lifecycle: cleaned up')
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
