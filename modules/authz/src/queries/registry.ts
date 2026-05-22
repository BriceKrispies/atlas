/**
 * Authz query registry — substrate-only stub.
 *
 * Authz's existing read routes (`GET /api/v1/policies` and
 * `GET /api/v1/policies/:version`) already run `evaluateRead` against
 * `Authz.Policy.List` / `Authz.Policy.Read` — so unlike catalog /
 * content-pages, migrating them carries no incremental audit-volume
 * change. The per-module follow-up still lands them as a separate slice
 * (per `specs/crosscut/action-driven-routing.md` §4.5: every existing
 * hand-mount migration is its own ticket); this file exists so the
 * composition shape is correct from day one.
 */
import { createQueryRegistry, type QueryRegistry } from '@atlas/ports';

export function authzQueryRegistry(): QueryRegistry {
  return createQueryRegistry();
}
