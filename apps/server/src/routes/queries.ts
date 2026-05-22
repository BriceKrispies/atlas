/**
 * Query-side catch-all dispatcher.
 *
 * `GET /api/v1/queries/:queryId` — params decoded from the querystring.
 * `POST /api/v1/queries/:queryId` — params decoded from the JSON body.
 *
 * Both verbs share the same descriptor lookup, authorization, cache, and
 * dispatch path. Adding a new read endpoint is a module-only edit
 * (register a descriptor in the module's `*QueryRegistry`); no
 * `apps/server` route mount is required. This file IS the substrate that
 * closes the §11.1 retrospective for read endpoints.
 *
 * Contract: [`specs/crosscut/action-driven-routing.md`](../../../specs/crosscut/action-driven-routing.md) §4.
 * Substrate ticket: `tickets/atlas-on-atlas/query-catch-all-dispatcher.md`.
 *
 * Order inside the dispatch (§4.5 — I2-preserving):
 *   1. Resolve descriptor by queryId. 404 if not registered.
 *   2. Build `QueryContext` from the request bundle.
 *   3. `evaluateRead` — deny short-circuits 403, no cache read, no fn call.
 *   4. Cache lookup if `descriptor.cacheKey` returned non-null.
 *   5. On miss, call `descriptor.fn(ctx, params)`.
 *   6. Write back to cache (same key) on success.
 *   7. `null` result → 404 unless `nullIsOk: true`.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { evaluateRead } from '@atlas/ingress';
import type { Cache, QueryContext, QueryDescriptor, QueryRegistry } from '@atlas/ports';
import type { AppState } from '../bootstrap.ts';
import { buildRequestBundle } from '../middleware/state.ts';
import { errorResponse, mapError, errorMessage } from '../middleware/errors.ts';
import type { ServerVariables } from '../middleware/principal.ts';

type AppCtx = Context<{ Variables: ServerVariables }>;

/**
 * Decode a querystring `Record<string, string | string[]>` into the flat
 * `Record<string, unknown>` the descriptor expects. Numeric strings
 * intentionally stay strings — the query function owns its parsing per
 * §4.4 ("numeric strings stay strings; the query function owns its
 * parsing"). Multi-value keys (`?tag=a&tag=b`) collapse to arrays.
 */
function decodeQuerystring(c: AppCtx): Record<string, unknown> {
  const raw = c.req.queries();
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!Array.isArray(v)) continue;
    if (v.length === 0) continue;
    out[k] = v.length === 1 ? v[0] : v;
  }
  return out;
}

/**
 * Read the JSON body for POST requests. Returns null on empty/missing
 * body so callers fall back to an empty params object. Throws on a
 * malformed body (caller maps to 400 BAD_REQUEST).
 */
async function decodeJsonBody(c: AppCtx): Promise<Record<string, unknown> | null> {
  const text = await c.req.text();
  if (text.length === 0) return null;
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('expected JSON object body');
  }
  return parsed as Record<string, unknown>;
}

/**
 * Run the descriptor pipeline. Extracted so GET and POST share the same
 * order-of-operations exactly — diverging would defeat the catch-all's
 * uniformity guarantee (§4.4: "same descriptor, dispatch, authz, cache,
 * and audit path").
 */
