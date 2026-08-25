import { Command } from 'commander'
import { Effect, Result } from 'effect'
import { BackupConfiguration, configureBackup } from '../../backup/config'
import { BackupObjectStore } from '../../backup/object-store'
import { backupRuntimeLayer } from '../../backup/runtime'
import { createBackup, listBackups, restoreBackup } from '../../backup/service'
import { getBackupStatus, type BackupStatus } from '../../backup/status'
import { resolveWorkspaceContext } from '../../workspace/resolve'
import { runCommand } from '../io'

export function createBackupCommand(): Command {
  const command = new Command('backup')
    .description('Create and restore immutable Cloudflare R2 snapshots')
    .addHelpText(
      'after',
      '\nCredentials are inherited by Wrangler; Continuum never reads or stores them.',
    )
  addConfigureCommand(command)
  addStatusCommand(command)
  addCreateCommand(command)
  addListCommand(command)
  addRestoreCommand(command)
  return command
}

function addConfigureCommand(command: Command): void {
  command
    .command('configure')
    .description('Create project-local R2 backup identity and configuration')
    .requiredOption('--bucket <name>', 'Dedicated private R2 bucket')
    .option('--project-id <uuid>', 'Explicit portable project identity')
    .option('--writer-id <uuid>', 'Explicit single-writer identity')
    .action(async (options, actionCommand) => {
      await runCommand(
        actionCommand,
        async () => {
          const workspaceRoot = resolveWorkspaceContext().workspaceRoot
          return runEffect(configureBackup({ workspaceRoot, ...options }))
        },
        (config) => {
          console.log(`Configured R2 backup bucket: ${config.bucket}`)
          console.log(`Project ID: ${config.projectId}`)
          console.log(`Writer ID: ${config.writerId}`)
        },
      )
    })
}

function addStatusCommand(command: Command): void {
  command
    .command('status')
    .description('Compare local state with the remote backup head')
    .option('--wrangler <path>', 'Wrangler v4 executable')
    .action(async (options, actionCommand) => {
      await runCommand(
        actionCommand,
        async () => {
          const workspaceRoot = resolveWorkspaceContext().workspaceRoot
          return runConfiguredBackupOperation(
            workspaceRoot,
            options.wrangler,
            getBackupStatus(workspaceRoot),
          )
        },
        renderBackupStatus,
      )
    })
}

function addCreateCommand(command: Command): void {
  command
    .command('create')
    .description('Upload a verified immutable SQLite generation')
    .option('--wrangler <path>', 'Wrangler v4 executable')
    .action(async (options, actionCommand) => {
      await runCommand(
        actionCommand,
        async () => {
          const workspaceRoot = resolveWorkspaceContext().workspaceRoot
          return runConfiguredBackupOperation(
            workspaceRoot,
            options.wrangler,
            createBackup(workspaceRoot),
          )
        },
        (result) => {
          console.log(`Created R2 backup: ${result.generation}`)
          console.log(`SHA-256: ${result.digest}`)
          console.log(`Bytes: ${result.byteLength}`)
        },
      )
    })
}

function addListCommand(command: Command): void {
  command
    .command('list')
    .description('List verified generations by walking immutable lineage')
    .option('--limit <number>', 'Maximum generations', parseLimit, 100)
    .option('--wrangler <path>', 'Wrangler v4 executable')
    .action(async (options, actionCommand) => {
      await runCommand(
        actionCommand,
        async () => {
          const workspaceRoot = resolveWorkspaceContext().workspaceRoot
          return runConfiguredBackupOperation(
            workspaceRoot,
            options.wrangler,
            listBackups(workspaceRoot, options.limit),
          )
        },
        (manifests) => {
          if (manifests.length === 0) {
            console.log('No R2 backups found.')
            return
          }
          for (const manifest of manifests) {
            console.log(
              `${manifest.generation} ${manifest.database.digest} ${manifest.database.byteLength} bytes`,
            )
          }
        },
      )
    })
}

function addRestoreCommand(command: Command): void {
  command
    .command('restore')
    .description('Verify and atomically publish a separate recovery database')
    .option('--generation <id>', 'Generation (defaults to verified head)')
    .option(
      '--output <path>',
      'New destination; existing files are never replaced',
    )
    .option('--wrangler <path>', 'Wrangler v4 executable')
    .action(async (options, actionCommand) => {
      await runCommand(
        actionCommand,
        async () => {
          const workspaceRoot = resolveWorkspaceContext().workspaceRoot
          return runConfiguredBackupOperation(
            workspaceRoot,
            options.wrangler,
            restoreBackup(workspaceRoot, {
              generation: options.generation,
              outputPath: options.output,
            }),
          )
        },
        (result) => {
          console.log(`Restored R2 backup: ${result.generation}`)
          console.log(`Recovery database: ${result.outputPath}`)
          console.log(`SHA-256: ${result.digest}`)
        },
      )
    })
}

function renderBackupStatus(status: BackupStatus): void {
  console.log(`R2 backup status: ${status.state}`)
  console.log(`Checked at: ${status.checkedAt}`)
  console.log(`Freshness threshold: ${status.staleAfterSeconds} seconds`)
  console.log(`Local SHA-256: ${status.local.digest}`)
  if (status.remote) {
    console.log(`Remote generation: ${status.remote.generation}`)
    console.log(`Remote SHA-256: ${status.remote.digest}`)
    console.log(`Remote updated at: ${status.remote.updatedAt}`)
    console.log(`Remote age: ${status.remote.ageSeconds} seconds`)
  } else if (status.state === 'missing') {
    console.log('Remote: no backup head')
  } else {
    console.log(`Remote: unavailable (${status.errorCode})`)
  }
}

function runConfiguredBackupOperation<A, E>(
  workspaceRoot: string,
  executable: string | undefined,
  operation: Effect.Effect<A, E, BackupConfiguration | BackupObjectStore>,
): Promise<A> {
  const runtime = backupRuntimeLayer({
    workspaceRoot,
    ...(executable === undefined ? {} : { executable }),
  })
  return runEffect(operation.pipe(Effect.provide(runtime)))
}

async function runEffect<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  const result = await Effect.runPromise(Effect.result(effect))
  if (Result.isFailure(result)) throw result.failure
  return result.success
}

function parseLimit(value: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1_000) {
    throw new Error('Limit must be an integer between 1 and 1000')
  }
  return parsed
}
