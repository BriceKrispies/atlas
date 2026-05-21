/**
 * CustomDomainStore — the seam where a request's Host header maps to a
 * tenant id. Stubbed today; the same port surface is reused when DNS
 * verification + cert issuance land. See
 * `specs/domains/tenancy/capabilities/custom-domains/README.md`.
 *
 * Implementations live in `@atlas/adapter-node` (Postgres) and
 * `@atlas/adapter-idb` (in-memory, for sim parity). Tenancy is enforced
 * at the `tenant_id` column — no cross-tenant escape hatch.
 *
 * Hostname normalization (lowercase + strip port + strip trailing `.`)
 * is the **caller's** responsibility. Adapters store and look up exactly
 * the string they're given. Use `normalizeHost()` from
 * `@atlas/platform-core/tenant-urls` at every boundary.
 */

export interface CustomDomain {
  hostname: string;
  tenantId: string;
  /**
   * Stub-mode values: `'active' | 'disabled'`. Future values added by the
   * verification flow: `'pending' | 'verified'`. Resolvers must filter to
   * `'active'` only — pending/verified domains are not yet routable.
   */
  status: string;
  isPrimary: boolean;
  /** RFC-3339 timestamp string. */
  createdAt: string;
}

export interface CustomDomainStore {
  /**
   * Look up a domain by its hostname (already normalized). Returns null
   * when no row exists — including for `disabled` rows, since callers
   * always want active routing.
   */
  getByHostname(hostname: string): Promise<CustomDomain | null>;

  /**
   * The active primary domain for a tenant, or null if none. Used by
   * `tenantBaseUrl` to construct branded links.
   */
  getPrimary(tenantId: string): Promise<CustomDomain | null>;

  /**
   * List every domain (any status) registered to a tenant. For operator
   * tools and admin surfaces.
   */
  list(tenantId: string): Promise<CustomDomain[]>;

  /**
   * Add a new active domain. In stub mode this is the only way a domain
   * ever lands; the real flow inserts as `pending` and transitions
   * through `verified` to `active`.
   *
   * Setting `isPrimary: true` clears the primary flag on any other
   * domain owned by the same tenant. The unique partial index on
   * `(tenant_id) WHERE is_primary` enforces "at most one primary".
   */
  add(input: { hostname: string; tenantId: string; isPrimary: boolean }): Promise<CustomDomain>;

  /**
   * Mark a domain as `disabled`. The row stays in place for audit; the
   * resolver simply ignores it. Re-enabling is not in the stub surface —
   * delete and re-add, or extend the store later.
   */
  disable(hostname: string): Promise<void>;
}
