/**
 * Tenant URL construction.
 *
 * Centralized so future custom-domain rollout switches *one* helper
 * instead of every link-generation site. Today this returns a subdomain
 * URL based on `fallbackBase`; once a tenant has a primary custom domain
 * configured (via the `custom_domains` control-plane table), the same
 * call returns the branded URL automatically.
 *
 * See `specs/domains/tenancy/capabilities/custom-domains/README.md` for
 * the broader context.
 *
 * `platform-core` is foundational and must not depend on `@atlas/ports`
 * (ports depend on platform-core). The `PrimaryCustomDomainLookup` type
 * below is the minimal structural shape this helper needs — any
 * `CustomDomainStore` from `@atlas/ports` satisfies it via structural
 * typing, so callers pass their store directly with no adapter.
 */

/**
 * Minimal lookup surface needed to resolve a tenant's primary custom
 * domain. Structural — `CustomDomainStore` (from `@atlas/ports`) and any
 * test double with the same `getPrimary` shape both satisfy it.
 */
export interface PrimaryCustomDomainLookup {
  getPrimary(tenantId: string): Promise<{ hostname: string } | null>;
}

/**
 * Normalize a hostname for storage and lookup. Lowercase + strip any
 * port + strip a trailing dot. Use at every boundary that touches the
 * `custom_domains` table — both write sites and read sites — so
 * `Community.Acme.Example:8080.` and `community.acme.example` resolve
 * to the same row.
 */
export function normalizeHost(host: string): string {
  let h = host.trim().toLowerCase();
  // Strip port (last `:` after the rightmost `]` for IPv6 — but custom
  // domains are by convention DNS hostnames, not IPv6 literals, so a
  // simple lastIndexOf is sufficient).
  const colonIdx = h.lastIndexOf(':');
  if (colonIdx > -1 && /^\d+$/.test(h.slice(colonIdx + 1))) {
    h = h.slice(0, colonIdx);
  }
  // Strip trailing root-zone dot.
  if (h.endsWith('.')) h = h.slice(0, -1);
  return h;
}

/**
 * Construct the canonical base URL for a tenant.
 *
 * - When the tenant has an active primary custom domain, returns
 *   `https://<primary-hostname>`.
 * - Otherwise returns `https://<tenantId>.<fallbackBase>`.
 *
 * Callers should pass in the `fallbackBase` from config (e.g.
 * `atlas.example.com`) — this helper deliberately does not read env vars
 * so it stays pure and testable.
 */
export async function tenantBaseUrl(
  tenantId: string,
  store: PrimaryCustomDomainLookup,
  fallbackBase: string,
): Promise<string> {
  const primary = await store.getPrimary(tenantId);
  if (primary) {
    return `https://${primary.hostname}`;
  }
  return `https://${tenantId}.${fallbackBase}`;
}
