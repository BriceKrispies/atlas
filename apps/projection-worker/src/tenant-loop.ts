/**
 * Per-tenant subscription orchestration for the projection worker.
 *
 * Discovers active tenants from the control plane on a configurable
 * interval, opens one `WorkerSource.subscribe` per newly-seen tenant,
 * runs the canonical dispatcher chain
 * (catalog + content-pages + cacheTagDispatcher) for each event, and
 * advances the per-(module, tenant) cursor via `sub.ack(seq)` on success.
 *
 * Phase 2 (shadow mode): writes go through `wrapShadow` from `./diff.ts`
 * so the live KV is never mutated; divergence is logged.
 *
 * Phase 3 (live mode): the chain becomes authoritative — same composition,
 * just unwrapped projection / cache adapters.
 */

import type { EventEnvelope } from '@atlas/platform-core';
import {
  cacheTagDispatcher,
  composeDispatchers,
  type EventDispatcher,
  type WorkerSubscription,
} from '@atlas/ports';
import { catalogDispatcher } from '@atlas/catalog';
import { contentPagesDispatcher } from '@atlas/content-pages';
import type { WorkerAppState, PerTenantAdapters } from './bootstrap.ts';
import { wrapShadow } from './diff.ts';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Tracking record for an active tenant subscription. */
interface TenantHandle {
  tenantId: string;
  subscription: WorkerSubscription;
  loop: Promise<void>;
}

/** Backoff bounds for per-event retry. */
const BACKOFF_INITIAL_MS = 100;
const BACKOFF_CAP_MS = 30_000;
const MAX_RETRIES_BEFORE_DEAD_LETTER = 5;

/**
 * Runs the per-tenant subscription orchestration. Returns a stop function
 * that the caller awaits during shutdown — it closes every active
 * subscription, waits for in-flight chain runs to drain, and resolves.
 *
 * Throws on programmer errors (missing config, bad pool). Transient DB
 * errors during tenant discovery are logged and retried on the next tick.
 */
export async function runTenantLoop(
  state: WorkerAppState,
): Promise<() => Promise<void>> {
  if (!state.config) {
    throw new Error('runTenantLoop: state.config is required');
  }
  if (!state.controlPlaneSql) {
    throw new Error('runTenantLoop: state.controlPlaneSql is required');
  }

  const handles = new Map<string, TenantHandle>();
  let stopped = false;

  // Kick off discovery. A repeating timer drives re-scans; the initial
  // pass runs immediately so the first tenants come online without
  // waiting `tenantDiscoveryIntervalSeconds`.
  await discoverAndStart(state, handles, () => stopped);

  const intervalMs = state.config.tenantDiscoveryIntervalSeconds * 1000;
  const timer = setInterval(() => {
    if (stopped) return;
    void discoverAndStart(state, handles, () => stopped).catch((err) => {
      log('error', 'tenant discovery scheduled tick failed', {
        error: errorMessage(err),
      });
    });
  }, intervalMs);
  // Don't keep the process alive solely on this timer — main.ts owns
  // the lifecycle via signal handlers.
  if (typeof timer.unref === 'function') timer.unref();

  return async function stop(): Promise<void> {
    stopped = true;
    clearInterval(timer);

    // Snapshot the handles map; further discovery ticks can't add to it.
    const snapshot = Array.from(handles.values());

    // Close every active subscription. `close()` is idempotent and
    // terminates the `events()` async iterable so the per-tenant loop
    // exits its for-await.
    await Promise.allSettled(
      snapshot.map(async (h) => {
        try {
          await h.subscription.close();
        } catch (err) {
          log('warn', 'subscription close failed', {
            tenantId: h.tenantId,
            error: errorMessage(err),
          });
        }
      }),
    );

    // Wait (with a soft timeout) for in-flight chain runs to drain.
    // Each per-tenant `loop` promise resolves once `events()` ends.
    const drainTimeoutMs = 5_000;
    await Promise.race([
      Promise.allSettled(snapshot.map((h) => h.loop)),
      new Promise<void>((resolve) => {
        const t = setTimeout(() => resolve(), drainTimeoutMs);
        if (typeof t.unref === 'function') t.unref();
      }),
    ]);

    log('info', 'tenant loop stopped', { tenants: snapshot.length });
  };
}

