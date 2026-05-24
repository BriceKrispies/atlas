/**
 * PostgresClusterStore — Postgres-backed `ClusterStore` over
 * `control_plane.clusters` (installed by
 * `migrations/control-plane/00000006_clusters.sql`).
 *
 * Platform-level (no `tenantId`): clusters apply across the whole deployment.
 * Register/disable are idempotent (I3): `add` of an existing `clusterId` is a
 * no-op that leaves the original row untouched (`ON CONFLICT DO NOTHING`);
 * `disable` of an already-disabled or unknown id affects zero rows.
 *
 * Mirrors the shape of `PostgresCustomDomainStore`. See
 * `specs/domains/compute/cluster/capabilities/cluster-registration/README.md`.
 */
import type {
  ClusterAddInput,
  ClusterAuthKind,
  ClusterRecord,
  ClusterStatus,
  ClusterStore,
} from '@atlas/ports';
import type postgres from 'postgres';

interface ClusterRow {
  cluster_id: string;
  name: string;
  endpoint: string;
  auth_kind: ClusterAuthKind;
  auth_secret: string;
  region: string | null;
  status: ClusterStatus;
  // postgres.js returns timestamptz as a Date unless globally overridden;
  // normalize to an RFC-3339 string in rowToRecord.
  created_at: string | Date;
}

function rowToRecord(row: ClusterRow): ClusterRecord {
  return {
    clusterId: row.cluster_id,
    name: row.name,
    endpoint: row.endpoint,
    authKind: row.auth_kind,
    authSecret: row.auth_secret,
    region: row.region,
    status: row.status,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
  };
}

const COLUMNS =
  'cluster_id, name, endpoint, auth_kind, auth_secret, region, status, created_at';

export class PostgresClusterStore implements ClusterStore {
  constructor(private readonly sql: postgres.Sql) {}

  async add(input: ClusterAddInput): Promise<void> {
    // Idempotent: an existing cluster_id is left untouched (I3).
    await this.sql`
      INSERT INTO control_plane.clusters (
        cluster_id, name, endpoint, auth_kind, auth_secret, region
      ) VALUES (
        ${input.clusterId},
        ${input.name},
        ${input.endpoint},
        ${input.authKind},
        ${input.authSecret},
        ${input.region ?? null}
      )
      ON CONFLICT (cluster_id) DO NOTHING
    `;
  }

  async get(clusterId: string): Promise<ClusterRecord | null> {
    const rows = await this.sql<ClusterRow[]>`
      SELECT ${this.sql.unsafe(COLUMNS)}
      FROM control_plane.clusters
      WHERE cluster_id = ${clusterId}
      LIMIT 1
    `;
    const row = rows[0];
    return row ? rowToRecord(row) : null;
  }

  async list(opts?: { activeOnly?: boolean }): Promise<ReadonlyArray<ClusterRecord>> {
    const rows = opts?.activeOnly
      ? await this.sql<ClusterRow[]>`
          SELECT ${this.sql.unsafe(COLUMNS)}
          FROM control_plane.clusters
          WHERE status = 'active'
          ORDER BY created_at ASC
        `
      : await this.sql<ClusterRow[]>`
          SELECT ${this.sql.unsafe(COLUMNS)}
          FROM control_plane.clusters
          ORDER BY created_at ASC
        `;
    return rows.map(rowToRecord);
  }

  async disable(clusterId: string): Promise<void> {
    // Idempotent: zero rows affected when already disabled or unknown (I3).
    await this.sql`
      UPDATE control_plane.clusters
      SET status = 'disabled'
      WHERE cluster_id = ${clusterId}
        AND status <> 'disabled'
    `;
  }
}
