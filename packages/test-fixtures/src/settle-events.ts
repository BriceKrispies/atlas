/**
 * `settleEvents` — drive a dispatcher chain manually after the Phase-3
 * worker cut-over (`specs/worker.md`).
 *
 * When `apps/server` runs with `WORKER_MODE=async`, the per-request
 * `state.dispatch` is a no-op: events are appended but the projection
 * chain runs out-of-band in the projection-worker. Tests that previously
 * relied on inline dispatch ordering (i.e. "submit an intent, then
 * immediately read the projection") need a deterministic way to drive
 * the chain themselves rather than spinning up a worker and racing it.
 *
 * `settleEvents` reads everything past `afterSeq` from the event store
 * for one tenant and runs each event through the supplied dispatcher in
 * `seq` order — exactly what the worker's per-tenant loop does, but
 * synchronously and bounded. Tests that need retry / failure semantics
 * should wrap this themselves.
 */
import type { EventEnvelope } from '@atlas/platform-core';
import type { EventStore, EventDispatcher } from '@atlas/ports';
export interface SettleEventsOptions {
    eventStore: EventStore;
    dispatch: EventDispatcher;
    tenantId: string;
    /**
     * Cursor — only events with `seq > afterSeq` are dispatched. Defaults
     * to `0n` (drain everything). Tests doing incremental settlement
     * pass the previous return's `lastSeq` here.
     */
    afterSeq?: bigint;
}
export interface SettleEventsResult {
    /**
     * The highest `seq` observed in the event stream (whether dispatched
     * or filtered out by `afterSeq`). When the stream had nothing past
     * the cursor this equals the input `afterSeq`.
     */
    lastSeq: bigint;
    /** Number of envelopes the dispatcher was actually invoked for. */
    processed: number;
}
/**
 * Drain `eventStore` for `tenantId` and run each event past `afterSeq`
 * through `dispatch` in seq order.
 *
 * On dispatcher rejection, rethrows wrapped with the offending eventId
 * so tests can pinpoint which envelope blew up. Subsequent events are
 * NOT processed — failure short-circuits, matching the worker's
 * "halt-on-error, leave the cursor unadvanced" semantics.
 */
export async function settleEvents(opts: SettleEventsOptions): Promise<SettleEventsResult> {
    const { eventStore, dispatch, tenantId } = opts;
    const afterSeq = opts.afterSeq ?? 0n;
    const all = await eventStore.readEvents(tenantId);
    // Sort ascending by seq. `readEvents` is documented to return events
    // in seq order already, but we re-sort defensively because alternative
    // adapters and tests may return out-of-order streams.
    const ordered = [...all].sort(function (a, b) {
        const aSeq = a.seq ?? 0n;
        const bSeq = b.seq ?? 0n;
        if (aSeq < bSeq)
            return -1;
        if (aSeq > bSeq)
            return 1;
        return 0;
    });
    let lastSeq = afterSeq;
    let processed = 0;
    for (const envelope of ordered) {
        const seq = envelope.seq ?? 0n;
        if (seq > lastSeq)
            lastSeq = seq;
        if (seq <= afterSeq)
            continue;
        try {
            await dispatch(envelope);
        }
        catch (err) {
            throw wrapDispatchError(err, envelope);
        }
        processed += 1;
    }
    return { lastSeq, processed };
}
function wrapDispatchError(err: unknown, envelope: EventEnvelope): Error {
    const id = envelope.eventId ?? '<unknown>';
    const original = err instanceof Error ? err.message : String(err);
    const wrapped = new Error(`settleEvents: dispatcher rejected for eventId=${id}: ${original}`);
    if (err instanceof Error && err.stack) {
        wrapped.stack = `${wrapped.message}\nCaused by: ${err.stack}`;
    }
    // Preserve the original via `cause` so tooling that introspects the
    // error chain (vitest's failure formatter, structured logs) can dig in.
    (wrapped as Error & {
        cause?: unknown;
    }).cause = err;
    return wrapped;
}
