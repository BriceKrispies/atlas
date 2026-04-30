/**
 * Migration runner for the Postgres adapters.
 *
 * Mirrors the Rust runner in `crates/control_plane_db/src/lib.rs:37-110`:
 * - Tracks applied migrations in a `_migrations` table.
 * - Reads `.sql` files from a directory, sorts by filename
 *   (`YYYYMMDDHHMMSS_description.sql` rule), executes pending in order.
 * - Each unapplied migration runs in a transaction along with the
 *   bookkeeping insert into `_migrations`.
 *
 * **Differences from the Rust runner (intentional):**
 * - The Rust version splits SQL on `;` which trips on dollar-quoted strings
 *   and embedded `;` in comments. We instead pass each `.sql` file to
 *   postgres.js as a single multi-statement query via `sql.unsafe(content)`.
 *   postgres.js' simple-query path tolerates multi-statement SQL fine.
 *   This is strictly safer than the Rust naive splitter.
 */

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type postgres from 'postgres';

export type MigrationKind = 'control-plane' | 'tenant';

export interface MigrationRunResult {
  applied: string[];
}

const HERE = dirname(fileURLToPath(import.meta.url));

function migrationsDirFor(kind: MigrationKind): string {
  return join(HERE, kind);
}

function migrationsTableFor(kind: MigrationKind): string {
  // Control-plane keeps its bookkeeping inside the `control_plane` schema
  // (matches the Rust runner). Tenant DBs use `public._migrations`.
  return kind === 'control-plane' ? 'control_plane._migrations' : 'public._migrations';
}

/**
 * Run any pending migrations from the bundled directory of `.sql` files.
 *
 * Idempotent — re-running is a no-op once everything is applied.
 */
export async function runMigrations(
  sql: postgres.Sql,
  kind: MigrationKind,
): Promise<MigrationRunResult> {
  // Runtime narrowing: TS erases the union at runtime and `kind` flows
  // into `sql.unsafe(...)` via `migrationsTableFor`. Refuse anything that
  // isn't one of the two known string literals — keeps a future caller
  // from accidentally turning this into a SQL-injection sink.
  if (kind !== 'control-plane' && kind !== 'tenant') {
    throw new TypeError(
      `runMigrations: kind must be 'control-plane' | 'tenant', got ${String(kind)}`,
    );
  }

  // 1. Ensure schema + bookkeeping table exist.
  if (kind === 'control-plane') {
    await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS control_plane`);
  }
  const table = migrationsTableFor(kind);
  await sql.unsafe(
    `CREATE TABLE IF NOT EXISTS ${table} (
       id SERIAL PRIMARY KEY,
       filename TEXT NOT NULL UNIQUE,
       executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
  );

  // 2. Discover migration files.
  const dir = migrationsDirFor(kind);
  const all = await readdir(dir);
  const files = all
    .filter((f) => f.toLowerCase().endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  // 3. Find what's already applied.
  const existingRows = await sql.unsafe<{ filename: string }[]>(
    `SELECT filename FROM ${table}`,
  );
  const existing = new Set(existingRows.map((r) => r.filename));

  const applied: string[] = [];

  // 4. Apply pending in order, each in its own transaction.
  for (const filename of files) {
    if (existing.has(filename)) continue;
    const path = join(dir, filename);
    const content = await readFile(path, 'utf8');

    await sql.begin(async (tx) => {
      // postgres.js' `unsafe` allows multi-statement SQL when no parameters
      // are bound — exactly what migrations need.
      await tx.unsafe(content);
      await tx.unsafe(`INSERT INTO ${table} (filename) VALUES ($1)`, [filename]);
    });

    applied.push(filename);
  }

  return { applied };
}
