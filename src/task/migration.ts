/**
 * Migration SQL loader.
 *
 * During development/testing: loads SQL from file system
 * When bundled: the build process replaces this with an inline version
 */

export interface Migration {
  version: number
  sql: string
}

let cachedMigrations: Migration[] | null = null

const migrationFiles = [
  '001_initial.sql',
  '002_execution_model.sql',
  '003_sdk_alignment.sql',
]

export async function getMigrations(): Promise<Migration[]> {
  if (cachedMigrations) return cachedMigrations

  const migrations = await Promise.all(
    migrationFiles.map(async (file, index) => ({
      version: index + 1,
      sql: await Bun.file(
        new URL(`./migrations/${file}`, import.meta.url).pathname,
      ).text(),
    })),
  )

  cachedMigrations = migrations
  return migrations
}
