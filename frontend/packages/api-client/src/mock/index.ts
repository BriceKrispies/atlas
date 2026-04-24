/**
 * Mock backend implementation.
 *
 * In-memory data with simulated latency. Mutations emit events
 * so subscribers see updates (simulating SSE).
 */

import * as store from './store.ts';
import type { Backend, BackendEventCallback, Unsubscribe } from '../backend.ts';

type RouteHandler = (...params: string[]) => Promise<unknown>;

/** Route table: path pattern → handler */
const routes: Record<string, RouteHandler> = {
  '/pages': () => store.list('pages'),
  '/pages/:id': (id) => store.getById('pages', id!),
};

interface MatchedRoute {
  handler: RouteHandler;
  params: string[];
}

/**
 * Match a path against registered routes.
 */
function matchRoute(path: string): MatchedRoute | null {
  // Exact match
  const exact = routes[path];
  if (exact) {
    return { handler: exact, params: [] };
  }

  // Parameterized match: /pages/pg_001 → /pages/:id
  const segments = path.split('/').filter(Boolean);
  for (const [pattern, handler] of Object.entries(routes)) {
    const patternSegments = pattern.split('/').filter(Boolean);
    if (segments.length !== patternSegments.length) continue;

    const params: string[] = [];
    let match = true;
    for (let i = 0; i < segments.length; i++) {
      const pSeg = patternSegments[i]!;
      const sSeg = segments[i]!;
      if (pSeg.startsWith(':')) {
        params.push(sSeg);
      } else if (pSeg !== sSeg) {
        match = false;
        break;
      }
    }
    if (match) return { handler, params };
  }

  return null;
}

interface IntentBody {
  actionId?: string;
  title?: string;
  slug?: string;
  pageId?: string;
  [key: string]: unknown;
}

export const mockBackend: Backend = {
  async query(path: string): Promise<unknown> {
    const route = matchRoute(path);
    if (!route) {
      throw new Error(`[mock] No route for: ${path}`);
    }
    return route.handler(...route.params);
  },

  async mutate(path: string, body: Record<string, unknown>): Promise<unknown> {
    if (path === '/intents') {
      const intent = body as IntentBody;
      const actionId = intent.actionId;
      if (actionId === 'ContentPages.Page.Create') {
        const page = {
          pageId: `pg_${Date.now().toString(36)}`,
          title: intent.title ?? 'Untitled',
          slug: intent.slug ?? 'untitled',
          status: 'draft',
          tenantId: 'tenant-001',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        return store.create('pages', page);
      }
      if (actionId === 'ContentPages.Page.Delete') {
        await store.remove('pages', intent.pageId ?? '');
        return { deleted: true };
      }
    }
    throw new Error(`[mock] Unknown mutation: ${path} ${JSON.stringify(body)}`);
  },

  subscribe(eventType: string, callback: BackendEventCallback): Unsubscribe {
    return store.subscribe(eventType, callback);
  },
};
