/**
 * PostgresRepositoryRevisionStore — Postgres-backed `RepositoryRevisionStore`.
 *
 * Schema is installed by the bundled tenant migration
 * `migrations/tenant/<timestamp>_repositories.sql` (run via the
 * @atlas/adapter-node migration runner). The `bytes` column is BYTEA —
 * postgres.js accepts a `Uint8Array` (or `Buffer`) on insert and returns
 * a Node `Buffer` on select (`Buffer` is a subclass of `Uint8Array`, so
 * we hand it back unchanged).
 *
 * `tenantId` is part of the port surface for cross-adapter parity, but
 * per-tenant DBs already isolate at the connection level — the
 * underlying `postgres.Sql` is bound to a single tenant DB by the
 * tenant-db provider, so this adapter does NOT filter by a `tenant_id`
 * column. See `specs/domains/code/repository/capabilities/upload-tarball/README.md`.
 *
 * Phase 1 stores tarball bytes inline in BYTEA. When `storage/object-storage`
 * lands, the bytes column moves out and this adapter switches to a
 * presigned-URL flow — the port surface is intentionally narrow so that
 * migration is local to this file.
 */

import type { RepositoryRevisionStore, RevisionRecord } from '@atlas/ports';
import type postgres from 'postgres';

interface RevisionMetadataRow {
  revision_id: string;
  repo_id: string;
  byte_count: number;
  content_hash: string;
  pushed_at: Date | string;
  pushed_by: string;
  correlation_id: string;
}

interface RevisionBytesRow {
  bytes: Uint8Array;
}

function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function rowToRevision(row: RevisionMetadataRow): RevisionRecord {
  return {
    revisionId: row.revision_id,
    repoId: row.repo_id,
    byteCount: row.byte_count,
    contentHash: row.content_hash,
    pushedAt: toIso(row.pushed_at),
    pushedBy: row.pushed_by,
    correlationId: row.correlation_id,
  };
}

export class PostgresRepositoryRevisionStore implements RepositoryRevisionStore {
  constructor(private readonly sql: postgres.Sql) {}

  async getMetadata(_tenantId: string, revisionId: string): Promise<RevisionRecord | null> {
    const rows = await this.sql<RevisionMetadataRow[]>`
      SELECT revision_id, repo_id, byte_count, content_hash,
             pushed_at, pushed_by, correlation_id
      FROM repository_revisions
      WHERE revision_id = ${revisionId}
      LIMIT 1
    `;
    const row = rows[0];
    return row ? rowToRevision(row) : null;
  }

  async listForRepo(_tenantId: string, repoId: string): Promise<readonly RevisionRecord[]> {
    // Index `repository_revisions_by_repo` covers this — newest first.
    const rows = await this.sql<RevisionMetadataRow[]>`
      SELECT revision_id, repo_id, byte_count, content_hash,
             pushed_at, pushed_by, correlation_id
      FROM repository_revisions
      WHERE repo_id = ${repoId}
      ORDER BY pushed_at DESC
    `;
    return rows.map(rowToRevision);
  }

  async getBytes(_tenantId: string, revisionId: string): Promise<Uint8Array | null> {
    // postgres.js returns BYTEA as a Node `Buffer`, which is a subclass
    // of `Uint8Array` — return it as-is. Callers that need to copy can
    // do so themselves.
    const rows = await this.sql<RevisionBytesRow[]>`
      SELECT bytes
      FROM repository_revisions
      WHERE revision_id = ${revisionId}
      LIMIT 1
    `;
    const row = rows[0];
    return row ? row.bytes : null;
  }

  async append(
    _tenantId: string,
    input: {
      revisionId: string;
      repoId: string;
      bytes: Uint8Array;
      byteCount: number;
      contentHash: string;
      pushedBy: string;
      correlationId: string;
    },
  ): Promise<void> {
    // `pushed_at` is left to Postgres `now()` — input has no field for
    // it, matching the migration default. The handler-emitted event
    // carries its own `occurredAt` independently.
    await this.sql`
      INSERT INTO repository_revisions (
        revision_id, repo_id, byte_count, content_hash, bytes,
        pushed_by, correlation_id
      ) VALUES (
        ${input.revisionId},
        ${input.repoId},
        ${input.byteCount},
        ${input.contentHash},
        ${input.bytes},
        ${input.pushedBy},
        ${input.correlationId}
      )
    `;
  }
}
