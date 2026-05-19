/**
 * Admin logging-control routes.
 *
 * Mounted in the authed group — `principalMiddleware` runs first so
 * `c.get('principal')` is set. Authorization for these routes is the
 * coarse "must have `admin` role" check (same posture as
 * `routes/admin-signups.ts`); the full I2 policy gate via the intent
 * pipeline is a follow-up when these flow through Cedar.
 *
 * Endpoints:
 *
 *   GET  /api/v1/admin/logging/levels
 *   POST /api/v1/admin/logging/levels/global
 *   POST /api/v1/admin/logging/levels/module/:moduleId
 *   POST /api/v1/admin/logging/levels/tenant/:tenantId
 *   POST /api/v1/admin/logging/levels/correlation/:correlationId
 *   GET  /api/v1/admin/logging/correlation/:correlationId/recent
 *
 * Per specs/crosscut/logging.md — runtime level overrides are mutated
 * via these routes; the LevelController stored on AppState is the
 * single source of truth at request time. Override bodies accept
 * `{ level: 'debug'|'info'|'warn'|'error'|'fatal' }` to set, or
 * `{ level: null }` to clear (POST is reused for clear so atlasctl
 * doesn't need a separate verb per operation).
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { isLogLevel, type LogLevel } from '@atlas/logging';
import type { AppState } from '../bootstrap.ts';
import { errorResponse, errorMessage } from '../middleware/errors.ts';
import { correlationIdFor } from '../middleware/correlation.ts';
import type { ServerVariables } from '../middleware/principal.ts';
type AppCtx = Context<{
    Variables: ServerVariables;
}>;
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
interface LevelBody {
    level: unknown;
}
/**
 * Parse the `{ level }` body. Returns the level (string), `null` (explicit
 * clear), or a Response to surface a 400.
 *
 * Why `null` is allowed: callers (atlasctl) use the same POST to set OR
 * clear an override; null clears. This keeps the URL space small.
 */
