/**
 * Per-tenant subscription orchestration for the projection worker.
 *
 * Discovers active tenants from the control plane on a configurable
 * interval, opens one `WorkerSource.subscribe` per newly-seen tenant,
 * runs the canonical dispatcher chain
 * (catalog + content-pages + identity + cacheTagDispatcher) for each
 * event, and advances the per-(module, tenant) cursor via
 * `sub.ack(seq)` on success.
 *
 * Phase 2 (shadow mode): writes go through `wrapShadow` from `./diff.ts`
 * so the live KV is never mutated; divergence is logged.
 *
 * Phase 3 (live mode): the chain becomes authoritative — same composition,
 * just unwrapped projection / cache adapters.
 *
 * Logging: a base ctx is threaded in by main.ts; tenant-scoped contexts
 * derive from it via `.with({ tenantId, ... })`, and every per-event
 * dispatch is logged on a fresh root context that adopts the envelope's
 * correlationId (so the worker leg of the flow joins the original write
 * request in operator searches) and uses the eventId as causationId. See
 * specs/crosscut/logging.md ¶ "Worker / event handler".
 */

import type { EventEnvelope } from '@atlas/platform-core';
import type { AtlasExecutionContext } from '@atlas/platform-core';
import { createRootContext, type LogPipeline } from '@atlas/logging';
import {
  cacheTagDispatcher,
  composeDispatchers,
  type EventDispatcher,
  type WorkerSubscription,
} from '@atlas/ports';
import { catalogDispatcher } from '@atlas/catalog';
import { contentPagesDispatcher } from '@atlas/content-pages';
import { identityDispatcher } from '@atlas/identity';
import { repositoryDispatcher } from '@atlas/repository';
import type { WorkerAppState, PerTenantAdapters } from './bootstrap.ts';
import { wrapShadow } from './diff.ts';

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
 * Canonical, ordered list of the worker's dispatcher chain. Mirrors the
 * inline chain in `apps/server/src/middleware/state.ts` (see
 * `REQUEST_DISPATCHER_CHAIN_NAMES`) modulo the dispatchers the worker
 * does NOT run today — `policy-cache` and `server-events`. Tests assert
 * that the worker's list is a strict prefix-equivalent to the inline
 * chain so I12 worker-mirror parity is mechanically checked.
 */
export const WORKER_DISPATCHER_CHAIN_NAMES: ReadonlyArray<string> = [
  'catalog',
  'content-pages',
  'identity',
  'repository',
  'cache-tag',
];

/**
 * Runs the per-tenant subscription orchestration. Returns a stop function
 * that the caller awaits during shutdown — it closes every active
 * subscription, waits for in-flight chain runs to drain, and resolves.
 *
 * Throws on programmer errors (missing config, bad pool). Transient DB
 * errors during tenant discovery are logged and retried on the next tick.
 *
 * `baseCtx` is the worker-level execution context — typically derived
 * from main.ts's bootCtx via `.withModule('@atlas/projection-worker')`.
 * `logPipeline` is the same pipeline that backs `baseCtx.logger`, threaded
 * separately because the Logger interface intentionally hides its sink
 * wiring; per-event root contexts re-use it so every line lands on the
 * same stdout / ring-buffer sinks.
 */
