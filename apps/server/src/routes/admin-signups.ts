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
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  handleSignupApprove,
  handleSignupDeny,
  TenancyError,
  tenantHostnameFor,
} from '@atlas/tenancy';
import type { SignupRequestStatus } from '@atlas/ports';
import type { AppState } from '../bootstrap.ts';
import { ensureTenantMigrated } from '../bootstrap.ts';
import { errorResponse, mapError } from '../middleware/errors.ts';
import { correlationIdFor } from '../middleware/correlation.ts';
import type { ServerVariables } from '../middleware/principal.ts';
import { issueInviteForTenant } from './signup.ts';

type AppCtx = Context<{ Variables: ServerVariables }>;

function readString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function requireAdmin(
  state: AppState,
  c: AppCtx,
  correlationId: string,
): Response | null {
  const principal = c.get('principal');
  if (!principal) {
    return errorResponse(
      c,
      'PRINCIPAL_INVALID',
      'authentication required',
      401,
      correlationId,
    );
  }
  // PR1 dev shortcut: in TEST_AUTH_ENABLED mode any authenticated
  // principal can drive the admin queue. Role-based RBAC + Cedar
  // policy gating land when these routes get folded into the
  // standard `submitIntent` pipeline. Production deployments must
  // run with `TEST_AUTH_ENABLED=false`.
  if (state.config.testAuth.enabled) return null;
  const roles = principal.roles ?? [];
  if (!roles.includes('admin')) {
    return errorResponse(
      c,
      'FORBIDDEN',
      'admin role required',
      403,
      correlationId,
    );
  }
  return null;
}

export function adminSignupRoutes(
  state: AppState,
): Hono<{ Variables: ServerVariables }> {
  const app = new Hono<{ Variables: ServerVariables }>();

  app.get('/api/v1/admin/signups', async (c: AppCtx) => {
    const correlationId = correlationIdFor(c);
    const denied = requireAdmin(state, c, correlationId);
    if (denied) return denied;
    const statusRaw = c.req.query('status');
    const status: SignupRequestStatus | undefined =
      statusRaw === 'pending' || statusRaw === 'approved' || statusRaw === 'denied'
        ? statusRaw
        : undefined;
    const limitRaw = c.req.query('limit');
    const limit = limitRaw ? Math.max(1, Math.min(parseInt(limitRaw, 10) || 50, 200)) : 50;
    const rows = await state.signupRequests.list(
      status !== undefined ? { status, limit } : { limit },
    );
    return c.json({ signups: rows });
  });

  app.post('/api/v1/admin/signups/:id/approve', async (c: AppCtx) => {
    const correlationId = correlationIdFor(c);
    const denied = requireAdmin(state, c, correlationId);
    if (denied) return denied;
    const principal = c.get('principal');
    const signupId = c.req.param('id');
    if (!signupId) {
      return errorResponse(
        c,
        'SCHEMA_VALIDATION_FAILED',
        'signupId required',
        400,
        correlationId,
      );
    }
    try {
      const result = await handleSignupApprove(
        {
          signupId,
          principalId: principal!.principalId,
          correlationId,
        },
        {
          signupRequests: state.signupRequests,
          tenants: state.tenants,
          customDomains: state.customDomains,
          mailer: state.mailer,
          apexDomain: state.config.tenantApex,
          ensureTenantProvisioned: async (tenantId: string): Promise<void> => {
            await ensureTenantMigrated(state, tenantId);
            // Drop any negative cache entry for the new hostname so
            // the next request to <slug>.localhost resolves the
            // tenant — `principalMiddleware`'s host cache started
            // with `null` for this hostname before we registered it.
            state.customDomainCache.invalidate(
              tenantHostnameFor(tenantId, state.config.tenantApex),
            );
          },
          issueInvite: (input) =>
            issueInviteForTenant(state, input),
          buildMagicLinkUrl: (input) => {
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
        },
      );
      return c.json(
        {
          signupId: result.signup.signupId,
          tenantId: result.tenant.tenantId,
          hostname: result.hostname,
          status: result.signup.status,
        },
        200,
      );
    } catch (e) {
      if (e instanceof TenancyError) {
        return errorResponse(c, e.code, e.message, e.status, correlationId);
      }
      return mapError(c, e, correlationId);
    }
  });

  app.post('/api/v1/admin/signups/:id/deny', async (c: AppCtx) => {
    const correlationId = correlationIdFor(c);
    const denied = requireAdmin(state, c, correlationId);
    if (denied) return denied;
    const principal = c.get('principal');
    const signupId = c.req.param('id');
    if (!signupId) {
      return errorResponse(
        c,
        'SCHEMA_VALIDATION_FAILED',
        'signupId required',
        400,
        correlationId,
      );
    }
    interface Body {
      reason?: unknown;
    }
    let body: Body = {};
    try {
      body = (await c.req.json()) as Body;
    } catch {
      // Allow empty body — default reason.
    }
    const reason = readString(body.reason) ?? 'denied by admin';
    try {
      const result = await handleSignupDeny(
        {
          signupId,
          reason,
          principalId: principal!.principalId,
          correlationId,
        },
        { signupRequests: state.signupRequests },
      );
      return c.json(
        {
          signupId: result.signup.signupId,
          status: result.signup.status,
          deniedReason: result.signup.deniedReason,
        },
        200,
      );
    } catch (e) {
      if (e instanceof TenancyError) {
        return errorResponse(c, e.code, e.message, e.status, correlationId);
      }
      return mapError(c, e, correlationId);
    }
  });

  return app;
}
