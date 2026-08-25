import { Effect, Layer } from 'effect'
import {
  BackupConfiguration,
  backupConfigurationLayer,
  readBackupConfig,
} from './config'
import type { BackupConfigurationError, BackupDecodeError } from './errors'
import {
  BackupObjectStore,
  wranglerObjectStoreLayer,
  type WranglerObjectStoreOptions,
} from './object-store'

export type BackupRuntimeOptions = Omit<
  WranglerObjectStoreOptions,
  'bucket'
> & {
  workspaceRoot: string
}

export function backupRuntimeLayer(
  options: BackupRuntimeOptions,
): Layer.Layer<
  BackupConfiguration | BackupObjectStore,
  BackupConfigurationError | BackupDecodeError
> {
  const { workspaceRoot, ...objectStoreOptions } = options
  return Layer.unwrap(
    readBackupConfig(workspaceRoot).pipe(
      Effect.map((config) =>
        Layer.mergeAll(
          backupConfigurationLayer(config),
          wranglerObjectStoreLayer({
            ...objectStoreOptions,
            bucket: config.bucket,
          }),
        ),
      ),
    ),
  )
}
