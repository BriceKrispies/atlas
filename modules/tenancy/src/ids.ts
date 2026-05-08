/**
 * ID minters for the tenancy module.
 *
 * `signup-` prefix matches the convention used elsewhere in the codebase
 * (`event-`, `audit-`, `msg-`). The slug stays lowercase + alnum + dash;
 * the tenant id derived from a slug is the same string with no rewriting,
 * so that the URL `<slug>.localhost` and the DB `tenant_id` column are
 * identical.
 */
export function newSignupRequestId(): string {
  return `signup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Mint a tenancy-scoped event id. Mirrors the prefix convention used by
 * the identity module's `newEventId` so events written across modules
 * remain visually consistent in event-store dumps.
 */
export function newEventId(): string {
  return `event-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Validate that a tenant slug is safe to use as both:
 *   - a Postgres tenant_id (PRIMARY KEY in `control_plane.tenants`)
 *   - a DNS label (`<slug>.localhost`)
 *
 * Rules: lowercase a-z + 0-9 + hyphen, must start and end alnum, 1-63 chars.
 */
export function isValidTenantSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

/**
 * The hostname a tenant's site lives at in the local-dev shape:
 * `<slug>.localhost`. Production wiring will substitute the configured
 * apex domain.
 */
export function tenantHostnameFor(slug: string, apex = 'localhost'): string {
  return `${slug}.${apex}`;
}
