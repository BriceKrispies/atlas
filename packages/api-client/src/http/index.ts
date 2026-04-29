/**
 * HTTP backend implementation.
 *
 * Calls the real Atlas ingress API. Swap in via VITE_BACKEND=http.
 * Requires the ingress service to be running on VITE_API_URL (default: http://localhost:3000).
 */

import type { Backend, BackendEventCallback, Unsubscribe } from '../backend.ts';

const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const TENANT_ID: string = import.meta.env.VITE_TENANT_ID ?? 'tenant-001';

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
 * `@atlas/adapters-node` so client-side envelope construction matches
 * the server's schema-validator lookup.
 */
function deriveSchemaId(actionId: string): string {
  const PASCAL_BOUNDARY = /(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/g;
  const segments = actionId
    .split('.')
    .map((s) => s.replace(PASCAL_BOUNDARY, '_').toLowerCase())
    .filter((s) => s.length > 0);
  return `${segments.join('.')}.v1`;
}

function wrapIntent(payload: IntentPayload): EventEnvelope {
  const actionId = payload.actionId ?? '';
  // Derive eventType from actionId: "ContentPages.Page.Create" → "ContentPages.PageCreateRequested"
  const parts = actionId.split('.');
  const eventType =
    parts.length === 3
      ? `${parts[0]}.${parts[1]}${parts[2]}Requested`
      : `${actionId}Requested`;

  return {
    eventId: `evt-${uid()}`,
    eventType,
    // Schema id is derived from the actionId so the envelope routes to
    // the right validator on the server (`@atlas/adapters-node`'s
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
    const envelope: unknown =
      path === '/intents' ? wrapIntent(body as IntentPayload) : body;
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
    const source = new EventSource(`${API_URL}/api/v1/events`, {
      // Note: EventSource doesn't support custom headers natively.
      // For auth, we'll need to use a polyfill or query param token.
    });

    const handler = (e: Event): void => {
      const msg = e as unknown as ServerSentEventLike;
      if (msg.type === eventType) {
        callback(JSON.parse(msg.data) as unknown);
      }
    };

    source.addEventListener(eventType, handler);

    return () => {
      source.removeEventListener(eventType, handler);
      source.close();
    };
  },
};
