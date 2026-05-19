/**
 * Admin signup-queue routes (authed).
 *
 * Mounted in the authed group — `principalMiddleware` runs first so
 * `c.get('principal')` is set. Authorization for PR1 is a coarse
 * "must have `admin` role" check; the full I2 policy gate lands when
 * we wire `Tenancy.Signup.Approve` through `submitIntent`.
 *
 * Endpoints:
 *   GET  /api/v1/admin/signups            → list (filter ?status=pending)
 *   POST /api/v1/admin/signups/:id/approve
 *   POST /api/v1/admin/signups/:id/deny
 *
 * I2 posture: fail-closed. Even with `TEST_AUTH_ENABLED=true` the route
 * still requires `principal.roles` to include `admin`. The dev/test
 * workflow is to send `X-Debug-Principal: user:<id>:<tenantId>:admin`
 * so the principal carries the admin role; see
 * `apps/server/src/middleware/principal.ts` for the header format.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { PostgresEventStore } from '@atlas/adapter-node';
import { handleSignupApprove, handleSignupDeny, TenancyError, tenantHostnameFor, } from '@atlas/tenancy';
import type { SignupRequestStatus } from '@atlas/ports';
import type { AppState } from '../bootstrap.ts';
import { ensureTenantMigrated } from '../bootstrap.ts';
import { errorResponse, mapError } from '../middleware/errors.ts';
import { correlationIdFor } from '../middleware/correlation.ts';
import type { ServerVariables } from '../middleware/principal.ts';
import { issueInviteForTenant } from './signup.ts';
type AppCtx = Context<{
    Variables: ServerVariables;
}>;
function readString(v: unknown): string | null {
    return typeof v === 'string' && v.length > 0 ? v : null;
}
/** Type guard for plain JSON objects (not arrays, not null). */
function isJsonObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
/** Narrow a thrown value to a printable message. */
function errorMessage(err: unknown): string {
    if (err instanceof Error)
        return err.message;
    return String(err);
}
function requireAdmin(_state: AppState, c: AppCtx, correlationId: string): Response | null {
    // Fail-closed admin gate (Invariant I2). The earlier PR1 implementation
    // short-circuited to allow when `TEST_AUTH_ENABLED=true`, which meant
    // any authenticated principal — including JWTs minted by an unrelated
    // IdP or arbitrary `X-Debug-Principal` headers — could approve signups
    // and provision tenants. That's a real authorization hole on any
    // prod-shaped instance that happens to have test-auth still on.
    //
    // The new contract: principal must exist AND `principal.roles` must
    // include `admin`. In `TEST_AUTH_ENABLED=true` mode, dev/test flows
    // get an admin principal by sending
    //   X-Debug-Principal: user:<id>:<tenantId>:admin
    // (4-segment form, see `middleware/principal.ts`). In strict mode the
    // role is hydrated from the principal's `Membership` row.
    //
    // Full I2 policy gating (Cedar `Tenancy.Signup.Approve`) lands when
    // these routes are folded into the standard `submitIntent` pipeline.
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
export function adminSignupRoutes(state: AppState): Hono<{
    Variables: ServerVariables;
}> {
    const app = new Hono<{
        Variables: ServerVariables;
    }>();
    app.get('/api/v1/admin/signups', async function (c: AppCtx) {
        const correlationId = correlationIdFor(c);
        const denied = requireAdmin(state, c, correlationId);
        if (denied)
            return denied;
        const statusRaw = c.req.query('status');
        const status: SignupRequestStatus | undefined = statusRaw === 'pending' || statusRaw === 'approved' || statusRaw === 'denied'
            ? statusRaw
            : undefined;
        const limitRaw = c.req.query('limit');
        const limit = limitRaw ? Math.max(1, Math.min(parseInt(limitRaw, 10) || 50, 200)) : 50;
        const rows = await state.signupRequests.list(status !== undefined ? { status, limit } : { limit });
        return c.json({ signups: rows });
    });
    app.post('/api/v1/admin/signups/:id/approve', async function (c: AppCtx) {
        const correlationId = correlationIdFor(c);
        const denied = requireAdmin(state, c, correlationId);
        if (denied)
            return denied;
        // `requireAdmin` guarantees a principal — but TS can't track that
        // across the helper boundary. Re-read + explicit null guard avoids
        // a non-null assertion and keeps the type narrowed in this scope.
        const principal = c.get('principal');
        if (!principal) {
            return errorResponse(c, 'PRINCIPAL_INVALID', 'authentication required', 401, correlationId);
        }
        const signupId = c.req.param('id');
        if (!signupId) {
            return errorResponse(c, 'SCHEMA_VALIDATION_FAILED', 'signupId required', 400, correlationId);
        }
        try {
            const result = await handleSignupApprove({
                signupId,
                principalId: principal.principalId,
                correlationId,
            }, {
                signupRequests: state.signupRequests,
                tenants: state.tenants,
                customDomains: state.customDomains,
                mailer: state.mailer,
                apexDomain: state.config.tenantApex,
                ensureTenantProvisioned: async function (tenantId: string): Promise<void> {
                    await ensureTenantMigrated(state, tenantId);
                    // Drop any negative cache entry for the new hostname so
                    // the next request to <slug>.localhost resolves the
                    // tenant — `principalMiddleware`'s host cache started
                    // with `null` for this hostname before we registered it.
                    state.customDomainCache.invalidate(tenantHostnameFor(tenantId, state.config.tenantApex));
                },
                issueInvite: function (input) {
                    return issueInviteForTenant(state, input);
                },
                revokeOutstandingInvites: async function (_input) {
                    // TODO: identity module does not yet expose an
                    // `Identity.Invite.Revoke` handler. Until it does, this
                    // callback is a no-op and prior magic-link tokens remain
                    // valid until their TTL (~7 days). The choreography in
                    // `handleSignupApprove` already calls this hook before
                    // re-minting on retry, so wiring real revoke is a single
                    // adapter-store update once the handler lands. Tracked
                    // as follow-up debt against the I3 idempotency claim in
                    // specs/domains/tenancy/capabilities/public-signup/README.md.
                    void _input;
                },
                appendEvent: async function (envelope) {
                    // Per-tenant event store — built lazily because tenant SQL
                    // is only resolvable after `ensureTenantProvisioned`. Same
                    // pattern as `issueInviteForTenant`.
                    const sql = await ensureTenantMigrated(state, envelope.tenantId);
                    const eventStore = new PostgresEventStore(sql);
                    await eventStore.append(envelope);
                },
                buildMagicLinkUrl: function (input) {
                    // Magic link points back at the *parent* origin so the
                    // POST /signup/confirm response can set a Domain=.<apex>
                    // cookie that survives the 303 to <slug>.<apex>.
                    // The user lands on the confirm HTML page first, clicks
                    // "Sign in", we then 303 them to the tenant home.
                    const url = new URL(state.config.publicBaseUrl);
                    url.pathname = '/signup/confirm';
                    url.searchParams.set('token', input.presentedToken);
                    url.searchParams.set('tenantId', input.tenantId);
                    url.searchParams.set('email', input.acceptedEmail);
                    return url.toString();
                },
                logger: c.get('ctx').logger,
            });
            return c.json({
                signupId: result.signup.signupId,
                tenantId: result.tenant.tenantId,
                hostname: result.hostname,
                status: result.signup.status,
            }, 200);
        }
        catch (e) {
            if (e instanceof TenancyError) {
                return errorResponse(c, e.code, e.message, e.status, correlationId);
            }
            return mapError(c, e, correlationId);
        }
    });
    app.post('/api/v1/admin/signups/:id/deny', async function (c: AppCtx) {
        const correlationId = correlationIdFor(c);
        const denied = requireAdmin(state, c, correlationId);
        if (denied)
            return denied;
        // See approve route — `requireAdmin` already established this is set,
        // but the type system needs the explicit re-narrow.
        const principal = c.get('principal');
        if (!principal) {
            return errorResponse(c, 'PRINCIPAL_INVALID', 'authentication required', 401, correlationId);
        }
        const signupId = c.req.param('id');
        if (!signupId) {
            return errorResponse(c, 'SCHEMA_VALIDATION_FAILED', 'signupId required', 400, correlationId);
        }
        // Body is OPTIONAL on this route. On parse failure / non-object we
        // fall back to `{}` (default reason). The warn log preserves the
        // diagnostic the previous version emitted.
        let rawBody: unknown = {};
        try {
            rawBody = await c.req.json();
        }
        catch (e) {
            c.get('ctx').logger.warn('admin signup deny body parse failed; using default reason', {
                event: 'AdminSignup.Deny.BodyParseFailed',
                properties: {
                    principalId: principal.principalId,
                    tenantId: principal.tenantId,
                    signupId,
                    cause: errorMessage(e),
                },
            });
        }
        const body: Record<string, unknown> = isJsonObject(rawBody) ? rawBody : {};
        const reason = readString(body['reason']) ?? 'denied by admin';
        try {
            const result = await handleSignupDeny({
                signupId,
                reason,
                principalId: principal.principalId,
                correlationId,
            }, { signupRequests: state.signupRequests, logger: c.get('ctx').logger });
            return c.json({
                signupId: result.signup.signupId,
                status: result.signup.status,
                deniedReason: result.signup.deniedReason,
            }, 200);
        }
        catch (e) {
            if (e instanceof TenancyError) {
                return errorResponse(c, e.code, e.message, e.status, correlationId);
            }
            return mapError(c, e, correlationId);
        }
    });
    return app;
}