/**
 * Query the control plane for active tenants and start a per-tenant
 * subscription for each newly-seen tenant. Idempotent: tenants already
 * being processed are skipped.
 *
 * Transient DB errors are caught and logged so the next discovery tick
 * gets a clean slate — the worker stays up.
 */
async function discoverAndStart(
  state: WorkerAppState,
  handles: Map<string, TenantHandle>,
  isStopped: () => boolean,
): Promise<void> {
  if (isStopped()) return;

  let rows: Array<{ tenant_id: string }>;
  try {
    rows = await state.controlPlaneSql<Array<{ tenant_id: string }>>`
      SELECT tenant_id FROM control_plane.tenants WHERE status = 'active'
    `;
  } catch (err) {
    log('warn', 'tenant discovery query failed; will retry', {
      error: errorMessage(err),
    });
    return;
  }

  for (const row of rows) {
    if (isStopped()) return;
    const tenantId = row.tenant_id;
    if (handles.has(tenantId)) continue;

    try {
      const handle = await startTenantSubscription(state, tenantId, () => {
        handles.delete(tenantId);
      });
      handles.set(tenantId, handle);
      log('info', 'tenant subscription started', { tenantId });
    } catch (err) {
      log('error', 'failed to start tenant subscription', {
        tenantId,
        error: errorMessage(err),
      });
    }
  }
}

/**
 * Open a `WorkerSource` subscription for one tenant and spawn the
 * per-event consumption loop. Returns a `TenantHandle` whose `loop`
 * promise resolves when `events()` terminates.
 */
async function startTenantSubscription(
  state: WorkerAppState,
  tenantId: string,
  onExit: () => void,
): Promise<TenantHandle> {
  const adapters = await state.adaptersForTenant(tenantId);

  // Cursor read: where did we leave off? Default to `0n` (start of stream).
  const afterSeq = await readCursor(state, tenantId);

  const subscription = adapters.workerSource.subscribe(tenantId, afterSeq);

  const loop = consumeTenantEvents(state, adapters, subscription)
    .catch((err) => {
      log('error', 'tenant loop terminated unexpectedly', {
        tenantId,
        error: errorMessage(err),
      });
    })
    .finally(() => {
      onExit();
      log('info', 'tenant subscription stopped', { tenantId });
    });

  return { tenantId, subscription, loop };
}

/**
 * Read the durable cursor for `(tenantId, moduleId)`. Returns `0n` when
 * no row exists yet. Reads from the **tenant** pool (not control-plane);
 * `worker_cursors` is a tenant-DB table per the migration in
 * `adapters/node/src/migrations/tenant/20260503000001_*.sql`.
 */
async function readCursor(
  state: WorkerAppState,
  tenantId: string,
): Promise<bigint> {
  const sql = await state.tenantDb.getPool(tenantId);
  const rows = await sql<Array<{ last_seq: string | number | bigint }>>`
    SELECT last_seq FROM worker_cursors
    WHERE tenant_id = ${tenantId} AND module_id = ${state.config.moduleId}
  `;
  const first = rows[0];
  if (!first) return 0n;
  return BigInt(first.last_seq as string | number | bigint);
}

/**
 * The actual per-tenant consumption loop. Pulls events from the
 * subscription, runs the dispatcher chain with retry+dead-letter
 * semantics, then acks. Exits cleanly when the subscription is closed.
 */
