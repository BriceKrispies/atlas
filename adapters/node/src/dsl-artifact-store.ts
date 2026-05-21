/**
 * PostgresDslArtifactStore — adapter for the `DslArtifactStore` port.
 *
 * Storage shape per ADR 0007 §3 + revised ADR 0005 db-per-tenant:
 *   - `public._atlas_dsl_<kind>`           current row, one per (tenantId, apiName)
 *   - `public._atlas_dsl_<kind>_versions`  append-only history
 *
 * Both tables sit inside the tenant's database. The adapter is constructed
 * against a per-tenant `Sql` (typically resolved via
 * `PostgresTenantDbProvider.getPool(tenantId)`); the connection IS the
 * tenant boundary.
 *
 * Lazy bootstrap: `ensureKindRegistered(kind)` runs `CREATE TABLE IF NOT
 * EXISTS` for both tables. Idempotent. The adapter caches "kind already
 * bootstrapped" in memory to avoid the round-trip on subsequent saves —
 * the SQL is still safe to re-issue, but skipping it shaves a few ms on
 * hot writes.
 *
 * Identifier safety: `kind` is validated against `DSL_KIND_PATTERN` from
 * `@atlas/dsl-substrate` before being interpolated into table names.
 * Anything outside `[a-z][a-z0-9_]{1,30}` is rejected at the boundary.
 */

import type postgres from 'postgres';
import type { DslArtifactStore, SaveDslArtifactInput, SaveDslArtifactResult } from '@atlas/ports';
import type { DslArtifact, SourceMap, ArtifactRef } from '@atlas/dsl-substrate';
import { DSL_KIND_PATTERN, dslTableName, dslVersionsTableName } from '@atlas/dsl-substrate';

/**
 * DB row shape — snake_case columns, JSONB for structured fields. The
 * adapter narrows JSONB → typed objects at the boundary and accepts
 * caller-supplied TAst on the way back out.
 */
interface DslArtifactDbRow {
  artifact_id: string;
  api_name: string;
  tenant_id: string;
  version: string | number;
  substrate_version: string;
  source: string;
  ast: unknown;
  source_map: unknown;
  dependencies: unknown;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
}

