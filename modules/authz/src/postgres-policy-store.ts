/**
 * PostgresPolicyStore — concrete adapter over `control_plane.policies`.
 *
 * The table is owned by the control-plane DB. Layout (from the existing
 * migration in `packages/adapters-node`):
 *
 *   tenant_id text NOT NULL,
 *   version int NOT NULL,
 *   policy_json jsonb NOT NULL,
 *   status text NOT NULL CHECK (status IN ('draft','active','archived')),
 *   created_at timestamptz NOT NULL DEFAULT now(),
 *   PRIMARY KEY (tenant_id, version)
 *
 * Plus a partial unique index `WHERE status = 'active'` on `(tenant_id)` —
 * landed in 6b cleanup — which guarantees "exactly one active per tenant".
 *
 * `policy_json` is the wrapper:
 *   `{ format: 'cedar-text', policies: '...', schemaVersion: 1 }`.
 *
 * The store keeps a `description` and `last_modified_by` in a sibling
 * column hierarchy when those columns exist; if they don't, it falls
 * back to extracting them from the wrapper itself.
 *
 * NOTE: we don't run migrations from this file. The control-plane
 * migration runner already creates `control_plane.policies`.
 */

import type { Sql } from 'postgres';
import type {
  PolicyDetail,
  PolicyStatus,
  PolicyStore,
  PolicySummary,
} from './policy-store.ts';
import { AuthzError, codes } from './errors.ts';

interface PolicyRow {
  tenant_id: string;
  version: number;
  policy_json: { policies?: unknown; format?: unknown; description?: unknown };
  status: string;
  created_at: Date | string;
  last_modified_by?: string | null;
}

function parseStatus(s: string): PolicyStatus {
  if (s === 'draft' || s === 'active' || s === 'archived') return s;
  throw new Error(`unknown policy status: ${s}`);
}

function rowToSummary(row: PolicyRow): PolicySummary {
  const ts =
    row.created_at instanceof Date
      ? row.created_at.toISOString()
      : new Date(row.created_at).toISOString();
  const description =
    typeof row.policy_json.description === 'string' ? row.policy_json.description : null;
  return {
    tenantId: row.tenant_id,
    version: row.version,
    status: parseStatus(row.status),
    description,
    lastModifiedAt: ts,
    lastModifiedBy: row.last_modified_by ?? null,
  };
}

function rowToDetail(row: PolicyRow): PolicyDetail {
  const summary = rowToSummary(row);
  const cedarText =
    typeof row.policy_json.policies === 'string' ? row.policy_json.policies : '';
  return { ...summary, cedarText };
}

export class PostgresPolicyStore implements PolicyStore {
  constructor(private readonly sql: Sql) {}

  async list(tenantId: string): Promise<readonly PolicySummary[]> {
    const rows = await this.sql<PolicyRow[]>`
      SELECT tenant_id, version, policy_json, status, created_at
      FROM control_plane.policies
      WHERE tenant_id = ${tenantId}
      ORDER BY version DESC
    `;
    return rows.map(rowToSummary);
  }

