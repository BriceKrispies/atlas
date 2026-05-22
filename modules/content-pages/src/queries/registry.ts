/**
 * Content-pages query registry — substrate-only stub.
 *
 * See `modules/catalog/src/queries/registry.ts` for the long-form
 * rationale: this file exists so the catch-all composition shape is
 * correct from day one. Content-pages reads migrate onto the registry
 * in a per-module follow-up slice with architect review for the new
 * `evaluateRead` audit volume (per `specs/crosscut/action-driven-routing.md`
 * §4.5).
 */
import { createQueryRegistry, type QueryRegistry } from '@atlas/ports';

export function contentPagesQueryRegistry(): QueryRegistry {
  return createQueryRegistry();
}