function rowToArtifact<TAst>(row: DslArtifactDbRow, kind: string): DslArtifact<string, TAst> {
  return {
    kind,
    artifactId: row.artifact_id,
    apiName: row.api_name,
    tenantId: row.tenant_id,
    // Postgres bigint may come back as string; bigserial columns return numbers in postgres.js by default but we accept both.
    version: typeof row.version === 'string' ? Number.parseInt(row.version, 10) : row.version,
    substrateVersion: row.substrate_version,
    source: row.source,
    ast: row.ast as TAst,
    sourceMap: (row.source_map as SourceMap | null) ?? [],
    dependencies: (row.dependencies as ReadonlyArray<ArtifactRef> | null) ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

function assertKind(kind: string): void {
  if (!DSL_KIND_PATTERN.test(kind)) {
    throw new Error(
      `invalid DSL kind '${kind}' — must match ${DSL_KIND_PATTERN.toString()} (DSL_KIND_PATTERN)`,
    );
  }
}

export class PostgresDslArtifactStore implements DslArtifactStore {
  private readonly bootstrapped = new Set<string>();

  constructor(private readonly sql: postgres.Sql) {}

  async ensureKindRegistered(kind: string): Promise<void> {
    assertKind(kind);
    if (this.bootstrapped.has(kind)) return;

    const table = dslTableName(kind);
    const versionsTable = dslVersionsTableName(kind);

    // CREATE TABLE IF NOT EXISTS for both. JSONB for structured fields;
    // BIGINT for monotonic version. UNIQUE (tenant_id, api_name) on the
    // current table because the row IS the latest version. Composite PK
    // (artifact_id, version) on the versions table because multiple
    // versions of the same artifact coexist.
    await this.sql.unsafe(`
      CREATE TABLE IF NOT EXISTS public.${table} (
        artifact_id        UUID PRIMARY KEY,
        api_name           TEXT NOT NULL,
        tenant_id          TEXT NOT NULL,
        version            BIGINT NOT NULL,
        substrate_version  TEXT NOT NULL,
        source             TEXT NOT NULL,
        ast                JSONB NOT NULL,
        source_map         JSONB NOT NULL,
        dependencies       JSONB NOT NULL,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by         TEXT NOT NULL,
        updated_by         TEXT NOT NULL,
        UNIQUE (tenant_id, api_name)
      )
    `);

    await this.sql.unsafe(`
      CREATE TABLE IF NOT EXISTS public.${versionsTable} (
        artifact_id        UUID NOT NULL,
        version            BIGINT NOT NULL,
        api_name           TEXT NOT NULL,
        tenant_id          TEXT NOT NULL,
        substrate_version  TEXT NOT NULL,
        source             TEXT NOT NULL,
        ast                JSONB NOT NULL,
        source_map         JSONB NOT NULL,
        dependencies       JSONB NOT NULL,
        created_at         TIMESTAMPTZ NOT NULL,
        updated_at         TIMESTAMPTZ NOT NULL,
        created_by         TEXT NOT NULL,
        updated_by         TEXT NOT NULL,
        PRIMARY KEY (artifact_id, version)
      )
    `);

    this.bootstrapped.add(kind);
  }

  async save<TAst>(input: SaveDslArtifactInput<TAst>): Promise<SaveDslArtifactResult<TAst>> {
    assertKind(input.kind);
    await this.ensureKindRegistered(input.kind);

    const table = dslTableName(input.kind);
    const versionsTable = dslVersionsTableName(input.kind);

    // Single transaction so a crash mid-save leaves the row at its prior
    // version, not at a torn state. The transaction:
    //   1. SELECT current row by (tenant_id, api_name) FOR UPDATE — locks
    //      the row if it exists.
    //   2. If no row: INSERT with version=1, fresh artifactId. Return
    //      'inserted'.
    //   3. If row exists: copy current row to versions table, UPDATE
    //      with version+1 and new payload. Return 'versioned'.
    return this.sql.begin(async (tx) => {
      const existing = await tx<DslArtifactDbRow[]>`
        SELECT * FROM public.${tx(table)}
        WHERE tenant_id = ${input.tenantId} AND api_name = ${input.apiName}
        FOR UPDATE
      `;

      if (existing.length === 0) {
        // First save. Mint UUID server-side via gen_random_uuid().
        const inserted = await tx<DslArtifactDbRow[]>`
          INSERT INTO public.${tx(table)} (
            artifact_id, api_name, tenant_id, version, substrate_version,
            source, ast, source_map, dependencies,
            created_by, updated_by
          ) VALUES (
            gen_random_uuid(),
            ${input.apiName},
            ${input.tenantId},
            1,
            ${input.substrateVersion},
            ${input.source},
            ${tx.json(input.ast as unknown)},
            ${tx.json(input.sourceMap as unknown)},
            ${tx.json(input.dependencies as unknown)},
            ${input.createdBy},
            ${input.createdBy}
          )
          RETURNING *
        `;
        const row = inserted[0];
        if (!row) throw new Error('DSL artifact insert returned no row');
        return {
          artifact: rowToArtifact<TAst>(row, input.kind),
          outcome: 'inserted' as const,
        };
      }

      const prior = existing[0];
      if (!prior) throw new Error('DSL artifact SELECT returned no row after length check');

      // Copy prior row into versions table.
      await tx`
        INSERT INTO public.${tx(versionsTable)} (
          artifact_id, version, api_name, tenant_id, substrate_version,
          source, ast, source_map, dependencies,
          created_at, updated_at, created_by, updated_by
        ) VALUES (
          ${prior.artifact_id},
          ${prior.version},
          ${prior.api_name},
          ${prior.tenant_id},
          ${prior.substrate_version},
          ${prior.source},
          ${tx.json(prior.ast)},
          ${tx.json(prior.source_map)},
          ${tx.json(prior.dependencies)},
          ${prior.created_at},
          ${prior.updated_at},
          ${prior.created_by},
          ${prior.updated_by}
        )
      `;

      // Replace current row with new version.
      const nextVersion =
        (typeof prior.version === 'string' ? Number.parseInt(prior.version, 10) : prior.version) +
        1;
      const updated = await tx<DslArtifactDbRow[]>`
        UPDATE public.${tx(table)} SET
          version = ${nextVersion},
          substrate_version = ${input.substrateVersion},
          source = ${input.source},
          ast = ${tx.json(input.ast as unknown)},
          source_map = ${tx.json(input.sourceMap as unknown)},
          dependencies = ${tx.json(input.dependencies as unknown)},
          updated_at = now(),
          updated_by = ${input.createdBy}
        WHERE tenant_id = ${input.tenantId} AND api_name = ${input.apiName}
        RETURNING *
      `;
      const row = updated[0];
      if (!row) throw new Error('DSL artifact UPDATE returned no row');
      return {
        artifact: rowToArtifact<TAst>(row, input.kind),
        outcome: 'versioned' as const,
      };
    }) as Promise<SaveDslArtifactResult<TAst>>;
  }

  async get<TAst>(kind: string, apiName: string): Promise<DslArtifact<string, TAst> | null> {
    assertKind(kind);
    if (!this.bootstrapped.has(kind)) {
      // Reading from a kind that's never been bootstrapped just means no
      // artifact exists. Don't lazy-bootstrap on read — that would create
      // empty tables for kinds nobody has authored against yet.
      const tableExists = await this.tableExists(dslTableName(kind));
      if (!tableExists) return null;
    }
    const rows = await this.sql<DslArtifactDbRow[]>`
      SELECT * FROM public.${this.sql(dslTableName(kind))}
      WHERE api_name = ${apiName}
      LIMIT 1
    `;
    const row = rows[0];
    return row ? rowToArtifact<TAst>(row, kind) : null;
  }

  async getVersion<TAst>(
    kind: string,
    apiName: string,
    version: number,
  ): Promise<DslArtifact<string, TAst> | null> {
    assertKind(kind);
    if (!this.bootstrapped.has(kind)) {
      const tableExists = await this.tableExists(dslTableName(kind));
      if (!tableExists) return null;
    }

    // First try the current table (latest version).
    const current = await this.sql<DslArtifactDbRow[]>`
      SELECT * FROM public.${this.sql(dslTableName(kind))}
      WHERE api_name = ${apiName} AND version = ${version}
      LIMIT 1
    `;
    if (current[0]) return rowToArtifact<TAst>(current[0], kind);

    // Fall back to versions table.
    const historical = await this.sql<DslArtifactDbRow[]>`
      SELECT * FROM public.${this.sql(dslVersionsTableName(kind))}
      WHERE api_name = ${apiName} AND version = ${version}
      LIMIT 1
    `;
    const row = historical[0];
    return row ? rowToArtifact<TAst>(row, kind) : null;
  }

  async getById<TAst>(kind: string, artifactId: string): Promise<DslArtifact<string, TAst> | null> {
    assertKind(kind);
    if (!this.bootstrapped.has(kind)) {
      const tableExists = await this.tableExists(dslTableName(kind));
      if (!tableExists) return null;
    }
    const rows = await this.sql<DslArtifactDbRow[]>`
      SELECT * FROM public.${this.sql(dslTableName(kind))}
      WHERE artifact_id = ${artifactId}
      LIMIT 1
    `;
    const row = rows[0];
    return row ? rowToArtifact<TAst>(row, kind) : null;
  }

  async list<TAst>(kind: string): Promise<ReadonlyArray<DslArtifact<string, TAst>>> {
    assertKind(kind);
    if (!this.bootstrapped.has(kind)) {
      const tableExists = await this.tableExists(dslTableName(kind));
      if (!tableExists) return [];
    }
    const rows = await this.sql<DslArtifactDbRow[]>`
      SELECT * FROM public.${this.sql(dslTableName(kind))}
      ORDER BY api_name
    `;
    return rows.map((r) => rowToArtifact<TAst>(r, kind));
  }

  /**
   * Check whether `_atlas_dsl_<kind>` exists in `public`. Used on the read
   * path so a `get` against a never-bootstrapped kind returns `null`
   * cleanly rather than erroring on "relation does not exist".
   */
  private async tableExists(table: string): Promise<boolean> {
    const rows = await this.sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ${table}
      ) AS exists
    `;
    return rows[0]?.exists ?? false;
  }
}
