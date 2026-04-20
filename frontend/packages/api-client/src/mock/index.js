/**
 * Mock backend implementation.
 *
 * In-memory data with simulated latency. Mutations emit events
 * so subscribers see updates (simulating SSE).
 *
 * @type {import('../backend.js').Backend}
 */

import * as store from './store.js';

/** Route table: path pattern → handler */
const routes = {
  '/pages': () => store.list('pages'),
  '/pages/:id': (id) => store.getById('pages', id),
};

/**
 * Match a path against registered routes.
 * @param {string} path
 * @returns {{ handler: Function, params: string[] } | null}
 */
function matchRoute(path) {
  // Exact match
  if (routes[path]) {
    return { handler: routes[path], params: [] };
  }

  // Parameterized match: /pages/pg_001 → /pages/:id
  const segments = path.split('/').filter(Boolean);
  for (const [pattern, handler] of Object.entries(routes)) {
    const patternSegments = pattern.split('/').filter(Boolean);
    if (segments.length !== patternSegments.length) continue;

    const params = [];
    let match = true;
    for (let i = 0; i < segments.length; i++) {
      if (patternSegments[i].startsWith(':')) {
        params.push(segments[i]);
      } else if (patternSegments[i] !== segments[i]) {
        match = false;
        break;
      }
    }
    if (match) return { handler, params };
  }

  return null;
}

/** @type {import('../backend.js').Backend} */
export const mockBackend = {
  async query(path) {
    const route = matchRoute(path);
    if (!route) {
      throw new Error(`[mock] No route for: ${path}`);
    }
    return route.handler(...route.params);
  },

  async mutate(path, body) {
    if (path === '/intents') {
      const actionId = body.actionId;
      if (actionId === 'ContentPages.Page.Create') {
        const page = {
          pageId: `pg_${Date.now().toString(36)}`,
          title: body.title ?? 'Untitled',
          slug: body.slug ?? 'untitled',
          status: 'draft',
          tenantId: 'tenant-001',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        return store.create('pages', page);
      }
      if (actionId === 'ContentPages.Page.Delete') {
        await store.remove('pages', body.pageId);
        return { deleted: true };
      }
    }
    throw new Error(`[mock] Unknown mutation: ${path} ${JSON.stringify(body)}`);
  },

  subscribe(eventType, callback) {
    return store.subscribe(eventType, callback);
  },
};
