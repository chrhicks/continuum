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
const dirArg = getArgValue('--dir') ?? '.tmp/sdk-backlog'
const targetDir = resolve(rootDir, dirArg)
const cleanup = getFlag('--cleanup')

const run = async () => {
  mkdirSync(targetDir, { recursive: true })
  process.chdir(targetDir)

  await continuum.task.init()

  const epic = await continuum.task.create({
    title: `Epic: SDK backlog ${new Date().toISOString()}`,
    type: 'epic',
    description: 'Bootstrap an epic with blocked features.',
  })

  const featureA = await continuum.task.create({
    title: 'Feature A: ingest pipeline',
    type: 'feature',
    status: 'blocked',
    description: 'Build ingestion pipeline for logs.',
    parentId: epic.id,
    blockedBy: [epic.id],
  })

  const featureB = await continuum.task.create({
    title: 'Feature B: reporting UI',
    type: 'feature',
    status: 'blocked',
    description: 'Create reporting dashboard for analytics.',
    parentId: epic.id,
    blockedBy: [featureA.id],
  })

  await continuum.task.update(epic.id, { status: 'ready' })

  await continuum.task.update(featureA.id, {
    status: 'ready',
    blockedBy: [],
  })

  const ready = await continuum.task.list({
    status: 'ready',
    type: 'feature',
    sort: 'updatedAt',
    order: 'desc',
    limit: 10,
  })

  console.log('sdk-backlog-bootstrap: ok')
  console.log(`epic: ${epic.id}`)
  console.log(`featureA: ${featureA.id}`)
  console.log(`featureB: ${featureB.id}`)
  console.log(
    `ready-features: ${ready.tasks.map((task) => task.id).join(', ')}`,
  )
  console.log(`dir: ${targetDir}`)

  if (cleanup) {
    await continuum.task.delete(featureB.id)
    await continuum.task.delete(featureA.id)
    await continuum.task.delete(epic.id)
    console.log('sdk-backlog-bootstrap: cleaned up')
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
