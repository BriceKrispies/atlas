/**
 * Registry-refresh middleware.
 *
 * Refreshes the control-plane schema/action registry snapshot at the REQUEST
 * BOUNDARY — once, before the authed intent routes run. This is the
 * deterministic delivery of the capability's N+1 ("next request") freshness
 * guarantee (decision O1, refresh-at-request-boundary):
 *
 *   - The `ControlPlaneRegistry` port stays SYNC — `getSchemaValidator` /
 *     `getAction` / `hasAction` are pure snapshot reads with no async hop on
 *     the request path (and no fire-and-forget refresh kicked from a lookup,
 *     which previously gave N+2 visibility).
 *   - A row written out-of-band (the hot-registration path) is loaded into the
 *     snapshot by this middleware before submitIntent's sync step-3 (schema
 *     lookup) / step-5 (action lookup) run, so it resolves on the very next
 *     request — same process, stable bootId (I20).
 *
 * Mounted on the AUTHED route group only: health / metrics / public routes do
 * not consult the registry and need not pay the refresh.
 *
 * Named + exported (not an inline closure) so it is unit-testable with a stub
 * registry — assert `refresh()` is awaited before `next()`.
 *
 * @spec specs/domains/runtime/capabilities/control-plane-schema-registry/README.md#hot-registration-contract
 */
import type { Context, Next } from 'hono';

export function registryRefreshMiddleware(registry: { refresh(): Promise<void> }) {
  return async function refreshRegistry(c: Context, next: Next): Promise<void> {
    await registry.refresh();
    await next();
  };
}
