/**
 * apps/sim — Web Worker projection mirror (Phase 4 of the worker
 * migration; see `specs/worker.md`).
 *
 * Mirrors `apps/projection-worker/src/tenant-loop.ts` against IDB
 * adapters: opens its own connection to the same `atlas-sim-<tenantId>`
 * IndexedDB database the main thread uses, subscribes to the
 * `IdbWorkerSource` for one tenant, and runs the canonical dispatcher
 * chain (`catalogDispatcher + contentPagesDispatcher + cacheTagDispatcher`)
 * on each event past the durable cursor.
 *
 * Differences from the server worker:
 *   - No shadow wrapping. Sim is not authoritative — divergence detection
 *     is the server worker's concern (Phase 2).
 *   - No control-plane tenant discovery — the main thread tells the
 *     worker which tenant to run via the `init` message.
 *   - No `wasmHost`. BDD scenarios don't currently exercise WASM render
 *     trees; if/when they do, a transferable plugin-loader bridge will
 *     follow.
 *
 * Imports MUST be browser-safe — this file runs in a `DedicatedWorkerGlobalScope`
 * with no DOM. In particular, do not import `@atlas/wasm-host` (which pulls
 * in node `worker_threads`); use `@atlas/wasm-host/browser` if a host is
 * eventually wired in.
 *
 * Protocol (see `apps/sim/src/main.ts` for the main-thread side):
 *   M -> W  { type: 'init', tenantId, moduleId }
 *   W -> M  { type: 'ready' }
 *   M -> W  { type: 'settle', requestId }
 *   W -> M  { type: 'settled', requestId, processed, lastSeq } (lastSeq as string)
 *   M -> W  { type: 'shutdown' }
 *   W -> M  { type: 'shutdown-ack' }
 */

import {
  openAtlasIdb,
  IdbCache,
  IdbCatalogStateStore,
  IdbEntityStore,
  IdbProjectionStore,
  IdbRelationStore,
  IdbSearchEngine,
  IdbWorkerSource,
  type IdbDb,
} from '@atlas/adapter-idb';
import { catalogDispatcher } from '@atlas/catalog';
import { contentPagesDispatcher } from '@atlas/content-pages';
import {
  cacheTagDispatcher,
  composeDispatchers,
  type EventDispatcher,
  type WorkerSubscription,
} from '@atlas/ports';

interface InitMessage {
  type: 'init';
  tenantId: string;
  moduleId: string;
}
interface SettleMessage {
  type: 'settle';
  requestId: string;
}
interface ShutdownMessage {
  type: 'shutdown';
}
type InboundMessage = InitMessage | SettleMessage | ShutdownMessage;

interface ReadyOut {
  type: 'ready';
}
interface SettledOut {
  type: 'settled';
  requestId: string;
  processed: number;
  /** Bigint serialized as decimal string — postMessage chokes on bigint. */
  lastSeq: string;
}
interface ShutdownAckOut {
  type: 'shutdown-ack';
}
type OutboundMessage = ReadyOut | SettledOut | ShutdownAckOut;

// `DedicatedWorkerGlobalScope` isn't in the project's `lib: DOM` baseline
// (would require `lib: WebWorker`, which conflicts with DOM in the same
// project). We narrow the surface we need from `self` ourselves:
interface WorkerGlobalSurface {
  postMessage(msg: unknown): void;
  addEventListener(
    type: 'message',
    listener: (e: MessageEvent<InboundMessage>) => void,
  ): void;
  close(): void;
}
const ctx: WorkerGlobalSurface = self as unknown as WorkerGlobalSurface;

interface RuntimeState {
  tenantId: string;
  moduleId: string;
  db: IdbDb;
  subscription: WorkerSubscription;
  dispatch: EventDispatcher;
  /** Highest seq for which the chain has run successfully. */
  processedSeq: bigint;
  /** Total events the chain has processed since boot (for `settle`). */
  totalProcessed: number;
  /** Resolved when shutdown completes; the consume loop awaits this. */
  loop: Promise<void>;
  shutdown: boolean;
}

let runtime: RuntimeState | null = null;

function post(msg: OutboundMessage): void {
  ctx.postMessage(msg);
}

ctx.addEventListener('message', (e: MessageEvent<InboundMessage>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'init':
      void handleInit(msg).catch((err) => {
        // Boot failure — surface via console; main thread will time out
        // its `ready` wait and report it.
        console.error('[atlas-sim-worker] init failed', err);
      });
      break;
    case 'settle':
      void handleSettle(msg);
      break;
    case 'shutdown':
      void handleShutdown();
      break;
  }
});

