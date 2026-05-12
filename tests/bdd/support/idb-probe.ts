/**
 * Typed wrappers around `page.evaluate(() => window.__atlas[_debug].X(...))`.
 * Step files import these helpers instead of writing `evaluate` calls inline,
 * so step bodies stay declarative and the harness API has one source of truth.
 *
 * Action helpers (submitIntent / queries) hit `window.__atlas` and are valid
 * outside BDD too — the surface ships in production.
 *
 * Probe helpers (snapshot, readEvents, …) hit `window.__atlas_debug`, which
 * is gated on `import.meta.env.VITE_BDD === 'true'` in `apps/sim/src/main.ts`.
 * Calling a probe against a non-BDD build will reject with a TypeError.
 */

import type { Page } from '@playwright/test';
import type {
  EventEnvelope,
  IntentEnvelope,
  IntentResponse,
  SearchDocument,
} from '@atlas/platform-core';
import { assertDefined } from '@atlas/test-fixtures/assert';
// ---------------- Window surface accessors ----------------
//
// `window.__atlas` and `window.__atlas_debug` are declared as optional on
// the `Window` interface (see `apps/sim/src/types.ts`) because they are
// only mounted inside the BDD harness build. Each probe asserts presence
// inside the `page.evaluate` browser context — if a probe lands against a
// non-BDD build the error names which surface is missing rather than
// blowing up with a generic TypeError. The asserts are inlined into each
// evaluate callback because `page.evaluate` serialises its function to
// the browser and cannot close over Node-side helpers.

export interface EventReadFilter {
  type?: string;
  correlationId?: string;
  idempotencyKey?: string;
  tenantId?: string;
}

export interface IngressFailure {
  code: string;
  status: number;
  message: string;
  correlationId?: string;
}

export type SubmitRawResult =
  | { ok: true; response: IntentResponse }
  | { ok: false; failure: IngressFailure };

// ---------------- Action surface ----------------

/**
 * Auto-drain the projection Web Worker after every mutation.
 *
 * Phase 4 of the worker migration (`specs/worker.md`) puts an actual
 * Web Worker between intent submission and projection rebuilds in the
 * sim. To keep BDD steps declarative — `When I submit X` then `Then I
 * see Y` without a `When the worker has settled` in between — every
 * intent submission helper here calls `__atlas_debug.worker.settle()`
 * before returning.
 *
 * Wired here (idb-probe) rather than in `support/sim-fixture.ts`
 * because step files already import `submitIntent` / `submitIntentRaw`
 * from this module directly — wrapping at the fixture layer would
 * require either re-exporting via the fixture or rewriting every
 * step. Wrapping here is one diff and keeps the helper surface as the
 * single mutation entry point.
 *
 * No-op outside BDD: when `__atlas_debug` is undefined (e.g. running
 * the action surface against a non-BDD build) we skip silently.
 */
async function settleWorker(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const dbg = window.__atlas_debug;
    if (!dbg || !dbg.worker) return;
    await dbg.worker.settle();
  });
}

export async function submitIntent(
  page: Page,
  envelope: IntentEnvelope,
): Promise<IntentResponse> {
  const response = await page.evaluate((e) => {
    const action = window.__atlas;
    if (!action) throw new Error('window.__atlas is not mounted — non-BDD build?');
    return action.submitIntent(e);
  }, envelope);
  await settleWorker(page);
  return response;
}

export async function submitIntentRaw(
  page: Page,
  envelope: IntentEnvelope,
): Promise<SubmitRawResult> {
  const result = await page.evaluate((e) => {
    const action = window.__atlas;
    if (!action) throw new Error('window.__atlas is not mounted — non-BDD build?');
    return action.submitIntentRaw(e);
  }, envelope);
  // Settle even on a failed intent — the worker might still have
  // queued events from earlier mutations in the same scenario.
  await settleWorker(page);
  return result;
}

export function getFamilyDetail(page: Page, familyKey: string): Promise<unknown> {
  return page.evaluate((k) => {
    const action = window.__atlas;
    if (!action) throw new Error('window.__atlas is not mounted — non-BDD build?');
    return action.getFamilyDetail(k);
  }, familyKey);
}

export function getVariantTable(
  page: Page,
  familyKey: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  return page.evaluate(
    ([k, p]) => {
      const action = window.__atlas;
      if (!action) throw new Error('window.__atlas is not mounted — non-BDD build?');
      return action.getVariantTable(
        k as string,
        p as Record<string, unknown>,
      );
    },
    [familyKey, params] as const,
  );
}

