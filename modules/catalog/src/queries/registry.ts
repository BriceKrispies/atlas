/**
 * Catalog query registry — substrate-only stub.
 *
 * The query-side catch-all (`apps/server/src/routes/queries.ts`) composes
 * one `QueryRegistry` per module. The substrate ticket (`tickets/atlas-on-atlas/
 * query-catch-all-dispatcher.md`) lands the composition shape with one
 * worked migration (`Identity.Memberships.List`); migrating catalog's
 * existing hand-mounted read routes (`/api/v1/catalog/families/:familyKey`,
 * `/api/v1/catalog/search`, etc.) is a separate per-module follow-up
 * slice — per `specs/crosscut/action-driven-routing.md` §4.5, those
 * migrations need explicit architect review because they introduce
 * `evaluateRead`-driven audit volume on read paths that today trust
 * tenant isolation alone.
 *
 * This file exists so the composition shape is correct from day one.
 * When catalog reads migrate, register their descriptors here. See
 * `modules/identity/src/queries/registry.ts` for the worked example.
 */
import { createQueryRegistry, type QueryRegistry } from '@atlas/ports';

export function catalogQueryRegistry(): QueryRegistry {
  return createQueryRegistry();
}