async function readLevelBody(c: AppCtx, correlationId: string): Promise<LogLevel | null | Response> {
    let body: LevelBody;
    try {
        body = (await c.req.json()) as LevelBody;
    }
    catch (e) {
        return errorResponse(c, 'BAD_REQUEST', `invalid JSON body: ${errorMessage(e)}`, 400, correlationId);
    }
    if (body.level === null)
        return null;
    if (!isLogLevel(body.level)) {
        return errorResponse(c, 'BAD_REQUEST', 'level must be one of debug, info, warn, error, fatal, or null to clear', 400, correlationId);
    }
    return body.level;
}
export function adminLoggingRoutes(state: AppState): Hono<{
    Variables: ServerVariables;
}> {
    const app = new Hono<{
        Variables: ServerVariables;
    }>();
    // Snapshot all overrides + the resolved-default level.
    app.get('/api/v1/admin/logging/levels', function (c: AppCtx) {
        const correlationId = correlationIdFor(c);
        const denied = requireAdmin(c, correlationId);
        if (denied)
            return denied;
        return c.json(state.levelController.snapshot());
    });
    // Global override.
    app.post('/api/v1/admin/logging/levels/global', async function (c: AppCtx) {
        const correlationId = correlationIdFor(c);
        const denied = requireAdmin(c, correlationId);
        if (denied)
            return denied;
        const parsed = await readLevelBody(c, correlationId);
        if (parsed instanceof Response)
            return parsed;
        if (parsed === null) {
            // "Clear global" doesn't make sense — global has a non-null default.
            // Reject with a hint pointing operators at the right verb.
            return errorResponse(c, 'BAD_REQUEST', 'global level cannot be cleared; pass an explicit level', 400, correlationId);
        }
        state.levelController.setGlobal(parsed);
        c.get('ctx').logger.info('logging level changed (global)', {
            event: 'Admin.Logging.SetGlobal',
            properties: { level: parsed },
        });
        return c.json(state.levelController.snapshot());
    });
    // Module override (null clears).
    app.post('/api/v1/admin/logging/levels/module/:moduleId', async function (c: AppCtx) {
        const correlationId = correlationIdFor(c);
        const denied = requireAdmin(c, correlationId);
        if (denied)
            return denied;
        const moduleId = c.req.param('moduleId');
        if (moduleId === undefined || moduleId.length === 0) {
            return errorResponse(c, 'BAD_REQUEST', 'moduleId required', 400, correlationId);
        }
        const parsed = await readLevelBody(c, correlationId);
        if (parsed instanceof Response)
            return parsed;
        state.levelController.setModule(moduleId, parsed);
        c.get('ctx').logger.info('logging level changed (module)', {
            event: parsed === null ? 'Admin.Logging.ClearModule' : 'Admin.Logging.SetModule',
            properties: { moduleId, level: parsed },
        });
        return c.json(state.levelController.snapshot());
    });
    // Tenant override (null clears).
    app.post('/api/v1/admin/logging/levels/tenant/:tenantId', async function (c: AppCtx) {
        const correlationId = correlationIdFor(c);
        const denied = requireAdmin(c, correlationId);
        if (denied)
            return denied;
        const tenantId = c.req.param('tenantId');
        if (tenantId === undefined || tenantId.length === 0) {
            return errorResponse(c, 'BAD_REQUEST', 'tenantId required', 400, correlationId);
        }
        const parsed = await readLevelBody(c, correlationId);
        if (parsed instanceof Response)
            return parsed;
        state.levelController.setTenant(tenantId, parsed);
        c.get('ctx').logger.info('logging level changed (tenant)', {
            event: parsed === null ? 'Admin.Logging.ClearTenant' : 'Admin.Logging.SetTenant',
            properties: { tenantId, level: parsed },
        });
        return c.json(state.levelController.snapshot());
    });
    // Correlation override (null clears). Useful for "I want this one
    // failing flow at debug for the next minute" without flipping global.
    app.post('/api/v1/admin/logging/levels/correlation/:correlationId', async function (c: AppCtx) {
        const requestCorrelationId = correlationIdFor(c);
        const denied = requireAdmin(c, requestCorrelationId);
        if (denied)
            return denied;
        const target = c.req.param('correlationId');
        if (target === undefined || target.length === 0) {
            return errorResponse(c, 'BAD_REQUEST', 'correlationId required', 400, requestCorrelationId);
        }
        const parsed = await readLevelBody(c, requestCorrelationId);
        if (parsed instanceof Response)
            return parsed;
        state.levelController.setCorrelation(target, parsed);
        c.get('ctx').logger.info('logging level changed (correlation)', {
            event: parsed === null
                ? 'Admin.Logging.ClearCorrelation'
                : 'Admin.Logging.SetCorrelation',
            properties: { targetCorrelationId: target, level: parsed },
        });
        return c.json(state.levelController.snapshot());
    });
    // Inspect recent log events for a correlationId from the in-memory ring.
    // For incident-time triage; not authoritative — bounded ring buffer is
    // overwritten as new events arrive. atlasctl's `logging inspect <id>`
    // wraps this.
    app.get('/api/v1/admin/logging/correlation/:correlationId/recent', function (c: AppCtx) {
        const requestCorrelationId = correlationIdFor(c);
        const denied = requireAdmin(c, requestCorrelationId);
        if (denied)
            return denied;
        const target = c.req.param('correlationId');
        if (target === undefined || target.length === 0) {
            return errorResponse(c, 'BAD_REQUEST', 'correlationId required', 400, requestCorrelationId);
        }
        const limitRaw = c.req.query('limit');
        const limit = limitRaw
            ? Math.max(1, Math.min(parseInt(limitRaw, 10) || 200, 1000))
            : 200;
        const events = state.inspectionSink.getByCorrelationId(target, limit);
        return c.json({ correlationId: target, count: events.length, events });
    });
    return app;
}