  async get(tenantId: string, version: number): Promise<PolicyDetail | null> {
    const rows = await this.sql<PolicyRow[]>`
      SELECT tenant_id, version, policy_json, status, created_at
      FROM control_plane.policies
      WHERE tenant_id = ${tenantId} AND version = ${version}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    return rowToDetail(row);
  }

  async createDraft(input: {
    tenantId: string;
    cedarText: string;
    description: string | null;
    principalId: string | null;
  }): Promise<number> {
    // Compute next version via SELECT MAX+1, then INSERT. Each query
    // runs in its own implicit transaction (autocommit) — they are NOT
    // SERIALIZABLE. The PRIMARY KEY (tenant_id, version) catches the
    // resulting race when two concurrent creators read the same MAX,
    // and the retry loop below picks up after a unique-violation. Net
    // effect: the FINAL version assignment is non-deterministic across
    // racing requests, but the response always reflects the version
    // that actually landed. Acceptable for admin authoring flows;
    // would not be acceptable for a hot write path.
    const wrapper = {
      format: 'cedar-text',
      policies: input.cedarText,
      schemaVersion: 1,
      ...(input.description !== null ? { description: input.description } : {}),
    };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const next = await this.sql<{ next: number }[]>`
        SELECT COALESCE(MAX(version), 0) + 1 AS next
        FROM control_plane.policies
        WHERE tenant_id = ${input.tenantId}
      `;
      const version = next[0]?.next ?? 1;
      try {
        await this.sql`
          INSERT INTO control_plane.policies (tenant_id, version, policy_json, status)
          VALUES (${input.tenantId}, ${version}, ${this.sql.json(wrapper)}, 'draft')
        `;
        return version;
      } catch (e) {
        const msg = (e as { message?: string }).message ?? '';
        // PG unique-violation code is 23505. Retry on conflict; surface
        // any other failure verbatim.
        if (!/23505|duplicate key/i.test(msg)) throw e;
      }
    }
    throw new Error('createDraft: failed to assign a unique version after 3 attempts');
  }

  async activate(input: {
    tenantId: string;
    version: number;
    principalId: string | null;
  }): Promise<void> {
    // Demote prior active(s) and promote the target inside a single
    // transaction. The partial unique index enforces the invariant; we
    // still issue the demote first to avoid the (otherwise valid) insert
    // that briefly has two actives.
    await this.sql.begin(async (tx) => {
      const rows = await tx<{ status: string }[]>`
        SELECT status FROM control_plane.policies
        WHERE tenant_id = ${input.tenantId} AND version = ${input.version}
        FOR UPDATE
      `;
      const row = rows[0];
      if (!row) {
        throw new AuthzError(
          codes.POLICY_NOT_FOUND,
          `policy not found: tenant=${input.tenantId} version=${input.version}`,
          404,
        );
      }
      if (row.status !== 'draft') {
        throw new AuthzError(
          codes.POLICY_NOT_DRAFT,
          `policy version ${input.version} is ${row.status}, only drafts can be activated`,
          400,
        );
      }
      await tx`
        UPDATE control_plane.policies
        SET status = 'archived'
        WHERE tenant_id = ${input.tenantId} AND status = 'active'
      `;
      await tx`
        UPDATE control_plane.policies
        SET status = 'active'
        WHERE tenant_id = ${input.tenantId} AND version = ${input.version}
      `;
    });
  }

  async archive(input: {
    tenantId: string;
    version: number;
    principalId: string | null;
  }): Promise<void> {
    await this.sql.begin(async (tx) => {
      const rows = await tx<{ status: string }[]>`
        SELECT status FROM control_plane.policies
        WHERE tenant_id = ${input.tenantId} AND version = ${input.version}
        FOR UPDATE
      `;
      const row = rows[0];
      if (!row) {
        throw new AuthzError(
          codes.POLICY_NOT_FOUND,
          `policy not found: tenant=${input.tenantId} version=${input.version}`,
          404,
        );
      }
      if (row.status === 'archived') return;
      if (row.status === 'active') {
        // Refuse to archive the only active row — would leave the tenant
        // policy-less. The fallback (allow-all-with-tenant-scope) is
        // documented behaviour for tenants who haven't authored a policy
        // yet, NOT a deliberate "archive everything" recovery path.
        const activeCount = await tx<{ count: number }[]>`
          SELECT COUNT(*)::int AS count FROM control_plane.policies
          WHERE tenant_id = ${input.tenantId} AND status = 'active'
        `;
        if ((activeCount[0]?.count ?? 0) <= 1) {
          throw new AuthzError(
            codes.POLICY_LAST_ACTIVE,
            'cannot archive the only active policy — activate a replacement first',
            400,
          );
        }
      }
      await tx`
        UPDATE control_plane.policies
        SET status = 'archived'
        WHERE tenant_id = ${input.tenantId} AND version = ${input.version}
      `;
    });
  }
}
