/**
 * Migration SQL loader.
 *
 * During development/testing: loads SQL from file system
 * When bundled: the build process replaces this with an inline version
 */

export interface Migration {
  version: number;
  sql: string;
}

let cachedMigrations: Migration[] | null = null;

export async function getMigrations(): Promise<Migration[]> {
  if (cachedMigrations) return cachedMigrations;

  const migrations: Migration[] = [];

  const migration001Path = new URL("./migrations/001_initial.sql", import.meta.url).pathname;
  migrations.push({
    version: 1,
    sql: await Bun.file(migration001Path).text()
  });

  const migration002Path = new URL("./migrations/002_execution_model.sql", import.meta.url).pathname;
  migrations.push({
    version: 2,
    sql: await Bun.file(migration002Path).text()
  });

  cachedMigrations = migrations;
  return migrations;
}