async function consumeTenantEvents(
  state: WorkerAppState,
  adapters: PerTenantAdapters,
  subscription: WorkerSubscription,
): Promise<void> {
  const dispatch = buildDispatcherChain(adapters);

  for await (const event of subscription.events()) {
    const ok = await runWithRetry(adapters.tenantId, event, dispatch);
    if (event.seq === undefined) {
      // Defensive — a `WorkerSource` event without a seq violates the
      // port contract. Log and skip; we can't ack without a cursor.
      log('error', 'event missing seq; cannot ack', {
        tenantId: adapters.tenantId,
        eventId: event.eventId,
        eventType: event.eventType,
      });
      continue;
    }
    // Ack regardless of success — after MAX_RETRIES we treat the event
    // as dead-lettered and advance the cursor so the loop makes
    // forward progress. (`ok` is informational here.)
    void ok;
    try {
      await subscription.ack(event.seq);
    } catch (err) {
      log('error', 'cursor ack failed', {
        tenantId: adapters.tenantId,
        seq: event.seq.toString(),
        error: errorMessage(err),
      });
    }
  }
}

/**
 * Build the dispatcher chain for one tenant. Same composition as the
 * canonical inline chain at `apps/server/src/middleware/state.ts:118`,
 * minus `policyCacheDispatcher` and `serverEventDispatcher` (Phase 2
 * scope — see the report in `tenant-loop.ts`'s commit message).
 *
 * In shadow mode the projection store + cache are wrapped so writes
 * are recorded for divergence reporting rather than committed.
 */
function buildDispatcherChain(
  adapters: PerTenantAdapters,
): EventDispatcher {
  // Phase 2: wrap projections + cache so writes are observed but not
  // committed to the live KV. The chain composition matches
  // `apps/server/src/middleware/state.ts` so Phase 3 cut-over is a
  // relocation, not a rewrite.
  const shadow = wrapShadow({
    projections: adapters.projections,
    cache: adapters.cache,
  });

  return composeDispatchers(
    catalogDispatcher({
      catalogState: adapters.catalogState,
      projections: shadow.projections,
      search: adapters.search,
      cache: shadow.cache,
    }),
    contentPagesDispatcher({
      entities: adapters.entities,
      relations: adapters.relations,
      cache: shadow.cache,
    }),
    cacheTagDispatcher(shadow.cache),
  );
}

/**
 * Run `dispatch(event)` with exponential backoff. After
 * `MAX_RETRIES_BEFORE_DEAD_LETTER` failures, log a structured
 * dead-letter warning and return false so the caller advances past
 * this event. Returns true on success.
 */
async function runWithRetry(
  tenantId: string,
  event: EventEnvelope,
  dispatch: EventDispatcher,
): Promise<boolean> {
  let attempt = 0;
  let delayMs = BACKOFF_INITIAL_MS;
  // Loop until success or dead-letter.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await dispatch(event);
      return true;
    } catch (err) {
      attempt += 1;
      log('warn', 'dispatcher chain failed for event', {
        tenantId,
        eventId: event.eventId,
        eventType: event.eventType,
        seq: event.seq?.toString(),
        attempt,
        error: errorMessage(err),
      });
      if (attempt >= MAX_RETRIES_BEFORE_DEAD_LETTER) {
        log('error', 'event dead-lettered after max retries; advancing cursor', {
          tenantId,
          eventId: event.eventId,
          eventType: event.eventType,
          seq: event.seq?.toString(),
          attempts: attempt,
        });
        return false;
      }
      await sleep(delayMs);
      delayMs = Math.min(delayMs * 2, BACKOFF_CAP_MS);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (typeof t.unref === 'function') t.unref();
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function log(
  level: LogLevel,
  msg: string,
  fields: Record<string, unknown> = {},
): void {
  // Mirror the format used in `main.ts` so log lines line up across
  // the two files when grepped together.
  console.log(
    JSON.stringify({
      level,
      msg,
      ts: new Date().toISOString(),
      ...fields,
    }),
  );
}
