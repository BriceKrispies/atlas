/**
 * HTTP backend implementation.
 *
 * Calls the real Atlas ingress API. Swap in via VITE_BACKEND=http.
 * Requires the ingress service to be running on VITE_API_URL (default: http://localhost:3000).
 */
import { emitTelemetry } from '@atlas/core';
import type { Backend, BackendEventCallback, SerializedServerEvent, SerializedServerEventCallback, Unsubscribe, } from '../backend.ts';
// `import.meta.env` is Vite-injected; under raw Node ESM (the test harness,
// SSR) it can be undefined. Read through an optional chain so the module
// loads in both worlds — production frontend builds still go through Vite.
const _viteEnv = (import.meta as { env?: Record<string, string | undefined> }).env;
const API_URL: string = _viteEnv?.VITE_API_URL ?? 'http://localhost:3000';
const TENANT_ID: string = _viteEnv?.VITE_TENANT_ID ?? 'tenant-001';
// TODO: Auth headers (Bearer token from @atlas/auth) will be injected here
function headers(): Record<string, string> {
    return {
        'Content-Type': 'application/json',
        'X-Debug-Principal': `user:admin:${TENANT_ID}`, // Dev only — replaced by real auth
    };
}
/** Generate a short random ID */
function uid(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
interface IntentPayload {
    actionId?: string;
    [key: string]: unknown;
}
interface EventEnvelope {
    eventId: string;
    eventType: string;
    schemaId: string;
    schemaVersion: number;
    occurredAt: string;
    tenantId: string;
    correlationId: string;
    idempotencyKey: string;
    payload: IntentPayload;
}
/**
 * Wrap an intent payload in a full EventEnvelope for the ingress API.
 * The component provides the payload (actionId, resourceType, etc.),
 * this function adds the envelope fields the backend requires.
 */
/**
 * Convert PascalCase segments of an actionId to lower_snake and join with
 * dots, plus a `.v1` suffix. Mirrors `actionIdToSchemaId` in
 * `@atlas/adapter-node` so client-side envelope construction matches
 * the server's schema-validator lookup.
 */
function deriveSchemaId(actionId: string): string {
    const PASCAL_BOUNDARY = /(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/g;
    const segments = actionId
        .split('.')
        .map(function (s) {
        return s.replace(PASCAL_BOUNDARY, '_').toLowerCase();
    })
        .filter(function (s) {
        return s.length > 0;
    });
    return `${segments.join('.')}.v1`;
}
function wrapIntent(payload: IntentPayload): EventEnvelope {
    const actionId = payload.actionId ?? '';
    // Derive eventType from actionId: "ContentPages.Page.Create" → "ContentPages.PageCreateRequested"
    const parts = actionId.split('.');
    const eventType = parts.length === 3
        ? `${parts[0]}.${parts[1]}${parts[2]}Requested`
        : `${actionId}Requested`;
    return {
        eventId: `evt-${uid()}`,
        eventType,
        // Schema id is derived from the actionId so the envelope routes to
        // the right validator on the server (`@atlas/adapter-node`'s
        // `actionIdToSchemaId` does the same conversion). Authz, catalog,
        // and content actions all flow through this single helper.
        schemaId: deriveSchemaId(actionId),
        schemaVersion: 1,
        occurredAt: new Date().toISOString(),
        tenantId: TENANT_ID,
        correlationId: `corr-${uid()}`,
        idempotencyKey: `idem-${uid()}`,
        payload,
    };
}
interface ServerSentEventLike {
    type: string;
    data: string;
}
/** Read `.message` from a thrown value without an unsafe cast. */
function errMessage(e: unknown): string {
    if (e instanceof Error)
        return e.message;
    return String(e);
}
/** Narrow an arbitrary `Event` to the `MessageEvent`-shaped `{ data: string }`
 *  that `EventSource` delivers. Used inside the SSE dispatch fanout. */
function isMessageEventLike(e: Event): e is Event & {
    data: string;
} {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary: Event is a DOM lib type; we read one optional property to type-test
    return typeof (e as {
        data?: unknown;
    }).data === 'string';
}
/**
 * Pool of EventSources keyed by their tag-filter signature.
 *
 * Multiple surfaces subscribed to the same tag set share one connection.
 * When the last subscriber for a signature unsubscribes, the EventSource
 * is closed and the entry removed.
 *
 * The signature is the sorted tag list joined by `,`. Empty signature
 * (`''`) is the "no filter" pool slot used by the legacy `subscribe()`
 * method and by `subscribeTags([], …)`.
 */
interface PooledSource {
    source: EventSource;
    /** All currently-attached `message`-style subscribers. */
    subscribers: Set<(event: SerializedServerEvent) => void>;
}
const sourcePool = new Map<string, PooledSource>();
function tagSignature(tags: readonly string[]): string {
    // Sorting normalises ['B','A'] and ['A','B'] to the same signature so
    // they share a connection. Empty list → '' (the back-compat slot).
    return [...tags].sort().join(',');
}
function ensurePooledSource(tags: readonly string[]): PooledSource {
    const signature = tagSignature(tags);
    const existing = sourcePool.get(signature);
    if (existing)
        return existing;
    const url = tags.length > 0
        ? `${API_URL}/api/v1/events?tags=${encodeURIComponent(tags.join(','))}`
        : `${API_URL}/api/v1/events`;
    const source = new EventSource(url, {
    // EventSource doesn't support custom headers; auth via cookie /
    // query-token will land later (see TODO at top of file).
    });
    const pooled: PooledSource = {
        source,
        subscribers: new Set(),
    };
    // Single onmessage-style fanout: every named-event listener delegates
    // to the subscriber set, so we only pay one parse per delivered event.
    // We use a wildcard listener via `source.onmessage` AND attach a
    // generic handler at addEventListener time per subscriber? No — the
    // server emits `event: <eventType>` so we have to listen per event
    // type. Cheapest portable shape: install a single listener for each
    // event type the first time we see it. Since the server's eventType
    // set is small (`projection.updated`, `cache.invalidated`), we attach
    // both up front.
    const dispatch = function (e: Event): void {
        // The DOM lib types `EventSource`'s callback as receiving `Event`, but
        // at runtime it always delivers a `MessageEvent` with a string `data`.
        // Narrow defensively rather than escape-hatching through `as unknown as`.
        if (!isMessageEventLike(e))
            return;
        let parsed: unknown;
        try {
            parsed = JSON.parse(e.data);
        }
        catch {
            return;
        }
        // The server emits SerializedServerEvent shapes; we hand the parsed
        // value to subscribers as that type. Schema mismatches surface as
        // runtime errors inside the subscriber's own typed access.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary: parsed SSE JSON arrives untyped from the network
        const typed = parsed as SerializedServerEvent;
        for (const cb of pooled.subscribers) {
            try {
                cb(typed);
            }
            catch (err) {
                // One bad subscriber must not break the others. Route the
                // failure through the frontend telemetry pipeline instead of
                // bypassing the logging contract.
                emitTelemetry({
                    eventName: 'Atlas.Listener.Threw',
                    level: 'error',
                    source: 'api-client.http.subscribeTags',
                    'error.message': errMessage(err),
                });
            }
        }
    };
    // Listen for the two server-emitted event types. New types added
    // server-side need an entry here too.
    source.addEventListener('projection.updated', dispatch);
    source.addEventListener('cache.invalidated', dispatch);
    sourcePool.set(signature, pooled);
    return pooled;
}
function attachSubscriber(signature: string, pooled: PooledSource, callback: (event: SerializedServerEvent) => void): Unsubscribe {
    pooled.subscribers.add(callback);
    return function () {
        pooled.subscribers.delete(callback);
        if (pooled.subscribers.size === 0) {
            pooled.source.close();
            sourcePool.delete(signature);
        }
    };
}
export const httpBackend: Backend = {
    async query(path: string): Promise<unknown> {
        const res = await fetch(`${API_URL}/api/v1${path}`, {
            headers: headers(),
        });
        if (!res.ok) {
            throw new Error(`API error: ${res.status} ${res.statusText}`);
        }
        return res.json() as Promise<unknown>;
    },
    async mutate(path: string, body: Record<string, unknown>): Promise<unknown> {
        // Wrap intent payloads in an EventEnvelope for the ingress API
        const envelope: unknown = path === '/intents' ? wrapIntent(body as IntentPayload) : body;
        const res = await fetch(`${API_URL}/api/v1${path}`, {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify(envelope),
        });
        if (!res.ok) {
            throw new Error(`API error: ${res.status} ${res.statusText}`);
        }
        return res.json() as Promise<unknown>;
    },
    subscribe(eventType: string, callback: BackendEventCallback): Unsubscribe {
        // Legacy event-type subscription. Routed through the same pool as
        // `subscribeTags([], …)` so a page subscribing both ways shares
        // one connection. We filter by `eventType` client-side since the
        // server delivers all event types on the unfiltered stream.
        const pooled = ensurePooledSource([]);
        const wrapped = function (parsed: SerializedServerEvent): void {
            if (parsed.eventType === eventType)
                callback(parsed);
        };
        return attachSubscriber('', pooled, wrapped);
    },
    subscribeTags(tags: string[], callback: SerializedServerEventCallback): Unsubscribe {
        const signature = tagSignature(tags);
        const pooled = ensurePooledSource(tags);
        return attachSubscriber(signature, pooled, callback);
    },
};
/**
 * Test-only hook: drop every pooled EventSource. Not part of the
 * public surface — exported for unit tests that swap the global
 * `EventSource` constructor between cases.
 */
export function _resetSubscriptionPool(): void {
    for (const pooled of sourcePool.values()) {
        pooled.source.close();
    }
    sourcePool.clear();
}
