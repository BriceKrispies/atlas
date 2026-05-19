import type { EventEnvelope } from '@atlas/platform-core';
import type { EntityStore, EventStore } from '@atlas/ports';
import { generateAuthenticationOptions, verifyAuthenticationResponse, type AuthenticationResponseJSON, } from '@simplewebauthn/server';
import { IdentityError, codes } from '../errors.ts';
import type { AuthFactorDocument, WebAuthnFactorAttrs, } from '../types.ts';
/**
 * Type guard: `attrs` matches the WebAuthn variant of the discriminated
 * union. `kind === 'passkey' | 'webauthn_mfa'` discriminates `attrs` in
 * the stored shape but TS doesn't propagate that narrowing through the
 * `factor.kind` check, so this guard does the runtime probe.
 *
 * The probe checks `credentialId` (string) — the field that
 * distinguishes WebAuthn from TOTP attrs. A factor whose `kind` says
 * WebAuthn but whose `attrs` doesn't carry `credentialId` is a
 * persisted-shape invariant violation.
 */
function isWebAuthnAttrs(attrs: AuthFactorDocument['attrs']): attrs is WebAuthnFactorAttrs {
    return 'credentialId' in attrs && typeof attrs.credentialId === 'string';
}
function readWebAuthnAttrs(factor: AuthFactorDocument): WebAuthnFactorAttrs {
    if (!isWebAuthnAttrs(factor.attrs)) {
        throw new IdentityError(codes.WEBAUTHN_VERIFICATION_FAILED, `factor ${factor.factorId} (kind=${factor.kind}) is missing WebAuthn attrs`, 500);
    }
    return factor.attrs;
}
/** Narrow a caught `unknown` to its `Error.message`. */
function errorMessage(e: unknown): string {
    if (e instanceof Error)
        return e.message;
    return String(e);
}
import { newEventId } from '../ids.ts';
import { deleteWebAuthnChallenge, getWebAuthnChallenge, putWebAuthnChallenge, type WebAuthnChallengeDocument, } from '../entities/webauthn-challenge.ts';
import { findFactorByCredentialId, listActiveFactorsForUserByKind, putAuthFactorEntity, } from '../entities/auth-factor.ts';
const CHALLENGE_TTL_SECONDS = 5 * 60;
function newChallengeId(): string {
    return `wac-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
// =====================================================================
// Begin: generate challenge + return PublicKeyCredentialRequestOptions
// =====================================================================
export interface WebAuthnAssertBeginCommand {
    tenantId: string;
    correlationId: string;
    /**
     * For 2FA: required (we know who's logging in from the primary
     * factor). For passkey-as-primary: omit; the passkey IS the
     * identity, so the IDP discovers the user from the assertion's
     * `userHandle`.
     */
    userId?: string;
    rpId: string;
    /** 'passkey' (primary) or 'webauthn_mfa' (second factor). */
    factorKind: 'passkey' | 'webauthn_mfa';
}
export interface WebAuthnAssertBeginResult {
    challengeId: string;
    options: ReturnType<typeof generateAuthenticationOptions> extends Promise<infer T> ? T : never;
}
export async function handleWebAuthnAssertBegin(cmd: WebAuthnAssertBeginCommand, entities: EntityStore): Promise<WebAuthnAssertBeginResult> {
    // For 2FA: enumerate the user's enrolled factors so the browser
    // can offer them. For passkey: leave allowCredentials empty so the
    // browser uses any discoverable credential.
    let allow: {
        id: string;
    }[] = [];
    if (cmd.userId) {
        const factors = await listActiveFactorsForUserByKind(entities, cmd.tenantId, cmd.userId, cmd.factorKind);
        allow = factors
            .map(function (f) {
            if (!isWebAuthnAttrs(f.attrs))
                return null;
            return f.attrs.credentialId ? { id: f.attrs.credentialId } : null;
        })
            .filter(function (v): v is {
            id: string;
        } {
            return v !== null;
        });
    }
    const opts = await generateAuthenticationOptions({
        rpID: cmd.rpId,
        ...(allow.length > 0 ? { allowCredentials: allow } : {}),
        userVerification: cmd.factorKind === 'passkey' ? 'required' : 'preferred',
    });
    const challengeId = newChallengeId();
    const occurredAt = new Date().toISOString();
    const challengeDoc: WebAuthnChallengeDocument = {
        challengeId,
        tenantId: cmd.tenantId,
        // User is unknown for passkey-as-primary — fill with a sentinel
        // so the verify step can reject mismatches when the assertion's
        // userHandle resolves to a different user.
        userId: cmd.userId ?? '_passkey_discovery',
        challenge: opts.challenge,
        kind: 'authenticate',
        expiresAt: new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000).toISOString(),
        createdAt: occurredAt,
    };
    await putWebAuthnChallenge(entities, challengeDoc);
    return { challengeId, options: opts };
}
// =====================================================================
// Finish: verify assertion + advance signCount
// =====================================================================
export interface WebAuthnAssertFinishCommand {
    tenantId: string;
    correlationId: string;
    principalId: string | null;
    challengeId: string;
    response: AuthenticationResponseJSON;
    expectedOrigin: string;
    rpId: string;
    factorKind: 'passkey' | 'webauthn_mfa';
}
export interface WebAuthnAssertFinishResult {
    envelope: EventEnvelope;
    /** The AuthFactor that authorized the assertion (signCount-advanced). */
    document: AuthFactorDocument;
    /** Resolved userId — for passkey-primary, this is discovered from the credential. */
    userId: string;
}
export async function handleWebAuthnAssertFinish(cmd: WebAuthnAssertFinishCommand, eventStore: EventStore, entities: EntityStore): Promise<WebAuthnAssertFinishResult> {
    const challenge = await getWebAuthnChallenge(entities, cmd.tenantId, cmd.challengeId);
    if (!challenge) {
        throw new IdentityError(codes.WEBAUTHN_VERIFICATION_FAILED, 'challenge not found or expired', 400);
    }
    if (challenge.kind !== 'authenticate') {
        throw new IdentityError(codes.WEBAUTHN_VERIFICATION_FAILED, `challenge is for ${challenge.kind}, not authenticate`, 400);
    }
    if (new Date(challenge.expiresAt).getTime() <= Date.now()) {
        throw new IdentityError(codes.WEBAUTHN_VERIFICATION_FAILED, 'challenge expired', 400);
    }
    // Resolve credentialId → AuthFactor.
    const credentialId = cmd.response.id;
    const factor = await findFactorByCredentialId(entities, cmd.tenantId, credentialId);
    if (!factor) {
        throw new IdentityError(codes.PASSKEY_NOT_REGISTERED, 'no factor matches the presented credential', 401);
    }
    if (factor.kind !== cmd.factorKind) {
        throw new IdentityError(codes.WEBAUTHN_VERIFICATION_FAILED, `factor kind mismatch: expected ${cmd.factorKind}, got ${factor.kind}`, 400);
    }
    if (factor.status !== 'active') {
        throw new IdentityError(codes.MFA_FACTOR_LOCKED, `factor ${factor.factorId} is in status ${factor.status}`, 401);
    }
    // For 2FA: the bound challenge userId must match the factor's userId.
    // For passkey-primary: the challenge.userId is the sentinel; we
    // accept whatever userId the credential resolves to.
    if (challenge.userId !== '_passkey_discovery' &&
        challenge.userId !== factor.userId) {
        throw new IdentityError(codes.WEBAUTHN_VERIFICATION_FAILED, 'credential does not belong to the challenged user', 403);
    }
    const wAttrs = readWebAuthnAttrs(factor);
    let verification;
    try {
        verification = await verifyAuthenticationResponse({
            response: cmd.response,
            expectedChallenge: challenge.challenge,
            expectedOrigin: cmd.expectedOrigin,
            expectedRPID: cmd.rpId,
            credential: {
                id: wAttrs.credentialId,
                publicKey: Buffer.from(wAttrs.publicKey, 'base64url'),
                counter: wAttrs.signCount,
            },
            requireUserVerification: cmd.factorKind === 'passkey',
        });
    }
    catch (e) {
        throw new IdentityError(codes.WEBAUTHN_VERIFICATION_FAILED, `assertion verification failed: ${errorMessage(e)}`, 401);
    }
    if (!verification.verified) {
        throw new IdentityError(codes.WEBAUTHN_VERIFICATION_FAILED, 'assertion not verified', 401);
    }
    // Single-use challenge.
    await deleteWebAuthnChallenge(entities, cmd.tenantId, cmd.challengeId);
    // signCount monotonicity — cloned-credential detection.
    const newSignCount = verification.authenticationInfo.newCounter;
    if (newSignCount !== 0 && newSignCount <= wAttrs.signCount) {
        // Note: many authenticators report 0 always (Apple TouchID does
        // this). 0 means "doesn't track", not "regression"; only reject
        // when both are non-zero AND newCounter <= stored.
        if (wAttrs.signCount > 0) {
            throw new IdentityError(codes.WEBAUTHN_SIGN_COUNT_REGRESSION, `signCount regression: stored ${wAttrs.signCount}, presented ${newSignCount}`, 401);
        }
    }
    const occurredAt = new Date().toISOString();
    const updatedAttrs: WebAuthnFactorAttrs = {
        ...wAttrs,
        signCount: newSignCount,
    };
    const updatedFactor: AuthFactorDocument = {
        ...factor,
        attrs: updatedAttrs,
        lastUsedAt: occurredAt,
    };
    // Persist the updated signCount inline. This is a write outside
    // the dispatcher path — it's a heartbeat-shaped update (replay
    // safety), not an audit lifecycle event. The audit
    // `MfaChallengeSucceeded` event below carries the same document
    // for observability.
    await putAuthFactorEntity(entities, updatedFactor);
    const envelope: EventEnvelope = {
        eventId: newEventId(),
        eventType: 'Identity.MfaChallengeSucceeded',
        schemaId: 'domain.identity.mfa.challenge_succeeded.v1',
        schemaVersion: 1,
        occurredAt,
        tenantId: cmd.tenantId,
        correlationId: cmd.correlationId,
        idempotencyKey: `identity.mfa.${cmd.factorKind}.success.${factor.factorId}.${occurredAt}`,
        causationId: null,
        principalId: cmd.principalId,
        userId: factor.userId,
        cacheInvalidationTags: [
            `Tenant:${cmd.tenantId}`,
            `User:${factor.userId}`,
            `AuthFactor:${factor.factorId}`,
        ],
        retentionTag: 'retention:1y',
        payload: { document: updatedFactor, method: cmd.factorKind },
    };
    const stored = await eventStore.append(envelope);
    envelope.eventId = stored.eventId;
    envelope.seq = stored.seq;
    return { envelope, document: updatedFactor, userId: factor.userId };
}
