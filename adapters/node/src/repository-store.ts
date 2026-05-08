/**
 * PostgresRepositoryStore — Postgres-backed `RepositoryStore`.
 *
 * Schema is installed by the bundled tenant migration
 * `migrations/tenant/<timestamp>_repositories.sql` (run via the
 * @atlas/adapter-node migration runner). See
 * `specs/domains/code/repository/capabilities/upload-tarball/README.md`
 * for the column shape and the larger upload-tarball flow.
 *
 * `tenantId` is part of the port surface for cross-adapter parity, but
 * per-tenant DBs already isolate at the connection level — the
 * underlying `postgres.Sql` is bound to a single tenant DB by the
 * tenant-db provider, so this adapter does NOT filter by a `tenant_id`
 * column. The argument is accepted only so the cross-adapter contract
 * (incl. the IDB stub) lines up.
 */

import type { RepositoryRecord, RepositoryStore } from '@atlas/ports';
import type postgres from 'postgres';

interface RepositoryRow {
  repo_id: string;
  repo_slug: string;
  name: string;
  description: string | null;
  created_at: Date | string;
  created_by: string;
}

function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function rowToRepository(row: RepositoryRow): RepositoryRecord {
  return {
    repoId: row.repo_id,
    repoSlug: row.repo_slug,
    name: row.name,
    description: row.description,
    createdAt: toIso(row.created_at),
    createdBy: row.created_by,
  };
}

export class PostgresRepositoryStore implements RepositoryStore {
  constructor(private readonly sql: postgres.Sql) {}

  async getBySlug(_tenantId: string, repoSlug: string): Promise<RepositoryRecord | null> {
    const rows = await this.sql<RepositoryRow[]>`
      SELECT repo_id, repo_slug, name, description, created_at, created_by
      FROM repositories
      WHERE repo_slug = ${repoSlug}
      LIMIT 1
    `;
    const row = rows[0];
    return row ? rowToRepository(row) : null;
  }

  async get(_tenantId: string, repoId: string): Promise<RepositoryRecord | null> {
    const rows = await this.sql<RepositoryRow[]>`
      SELECT repo_id, repo_slug, name, description, created_at, created_by
      FROM repositories
      WHERE repo_id = ${repoId}
      LIMIT 1
    `;
    const row = rows[0];
    return row ? rowToRepository(row) : null;
  }

  async list(_tenantId: string): Promise<readonly RepositoryRecord[]> {
    const rows = await this.sql<RepositoryRow[]>`
      SELECT repo_id, repo_slug, name, description, created_at, created_by
      FROM repositories
      ORDER BY created_at ASC
    `;
    return rows.map(rowToRepository);
  }

  async create(
    _tenantId: string,
    input: {
      repoId: string;
      repoSlug: string;
      name: string;
      description?: string | null;
      createdBy: string;
    },
  ): Promise<void> {
    // `created_at` is left to Postgres `now()` — input has no field for
    // it, mirroring the migration default. The handler doesn't pass a
    // timestamp; events carry their own `occurredAt` separately.
    await this.sql`
      INSERT INTO repositories (
        repo_id, repo_slug, name, description, created_by
      ) VALUES (
        ${input.repoId},
        ${input.repoSlug},
        ${input.name},
        ${input.description ?? null},
        ${input.createdBy}
      )
    `;
  }
}
