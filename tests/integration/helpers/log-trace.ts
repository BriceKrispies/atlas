/**
 * Helper for fetching and asserting on the per-correlationId log trace
 * captured by `apps/server`'s in-memory ring sink.
 *
 * Used by both the standalone smoke driver (`scripts/e2e-smoke.ts`) and
 * the Playwright integration spec (`tests/integration/intent-logging.itest.ts`).
 *
 * The endpoint is gated by `principal.roles.includes('admin')` — pass an
 * X-Debug-Principal header with role `admin` (e.g.
 * `user:tester:<tenant>:admin`) when calling.
 */
export interface LogRecord {
    timestamp: string;
    level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
    message: string;
    eventName?: string;
    correlationId: string;
    tenantId?: string;
    principalId?: string;
    durationMs?: number;
    properties?: Record<string, unknown>;
}
export interface FetchTraceOptions {
    /** X-Debug-Principal value (must include `admin` role). */
    principal: string;
    /** Defaults to 200, clamped server-side to [1, 1000]. */
    limit?: number;
    /**
     * Brief delay before fetching, since the ring sink is async-flushed and
     * the Request.Completed line for the request that just finished may
     * not be visible yet. Defaults to 100ms.
     */
    settleMs?: number;
}
export async function fetchTrace(ingressBase: string, correlationId: string, options: FetchTraceOptions): Promise<LogRecord[]> {
    const settle = options.settleMs ?? 100;
    if (settle > 0) {
        await new Promise(function (r) {
            return setTimeout(r, settle);
        });
    }
    const limit = options.limit ?? 200;
    const url = `${ingressBase}/api/v1/admin/logging/correlation/` +
        `${encodeURIComponent(correlationId)}/recent?limit=${limit}`;
    const r = await fetch(url, {
        headers: { 'X-Debug-Principal': options.principal },
    });
    if (!r.ok) {
        const body = await r.text().catch(function () {
            return '';
        });
        throw new Error(`fetchTrace failed: ${r.status} ${body}`);
    }
    const body = (await r.json()) as {
        events: LogRecord[];
    };
    // Ring sink returns newest-first; flip to chronological so consumers
    // can assert on event order.
    return [...body.events].sort(function (a, b) {
        return a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0;
    });
}
/**
 * Assert that every name in `expected` appears at least once in
 * `records`. Throws with a descriptive message listing which names are
 * missing (so test failures point straight at the gap).
 */
export function assertContainsEvents(records: ReadonlyArray<LogRecord>, expected: ReadonlyArray<string>): void {
    const seen = new Set(records.map(function (r) {
        return r.eventName;
    }).filter(function (n): n is string {
        return !!n;
    }));
    const missing = expected.filter(function (n) {
        return !seen.has(n);
    });
    if (missing.length > 0) {
        throw new Error(`missing expected log events: ${missing.join(', ')} ` +
            `(seen: ${[...seen].join(', ')})`);
    }
}
/**
 * Assert that every record carries the same correlationId. Useful as a
 * separate assertion so failure messages distinguish "missing event" from
 * "events present but uncorrelated."
 */
export function assertAllCorrelated(records: ReadonlyArray<LogRecord>, correlationId: string): void {
    const wrong = records.filter(function (r) {
        return r.correlationId !== correlationId;
    });
    if (wrong.length > 0) {
        throw new Error(`${wrong.length}/${records.length} records have wrong correlationId ` +
            `(first wrong: ${wrong[0]?.correlationId})`);
    }
}
