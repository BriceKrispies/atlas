/**
 * Per-tenant Cedar policy bundle loaders.
 *
 * The `control_plane.policies` table stores rows shaped
 *   (tenant_id, version, policy_json jsonb, status, created_at)
 *
 * with `policy_json` carrying a wrapper:
 *
 *   { "format": "cedar-text", "policies": "permit (...)\n...", "schemaVersion": 1 }
 *
 * The wrapper lets us slot in additional formats (precompiled JSON AST, etc.)
 * later without a DB migration. v1 only accepts `format: "cedar-text"`; any
 * other value is a hard reject so a misconfigured tenant fails loud rather
 * than silently denying every request.
 *
 * `BundledFixtureLoader` is the in-memory variant for tests / sim mode; it
 * skips the DB entirely.
 *
 * NOTE on activation atomicity: a partial unique index
 * (`WHERE status='active'`) on `(tenant_id)` enforces "exactly one
 * active row per tenant" at the DB layer (migration
 * `20260428000001_policies_unique_active.sql`). The
 * `ORDER BY version DESC LIMIT 1` query stays as belt-and-braces — if a
 * future migration relaxes the constraint, this loader still picks the
 * highest version deterministically.
 */

import type { Sql } from 'postgres';

export interface ParsedBundle {
  /** Tenant the bundle belongs to (denormalized for cache keying). */
  tenantId: string;
  /** Monotonic version number from `control_plane.policies.version`. */
  version: number;
  /** Raw Cedar text (concatenated policy set). */
  cedarText: string;
  /** Wrapper schema version — 1 today; bump when format evolves. */
  schemaVersion: number;
  /**
   * Memoised `staticPolicies` payload for Cedar's `isAuthorized` call —
   * populated lazily by `CedarPolicyEngine` on first evaluate. Either a
   * raw string (positional `policy0`, `policy1`, ... ids when the bundle
   * has no `@id("...")` annotations) or `Record<string, string>` keyed by
   * the annotation name. Held on the bundle so we split once per
   * (tenantId, version).
   */
  staticPolicies?: string | Record<string, string>;
}

export interface PolicyBundleLoader {
  /**
   * Load the active Cedar bundle for a tenant. Returns `null` when the
   * tenant has no active policy bundle (in which case the engine falls
   * back to allow-all-with-tenant-scope behaviour — see
   * `CedarPolicyEngine`).
   */
  load(tenantId: string): Promise<ParsedBundle | null>;
}

interface PolicyJsonWrapper {
  readonly format?: unknown;
  readonly policies?: unknown;
  readonly schemaVersion?: unknown;
}

/**
 * Postgres-backed loader. Reads the active row for a tenant from
 * `control_plane.policies`. Tolerates the (defensive) case where multiple
 * rows are accidentally `status='active'` by picking the highest version.
 */
export class PostgresBundleLoader implements PolicyBundleLoader {
  constructor(private readonly sql: Sql) {}

  async load(tenantId: string): Promise<ParsedBundle | null> {
    if (tenantId.trim().length === 0) {
      throw new Error('PostgresBundleLoader: tenantId must be non-empty');
    }
    // Highest active version wins. ORDER BY + LIMIT 1 is belt-and-braces
    // — the partial unique index on `WHERE status='active'` already
    // enforces the "one active row per tenant" invariant at the DB.
    const rows = await this.sql<
      Array<{ version: number; policy_json: unknown }>
    >`
      SELECT version, policy_json
      FROM control_plane.policies
      WHERE tenant_id = ${tenantId} AND status = 'active'
      ORDER BY version DESC
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;

    return parseWrapper(tenantId, row.version, row.policy_json);
  }
}

/**
 * In-memory bundle loader for tests + sim mode. Construct with a
 * `Map<tenantId, cedarText>`; version is stamped to `1` for everything.
 */
export class BundledFixtureLoader implements PolicyBundleLoader {
  constructor(private readonly bundles: Map<string, string>) {}

  async load(tenantId: string): Promise<ParsedBundle | null> {
    if (tenantId.trim().length === 0) {
      throw new Error('BundledFixtureLoader: tenantId must be non-empty');
    }
    const text = this.bundles.get(tenantId);
    if (text === undefined) return null;
    return {
      tenantId,
      version: 1,
      cedarText: text,
      schemaVersion: 1,
    };
  }
}

/**
 * Validate + extract the wrapper. Exported so the future admin UI can
 * use the same parse path when previewing.
 */
export function parseWrapper(
  tenantId: string,
  version: number,
  raw: unknown,
): ParsedBundle {
  if (raw === null || typeof raw !== 'object') {
    throw new Error(
      `policy bundle for tenant ${tenantId} v${version}: expected object wrapper, got ${typeof raw}`,
    );
  }
  const w = raw as PolicyJsonWrapper;
  if (w.format !== 'cedar-text') {
    throw new Error(
      `policy bundle for tenant ${tenantId} v${version}: unsupported format ${JSON.stringify(w.format)} (expected "cedar-text")`,
    );
  }
  if (typeof w.policies !== 'string') {
    throw new Error(
      `policy bundle for tenant ${tenantId} v${version}: .policies must be a string`,
    );
  }
  // Reject silently-coerced schemaVersion. v1 is the only value today;
  // a missing/non-number field could mean a tenant is on an unsupported
  // wrapper format — fail loud rather than pretend it's v1.
  if (w.schemaVersion === undefined) {
    throw new Error(
      `policy bundle for tenant ${tenantId} v${version}: .schemaVersion is required`,
    );
  }
  if (typeof w.schemaVersion !== 'number') {
    throw new Error(
      `policy bundle for tenant ${tenantId} v${version}: .schemaVersion must be a number, got ${typeof w.schemaVersion}`,
    );
  }
  if (w.schemaVersion !== 1) {
    throw new Error(
      `policy bundle for tenant ${tenantId} v${version}: unsupported schemaVersion ${w.schemaVersion} (expected 1)`,
    );
  }
  const schemaVersion = w.schemaVersion;
  return {
    tenantId,
    version,
    cedarText: w.policies,
    schemaVersion,
  };
}