export async function runTenantLoop(
  baseCtx: AtlasExecutionContext,
  logPipeline: LogPipeline,
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
  await discoverAndStart(baseCtx, logPipeline, state, handles, () => stopped);

  const intervalMs = state.config.tenantDiscoveryIntervalSeconds * 1000;
  const timer = setInterval(() => {
    if (stopped) return;
    void discoverAndStart(baseCtx, logPipeline, state, handles, () => stopped).catch((err) => {
      baseCtx.logger.error('tenant discovery scheduled tick failed', {
        event: 'ProjectionWorker.TenantDiscovery.Failed',
        error: {
          code: 'TENANT_DISCOVERY_TICK_FAILED',
          message: errorMessage(err),
        },
        properties: { cause: errorMessage(err) },
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
          baseCtx.logger.warn('subscription close failed', {
            event: 'ProjectionWorker.Subscription.CloseFailed',
            properties: { tenantId: h.tenantId, cause: errorMessage(err) },
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

    baseCtx.logger.info('tenant loop stopped', {
      event: 'ProjectionWorker.TenantLoop.Stopped',
      properties: { tenants: snapshot.length },
    });
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
  baseCtx: AtlasExecutionContext,
  logPipeline: LogPipeline,
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
    baseCtx.logger.warn('tenant discovery query failed; will retry', {
      event: 'ProjectionWorker.TenantDiscovery.QueryFailed',
      properties: { cause: errorMessage(err) },
    });
    return;
  }

  for (const row of rows) {
    if (isStopped()) return;
    const tenantId = row.tenant_id;
    if (handles.has(tenantId)) continue;

    try {
      const handle = await startTenantSubscription(baseCtx, logPipeline, state, tenantId, () => {
        handles.delete(tenantId);
      });
      handles.set(tenantId, handle);
      baseCtx.logger.info('tenant subscription started', {
        event: 'ProjectionWorker.Subscription.Started',
        properties: { tenantId },
      });
    } catch (err) {
      baseCtx.logger.error('failed to start tenant subscription', {
        event: 'ProjectionWorker.Subscription.StartFailed',
        error: {
          code: 'SUBSCRIPTION_START_FAILED',
          message: errorMessage(err),
          ...(err instanceof Error && err.stack !== undefined
            ? { stack: err.stack }
            : {}),
        },
        properties: { tenantId, cause: errorMessage(err) },
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
  baseCtx: AtlasExecutionContext,
  logPipeline: LogPipeline,
  state: WorkerAppState,
  tenantId: string,
  onExit: () => void,
): Promise<TenantHandle> {
  const adapters = await state.adaptersForTenant(tenantId);

  // Cursor read: where did we leave off? Default to `0n` (start of stream).
  const afterSeq = await readCursor(state, tenantId);

  const subscription = adapters.workerSource.subscribe(tenantId, afterSeq);

  const loop = consumeTenantEvents(baseCtx, logPipeline, adapters, subscription)
    .catch((err) => {
      baseCtx.logger.error('tenant loop terminated unexpectedly', {
        event: 'ProjectionWorker.TenantLoop.Terminated',
        error: {
          code: 'TENANT_LOOP_TERMINATED',
          message: errorMessage(err),
          ...(err instanceof Error && err.stack !== undefined
            ? { stack: err.stack }
            : {}),
        },
        properties: { tenantId, cause: errorMessage(err) },
      });
    })
    .finally(() => {
      onExit();
      baseCtx.logger.info('tenant subscription stopped', {
        event: 'ProjectionWorker.Subscription.Stopped',
        properties: { tenantId },
      });
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
 * Build a per-event execution context. The worker is the boundary at
 * which an event re-enters the system, so we mint a fresh root context
 * (not a `.with()` patch on the worker ctx) — adopting the envelope's
 * correlationId joins this leg of the flow to the original write
 * request in operator searches, and the eventId becomes the causationId
 * per specs/crosscut/logging.md.
 */
function buildEventContext(
  baseCtx: AtlasExecutionContext,
  logPipeline: LogPipeline,
  tenantId: string,
  envelope: EventEnvelope,
): AtlasExecutionContext {
  return createRootContext({
    pipeline: logPipeline,
    tenantId,
    principalId: envelope.principalId ?? 'system',
    environment: baseCtx.environment,
    incomingCorrelationId: envelope.correlationId,
    causationId: envelope.eventId,
    moduleId: '@atlas/projection-worker',
    actionId: envelope.eventType,
  });
}

/**
 * The actual per-tenant consumption loop. Pulls events from the
 * subscription, runs the dispatcher chain with retry+dead-letter
 * semantics, then acks. Exits cleanly when the subscription is closed.
 */
async function consumeTenantEvents(
  baseCtx: AtlasExecutionContext,
  logPipeline: LogPipeline,
  adapters: PerTenantAdapters,
  subscription: WorkerSubscription,
): Promise<void> {
  const dispatch = buildDispatcherChain(adapters);

  for await (const event of subscription.events()) {
    const eventCtx = buildEventContext(baseCtx, logPipeline, adapters.tenantId, event);
    const ok = await runWithRetry(eventCtx, adapters.tenantId, event, dispatch);
    if (event.seq === undefined) {
      // Defensive — a `WorkerSource` event without a seq violates the
      // port contract. Log and skip; we can't ack without a cursor.
      eventCtx.logger.error('event missing seq; cannot ack', {
        event: 'ProjectionWorker.Event.MissingSeq',
        error: {
          code: 'EVENT_MISSING_SEQ',
          message: 'event has no seq; cannot advance cursor',
        },
        properties: {
          tenantId: adapters.tenantId,
          eventId: event.eventId,
          eventType: event.eventType,
          cause: 'WorkerSource port contract violation: event has no seq',
        },
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
      eventCtx.logger.error('cursor ack failed', {
        event: 'ProjectionWorker.Cursor.AckFailed',
        error: {
          code: 'CURSOR_ACK_FAILED',
          message: errorMessage(err),
        },
        properties: {
          tenantId: adapters.tenantId,
          seq: event.seq.toString(),
          cause: errorMessage(err),
        },
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
    identityDispatcher({
      entities: adapters.entities,
      relations: adapters.relations,
      cache: shadow.cache,
    }),
    // Code / repository — projection rebuilds for `Repository.Created`
    // and `Repository.Uploaded`. Mirrors the inline chain in
    // `apps/server/src/middleware/state.ts`; runs BEFORE
    // `cacheTagDispatcher` so emitted tags are picked up.
    repositoryDispatcher({
      repositories: adapters.repositories,
      revisions: adapters.revisions,
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
  eventCtx: AtlasExecutionContext,
  tenantId: string,
  event: EventEnvelope,
  dispatch: EventDispatcher,
): Promise<boolean> {
  let attempt = 0;
  let delayMs = BACKOFF_INITIAL_MS;
  // Loop until success or dead-letter.
  while (true) {
    try {
      await dispatch(event);
      return true;
    } catch (err) {
      attempt += 1;
      eventCtx.logger.warn('dispatcher chain failed for event', {
        event: 'ProjectionWorker.Dispatch.Failed',
        properties: {
          tenantId,
          eventId: event.eventId,
          eventType: event.eventType,
          seq: event.seq?.toString(),
          attempt,
          cause: errorMessage(err),
        },
      });
      if (attempt >= MAX_RETRIES_BEFORE_DEAD_LETTER) {
        eventCtx.logger.error('event dead-lettered after max retries; advancing cursor', {
          event: 'ProjectionWorker.Dispatch.DeadLettered',
          error: {
            code: 'EVENT_DEAD_LETTERED',
            message: errorMessage(err),
            ...(err instanceof Error && err.stack !== undefined
              ? { stack: err.stack }
              : {}),
          },
          properties: {
            tenantId,
            eventId: event.eventId,
            eventType: event.eventType,
            seq: event.seq?.toString(),
            attempts: attempt,
            cause: `dispatcher chain failed ${attempt} times`,
          },
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
