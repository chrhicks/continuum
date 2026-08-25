import { Context, Effect, Layer } from 'effect'
import { createClient } from '../../db/client'
import { runMigrations } from '../../db/migrate'
import { DatabaseMigrationError, DatabaseOpenError } from '../domain/errors'
import {
  memoryResourceOwner,
  type MemoryResourceOwner,
  type MemoryResourcePaths,
} from '../application/resource-owner'

export type MemoryRuntimeConfig = MemoryResourcePaths

export type MemoryRuntimeService = MemoryResourceOwner

export class MemoryRuntime extends Context.Service<
  MemoryRuntime,
  MemoryRuntimeService
>()('continuum/MemoryRuntime') {}

export function memoryRuntimeLayer(
  config: MemoryRuntimeConfig,
): Layer.Layer<MemoryRuntime, DatabaseOpenError | DatabaseMigrationError> {
  return Layer.effect(
    MemoryRuntime,
    Effect.acquireRelease(openMemoryDatabase(config), (service) =>
      Effect.sync(() => service.handle.sqlite.close()),
    ),
  )
}

const openMemoryDatabase = Effect.fn('MemoryRuntime.open')(function* (
  config: MemoryRuntimeConfig,
) {
  const handle = yield* Effect.try({
    try: () => createClient(config.dbPath),
    catch: (cause) => new DatabaseOpenError({ path: config.dbPath, cause }),
  })
  yield* Effect.try({
    try: () => runMigrations(handle.sqlite),
    catch: (cause) => {
      handle.sqlite.close()
      return new DatabaseMigrationError({ path: config.dbPath, cause })
    },
  })
  return MemoryRuntime.of(memoryResourceOwner(config, handle))
})
