/**
 * Repository read-side routes (Code platform / `repository` domain).
 *
 * Phase-1 surface for the `upload-tarball` capability:
 *
 *   GET /api/v1/repositories                                 — list tenant's repos
 *   GET /api/v1/repositories/:repoId                         — repository detail
 *   GET /api/v1/repositories/:repoId/revisions               — revision list
 *   GET /api/v1/repositories/:repoId/revisions/:revisionId/bytes
 *                                                            — stream the tarball
 *
 * Writes go through `POST /api/v1/intents` with `Repository.Create` /
 * `Repository.Upload` actions; this file owns reads only.
 *
 * Mounted in the **authed** group — `principalMiddleware` runs first, so
 * `c.get('principal').tenantId` is the only source of tenant scope.
 * Tenant id is NEVER read from path / query parameters (Invariant I7).
 *
 * Cross-tenant resource access (e.g. tenant A asking for tenant B's
 * repository or revision id) returns 404, not 403, so existence is not
 * leaked. Same shape as `routes/content-pages.ts`.
 *
 * Spec: `specs/domains/code/repository/capabilities/upload-tarball/README.md`
 *       — sections "Surfaces" → "Routes", "File-by-File Plan" steps 6-7.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { PostgresRepositoryStore, PostgresRepositoryRevisionStore, } from '@atlas/adapter-node';
import { getRepository, listRepositories, getRevision, listRevisions, } from '@atlas/repository';
import type { RepositoryStore, RepositoryRevisionStore } from '@atlas/ports';
import type { AppState } from '../bootstrap.ts';
import { ensureTenantMigrated } from '../bootstrap.ts';
import { errorResponse, mapError } from '../middleware/errors.ts';
import type { ServerVariables } from '../middleware/principal.ts';
type AppCtx = Context<{
    Variables: ServerVariables;
}>;
/**
 * Build the per-request per-tenant repository stores. Cheap closures
 * over the per-tenant Postgres pool; allocating fresh instances on
 * every call keeps this file decoupled from `buildRequestBundle`.
 *
 * The work is delegated to `_storesFactory` so tests can swap in
 * in-memory implementations via {@link __setStoresFactoryForTest} —
 * Node ESM modules are immutable post-import, so there's no
 * `vi.mock`-equivalent for the legacy bootstrap-mock pattern.
 */
async function _defaultStoresFactory(
  state: AppState,
  tenantId: string,
): Promise<{ repositories: RepositoryStore; revisions: RepositoryRevisionStore }> {
    const sql = await ensureTenantMigrated(state, tenantId);
    return {
        repositories: new PostgresRepositoryStore(sql),
        revisions: new PostgresRepositoryRevisionStore(sql),
    };
}
let _storesFactory: typeof _defaultStoresFactory = _defaultStoresFactory;
/** @internal — test-only override hook. */
export function __setStoresFactoryForTest(
  fn: typeof _defaultStoresFactory | null,
): void {
  _storesFactory = fn ?? _defaultStoresFactory;
}
async function buildStores(state: AppState, c: AppCtx): Promise<{
    tenantId: string;
    repositories: RepositoryStore;
    revisions: RepositoryRevisionStore;
}> {
    const principal = c.get('principal');
    const { repositories, revisions } = await _storesFactory(state, principal.tenantId);
    return {
        tenantId: principal.tenantId,
        repositories,
        revisions,
    };
}
export function repositoryRoutes(state: AppState): Hono<{
    Variables: ServerVariables;
}> {
    const app = new Hono<{
        Variables: ServerVariables;
    }>();
    app.get('/api/v1/repositories', async function (c: AppCtx) {
        const correlationId = c.get('correlationId');
        try {
            const { tenantId, repositories } = await buildStores(state, c);
            const rows = await listRepositories({ tenantId, repositories });
            return c.json(rows);
        }
        catch (e) {
            return mapError(c, e, correlationId);
        }
    });
    app.get('/api/v1/repositories/:repoId', async function (c: AppCtx) {
        const correlationId = c.get('correlationId');
        const repoId = c.req.param('repoId') ?? '';
        try {
            const { tenantId, repositories } = await buildStores(state, c);
            const row = await getRepository({ tenantId, repositories }, repoId);
            if (!row) {
                return errorResponse(c, 'NOT_FOUND', `repository not found: ${repoId}`, 404, correlationId);
            }
            return c.json(row);
        }
        catch (e) {
            return mapError(c, e, correlationId);
        }
    });
    app.get('/api/v1/repositories/:repoId/revisions', async function (c: AppCtx) {
        const correlationId = c.get('correlationId');
        const repoId = c.req.param('repoId') ?? '';
        try {
            const { tenantId, repositories, revisions } = await buildStores(state, c);
            // Resolve repo first so a cross-tenant repoId reads as a 404 rather
            // than leaking existence via an empty revision list.
            const repo = await getRepository({ tenantId, repositories }, repoId);
            if (!repo) {
                return errorResponse(c, 'NOT_FOUND', `repository not found: ${repoId}`, 404, correlationId);
            }
            const rows = await listRevisions({ tenantId, revisions }, repoId);
            return c.json(rows);
        }
        catch (e) {
            return mapError(c, e, correlationId);
        }
    });
    app.get('/api/v1/repositories/:repoId/revisions/:revisionId/bytes', async function (c: AppCtx) {
        const correlationId = c.get('correlationId');
        const repoId = c.req.param('repoId') ?? '';
        const revisionId = c.req.param('revisionId') ?? '';
        try {
            const { tenantId, repositories, revisions } = await buildStores(state, c);
            // Resolve the repo first; cross-tenant repoIds read as 404.
            const repo = await getRepository({ tenantId, repositories }, repoId);
            if (!repo) {
                return errorResponse(c, 'NOT_FOUND', `repository not found: ${repoId}`, 404, correlationId);
            }
            // Verify the revision belongs to this tenant + repo. The
            // revision metadata read carries the tenant scope (per-tenant
            // DB) and we additionally assert `repoId` parity so a tenant
            // can't fish another repo's revision id from inside its own
            // tenant. Cross-tenant revision ids read as 404.
            const meta = await getRevision({ tenantId, revisions }, revisionId);
            if (!meta || meta.repoId !== repoId) {
                return errorResponse(c, 'NOT_FOUND', `revision not found: ${revisionId}`, 404, correlationId);
            }
            const bytes = await revisions.getBytes(tenantId, revisionId);
            if (!bytes) {
                // Metadata existed but bytes did not — that's a data
                // integrity bug, not a routing miss. Surface as 404 so the
                // client retries are bounded; the server-side log carries
                // the supportId for operator follow-up.
                return errorResponse(c, 'NOT_FOUND', `revision bytes not found: ${revisionId}`, 404, correlationId);
            }
            const filename = `${repo.repoSlug}-${revisionId}.tar.gz`;
            // Hono's `c.body` overload signature is narrow on Uint8Array vs
            // ArrayBufferLike; copy into a fresh Uint8Array<ArrayBuffer> so
            // the type matches `Response.body`'s expected input. The copy is
            // O(n) over a 10 MB cap — acceptable for Phase 1; the streaming
            // download replacement in the object-storage capability will
            // remove this allocation.
            const out = new Uint8Array(bytes.byteLength);
            out.set(bytes);
            return c.newResponse(out, 200 as ContentfulStatusCode, {
                'Content-Type': 'application/gzip',
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Content-Length': String(out.byteLength),
            });
        }
        catch (e) {
            return mapError(c, e, correlationId);
        }
    });
    return app;
}
