/**
 * HTTP backend implementation.
 *
 * Calls the real Atlas ingress API. Swap in via VITE_BACKEND=http.
 * Requires the ingress service to be running on VITE_API_URL (default: http://localhost:3000).
 *
 * @type {import('../backend.js').Backend}
 */

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const TENANT_ID = import.meta.env.VITE_TENANT_ID ?? 'tenant-001';

// TODO: Auth headers (Bearer token from @atlas/auth) will be injected here
function headers() {
  return {
    'Content-Type': 'application/json',
    'X-Debug-Principal': `user:admin:${TENANT_ID}`, // Dev only — replaced by real auth
  };
}

/** Generate a short random ID */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Wrap an intent payload in a full EventEnvelope for the ingress API.
 * The component provides the payload (actionId, resourceType, etc.),
 * this function adds the envelope fields the backend requires.
 */
function wrapIntent(payload) {
  const actionId = payload.actionId || '';
  // Derive eventType from actionId: "ContentPages.Page.Create" → "ContentPages.PageCreateRequested"
  const parts = actionId.split('.');
  const eventType =
    parts.length === 3
      ? `${parts[0]}.${parts[1]}${parts[2]}Requested`
      : `${actionId}Requested`;

  return {
    eventId: `evt-${uid()}`,
    eventType,
    schemaId: 'ui.contentpages.page.create.v1',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    tenantId: TENANT_ID,
    correlationId: `corr-${uid()}`,
    idempotencyKey: `idem-${uid()}`,
    payload,
  };
}

/** @type {import('../backend.js').Backend} */
export const httpBackend = {
  async query(path) {
    const res = await fetch(`${API_URL}/api/v1${path}`, {
      headers: headers(),
    });
    if (!res.ok) {
      throw new Error(`API error: ${res.status} ${res.statusText}`);
    }
    return res.json();
  },

  async mutate(path, body) {
    // Wrap intent payloads in an EventEnvelope for the ingress API
    const envelope = path === '/intents' ? wrapIntent(body) : body;
    const res = await fetch(`${API_URL}/api/v1${path}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(envelope),
    });
    if (!res.ok) {
      throw new Error(`API error: ${res.status} ${res.statusText}`);
    }
    return res.json();
  },

  subscribe(eventType, callback) {
    const source = new EventSource(`${API_URL}/api/v1/events`, {
      // Note: EventSource doesn't support custom headers natively.
      // For auth, we'll need to use a polyfill or query param token.
    });

    const handler = (e) => {
      if (e.type === eventType) {
        callback(JSON.parse(e.data));
      }
    };

    source.addEventListener(eventType, handler);

    return () => {
      source.removeEventListener(eventType, handler);
      source.close();
    };
  },
};
