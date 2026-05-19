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
import { PostgresEntityStore, PostgresEventStore, PostgresRelationStore, } from '@atlas/adapter-node';
import { handleFactorRevoke, handleGenerateRecoveryCodes, handleMfaBypassIssue, handleMfaChallengeSubmit, handleRedeemRecoveryCode, handleRegenerateRecoveryCodes, handleTotpChallenge, handleTotpEnroll, handleWebAuthnAssertBegin, handleWebAuthnAssertFinish, handleWebAuthnRegisterBegin, handleWebAuthnRegisterFinish, identityDispatcher, IdentityError, type MfaChallengeMethod, type MfaChallengeSubmitCommand, type WebAuthnAssertFinishCommand, type WebAuthnRegisterFinishCommand, } from '@atlas/identity';
import type { AppState } from '../bootstrap.ts';
import { ensureTenantMigrated } from '../bootstrap.ts';
import { errorResponse } from '../middleware/errors.ts';
import { correlationIdFor } from '../middleware/correlation.ts';
import type { ServerVariables } from '../middleware/principal.ts';
type AppCtx = Context<{
    Variables: ServerVariables;
}>;
function s(v: unknown): string | null {
    return typeof v === 'string' && v.length > 0 ? v : null;
}
/**
 * Type guard: narrows `unknown` to a plain JSON object (not array, not
 * null). Indexing returns `unknown` because JSON values are unknown by
 * nature — each leaf field still needs its own narrow before use.
 */
function isJsonObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
/**
 * Parse the request body as a JSON object. Returns `{}` on parse failure
 * or when the body is non-object (array, primitive, null). Routes then
 * pull individual fields with `s(body['key'])` and validate per-field.
 *
 * The runtime guard collapses the `c.req.json()` `unknown` boundary into
 * a typed `Record<string, unknown>` via a type-predicate guard — no
 * type-system escape-hatch cast required.
 */
async function readBodyObject(c: AppCtx): Promise<Record<string, unknown>> {
    const raw: unknown = await c.req.json().catch(function () {
        return ({});
    });
    return isJsonObject(raw) ? raw : {};
}
function asMfaMethod(v: unknown): MfaChallengeMethod | null {
    // The switch narrows the string literal type, so no cast is required.
    if (typeof v !== 'string')
        return null;
    switch (v) {
        case 'totp':
        case 'webauthn':
        case 'recovery_code':
        case 'bypass':
            return v;
        default:
            return null;
    }
}
/**
 * The WebAuthn assertion / registration response is a complex JSON shape
 * produced by `navigator.credentials.{create,get}()`. Validating its
 * full structure here would duplicate the schema check that
 * `@simplewebauthn/server` performs inside `verifyRegistrationResponse`
 * / `verifyAuthenticationResponse`. The narrow we DO enforce: the field
 * must be a non-null object so we don't hand the verifier a primitive
 * or null and trigger a less-helpful crash. The library is the schema
 * authority for the field's interior.
 */
