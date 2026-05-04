/**
 * Sim-mode role → principalId mapping. The role string is the value the
 * Gherkin scenario uses (Background or Given step); the principalId is what
 * the harness boots with.
 *
 * The `viewer:` prefix is what `apps/sim/src/role-aware-stub.ts` looks for
 * when deciding to deny mutating actions. Other roles fall through to the
 * default allow-all-with-tenant-scope behaviour.
 */

export type Role = 'TenantAdmin' | 'Viewer';

export function principalIdForRole(role: string, tenantId: string): string {
  switch (role) {
    case 'Viewer':
      return `viewer:test-user:${tenantId}`;
    case 'TenantAdmin':
      return `user:test-user:${tenantId}`;
    default:
      return `user:test-user:${tenantId}`;
  }
}
