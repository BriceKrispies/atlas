/**
 * Typed reader for the `CatalogStateRecord.payload` field.
 *
 * The port-level `CatalogStateStore` (in `@atlas/ports`) types the stored
 * payload as `unknown` because ports must remain domain-agnostic — the
 * catalog module is the sole producer/consumer of the actual `SeedPayload`
 * shape. This helper lifts the runtime invariant (only catalog handlers
 * write the field, and they only ever write a `SeedPayload`) into a typed
 * read site so the rest of the module doesn't need ad-hoc
 * `as SeedPayload` assertions sprinkled across handlers + projections.
 *
 * Mirrors the per-module `must` / `expect` helpers in
 * `modules/identity/src/internal/assert.ts` — a tiny named boundary so
 * the unsafe cast is centralized and reviewable.
 */

import type { CatalogStateRecord } from '@atlas/ports';
import type { SeedPayload } from '../seed-types.ts';

/**
 * Returns the `SeedPayload` stored on a catalog state record.
 *
 * Throws if the payload is not a non-null object — would indicate a bug
 * in the writing handler (every `catalogState.put` site writes a
 * `SeedPayload`). Schema validation at the seed-package-apply ingress
 * already enforces the field shape.
 */
export function readSeed(state: CatalogStateRecord): SeedPayload {
  const v = state.payload;
  if (!v || typeof v !== 'object') {
    throw new Error(
      `CatalogStateRecord.payload invariant violation: expected object, got ${typeof v}`,
    );
  }
  // Boundary: the port types payload as `unknown` (cross-domain
  // contract) but the catalog module is the sole writer and only writes
  // SeedPayload. The `as unknown as` form is required because the
  // narrowing is by construction, not by structural check.
  return v as SeedPayload;
}
