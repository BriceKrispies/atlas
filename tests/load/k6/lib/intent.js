// Shared helpers — k6 runs JavaScript on a Go engine, so this is ES
// modules (no TypeScript, no Node APIs beyond what k6 polyfills).
//
// Polyfills available: see https://k6.io/docs/javascript-api/
//   - http (k6/http)
//   - crypto.randomUUID is NOT available; we synthesize an ID from
//     `__VU` (virtual user id) + `__ITER` (per-VU iteration counter)
//     which is unique-per-request and fully deterministic for replays.

const ATLAS_URL = __ENV.ATLAS_URL || 'http://localhost:3000';
const TENANT_ID = __ENV.TENANT_ID || 'dev-tenant';
const PRINCIPAL = __ENV.DEBUG_PRINCIPAL || `user:gambler-k6:${TENANT_ID}`;

export const config = { ATLAS_URL, TENANT_ID, PRINCIPAL };

export function uid(prefix) {
  // __VU is the 1-based virtual-user id; __ITER is the per-VU iteration
  // count. Together they're unique across a run. Add a small random
  // suffix so multi-run replays don't collide on the idempotency key.
  return `${prefix}-${__VU}-${__ITER}-${Math.floor(Math.random() * 1e6)}`;
}

export function pageReadIntent() {
  return {
    eventType: 'ContentPages.PageReadRequested',
    schemaId: 'content_pages.page.read.v1',
    schemaVersion: 1,
    tenantId: TENANT_ID,
    correlationId: uid('corr'),
    idempotencyKey: uid('idem'),
    payload: {
      actionId: 'ContentPages.Page.Read',
      resourceType: 'Page',
      pageId: 'page-does-not-exist',
    },
  };
}

export const headers = {
  'Content-Type': 'application/json',
  'X-Debug-Principal': PRINCIPAL,
};