function readWebAuthnResponseJson(v: unknown): Record<string, unknown> | null {
    return isJsonObject(v) ? v : null;
}
/** Inner-shape parsers for the unified MFA challenge submit body. */
function readTotpField(v: unknown): {
    factorId: string;
    presentedCode: string;
} | null {
    if (!isJsonObject(v))
        return null;
    const factorId = s(v['factorId']);
    const presentedCode = s(v['presentedCode']);
    if (!factorId || !presentedCode)
        return null;
    return { factorId, presentedCode };
}
function readWebAuthnChallengeField(v: unknown): {
    challengeId: string;
    response: Record<string, unknown>;
} | null {
    if (!isJsonObject(v))
        return null;
    const challengeId = s(v['challengeId']);
    const response = readWebAuthnResponseJson(v['response']);
    if (!challengeId || !response)
        return null;
    return { challengeId, response };
}
function readRecoveryCodeField(v: unknown): {
    presentedCode: string;
} | null {
    if (!isJsonObject(v))
        return null;
    const presentedCode = s(v['presentedCode']);
    if (!presentedCode)
        return null;
    return { presentedCode };
}
function readBypassField(v: unknown): {
    presentedSecret: string;
} | null {
    if (!isJsonObject(v))
        return null;
    const presentedSecret = s(v['presentedSecret']);
    if (!presentedSecret)
        return null;
    return { presentedSecret };
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
export function mfaRoutes(state: AppState): Hono<{
    Variables: ServerVariables;
}> {
    const app = new Hono<{
        Variables: ServerVariables;
    }>();
    const rpId = state.config.oidc.issuerUrl
        ? new URL(state.config.oidc.issuerUrl).hostname
        : 'localhost';
    const expectedOrigin = state.config.oidc.issuerUrl ?? 'http://localhost:3000';
    // ----- TOTP --------------------------------------------------------
    app.post('/api/v1/identity/mfa/totp/enroll', async function (c: AppCtx) {
        const cid = correlationIdFor(c);
        const principal = c.get('principal');
        if (!principal?.userId) {
            return errorResponse(c, 'PRINCIPAL_INVALID', 'auth required', 401, cid);
        }
        const body = await readBodyObject(c);
        const name = s(body['name']) ?? 'Authenticator app';
        const accountLabel = s(body['accountLabel']) ?? principal.userId;
        const ad = await adaptersFor(state, principal.tenantId);
        try {
            const r = await handleTotpEnroll({
                tenantId: principal.tenantId,
                correlationId: cid,
                principalId: principal.principalId,
                userId: principal.userId,
                issuer: 'Atlas',
                accountLabel,
                name,
            }, ad.eventStore, state.secrets);
            await identityDispatcher({ entities: ad.entities, relations: ad.relations })(r.envelope);
            return c.json({
                factorId: r.document.factorId,
                otpauthUri: r.otpauthUri,
                base32Secret: r.plaintextBase32,
            }, 201);
        }
        catch (e) {
            if (e instanceof IdentityError)
                return errorResponse(c, e.code, e.message, e.status, cid);
            throw e;
        }
    });
    app.post('/api/v1/identity/mfa/totp/challenge', async function (c: AppCtx) {
        const cid = correlationIdFor(c);
        const principal = c.get('principal');
        if (!principal?.userId) {
            return errorResponse(c, 'PRINCIPAL_INVALID', 'auth required', 401, cid);
        }
        const body = await readBodyObject(c);
        const factorId = s(body['factorId']);
        const presentedCode = s(body['presentedCode']);
        if (!factorId || !presentedCode) {
            return errorResponse(c, 'SCHEMA_VALIDATION_FAILED', 'factorId + presentedCode required', 400, cid);
        }
        const ad = await adaptersFor(state, principal.tenantId);
        try {
            const r = await handleTotpChallenge({
                tenantId: principal.tenantId,
                correlationId: cid,
                principalId: principal.principalId,
                factorId,
                presentedCode,
            }, ad.eventStore, ad.entities, state.secrets);
            await identityDispatcher({ entities: ad.entities, relations: ad.relations })(r.envelope);
            return c.json({ ok: true });
        }
        catch (e) {
            if (e instanceof IdentityError)
                return errorResponse(c, e.code, e.message, e.status, cid);
            throw e;
        }
    });
    // ----- WebAuthn (2FA + passkey share these endpoints, gated by `kind`) ---
    app.post('/api/v1/identity/mfa/webauthn/register-begin', async function (c: AppCtx) {
        const cid = correlationIdFor(c);
        const principal = c.get('principal');
        if (!principal?.userId) {
            return errorResponse(c, 'PRINCIPAL_INVALID', 'auth required', 401, cid);
        }
        const body = await readBodyObject(c);
        const factorKind = body['factorKind'] === 'passkey' ? 'passkey' : 'webauthn_mfa';
        const ad = await adaptersFor(state, principal.tenantId);
        const r = await handleWebAuthnRegisterBegin({
            tenantId: principal.tenantId,
            correlationId: cid,
            userId: principal.userId,
            userName: (typeof principal.attributes?.['email'] === 'string'
                ? principal.attributes['email']
                : undefined) ?? principal.userId,
            rpId,
            factorKind,
        }, ad.entities);
        return c.json({ challengeId: r.challengeId, options: r.options }, 200);
    });
    app.post('/api/v1/identity/mfa/webauthn/register-finish', async function (c: AppCtx) {
        const cid = correlationIdFor(c);
        const principal = c.get('principal');
        if (!principal?.userId) {
            return errorResponse(c, 'PRINCIPAL_INVALID', 'auth required', 401, cid);
        }
        const body = await readBodyObject(c);
        const challengeId = s(body['challengeId']);
        const factorKind = body['factorKind'] === 'passkey' ? 'passkey' : 'webauthn_mfa';
        const factorName = s(body['factorName']) ?? 'WebAuthn factor';
        const response = readWebAuthnResponseJson(body['response']);
        if (!challengeId || !response) {
            return errorResponse(c, 'SCHEMA_VALIDATION_FAILED', 'challengeId + response required', 400, cid);
        }
        const ad = await adaptersFor(state, principal.tenantId);
        try {
            const r = await handleWebAuthnRegisterFinish({
                tenantId: principal.tenantId,
                correlationId: cid,
                principalId: principal.principalId,
                userId: principal.userId,
                challengeId,
                // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, atlas-widgets/no-double-cast -- boundary: browser-supplied RegistrationResponseJSON; @simplewebauthn/server validates the interior shape inside verifyRegistrationResponse. The object-shape narrow is in readWebAuthnResponseJson.
                response: response as unknown as WebAuthnRegisterFinishCommand['response'],
                expectedOrigin,
                rpId,
                factorKind,
                factorName,
            }, ad.eventStore, ad.entities);
            await identityDispatcher({ entities: ad.entities, relations: ad.relations })(r.envelope);
            return c.json({ factorId: r.document.factorId }, 201);
        }
        catch (e) {
            if (e instanceof IdentityError)
                return errorResponse(c, e.code, e.message, e.status, cid);
            throw e;
        }
    });
    app.post('/api/v1/identity/mfa/webauthn/assert-begin', async function (c: AppCtx) {
        const cid = correlationIdFor(c);
        const principal = c.get('principal');
        if (!principal) {
            return errorResponse(c, 'PRINCIPAL_INVALID', 'auth required', 401, cid);
        }
        const body = await readBodyObject(c);
        const factorKind = body['factorKind'] === 'passkey' ? 'passkey' : 'webauthn_mfa';
        const ad = await adaptersFor(state, principal.tenantId);
        const r = await handleWebAuthnAssertBegin({
            tenantId: principal.tenantId,
            correlationId: cid,
            ...(principal.userId ? { userId: principal.userId } : {}),
            rpId,
            factorKind,
        }, ad.entities);
        return c.json({ challengeId: r.challengeId, options: r.options }, 200);
    });
    app.post('/api/v1/identity/mfa/webauthn/assert-finish', async function (c: AppCtx) {
        const cid = correlationIdFor(c);
        const principal = c.get('principal');
        if (!principal) {
            return errorResponse(c, 'PRINCIPAL_INVALID', 'auth required', 401, cid);
        }
        const body = await readBodyObject(c);
        const challengeId = s(body['challengeId']);
        const factorKind = body['factorKind'] === 'passkey' ? 'passkey' : 'webauthn_mfa';
        const response = readWebAuthnResponseJson(body['response']);
        if (!challengeId || !response) {
            return errorResponse(c, 'SCHEMA_VALIDATION_FAILED', 'challengeId + response required', 400, cid);
        }
        const ad = await adaptersFor(state, principal.tenantId);
        try {
            const r = await handleWebAuthnAssertFinish({
                tenantId: principal.tenantId,
                correlationId: cid,
                principalId: principal.principalId,
                challengeId,
                // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, atlas-widgets/no-double-cast -- boundary: browser-supplied AuthenticationResponseJSON; @simplewebauthn/server validates the interior shape inside verifyAuthenticationResponse. The object-shape narrow is in readWebAuthnResponseJson.
                response: response as unknown as WebAuthnAssertFinishCommand['response'],
                expectedOrigin,
                rpId,
                factorKind,
            }, ad.eventStore, ad.entities);
            await identityDispatcher({ entities: ad.entities, relations: ad.relations })(r.envelope);
            return c.json({ ok: true, userId: r.userId });
        }
        catch (e) {
            if (e instanceof IdentityError)
                return errorResponse(c, e.code, e.message, e.status, cid);
            throw e;
        }
    });
    // ----- Recovery codes ---------------------------------------------
    app.post('/api/v1/identity/mfa/recovery/generate', async function (c: AppCtx) {
        const cid = correlationIdFor(c);
        const principal = c.get('principal');
        if (!principal?.userId) {
            return errorResponse(c, 'PRINCIPAL_INVALID', 'auth required', 401, cid);
        }
        const ad = await adaptersFor(state, principal.tenantId);
        try {
            const r = await handleGenerateRecoveryCodes({
                tenantId: principal.tenantId,
                correlationId: cid,
                principalId: principal.principalId,
                userId: principal.userId,
            }, ad.eventStore, ad.entities);
            await identityDispatcher({ entities: ad.entities, relations: ad.relations })(r.envelope);
            return c.json({ codes: r.plaintextCodes }, 201);
        }
        catch (e) {
            if (e instanceof IdentityError)
                return errorResponse(c, e.code, e.message, e.status, cid);
            throw e;
        }
    });
    app.post('/api/v1/identity/mfa/recovery/regenerate', async function (c: AppCtx) {
        const cid = correlationIdFor(c);
        const principal = c.get('principal');
        if (!principal?.userId) {
            return errorResponse(c, 'PRINCIPAL_INVALID', 'auth required', 401, cid);
        }
        const ad = await adaptersFor(state, principal.tenantId);
        const r = await handleRegenerateRecoveryCodes({
            tenantId: principal.tenantId,
            correlationId: cid,
            principalId: principal.principalId,
            userId: principal.userId,
        }, ad.eventStore, ad.entities);
        await identityDispatcher({ entities: ad.entities, relations: ad.relations })(r.envelope);
        return c.json({ codes: r.plaintextCodes });
    });
    app.post('/api/v1/identity/mfa/recovery/redeem', async function (c: AppCtx) {
        const cid = correlationIdFor(c);
        const principal = c.get('principal');
        if (!principal?.userId) {
            return errorResponse(c, 'PRINCIPAL_INVALID', 'auth required', 401, cid);
        }
        const body = await readBodyObject(c);
        const presentedCode = s(body['presentedCode']);
        if (!presentedCode) {
            return errorResponse(c, 'SCHEMA_VALIDATION_FAILED', 'presentedCode required', 400, cid);
        }
        const ad = await adaptersFor(state, principal.tenantId);
        try {
            const r = await handleRedeemRecoveryCode({
                tenantId: principal.tenantId,
                correlationId: cid,
                principalId: principal.principalId,
                userId: principal.userId,
                presentedCode,
            }, ad.eventStore, ad.entities);
            await identityDispatcher({ entities: ad.entities, relations: ad.relations })(r.envelope);
            return c.json({ remaining: r.remaining });
        }
        catch (e) {
            if (e instanceof IdentityError)
                return errorResponse(c, e.code, e.message, e.status, cid);
            throw e;
        }
    });
    // ----- Factor revoke ---------------------------------------------
    app.delete('/api/v1/identity/mfa/factors/:factorId', async function (c: AppCtx) {
        const cid = correlationIdFor(c);
        const principal = c.get('principal');
        if (!principal?.userId) {
            return errorResponse(c, 'PRINCIPAL_INVALID', 'auth required', 401, cid);
        }
        const factorId = c.req.param('factorId') ?? '';
        const ad = await adaptersFor(state, principal.tenantId);
        try {
            const r = await handleFactorRevoke({
                tenantId: principal.tenantId,
                correlationId: cid,
                principalId: principal.principalId,
                factorId,
            }, ad.eventStore, ad.entities);
            await identityDispatcher({ entities: ad.entities, relations: ad.relations })(r.envelope);
            return c.body(null, 204);
        }
        catch (e) {
            if (e instanceof IdentityError)
                return errorResponse(c, e.code, e.message, e.status, cid);
            throw e;
        }
    });
    // ----- MFA bypass -------------------------------------------------
    app.post('/api/v1/identity/mfa/bypass/issue', async function (c: AppCtx) {
        const cid = correlationIdFor(c);
        const principal = c.get('principal');
        if (!principal?.userId) {
            return errorResponse(c, 'PRINCIPAL_INVALID', 'auth required', 401, cid);
        }
        const body = await readBodyObject(c);
        const targetUserId = s(body['userId']);
        if (!targetUserId) {
            return errorResponse(c, 'SCHEMA_VALIDATION_FAILED', 'userId required', 400, cid);
        }
        const ad = await adaptersFor(state, principal.tenantId);
        try {
            const r = await handleMfaBypassIssue({
                tenantId: principal.tenantId,
                correlationId: cid,
                principalId: principal.principalId,
                userId: targetUserId,
            }, ad.eventStore);
            await identityDispatcher({ entities: ad.entities, relations: ad.relations })(r.envelope);
            return c.json({
                bypassId: r.document.bypassId,
                plaintextSecret: r.plaintextSecret,
                expiresAt: r.document.expiresAt,
            }, 201);
        }
        catch (e) {
            if (e instanceof IdentityError)
                return errorResponse(c, e.code, e.message, e.status, cid);
            throw e;
        }
    });
    // ----- Unified challenge submit ----------------------------------
    app.post('/api/v1/identity/mfa/challenge/submit', async function (c: AppCtx) {
        const cid = correlationIdFor(c);
        const principal = c.get('principal');
        if (!principal) {
            return errorResponse(c, 'PRINCIPAL_INVALID', 'auth required', 401, cid);
        }
        const body = await readBodyObject(c);
        const sessionId = s(body['sessionId']);
        const method = asMfaMethod(body['method']);
        if (!sessionId || !method) {
            return errorResponse(c, 'SCHEMA_VALIDATION_FAILED', 'sessionId + method required', 400, cid);
        }
        // Per-method inner-field validation. Each inner shape is narrowed at
        // the boundary so the handler receives a typed command, not a raw
        // request body. `expectedOrigin` / `rpId` for the WebAuthn path are
        // injected from the server's own config — the client cannot supply
        // them, which closes the "client-controlled origin defeats origin
        // verification" path.
        const totp = method === 'totp' ? readTotpField(body['totp']) : null;
        const webauthnInner = method === 'webauthn' ? readWebAuthnChallengeField(body['webauthn']) : null;
        const recoveryCode = method === 'recovery_code' ? readRecoveryCodeField(body['recoveryCode']) : null;
        const bypass = method === 'bypass' ? readBypassField(body['bypass']) : null;
        if ((method === 'totp' && !totp) ||
            (method === 'webauthn' && !webauthnInner) ||
            (method === 'recovery_code' && !recoveryCode) ||
            (method === 'bypass' && !bypass)) {
            return errorResponse(c, 'SCHEMA_VALIDATION_FAILED', `method=${method} requires its inner payload`, 400, cid);
        }
        type WebAuthnSubmitField = NonNullable<MfaChallengeSubmitCommand['webauthn']>;
        const webauthn: WebAuthnSubmitField | null = webauthnInner
            ? {
                challengeId: webauthnInner.challengeId,
                // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, atlas-widgets/no-double-cast -- boundary: browser-supplied AuthenticationResponseJSON; @simplewebauthn/server validates the interior shape during verifyAuthenticationResponse. The object-shape narrow is in readWebAuthnResponseJson.
                response: webauthnInner.response as unknown as WebAuthnSubmitField['response'],
                expectedOrigin,
                rpId,
            }
            : null;
        const ad = await adaptersFor(state, principal.tenantId);
        try {
            const r = await handleMfaChallengeSubmit({
                tenantId: principal.tenantId,
                correlationId: cid,
                principalId: principal.principalId,
                sessionId,
                method,
                ...(totp !== null ? { totp } : {}),
                ...(webauthn !== null ? { webauthn } : {}),
                ...(recoveryCode !== null ? { recoveryCode } : {}),
                ...(bypass !== null ? { bypass } : {}),
            }, ad.eventStore, ad.entities, state.secrets);
            const dispatch = identityDispatcher({ entities: ad.entities, relations: ad.relations });
            for (const f of r.follow)
                await dispatch(f);
            await dispatch(r.envelope);
            return c.json({ status: r.document.status });
        }
        catch (e) {
            if (e instanceof IdentityError)
                return errorResponse(c, e.code, e.message, e.status, cid);
            throw e;
        }
    });
    return app;
}