export function getTaxonomyNodes(page: Page, treeKey: string): Promise<unknown> {
  return page.evaluate((k) => {
    const action = window.__atlas;
    if (!action) throw new Error('window.__atlas is not mounted — non-BDD build?');
    return action.getTaxonomyNodes(k);
  }, treeKey);
}

export function searchCatalog(
  page: Page,
  params: Record<string, unknown>,
): Promise<unknown> {
  return page.evaluate((p) => {
    const action = window.__atlas;
    if (!action) throw new Error('window.__atlas is not mounted — non-BDD build?');
    return action.searchCatalog(p);
  }, params);
}

// ---------------- Debug / probe surface ----------------

export interface AtlasSnapshot {
  events: EventEnvelope[];
  projections: unknown[];
  cache: unknown[];
  search_documents: unknown[];
  catalog_state: unknown[];
  entities: unknown[];
  relations: unknown[];
}

export function snapshot(page: Page): Promise<AtlasSnapshot> {
  return page.evaluate(() => {
    const dbg = window.__atlas_debug;
    if (!dbg) throw new Error('window.__atlas_debug is not mounted — non-BDD build?');
    return dbg.snapshot();
  });
}

export function readEvents(
  page: Page,
  filter: EventReadFilter = {},
): Promise<EventEnvelope[]> {
  return page.evaluate((f) => {
    const dbg = window.__atlas_debug;
    if (!dbg) throw new Error('window.__atlas_debug is not mounted — non-BDD build?');
    return dbg.readEvents(f);
  }, filter);
}

export function readEventById(
  page: Page,
  id: string,
): Promise<EventEnvelope | null> {
  return page.evaluate((i) => {
    const dbg = window.__atlas_debug;
    if (!dbg) throw new Error('window.__atlas_debug is not mounted — non-BDD build?');
    return dbg.readEventById(i);
  }, id);
}

export function readEventTags(
  page: Page,
  id: string,
): Promise<string[] | null> {
  return page.evaluate((i) => {
    const dbg = window.__atlas_debug;
    if (!dbg) throw new Error('window.__atlas_debug is not mounted — non-BDD build?');
    return dbg.readEventTags(i);
  }, id);
}

export function readProjection(page: Page, key: string): Promise<unknown> {
  return page.evaluate((k) => {
    const dbg = window.__atlas_debug;
    if (!dbg) throw new Error('window.__atlas_debug is not mounted — non-BDD build?');
    return dbg.readProjection(k);
  }, key);
}

export function readAllProjections(page: Page): Promise<unknown[]> {
  return page.evaluate(() => {
    const dbg = window.__atlas_debug;
    if (!dbg) throw new Error('window.__atlas_debug is not mounted — non-BDD build?');
    return dbg.readAllProjections();
  });
}

export function readSearchDocs(
  page: Page,
  tenantId: string,
  type?: string,
): Promise<SearchDocument[]> {
  return page.evaluate(
    ([t, ty]) => {
      const dbg = window.__atlas_debug;
      if (!dbg) throw new Error('window.__atlas_debug is not mounted — non-BDD build?');
      return dbg.readSearchDocs(
        t as string,
        ty as string | undefined,
      );
    },
    [tenantId, type] as const,
  );
}

export function readCatalogState(page: Page, tenantId: string): Promise<unknown> {
  return page.evaluate((t) => {
    const dbg = window.__atlas_debug;
    if (!dbg) throw new Error('window.__atlas_debug is not mounted — non-BDD build?');
    return dbg.readCatalogState(t);
  }, tenantId);
}

export function reset(page: Page): Promise<void> {
  return page.evaluate(() => {
    const dbg = window.__atlas_debug;
    if (!dbg) throw new Error('window.__atlas_debug is not mounted — non-BDD build?');
    return dbg.reset();
  });
}

// ---------------- Convenience helpers ----------------

/**
 * Strict assertion: read events for a correlationId and require exactly one
 * matching the type. Returns the matched event for further assertions.
 */
export async function readSingleEventByType(
  page: Page,
  type: string,
  correlationId: string,
): Promise<EventEnvelope> {
  const matches = await readEvents(page, { type, correlationId });
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly 1 ${type} event for correlationId=${correlationId}, got ${matches.length}`,
    );
  }
  return assertDefined(
    matches[0],
    `length-checked match[0] for ${type}/${correlationId}`,
  );
}

/**
 * Count events of a given type emitted under an idempotency key. Used by
 * I3 (idempotency) assertions.
 */
export async function countEventsByIdempotencyKey(
  page: Page,
  type: string,
  idempotencyKey: string,
): Promise<number> {
  const matches = await readEvents(page, { type, idempotencyKey });
  return matches.length;
}
