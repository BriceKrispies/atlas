/**
 * MFA HTTP routes (Phase A5.10).
 *
 * All routes require an authenticated principal. WebAuthn ceremonies
 * are split into begin + finish (the browser does the round-trip
 * with the authenticator between the two calls).
 *
 * The challenge-submit route exposes the unified MFA challenge flow
 * (`Identity.MfaChallenge.Submit`) — accepts any of the four factor
 * proofs (TOTP / WebAuthn / recovery code / bypass) and promotes a
 * `mfa_pending` session.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  PostgresEntityStore,
  PostgresEventStore,
  PostgresRelationStore,
} from '@atlas/adapter-node';
import {
  handleFactorRevoke,
  handleGenerateRecoveryCodes,
  handleMfaBypassIssue,
  handleMfaChallengeSubmit,
  handleRedeemRecoveryCode,
  handleRegenerateRecoveryCodes,
  handleTotpChallenge,
  handleTotpEnroll,
  handleWebAuthnAssertBegin,
  handleWebAuthnAssertFinish,
  handleWebAuthnRegisterBegin,
  handleWebAuthnRegisterFinish,
  identityDispatcher,
  IdentityError,
  type MfaChallengeMethod,
} from '@atlas/identity';
import type { AppState } from '../bootstrap.ts';
import { ensureTenantMigrated } from '../bootstrap.ts';
import { errorResponse } from '../middleware/errors.ts';
import { correlationIdFor } from '../middleware/correlation.ts';
import type { ServerVariables } from '../middleware/principal.ts';

type AppCtx = Context<{ Variables: ServerVariables }>;

function s(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

async function adaptersFor(state: AppState, tenantId: string): Promise<{
  eventStore: PostgresEventStore;
  entities: PostgresEntityStore;
  relations: PostgresRelationStore;
}> {
  const sql = await ensureTenantMigrated(state, tenantId);
  return {
    eventStore: new PostgresEventStore(sql),
    entities: new PostgresEntityStore(sql),
    relations: new PostgresRelationStore(sql),
  };
}

export function mfaRoutes(state: AppState): Hono<{ Variables: ServerVariables }> {
  const app = new Hono<{ Variables: ServerVariables }>();

  const rpId = state.config.oidc.issuerUrl
    ? new URL(state.config.oidc.issuerUrl).hostname
    : 'localhost';
  const expectedOrigin = state.config.oidc.issuerUrl ?? 'http://localhost:3000';

  // ----- TOTP --------------------------------------------------------

  app.post('/api/v1/identity/mfa/totp/enroll', async (c: AppCtx) => {
    const cid = correlationIdFor(c);
    const principal = c.get('principal');
    if (!principal?.userId) {
      return errorResponse(c, 'PRINCIPAL_INVALID', 'auth required', 401, cid);
    }
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const name = s(body['name']) ?? 'Authenticator app';
    const accountLabel = s(body['accountLabel']) ?? principal.userId;
    const ad = await adaptersFor(state, principal.tenantId);
    try {
      const r = await handleTotpEnroll(
        {
          tenantId: principal.tenantId,
          correlationId: cid,
          principalId: principal.principalId,
          userId: principal.userId,
          issuer: 'Atlas',
          accountLabel,
          name,
        },
        ad.eventStore,
      );
      await identityDispatcher({ entities: ad.entities, relations: ad.relations })(r.envelope);
      return c.json(
        {
          factorId: r.document.factorId,
          otpauthUri: r.otpauthUri,
          base32Secret: r.plaintextBase32,
        },
        201,
      );
    } catch (e) {
      if (e instanceof IdentityError) return errorResponse(c, e.code, e.message, e.status, cid);
      throw e;
    }
  });

  app.post('/api/v1/identity/mfa/totp/challenge', async (c: AppCtx) => {
    const cid = correlationIdFor(c);
    const principal = c.get('principal');
    if (!principal?.userId) {
      return errorResponse(c, 'PRINCIPAL_INVALID', 'auth required', 401, cid);
    }
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const factorId = s(body['factorId']);
    const presentedCode = s(body['presentedCode']);
    if (!factorId || !presentedCode) {
      return errorResponse(c, 'SCHEMA_VALIDATION_FAILED', 'factorId + presentedCode required', 400, cid);
    }
    const ad = await adaptersFor(state, principal.tenantId);
    try {
      const r = await handleTotpChallenge(
        {
          tenantId: principal.tenantId,
          correlationId: cid,
          principalId: principal.principalId,
          factorId,
          presentedCode,
        },
        ad.eventStore,
        ad.entities,
      );
      await identityDispatcher({ entities: ad.entities, relations: ad.relations })(r.envelope);
      return c.json({ ok: true });
    } catch (e) {
      if (e instanceof IdentityError) return errorResponse(c, e.code, e.message, e.status, cid);
      throw e;
    }
  });

  // ----- WebAuthn (2FA + passkey share these endpoints, gated by `kind`) ---

  app.post('/api/v1/identity/mfa/webauthn/register-begin', async (c: AppCtx) => {
    const cid = correlationIdFor(c);
    const principal = c.get('principal');
    if (!principal?.userId) {
      return errorResponse(c, 'PRINCIPAL_INVALID', 'auth required', 401, cid);
    }
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const factorKind = body['factorKind'] === 'passkey' ? 'passkey' : 'webauthn_mfa';
    const ad = await adaptersFor(state, principal.tenantId);
    const r = await handleWebAuthnRegisterBegin(
      {
        tenantId: principal.tenantId,
        correlationId: cid,
        userId: principal.userId,
        userName:
          (typeof principal.attributes?.['email'] === 'string'
            ? (principal.attributes['email'] as string)
            : undefined) ?? principal.userId,
        rpId,
        factorKind,
      },
      ad.entities,
    );
    return c.json({ challengeId: r.challengeId, options: r.options }, 200);
  });

  app.post('/api/v1/identity/mfa/webauthn/register-finish', async (c: AppCtx) => {
    const cid = correlationIdFor(c);
    const principal = c.get('principal');
    if (!principal?.userId) {
      return errorResponse(c, 'PRINCIPAL_INVALID', 'auth required', 401, cid);
    }
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const challengeId = s(body['challengeId']);
    const factorKind = body['factorKind'] === 'passkey' ? 'passkey' : 'webauthn_mfa';
    const factorName = s(body['factorName']) ?? 'WebAuthn factor';
    const response = body['response'];
    if (!challengeId || !response) {
      return errorResponse(c, 'SCHEMA_VALIDATION_FAILED', 'challengeId + response required', 400, cid);
    }
    const ad = await adaptersFor(state, principal.tenantId);
    try {
      const r = await handleWebAuthnRegisterFinish(
        {
          tenantId: principal.tenantId,
          correlationId: cid,
          principalId: principal.principalId,
          userId: principal.userId,
          challengeId,
          response: response as never,
          expectedOrigin,
          rpId,
          factorKind,
          factorName,
        },
        ad.eventStore,
        ad.entities,
      );
      await identityDispatcher({ entities: ad.entities, relations: ad.relations })(r.envelope);
      return c.json({ factorId: r.document.factorId }, 201);
    } catch (e) {
      if (e instanceof IdentityError) return errorResponse(c, e.code, e.message, e.status, cid);
      throw e;
    }
  });

  app.post('/api/v1/identity/mfa/webauthn/assert-begin', async (c: AppCtx) => {
    const cid = correlationIdFor(c);
    const principal = c.get('principal');
    if (!principal) {
      return errorResponse(c, 'PRINCIPAL_INVALID', 'auth required', 401, cid);
    }
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const factorKind = body['factorKind'] === 'passkey' ? 'passkey' : 'webauthn_mfa';
    const ad = await adaptersFor(state, principal.tenantId);
    const r = await handleWebAuthnAssertBegin(
      {
        tenantId: principal.tenantId,
        correlationId: cid,
        ...(principal.userId ? { userId: principal.userId } : {}),
        rpId,
        factorKind,
      },
      ad.entities,
    );
    return c.json({ challengeId: r.challengeId, options: r.options }, 200);
  });

  app.post('/api/v1/identity/mfa/webauthn/assert-finish', async (c: AppCtx) => {
    const cid = correlationIdFor(c);
    const principal = c.get('principal');
    if (!principal) {
      return errorResponse(c, 'PRINCIPAL_INVALID', 'auth required', 401, cid);
    }
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const challengeId = s(body['challengeId']);
    const factorKind = body['factorKind'] === 'passkey' ? 'passkey' : 'webauthn_mfa';
    const response = body['response'];
    if (!challengeId || !response) {
      return errorResponse(c, 'SCHEMA_VALIDATION_FAILED', 'challengeId + response required', 400, cid);
    }
    const ad = await adaptersFor(state, principal.tenantId);
    try {
      const r = await handleWebAuthnAssertFinish(
        {
          tenantId: principal.tenantId,
          correlationId: cid,
          principalId: principal.principalId,
          challengeId,
          response: response as never,
          expectedOrigin,
          rpId,
          factorKind,
        },
        ad.eventStore,
        ad.entities,
      );
      await identityDispatcher({ entities: ad.entities, relations: ad.relations })(r.envelope);
      return c.json({ ok: true, userId: r.userId });
    } catch (e) {
      if (e instanceof IdentityError) return errorResponse(c, e.code, e.message, e.status, cid);
      throw e;
    }
  });

  // ----- Recovery codes ---------------------------------------------

  app.post('/api/v1/identity/mfa/recovery/generate', async (c: AppCtx) => {
    const cid = correlationIdFor(c);
    const principal = c.get('principal');
    if (!principal?.userId) {
      return errorResponse(c, 'PRINCIPAL_INVALID', 'auth required', 401, cid);
    }
    const ad = await adaptersFor(state, principal.tenantId);
    try {
      const r = await handleGenerateRecoveryCodes(
        {
          tenantId: principal.tenantId,
          correlationId: cid,
          principalId: principal.principalId,
          userId: principal.userId,
        },
        ad.eventStore,
        ad.entities,
      );
      await identityDispatcher({ entities: ad.entities, relations: ad.relations })(r.envelope);
      return c.json({ codes: r.plaintextCodes }, 201);
    } catch (e) {
      if (e instanceof IdentityError) return errorResponse(c, e.code, e.message, e.status, cid);
      throw e;
    }
  });

  app.post('/api/v1/identity/mfa/recovery/regenerate', async (c: AppCtx) => {
    const cid = correlationIdFor(c);
    const principal = c.get('principal');
    if (!principal?.userId) {
      return errorResponse(c, 'PRINCIPAL_INVALID', 'auth required', 401, cid);
    }
    const ad = await adaptersFor(state, principal.tenantId);
    const r = await handleRegenerateRecoveryCodes(
      {
        tenantId: principal.tenantId,
        correlationId: cid,
        principalId: principal.principalId,
        userId: principal.userId,
      },
      ad.eventStore,
      ad.entities,
    );
    await identityDispatcher({ entities: ad.entities, relations: ad.relations })(r.envelope);
    return c.json({ codes: r.plaintextCodes });
  });

  app.post('/api/v1/identity/mfa/recovery/redeem', async (c: AppCtx) => {
    const cid = correlationIdFor(c);
    const principal = c.get('principal');
    if (!principal?.userId) {
      return errorResponse(c, 'PRINCIPAL_INVALID', 'auth required', 401, cid);
    }
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const presentedCode = s(body['presentedCode']);
    if (!presentedCode) {
      return errorResponse(c, 'SCHEMA_VALIDATION_FAILED', 'presentedCode required', 400, cid);
    }
    const ad = await adaptersFor(state, principal.tenantId);
    try {
      const r = await handleRedeemRecoveryCode(
        {
          tenantId: principal.tenantId,
          correlationId: cid,
          principalId: principal.principalId,
          userId: principal.userId,
          presentedCode,
        },
        ad.eventStore,
        ad.entities,
      );
      await identityDispatcher({ entities: ad.entities, relations: ad.relations })(r.envelope);
      return c.json({ remaining: r.remaining });
    } catch (e) {
      if (e instanceof IdentityError) return errorResponse(c, e.code, e.message, e.status, cid);
      throw e;
    }
  });

  // ----- Factor revoke ---------------------------------------------

  app.delete('/api/v1/identity/mfa/factors/:factorId', async (c: AppCtx) => {
    const cid = correlationIdFor(c);
    const principal = c.get('principal');
    if (!principal?.userId) {
      return errorResponse(c, 'PRINCIPAL_INVALID', 'auth required', 401, cid);
    }
    const factorId = c.req.param('factorId') ?? '';
    const ad = await adaptersFor(state, principal.tenantId);
    try {
      const r = await handleFactorRevoke(
        {
          tenantId: principal.tenantId,
          correlationId: cid,
          principalId: principal.principalId,
          factorId,
        },
        ad.eventStore,
        ad.entities,
      );
      await identityDispatcher({ entities: ad.entities, relations: ad.relations })(r.envelope);
      return c.body(null, 204);
    } catch (e) {
      if (e instanceof IdentityError) return errorResponse(c, e.code, e.message, e.status, cid);
      throw e;
    }
  });

  // ----- MFA bypass -------------------------------------------------

  app.post('/api/v1/identity/mfa/bypass/issue', async (c: AppCtx) => {
    const cid = correlationIdFor(c);
    const principal = c.get('principal');
    if (!principal?.userId) {
      return errorResponse(c, 'PRINCIPAL_INVALID', 'auth required', 401, cid);
    }
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const targetUserId = s(body['userId']);
    if (!targetUserId) {
      return errorResponse(c, 'SCHEMA_VALIDATION_FAILED', 'userId required', 400, cid);
    }
    const ad = await adaptersFor(state, principal.tenantId);
    try {
      const r = await handleMfaBypassIssue(
        {
          tenantId: principal.tenantId,
          correlationId: cid,
          principalId: principal.principalId,
          userId: targetUserId,
        },
        ad.eventStore,
      );
      await identityDispatcher({ entities: ad.entities, relations: ad.relations })(r.envelope);
      return c.json(
        {
          bypassId: r.document.bypassId,
          plaintextSecret: r.plaintextSecret,
          expiresAt: r.document.expiresAt,
        },
        201,
      );
    } catch (e) {
      if (e instanceof IdentityError) return errorResponse(c, e.code, e.message, e.status, cid);
      throw e;
    }
  });

  // ----- Unified challenge submit ----------------------------------

  app.post('/api/v1/identity/mfa/challenge/submit', async (c: AppCtx) => {
    const cid = correlationIdFor(c);
    const principal = c.get('principal');
    if (!principal) {
      return errorResponse(c, 'PRINCIPAL_INVALID', 'auth required', 401, cid);
    }
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const sessionId = s(body['sessionId']);
    const method = s(body['method']) as MfaChallengeMethod | null;
    if (!sessionId || !method) {
      return errorResponse(c, 'SCHEMA_VALIDATION_FAILED', 'sessionId + method required', 400, cid);
    }
    const ad = await adaptersFor(state, principal.tenantId);
    try {
      const r = await handleMfaChallengeSubmit(
        {
          tenantId: principal.tenantId,
          correlationId: cid,
          principalId: principal.principalId,
          sessionId,
          method,
          ...(body['totp'] !== undefined ? { totp: body['totp'] as never } : {}),
          ...(body['webauthn'] !== undefined
            ? { webauthn: body['webauthn'] as never }
            : {}),
          ...(body['recoveryCode'] !== undefined
            ? { recoveryCode: body['recoveryCode'] as never }
            : {}),
          ...(body['bypass'] !== undefined ? { bypass: body['bypass'] as never } : {}),
        },
        ad.eventStore,
        ad.entities,
      );
      const dispatch = identityDispatcher({ entities: ad.entities, relations: ad.relations });
      for (const f of r.follow) await dispatch(f);
      await dispatch(r.envelope);
      return c.json({ status: r.document.status });
    } catch (e) {
      if (e instanceof IdentityError) return errorResponse(c, e.code, e.message, e.status, cid);
      throw e;
    }
  });

  return app;
}
