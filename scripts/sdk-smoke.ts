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
const dirArg = getArgValue('--dir') ?? '.tmp/sdk-smoke'
const targetDir = resolve(rootDir, dirArg)
const keep = getFlag('--keep')

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

const run = async () => {
  mkdirSync(targetDir, { recursive: true })
  process.chdir(targetDir)

  await continuum.task.init()

  const listBefore = await continuum.task.list({ limit: 5 })
  assert(Array.isArray(listBefore.tasks), 'list should return tasks array')

  const created = await continuum.task.create({
    title: `SDK smoke ${new Date().toISOString()}`,
    type: 'chore',
    description: 'SDK smoke test task',
    plan: 'Plan: create, update, delete',
  })
  assert(created.id, 'create should return id')

  const fetched = await continuum.task.get(created.id)
  assert(fetched?.id === created.id, 'get should return created task')

  const updated = await continuum.task.update(created.id, {
    title: `${created.title} (updated)`,
  })
  assert(updated.title.includes('updated'), 'update should change title')

  const listAfter = await continuum.task.list({ limit: 50 })
  assert(
    listAfter.tasks.some((task) => task.id === created.id),
    'list should include created task',
  )

  if (!keep) {
    await continuum.task.delete(created.id)
    const afterDelete = await continuum.task.get(created.id)
    assert(
      afterDelete?.status === 'deleted',
      'get after delete should be deleted',
    )

    const listWithDeleted = await continuum.task.list({
      includeDeleted: true,
      limit: 50,
    })
    assert(
      listWithDeleted.tasks.some((task) => task.id === created.id),
      'list includeDeleted should include deleted',
    )
  }

  console.log('sdk-smoke: ok')
  console.log(`dir: ${targetDir}`)
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
