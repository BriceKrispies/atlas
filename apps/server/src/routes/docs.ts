/**
 * Documentation routes — serves the generated OpenAPI specs and Scalar
 * UI to render them.
 *
 * Two surfaces:
 *
 *   GET /docs                  — public; renders specs/openapi.tenant.json
 *   GET /openapi.tenant.json   — public; the raw spec
 *
 *   GET /admin/docs            — admin-gated; renders specs/openapi.operator.json
 *   GET /admin/openapi.operator.json — admin-gated; the raw spec
 *
 * The HTML pages embed [Scalar](https://github.com/scalar/scalar) from
 * a CDN — no SDK install, no build step. The JSON files are read once
 * at module load via `import.meta.url`-relative path resolution and
 * cached for the process lifetime. Re-running `pnpm sync-openapi`
 * regenerates them; the server picks up the new content on restart.
 *
 * Per specs/crosscut/openapi.md.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppState } from '../bootstrap.ts';
import { errorResponse } from '../middleware/errors.ts';
import { correlationIdFor } from '../middleware/correlation.ts';
import type { ServerVariables } from '../middleware/principal.ts';
type AppCtx = Context<{
    Variables: ServerVariables;
}>;
// Resolve the repo root from this file's location:
//   apps/server/src/routes/docs.ts → ../../../../
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const TENANT_SPEC_PATH = resolve(repoRoot, 'specs', 'openapi.tenant.json');
const OPERATOR_SPEC_PATH = resolve(repoRoot, 'specs', 'openapi.operator.json');
interface CachedSpec {
    body: string;
    loadedAt: number;
}
function loadSpec(path: string): CachedSpec | null {
    if (!existsSync(path))
        return null;
    return { body: readFileSync(path, 'utf-8'), loadedAt: Date.now() };
}
const tenantSpec = loadSpec(TENANT_SPEC_PATH);
const operatorSpec = loadSpec(OPERATOR_SPEC_PATH);
function scalarHtml(specPath: string, title: string): string {
    // Minimal HTML harness; Scalar renders into the document via its
    // <script id="api-reference" data-url="..."> hook. The CDN bundle
    // is pinned to a major version; bump deliberately when we want the
    // newer features.
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escape(title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;padding:0;background:#fafafa;}</style>
</head>
<body>
<script id="api-reference" data-url="${escape(specPath)}"></script>
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@latest"></script>
</body>
</html>`;
}
function escape(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
function htmlResponse(c: AppCtx, body: string): Response {
    return c.body(body, 200 as ContentfulStatusCode, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
    });
}
function jsonSpecResponse(c: AppCtx, body: string): Response {
    return c.body(body, 200 as ContentfulStatusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        // Long cache: the spec only changes when the server restarts after
        // a fresh `pnpm sync-openapi`. Tenant SDKs that fetch this can
        // honor the response.
        'Cache-Control': 'public, max-age=300',
    });
}
function specMissing(c: AppCtx, name: string, correlationId: string): Response {
    return errorResponse(c, 'NOT_FOUND', `${name} not found — run \`pnpm sync-openapi\` to regenerate.`, 503, correlationId);
}
function requireAdmin(c: AppCtx, correlationId: string): Response | null {
    const principal = c.get('principal');
    if (!principal) {
        return errorResponse(c, 'PRINCIPAL_INVALID', 'authentication required', 401, correlationId);
    }
    const roles = principal.roles ?? [];
    if (!roles.includes('admin')) {
        return errorResponse(c, 'FORBIDDEN', 'admin role required', 403, correlationId);
    }
    return null;
}
/** Public routes: tenant spec + tenant docs UI. */
export function tenantDocsRoutes(_state: AppState): Hono<{
    Variables: ServerVariables;
}> {
    const app = new Hono<{
        Variables: ServerVariables;
    }>();
    app.get('/openapi.tenant.json', function (c: AppCtx) {
        if (tenantSpec === null) {
            return specMissing(c, 'tenant OpenAPI spec', correlationIdFor(c));
        }
        return jsonSpecResponse(c, tenantSpec.body);
    });
    app.get('/docs', function (c: AppCtx) {
        if (tenantSpec === null) {
            return specMissing(c, 'tenant OpenAPI spec', correlationIdFor(c));
        }
        return htmlResponse(c, scalarHtml('/openapi.tenant.json', 'Atlas Tenant API'));
    });
    return app;
}
/** Admin-gated routes: operator spec + operator docs UI. */
export function operatorDocsRoutes(_state: AppState): Hono<{
    Variables: ServerVariables;
}> {
    const app = new Hono<{
        Variables: ServerVariables;
    }>();
    app.get('/admin/openapi.operator.json', function (c: AppCtx) {
        const correlationId = correlationIdFor(c);
        const denied = requireAdmin(c, correlationId);
        if (denied)
            return denied;
        if (operatorSpec === null) {
            return specMissing(c, 'operator OpenAPI spec', correlationId);
        }
        return jsonSpecResponse(c, operatorSpec.body);
    });
    app.get('/admin/docs', function (c: AppCtx) {
        const correlationId = correlationIdFor(c);
        const denied = requireAdmin(c, correlationId);
        if (denied)
            return denied;
        if (operatorSpec === null) {
            return specMissing(c, 'operator OpenAPI spec', correlationId);
        }
        return htmlResponse(c, scalarHtml('/admin/openapi.operator.json', 'Atlas Operator API'));
    });
    return app;
}