async function handleInit(msg: InitMessage): Promise<void> {
  if (runtime) {
    // Re-init against an already-bound worker is a programmer error in
    // the main thread; reset() should terminate this worker first.
    throw new Error(
      `[atlas-sim-worker] received second init for tenant=${msg.tenantId}`,
    );
  }

  const db = await openAtlasIdb(msg.tenantId);
  const cache = new IdbCache(db);
  const projections = new IdbProjectionStore(db);
  const search = new IdbSearchEngine(db);
  const catalogState = new IdbCatalogStateStore(db);
  // L3 substrate — IDB-backed entity + relation stores. Mirrors the
  // main-thread sim composition in `apps/sim/src/main.ts` and the
  // server projection-worker chain.
  const entities = new IdbEntityStore(db);
  const relations = new IdbRelationStore(db);

  // Same chain composition as `apps/projection-worker/src/tenant-loop.ts`,
  // unwrapped (no shadow). `wasmHost` is intentionally omitted — see file
  // doc-comment.
  const dispatch = composeDispatchers(
    catalogDispatcher({ catalogState, projections, search, cache }),
    contentPagesDispatcher({
      entities,
      relations,
      cache,
    }),
    cacheTagDispatcher(cache),
  );

  // Read the durable cursor — `IdbWorkerSource` writes acks into
  // `worker_cursors`. Default to 0n (start of stream).
  const afterSeq = await readCursor(db, msg.tenantId, msg.moduleId);

  const workerSource = new IdbWorkerSource(db, msg.moduleId);
  const subscription = workerSource.subscribe(msg.tenantId, afterSeq);

  const state: RuntimeState = {
    tenantId: msg.tenantId,
    moduleId: msg.moduleId,
    db,
    subscription,
    dispatch,
    processedSeq: afterSeq,
    totalProcessed: 0,
    loop: Promise.resolve(),
    shutdown: false,
  };
  state.loop = consumeLoop(state);
  runtime = state;

  post({ type: 'ready' });
}

async function consumeLoop(state: RuntimeState): Promise<void> {
  try {
    for await (const event of state.subscription.events()) {
      if (state.shutdown) break;
      try {
        await state.dispatch(event);
      } catch (err) {
        // Mirror server-worker semantics: log + advance. Sim's not
        // authoritative; halting the loop on failure would just hide
        // bugs from BDD instead of surfacing them in the events log.
        console.warn(
          '[atlas-sim-worker] dispatch failed; advancing cursor',
          {
            eventId: event.eventId,
            eventType: event.eventType,
            error: err instanceof Error ? err.message : String(err),
          },
        );
      }
      if (event.seq !== undefined) {
        try {
          await state.subscription.ack(event.seq);
          if (event.seq > state.processedSeq) state.processedSeq = event.seq;
        } catch (err) {
          console.warn('[atlas-sim-worker] ack failed', {
            seq: event.seq.toString(),
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      state.totalProcessed += 1;
    }
  } catch (err) {
    console.error('[atlas-sim-worker] consume loop terminated', err);
  }
}

async function handleSettle(msg: SettleMessage): Promise<void> {
  if (!runtime) {
    post({ type: 'settled', requestId: msg.requestId, processed: 0, lastSeq: '0' });
    return;
  }

  const before = runtime.totalProcessed;
  // Determine the head — highest seq currently in the events store for
  // this tenant. We must drain at least up to this point.
  const head = await readHeadSeq(runtime.db, runtime.tenantId);

  // Spin until the consume loop's processed cursor catches the head.
  // The IdbWorkerSource's BroadcastChannel + 250ms poll already wakes
  // the consume loop; here we simply yield until the cursor advances.
  // Cap the wait so a stuck dispatcher doesn't hang BDD forever.
  const start = Date.now();
  const HARD_TIMEOUT_MS = 5_000;
  while (runtime.processedSeq < head) {
    if (Date.now() - start > HARD_TIMEOUT_MS) {
      console.warn('[atlas-sim-worker] settle timeout', {
        tenantId: runtime.tenantId,
        head: head.toString(),
        processedSeq: runtime.processedSeq.toString(),
      });
      break;
    }
    await sleep(10);
  }

  const processed = runtime.totalProcessed - before;
  post({
    type: 'settled',
    requestId: msg.requestId,
    processed,
    lastSeq: runtime.processedSeq.toString(),
  });
}

async function handleShutdown(): Promise<void> {
  if (!runtime) {
    post({ type: 'shutdown-ack' });
    ctx.close();
    return;
  }
  runtime.shutdown = true;
  try {
    await runtime.subscription.close();
  } catch {
    // close() is idempotent in spirit; swallow runtime quirks.
  }
  // Wait briefly for the loop to exit; it may be mid-dispatch.
  await Promise.race([
    runtime.loop,
    new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
  ]);
  try {
    runtime.db.close();
  } catch {
    // no-op
  }
  runtime = null;
  post({ type: 'shutdown-ack' });
  ctx.close();
}

async function readCursor(
  db: IdbDb,
  tenantId: string,
  moduleId: string,
): Promise<bigint> {
  const cursorKey = `${tenantId} ${moduleId}`;
  const row = await db.get('worker_cursors', cursorKey);
  if (!row) return 0n;
  return BigInt(row.lastSeq);
}

/**
 * Highest seq in the events store for `tenantId`. Returns 0n when the
 * store is empty for that tenant.
 */
async function readHeadSeq(db: IdbDb, tenantId: string): Promise<bigint> {
  const range = IDBKeyRange.bound(
    [tenantId, -Infinity],
    [tenantId, +Infinity],
  );
  const idx = db
    .transaction('events', 'readonly')
    .objectStore('events')
    .index('by_tenant_seq');
  const cursor = await idx.openCursor(range, 'prev');
  if (!cursor) return 0n;
  return BigInt(cursor.value.seq);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
