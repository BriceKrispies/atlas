/**
 * Phase A7 admin routes — impersonation + break-glass.
 *
 * Mounted in the AUTHED group. Two role checks gate every route:
 *
 *   - PLATFORM_SUPPORT routes (impersonation start, break-glass issue,
 *     break-glass approve/deny): caller must hold `PlatformSupport` on a
 *     Membership in THEIR home tenant. Direct REST shortcut over the
 *     intent pipeline; the role check runs INLINE before any side effect
 *     (Invariant I2) — see `middleware/role-check.ts`.
 *
 *   - TENANT_ADMIN routes (impersonation revoke, break-glass revoke):
 *     caller must hold `TenantAdmin` in the target tenant.
 *
 * Pen-test surface considered:
 *
 *   - Forging an impersonation token via the start route → unable; token
 *     is mint-only, server-generated, returned ONCE.
 *   - Cross-tenant escalation → blocked by `assertTenantAdmin` checking
 *     `principal.tenantId === targetTenantId`.
 *   - Self-approval on break-glass → handler enforces; returns 403
 *     `BREAK_GLASS_SELF_APPROVAL_FORBIDDEN`.
 *   - Token enumeration via timing → resolution is constant-time hash
 *     compare in the handler (see `crypto/secret-hash.ts`).
 *   - Double-execution / replay → idempotency keys deterministic from
 *     entity id; the event store rejects duplicates.
 *   - Information leak in errors → identity codes are NOT collapsed to
 *     opaque codes for these routes (operators need to debug); but
 *     plaintext tokens NEVER appear in error messages.
 *
 * Not implemented in this slice:
 *   - Rate limiting on Start / Issue (would gate brute-force on token
 *     forgery + reduce blast radius of compromised operator accounts).
 *   - Step-up MFA gate before high-stakes actions (Phase A7.7).
 *   - Maximum-grantable-roles check vs issuer authority (route-side
 *     refusal of grants exceeding the issuer's policy ceiling).
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  PostgresEntityStore,
  PostgresEventStore,
  PostgresRelationStore,
} from '@atlas/adapter-node';
import {
  handleBreakGlassApprove,
  handleBreakGlassDeny,
  handleBreakGlassIssue,
  handleBreakGlassRevoke,
  handleImpersonationEnd,
  handleImpersonationStart,
  identityDispatcher,
  IdentityError,
  listActiveImpersonationsForTenant,
  listGrantsForTenant,
} from '@atlas/identity';
import type { AppState } from '../bootstrap.ts';
import { ensureTenantMigrated } from '../bootstrap.ts';
import { errorResponse } from '../middleware/errors.ts';
import { correlationIdFor } from '../middleware/correlation.ts';
import {
  assertPlatformOperator,
  assertTenantAdmin,
} from '../middleware/role-check.ts';
import type { ServerVariables } from '../middleware/principal.ts';

type AppCtx = Context<{ Variables: ServerVariables }>;

// ----------------------------------------------------------------------
// Validation helpers (deliberately stricter than identity-idp.ts to
// match the higher pen-test bar on this surface).
// ----------------------------------------------------------------------

const REASON_MAX_LEN = 500;
const JUSTIFICATION_MAX_LEN = 2000;
const URL_MAX_LEN = 2000;
const ROLE_NAME_MAX_LEN = 64;
const TENANT_ID_MAX_LEN = 64;

function readNonEmptyString(v: unknown, maxLen: number): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (trimmed.length === 0 || trimmed.length > maxLen) return null;
  return trimmed;
}

function readUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  if (v.length > URL_MAX_LEN) return null;
  try {
    const url = new URL(v);
    // Reject anything that isn't http/https. Closes file://, javascript:,
    // data:, etc. injection paths in audit URLs.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return v;
  } catch {
    return null;
  }
}

function readRoleArray(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > 32) return null;
  const out: string[] = [];
  for (const r of v) {
    if (typeof r !== 'string') return null;
    const trimmed = r.trim();
    if (trimmed.length === 0 || trimmed.length > ROLE_NAME_MAX_LEN) return null;
    // Role names are alphanumeric + underscore + dash only — closes a
    // privilege-escalation path via injection of policy-relevant
    // metacharacters into role strings.
    if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) return null;
    out.push(trimmed);
  }
  return out;
}

function readOptionalStringArray(v: unknown): string[] | null | 'invalid' {
  if (v === undefined) return null;
  if (!Array.isArray(v) || v.length > 32) return 'invalid';
  const out: string[] = [];
  for (const s of v) {
    if (typeof s !== 'string' || s.length === 0 || s.length > ROLE_NAME_MAX_LEN) {
      return 'invalid';
    }
    if (!/^[A-Za-z0-9_-]+$/.test(s)) return 'invalid';
    out.push(s);
  }
  return out;
}

function readPositiveInt(v: unknown, max: number): number | null {
  if (typeof v !== 'number') return null;
  if (!Number.isInteger(v) || v <= 0 || v > max) return null;
  return v;
}

function readTenantId(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  if (v.length === 0 || v.length > TENANT_ID_MAX_LEN) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(v)) return null;
  return v;
}

// ----------------------------------------------------------------------
// Identity error → HTTP response. Inline mapping (not the global
// `errors.ts` middleware) so we control which codes leak which detail.
// ----------------------------------------------------------------------
function handleIdentityError(
  c: AppCtx,
  e: unknown,
  correlationId: string,
): Response {
  if (e instanceof IdentityError) {
    return errorResponse(c, e.code, e.message, e.status, correlationId);
  }
  // Generic 500 — never leak raw error message (could contain DB row
  // ids, stack frames, etc).
  return errorResponse(
    c,
    'INTERNAL_ERROR',
    'internal error',
    500,
    correlationId,
  );
}

// ----------------------------------------------------------------------

export function identityA7Routes(
  state: AppState,
): Hono<{ Variables: ServerVariables }> {
  const app = new Hono<{ Variables: ServerVariables }>();

  // ====================================================================
  // Impersonation
  // ====================================================================

  /**
   * `POST /api/v1/identity/impersonation/start`
   *
   * Operator opens an impersonation session against a target tenant.
   * Requires the caller to hold `PlatformSupport` on a Membership in
   * their home tenant. Token is returned ONCE in the response — store
   * it client-side, never log it.
   */
  app.post('/api/v1/identity/impersonation/start', async (c: AppCtx) => {
    const correlationId = correlationIdFor(c);
    const principal = c.get('principal');
    if (!principal) {
      return errorResponse(c, 'PRINCIPAL_INVALID', 'auth required', 401, correlationId);
    }
    // ROLE CHECK BEFORE BODY PARSE — closes a side-channel where a
    // non-operator could probe whether a target tenant exists by
    // observing different validation errors.
    const denial = await assertPlatformOperator(c, state, principal);
    if (denial) return denial;

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const tenantId = readTenantId(body['tenantId']);
    const targetUserId = readNonEmptyString(body['targetUserId'], 200);
    const reason = readNonEmptyString(body['reason'], REASON_MAX_LEN);
    const ticketUrl = readUrl(body['ticketUrl']);
    const maxDurationMin = readPositiveInt(body['maxDurationMin'], 8 * 60);
    const readonlyResourceTypesRaw = readOptionalStringArray(body['readonlyResourceTypes']);

    if (!tenantId) {
      return errorResponse(c, 'SCHEMA_VALIDATION_FAILED', 'tenantId required', 400, correlationId);
    }
    if (!targetUserId) {
      return errorResponse(c, 'SCHEMA_VALIDATION_FAILED', 'targetUserId required', 400, correlationId);
    }
    if (!reason) {
      return errorResponse(c, 'IMPERSONATION_REASON_REQUIRED', 'reason required', 400, correlationId);
    }
    if (!ticketUrl) {
      return errorResponse(c, 'IMPERSONATION_TICKET_REQUIRED', 'ticketUrl required (http or https)', 400, correlationId);
    }
    // Distinguish "absent" from "present but invalid". Silent downgrade
    // would let an attacker probe the validation surface without
    // observable rejection.
    if (body['maxDurationMin'] !== undefined && maxDurationMin === null) {
      return errorResponse(c, 'IMPERSONATION_DURATION_INVALID', 'maxDurationMin out of range (1..480)', 400, correlationId);
    }
    if (readonlyResourceTypesRaw === 'invalid') {
      return errorResponse(c, 'SCHEMA_VALIDATION_FAILED', 'readonlyResourceTypes must be string[]', 400, correlationId);
    }

    try {
      const sql = await ensureTenantMigrated(state, tenantId);
      const eventStore = new PostgresEventStore(sql);
      const entities = new PostgresEntityStore(sql);
      const relations = new PostgresRelationStore(sql);
      const result = await handleImpersonationStart(
        {
          tenantId,
          correlationId,
          operatorId: principal.principalId,
          targetUserId,
          reason,
          ticketUrl,
          ...(maxDurationMin !== null ? { maxDurationMin } : {}),
          ...(readonlyResourceTypesRaw
            ? { readonlyResourceTypes: readonlyResourceTypesRaw }
            : {}),
        },
        eventStore,
        entities,
      );
      await identityDispatcher({ entities, relations })(result.envelope);
      // Return token ONCE — client must persist server-side or in
      // operator UI memory. Never echoed back from any other endpoint.
      return c.json(
        {
          impersonationId: result.document.impersonationId,
          status: result.document.status,
          expiresAt: result.document.expiresAt,
          bearerToken: result.bearerToken,
        },
        201,
      );
    } catch (e) {
      return handleIdentityError(c, e, correlationId);
    }
  });

  /**
   * `POST /api/v1/identity/impersonation/end`
   *
   * Operator self-ends a session. Authorisation: caller must be the
   * SAME operator who opened it (we don't allow operator A to close
   * operator B's session — only tenant admins can revoke other
   * operators).
   */
  app.post('/api/v1/identity/impersonation/end', async (c: AppCtx) => {
    const correlationId = correlationIdFor(c);
    const principal = c.get('principal');
    if (!principal) {
      return errorResponse(c, 'PRINCIPAL_INVALID', 'auth required', 401, correlationId);
    }
    const denial = await assertPlatformOperator(c, state, principal);
    if (denial) return denial;

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const tenantId = readTenantId(body['tenantId']);
    const impersonationId = readNonEmptyString(body['impersonationId'], 200);
    if (!tenantId || !impersonationId) {
      return errorResponse(c, 'SCHEMA_VALIDATION_FAILED', 'tenantId + impersonationId required', 400, correlationId);
    }

    try {
      const sql = await ensureTenantMigrated(state, tenantId);
      const eventStore = new PostgresEventStore(sql);
      const entities = new PostgresEntityStore(sql);
      const relations = new PostgresRelationStore(sql);
      const result = await handleImpersonationEnd(
        {
          tenantId,
          correlationId,
          impersonationId,
          principalId: principal.principalId,
          reason: 'operator_ended',
        },
        eventStore,
        entities,
      );
      await identityDispatcher({ entities, relations })(result.envelope);
      return c.json({
        impersonationId: result.document.impersonationId,
        status: result.document.status,
        endedAt: result.document.endedAt,
      });
    } catch (e) {
      return handleIdentityError(c, e, correlationId);
    }
  });

  /**
   * `POST /api/v1/identity/impersonation/revoke`
   *
   * Tenant admin revokes an active impersonation session against their
   * tenant. Different from `end` — caller is a TenantAdmin in the
   * target tenant, NOT the operator.
   */
  app.post('/api/v1/identity/impersonation/revoke', async (c: AppCtx) => {
    const correlationId = correlationIdFor(c);
    const principal = c.get('principal');
    if (!principal) {
      return errorResponse(c, 'PRINCIPAL_INVALID', 'auth required', 401, correlationId);
    }
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const tenantId = readTenantId(body['tenantId']);
    const impersonationId = readNonEmptyString(body['impersonationId'], 200);
    if (!tenantId || !impersonationId) {
      return errorResponse(c, 'SCHEMA_VALIDATION_FAILED', 'tenantId + impersonationId required', 400, correlationId);
    }
    const denial = await assertTenantAdmin(c, state, principal, tenantId);
    if (denial) return denial;

    try {
      const sql = await ensureTenantMigrated(state, tenantId);
      const eventStore = new PostgresEventStore(sql);
      const entities = new PostgresEntityStore(sql);
      const relations = new PostgresRelationStore(sql);
      const result = await handleImpersonationEnd(
        {
          tenantId,
          correlationId,
          impersonationId,
          principalId: principal.principalId,
          reason: 'tenant_revoked',
        },
        eventStore,
        entities,
      );
      await identityDispatcher({ entities, relations })(result.envelope);
      return c.json({
        impersonationId: result.document.impersonationId,
        status: result.document.status,
        revokedBy: result.document.revokedBy,
      });
    } catch (e) {
      return handleIdentityError(c, e, correlationId);
    }
  });

  /**
   * `GET /api/v1/identity/impersonation`
   *
   * Lists active impersonation sessions for the requesting tenant.
   * Either platform operator or tenant admin may read; this lets
   * customer admins audit who's impersonating in their tenant in real
   * time.
   *
   * Returns sessions WITHOUT the token hash field (defense-in-depth
   * even though hashes aren't useful to an attacker without the
   * pre-image).
   */
  app.get('/api/v1/identity/impersonation', async (c: AppCtx) => {
    const correlationId = correlationIdFor(c);
    const principal = c.get('principal');
    if (!principal) {
      return errorResponse(c, 'PRINCIPAL_INVALID', 'auth required', 401, correlationId);
    }
    const tenantId = readTenantId(c.req.query('tenantId') ?? principal.tenantId);
    if (!tenantId) {
      return errorResponse(c, 'SCHEMA_VALIDATION_FAILED', 'tenantId required', 400, correlationId);
    }
    const isPlatform = (await assertPlatformOperator(c, state, principal)) === null;
    const isAdmin = isPlatform || (await assertTenantAdmin(c, state, principal, tenantId)) === null;
    if (!isPlatform && !isAdmin) {
      return errorResponse(c, 'PRINCIPAL_INVALID', 'tenant admin or platform operator required', 403, correlationId);
    }
    try {
      const sql = await ensureTenantMigrated(state, tenantId);
      const entities = new PostgresEntityStore(sql);
      const sessions = await listActiveImpersonationsForTenant(entities, tenantId);
      return c.json({
        impersonations: sessions.map((s) => ({
          impersonationId: s.impersonationId,
          tenantId: s.tenantId,
          operatorId: s.operatorId,
          targetUserId: s.targetUserId,
          reason: s.reason,
          ticketUrl: s.ticketUrl,
          maxDurationMin: s.maxDurationMin,
          status: s.status,
          issuedAt: s.issuedAt,
          expiresAt: s.expiresAt,
          ...(s.readonlyResourceTypes
            ? { readonlyResourceTypes: s.readonlyResourceTypes }
            : {}),
        })),
      });
    } catch (e) {
      return handleIdentityError(c, e, correlationId);
    }
  });

  // ====================================================================
  // Break-glass
  // ====================================================================

  /**
   * `POST /api/v1/identity/break-glass/issue`
   *
   * Operator opens a pending break-glass grant. By default
   * `requireApproval=true` (4-eyes); a tenant policy can opt out for
   * specific operators but the route-layer default is safe-side.
   */
  app.post('/api/v1/identity/break-glass/issue', async (c: AppCtx) => {
    const correlationId = correlationIdFor(c);
    const principal = c.get('principal');
    if (!principal) {
      return errorResponse(c, 'PRINCIPAL_INVALID', 'auth required', 401, correlationId);
    }
    const denial = await assertPlatformOperator(c, state, principal);
    if (denial) return denial;

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const tenantId = readTenantId(body['tenantId']);
    const grantedTo = readNonEmptyString(body['grantedTo'], 200) ?? principal.principalId;
    const grantedRoles = readRoleArray(body['grantedRoles']);
    const justification = readNonEmptyString(body['justification'], JUSTIFICATION_MAX_LEN);
    const incidentUrl = readUrl(body['incidentUrl']);
    const maxDurationMin = readPositiveInt(body['maxDurationMin'], 12 * 60);
    const resourceTypeAllowListRaw = readOptionalStringArray(body['resourceTypeAllowList']);

    if (!tenantId) {
      return errorResponse(c, 'SCHEMA_VALIDATION_FAILED', 'tenantId required', 400, correlationId);
    }
    if (!grantedRoles) {
      return errorResponse(c, 'SCHEMA_VALIDATION_FAILED', 'grantedRoles required (1-32 alphanumeric strings)', 400, correlationId);
    }
    if (!justification) {
      return errorResponse(c, 'BREAK_GLASS_JUSTIFICATION_REQUIRED', 'justification required', 400, correlationId);
    }
    if (!incidentUrl) {
      return errorResponse(c, 'BREAK_GLASS_INCIDENT_REQUIRED', 'incidentUrl required (http or https)', 400, correlationId);
    }
    if (body['maxDurationMin'] !== undefined && maxDurationMin === null) {
      return errorResponse(c, 'BREAK_GLASS_DURATION_INVALID', 'maxDurationMin out of range (1..720)', 400, correlationId);
    }
    if (resourceTypeAllowListRaw === 'invalid') {
      return errorResponse(c, 'SCHEMA_VALIDATION_FAILED', 'resourceTypeAllowList must be string[]', 400, correlationId);
    }
    // SECURITY: forbid granting roles that would let the recipient issue
    // FURTHER break-glass grants. Closes the chain-grant escalation path.
    const FORBIDDEN_GRANT_ROLES = new Set(['PlatformOwner', 'PlatformRoot']);
    for (const r of grantedRoles) {
      if (FORBIDDEN_GRANT_ROLES.has(r)) {
        return errorResponse(c, 'BREAK_GLASS_GRANT_EXCEEDS_AUTHORITY', `cannot grant ${r} via break-glass`, 403, correlationId);
      }
    }

    try {
      const sql = await ensureTenantMigrated(state, tenantId);
      const eventStore = new PostgresEventStore(sql);
      const entities = new PostgresEntityStore(sql);
      const relations = new PostgresRelationStore(sql);
      const requireApproval =
        typeof body['requireApproval'] === 'boolean'
          ? (body['requireApproval'] as boolean)
          : true;
      const result = await handleBreakGlassIssue(
        {
          tenantId,
          correlationId,
          issuedBy: principal.principalId,
          grantedTo,
          grantedRoles,
          justification,
          incidentUrl,
          ...(maxDurationMin !== null ? { maxDurationMin } : {}),
          requireApproval,
          ...(resourceTypeAllowListRaw
            ? { resourceTypeAllowList: resourceTypeAllowListRaw }
            : {}),
        },
        eventStore,
        entities,
      );
      await identityDispatcher({ entities, relations })(result.envelope);
      return c.json(
        {
          grantId: result.document.grantId,
          status: result.document.status,
          requireApproval: result.document.requireApproval,
          expiresAt: result.document.expiresAt,
        },
        201,
      );
    } catch (e) {
      return handleIdentityError(c, e, correlationId);
    }
  });

  /**
   * `POST /api/v1/identity/break-glass/approve`
   *
   * Second operator approves a pending grant. Self-approval forbidden
   * (handler enforces).
   */
  app.post('/api/v1/identity/break-glass/approve', async (c: AppCtx) => {
    const correlationId = correlationIdFor(c);
    const principal = c.get('principal');
    if (!principal) {
      return errorResponse(c, 'PRINCIPAL_INVALID', 'auth required', 401, correlationId);
    }
    const denial = await assertPlatformOperator(c, state, principal);
    if (denial) return denial;

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const tenantId = readTenantId(body['tenantId']);
    const grantId = readNonEmptyString(body['grantId'], 200);
    if (!tenantId || !grantId) {
      return errorResponse(c, 'SCHEMA_VALIDATION_FAILED', 'tenantId + grantId required', 400, correlationId);
    }

    try {
      const sql = await ensureTenantMigrated(state, tenantId);
      const eventStore = new PostgresEventStore(sql);
      const entities = new PostgresEntityStore(sql);
      const relations = new PostgresRelationStore(sql);
      const result = await handleBreakGlassApprove(
        {
          tenantId,
          correlationId,
          grantId,
          approvedBy: principal.principalId,
        },
        eventStore,
        entities,
      );
      await identityDispatcher({ entities, relations })(result.envelope);
      return c.json({
        grantId: result.document.grantId,
        status: result.document.status,
        approvedBy: result.document.approvedBy,
        expiresAt: result.document.expiresAt,
      });
    } catch (e) {
      return handleIdentityError(c, e, correlationId);
    }
  });

  /**
   * `POST /api/v1/identity/break-glass/deny`
   */
  app.post('/api/v1/identity/break-glass/deny', async (c: AppCtx) => {
    const correlationId = correlationIdFor(c);
    const principal = c.get('principal');
    if (!principal) {
      return errorResponse(c, 'PRINCIPAL_INVALID', 'auth required', 401, correlationId);
    }
    const denial = await assertPlatformOperator(c, state, principal);
    if (denial) return denial;

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const tenantId = readTenantId(body['tenantId']);
    const grantId = readNonEmptyString(body['grantId'], 200);
    const reason = readNonEmptyString(body['reason'], REASON_MAX_LEN);
    if (!tenantId || !grantId) {
      return errorResponse(c, 'SCHEMA_VALIDATION_FAILED', 'tenantId + grantId required', 400, correlationId);
    }

    try {
      const sql = await ensureTenantMigrated(state, tenantId);
      const eventStore = new PostgresEventStore(sql);
      const entities = new PostgresEntityStore(sql);
      const relations = new PostgresRelationStore(sql);
      const result = await handleBreakGlassDeny(
        {
          tenantId,
          correlationId,
          grantId,
          deniedBy: principal.principalId,
          ...(reason !== null ? { reason } : {}),
        },
        eventStore,
        entities,
      );
      await identityDispatcher({ entities, relations })(result.envelope);
      return c.json({
        grantId: result.document.grantId,
        status: result.document.status,
      });
    } catch (e) {
      return handleIdentityError(c, e, correlationId);
    }
  });

  /**
   * `POST /api/v1/identity/break-glass/revoke`
   *
   * Tenant admin revokes an active grant against their tenant.
   */
  app.post('/api/v1/identity/break-glass/revoke', async (c: AppCtx) => {
    const correlationId = correlationIdFor(c);
    const principal = c.get('principal');
    if (!principal) {
      return errorResponse(c, 'PRINCIPAL_INVALID', 'auth required', 401, correlationId);
    }
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const tenantId = readTenantId(body['tenantId']);
    const grantId = readNonEmptyString(body['grantId'], 200);
    if (!tenantId || !grantId) {
      return errorResponse(c, 'SCHEMA_VALIDATION_FAILED', 'tenantId + grantId required', 400, correlationId);
    }
    const denial = await assertTenantAdmin(c, state, principal, tenantId);
    if (denial) return denial;

    try {
      const sql = await ensureTenantMigrated(state, tenantId);
      const eventStore = new PostgresEventStore(sql);
      const entities = new PostgresEntityStore(sql);
      const relations = new PostgresRelationStore(sql);
      const result = await handleBreakGlassRevoke(
        {
          tenantId,
          correlationId,
          grantId,
          revokedBy: principal.principalId,
          reason: 'tenant_revoked',
        },
        eventStore,
        entities,
      );
      await identityDispatcher({ entities, relations })(result.envelope);
      return c.json({
        grantId: result.document.grantId,
        status: result.document.status,
        revokedBy: result.document.revokedBy,
      });
    } catch (e) {
      return handleIdentityError(c, e, correlationId);
    }
  });

  /**
   * `GET /api/v1/identity/break-glass`
   *
   * Lists grants for the target tenant (any status). Either platform
   * operator or tenant admin may read.
   */
  app.get('/api/v1/identity/break-glass', async (c: AppCtx) => {
    const correlationId = correlationIdFor(c);
    const principal = c.get('principal');
    if (!principal) {
      return errorResponse(c, 'PRINCIPAL_INVALID', 'auth required', 401, correlationId);
    }
    const tenantId = readTenantId(c.req.query('tenantId') ?? principal.tenantId);
    if (!tenantId) {
      return errorResponse(c, 'SCHEMA_VALIDATION_FAILED', 'tenantId required', 400, correlationId);
    }
    const isPlatform = (await assertPlatformOperator(c, state, principal)) === null;
    const isAdmin = isPlatform || (await assertTenantAdmin(c, state, principal, tenantId)) === null;
    if (!isPlatform && !isAdmin) {
      return errorResponse(c, 'PRINCIPAL_INVALID', 'tenant admin or platform operator required', 403, correlationId);
    }
    try {
      const sql = await ensureTenantMigrated(state, tenantId);
      const entities = new PostgresEntityStore(sql);
      const grants = await listGrantsForTenant(entities, tenantId);
      return c.json({
        grants: grants.map((g) => ({
          grantId: g.grantId,
          tenantId: g.tenantId,
          issuedBy: g.issuedBy,
          grantedTo: g.grantedTo,
          grantedRoles: g.grantedRoles,
          justification: g.justification,
          incidentUrl: g.incidentUrl,
          maxDurationMin: g.maxDurationMin,
          status: g.status,
          issuedAt: g.issuedAt,
          expiresAt: g.expiresAt,
          ...(g.approvedAt ? { approvedAt: g.approvedAt } : {}),
          ...(g.approvedBy ? { approvedBy: g.approvedBy } : {}),
          ...(g.endedAt ? { endedAt: g.endedAt } : {}),
          ...(g.endReason ? { endReason: g.endReason } : {}),
          ...(g.resourceTypeAllowList
            ? { resourceTypeAllowList: g.resourceTypeAllowList }
            : {}),
        })),
      });
    } catch (e) {
      return handleIdentityError(c, e, correlationId);
    }
  });

  return app;
}