async function dispatchQuery(
  c: AppCtx,
  state: AppState,
  registry: QueryRegistry,
  cacheFor: (bundle: Awaited<ReturnType<typeof buildRequestBundle>>) => Cache,
  queryId: string,
  params: Record<string, unknown>,
): Promise<Response> {
  const correlationId = c.get('correlationId');
  const principal = c.get('principal');
  if (!principal) {
    return errorResponse(
      c,
      'PRINCIPAL_REQUIRED',
      'authentication required',
      401,
      correlationId,
    );
  }

  // Step 1 — descriptor lookup. 404 if not registered. Body intentionally
  // does NOT echo the queryId (the requested id is already in the URL the
  // caller sent; echoing it back in the body adds nothing for the legit
  // caller and is a partial mitigation against the wider
  // descriptor-lookup-before-authz oracle tracked at
  // `tickets/chore/query-catchall-lookup-before-authz-oracle.md`).
  const descriptor: QueryDescriptor | undefined = registry.get(queryId);
  if (!descriptor) {
    return errorResponse(
      c,
      'NOT_FOUND',
      'query not registered',
      404,
      correlationId,
    );
  }

  let bundle: Awaited<ReturnType<typeof buildRequestBundle>>;
  try {
    bundle = await buildRequestBundle(state, principal, correlationId);
  } catch (e) {
    return mapError(c, e, correlationId);
  }

  // Step 2 — build `QueryContext`. The wiring layer owns this shape; the
  // contract (§4.2) is that the same instance is handed to every
  // dispatched query in a request.
  const ctx: QueryContext = {
    tenantId: bundle.ingress.tenantId,
    principalId: bundle.ingress.principalId,
    correlationId,
    ...(bundle.ingress.logger !== undefined ? { logger: bundle.ingress.logger } : {}),
    // Adapter-port fields typed as `unknown` on the port (cycle-free);
    // populated here with the per-request stores from the bundle.
    // Modules narrow structurally at the reach-in (see e.g.
    // `modules/identity/src/queries/registry.ts`'s `identityContext`).
    entities: bundle.identityDeps.entities,
    relations: bundle.identityDeps.relations,
    projections: bundle.catalogDeps.projections,
    search: bundle.catalogDeps.search,
  };

  // Step 3 — authorize before any read or fn call (I2).
  const decision = await evaluateRead(
    {
      principal: {
        id: principal.principalId,
        tenantId: principal.tenantId,
        attributes: bundle.principal.attributes ?? {},
      },
      action: descriptor.actionId,
      resource: {
        type: descriptor.resource.type,
        id: descriptor.resource.idFrom(params),
        tenantId: principal.tenantId,
        attributes: {},
      },
      context: { correlationId },
    },
    bundle.ingress,
  );
  if (decision.effect === 'deny') {
    return errorResponse(
      c,
      'UNAUTHORIZED',
      'Not authorized to perform this action',
      403,
      correlationId,
    );
  }

  // Step 4 — cache lookup if the descriptor declares a key. `null`
  // return opts the query out of caching (§4.6).
  const cache = cacheFor(bundle);
  let cacheKey: string | null = null;
  try {
    cacheKey = descriptor.cacheKey ? descriptor.cacheKey(ctx, params) : null;
  } catch (e) {
    // A `cacheKey` that throws under a real ctx is a module bug — the
    // registration-time smoke check should have caught this. Log and
    // proceed without caching rather than 500: the query itself may
    // still succeed.
    bundle.ingress.logger?.warn('query cacheKey threw; bypassing cache', {
      event: 'Query.CacheKey.Failed',
      properties: {
        queryId,
        cause: errorMessage(e),
      },
    });
    cacheKey = null;
  }

  if (cacheKey !== null) {
    try {
      const hit = await cache.get(cacheKey);
      if (hit !== null && hit !== undefined) {
        return c.json(hit as object);
      }
    } catch (e) {
      bundle.ingress.logger?.warn('query cache get failed; falling through to fn', {
        event: 'Query.Cache.Get.Failed',
        properties: {
          queryId,
          cause: errorMessage(e),
        },
      });
    }
  }

  // Step 5 — run the registered fn.
  let result: unknown;
  try {
    result = await descriptor.fn(ctx, params);
  } catch (e) {
    bundle.ingress.logger?.warn('query fn threw', {
      event: 'Query.Fn.Failed',
      properties: {
        queryId,
        cause: errorMessage(e),
      },
    });
    return mapError(c, e, correlationId);
  }

  // Step 6 — write back to cache. No-op if the descriptor opted out.
  if (cacheKey !== null && result !== null && result !== undefined) {
    try {
      // Cache write carries tenantId for I9/I10 alignment — the key
      // already includes it (§4.6 enforces); the tag is the standard
      // tenant-wide invalidation handle the write-side dispatcher
      // already emits. TTL of 60s is a placeholder; future per-query
      // overrides land via descriptor metadata (out of scope here).
      // CacheSetOptions = { ttlSeconds, tags }. Tag carries
      // `Tenant:<id>` so tenant-wide invalidation events (any write-side
      // emit tagged `Tenant:<id>`) purge this entry. TTL is a 60-second
      // safety net for cache entries written without tag-driven
      // invalidation; future per-descriptor overrides are out of scope.
      await cache.set(cacheKey, result, {
        tags: [`Tenant:${principal.tenantId}`],
        ttlSeconds: 60,
      });
    } catch (e) {
      bundle.ingress.logger?.warn('query cache set failed; returning fresh result', {
        event: 'Query.Cache.Set.Failed',
        properties: {
          queryId,
          cause: errorMessage(e),
        },
      });
    }
  }

  // Step 7 — map result. `null` → 404 unless the descriptor opts in.
  if (result === null) {
    if (descriptor.nullIsOk === true) {
      return c.json(null as unknown as object, 200 as ContentfulStatusCode);
    }
    return errorResponse(c, 'NOT_FOUND', `${queryId} returned no result`, 404, correlationId);
  }
  return c.json(result as object);
}

/**
 * Build the catch-all routes. Caller supplies the composed registry +
 * a per-bundle accessor for the cache; this lets tests pass a synthetic
 * registry + mock cache without going through `state.ts`'s production
 * composition.
 */
export function queryRoutes(
  state: AppState,
  registry: QueryRegistry,
  cacheFor: (bundle: Awaited<ReturnType<typeof buildRequestBundle>>) => Cache,
): Hono<{ Variables: ServerVariables }> {
  const app = new Hono<{ Variables: ServerVariables }>();

  app.get('/api/v1/queries/:queryId', async function (c: AppCtx): Promise<Response> {
    const queryId = c.req.param('queryId');
    if (!queryId) {
      return errorResponse(
        c,
        'BAD_REQUEST',
        'queryId is required',
        400,
        c.get('correlationId'),
      );
    }
    const params = decodeQuerystring(c);
    return dispatchQuery(c, state, registry, cacheFor, queryId, params);
  });

  app.post('/api/v1/queries/:queryId', async function (c: AppCtx): Promise<Response> {
    const queryId = c.req.param('queryId');
    if (!queryId) {
      return errorResponse(
        c,
        'BAD_REQUEST',
        'queryId is required',
        400,
        c.get('correlationId'),
      );
    }
    let params: Record<string, unknown>;
    try {
      params = (await decodeJsonBody(c)) ?? {};
    } catch (e) {
      return errorResponse(
        c,
        'BAD_REQUEST',
        `Invalid JSON body: ${errorMessage(e)}`,
        400,
        c.get('correlationId'),
      );
    }
    return dispatchQuery(c, state, registry, cacheFor, queryId, params);
  });

  return app;
}
