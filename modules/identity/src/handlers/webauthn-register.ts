import type { EventEnvelope } from '@atlas/platform-core';
import type { EntityStore, EventStore } from '@atlas/ports';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  type RegistrationResponseJSON,
  type AuthenticatorTransportFuture,
} from '@simplewebauthn/server';
import { IdentityError, codes } from '../errors.ts';
import type {
  AuthFactorDocument,
  AuthFactorKind,
  IdentityPolicy,
  WebAuthnFactorAttrs,
} from '../types.ts';
import { DEFAULT_IDENTITY_POLICY } from '../types.ts';
import { newAuthFactorId, newEventId } from '../ids.ts';
import {
  deleteWebAuthnChallenge,
  getWebAuthnChallenge,
  putWebAuthnChallenge,
  type WebAuthnChallengeDocument,
} from '../entities/webauthn-challenge.ts';
import { listActiveFactorsForUserByKind } from '../entities/auth-factor.ts';

const CHALLENGE_TTL_SECONDS = 5 * 60;

function newChallengeId(): string {
  return `wac-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Runtime guard narrowing `AuthFactorDocument['attrs']` to the WebAuthn
 * sub-shape. The `attrs` union is not discriminated by the parent
 * `kind` field; structural inspection for `credentialId` is the
 * sanctioned narrow path.
 */
function isWebAuthnAttrs(
  a: AuthFactorDocument['attrs'],
): a is WebAuthnFactorAttrs {
  return 'credentialId' in a && typeof a.credentialId === 'string';
}

// =====================================================================
// Begin: generate challenge + return PublicKeyCredentialCreationOptions
// =====================================================================

export interface WebAuthnRegisterBeginCommand {
  tenantId: string;
  correlationId: string;
  userId: string;
  /** Display name for the user (RP-side `user.name`). Typically email. */
  userName: string;
  userDisplayName?: string;
  /**
   * RP id — the bare hostname, e.g. 'atlas.example'. The browser
   * binds credentials to this RP. Must match the `origin` the
   * authenticator sees during the ceremony.
   */
  rpId: string;
  rpName?: string;
  /**
   * Whether this is a passkey enrollment (primary auth) or a
   * second-factor enrollment. Different default residentKey behavior:
   * passkeys MUST be discoverable; 2FA factors are server-side
   * (non-discoverable).
   */
  factorKind: 'passkey' | 'webauthn_mfa';
  policy?: IdentityPolicy;
}

export interface WebAuthnRegisterBeginResult {
  /** Stash these in a WebAuthnChallenge entity for the finish step. */
  challengeId: string;
  /** The PublicKeyCredentialCreationOptions (passable to the browser). */
  options: ReturnType<typeof generateRegistrationOptions> extends Promise<infer T>
    ? T
    : never;
}

/**
 * `Identity.Mfa.Webauthn.Register.Begin` (or .Passkey.Register.Begin
 * for the primary-auth flow). Persists a WebAuthnChallenge entity
 * the finish step verifies against. No event emitted at begin —
 * only on the successful finish.
 */
export async function handleWebAuthnRegisterBegin(
  cmd: WebAuthnRegisterBeginCommand,
  entities: EntityStore,
): Promise<WebAuthnRegisterBeginResult> {
  // Existing factors of this kind become `excludeCredentials` so
  // the authenticator refuses to enroll the same key twice.
  const existing = await listActiveFactorsForUserByKind(
    entities,
    cmd.tenantId,
    cmd.userId,
    cmd.factorKind,
  );
  const exclude = existing
    .map((f) =>
      isWebAuthnAttrs(f.attrs) && f.attrs.credentialId
        ? { id: f.attrs.credentialId }
        : null,
    )
    .filter((v): v is { id: string } => v !== null);
  const policy = cmd.policy ?? DEFAULT_IDENTITY_POLICY;
  // For passkeys we require resident-key + UV (passkeys MUST satisfy
  // both factors on their own). For 2FA factors we only require UV
  // when the policy says so; resident-key is no.
  const isPasskey = cmd.factorKind === 'passkey';
  const opts = await generateRegistrationOptions({
    rpName: cmd.rpName ?? 'Atlas',
    rpID: cmd.rpId,
    userID: new TextEncoder().encode(cmd.userId),
    userName: cmd.userName,
    userDisplayName: cmd.userDisplayName ?? cmd.userName,
    attestationType: policy.webauthnAttestation.includes('none')
      ? 'none'
      : 'direct',
    excludeCredentials: exclude,
    authenticatorSelection: {
      residentKey: isPasskey ? 'required' : 'preferred',
      userVerification: isPasskey ? 'required' : 'preferred',
    },
  });
  const challengeId = newChallengeId();
  const occurredAt = new Date().toISOString();
  const challengeDoc: WebAuthnChallengeDocument = {
    challengeId,
    tenantId: cmd.tenantId,
    userId: cmd.userId,
    challenge: opts.challenge,
    kind: 'register',
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000).toISOString(),
    createdAt: occurredAt,
  };
  await putWebAuthnChallenge(entities, challengeDoc);
  return { challengeId, options: opts };
}

// =====================================================================
// Finish: verify attestation + persist AuthFactor
// =====================================================================

export interface WebAuthnRegisterFinishCommand {
  tenantId: string;
  correlationId: string;
  principalId: string | null;
  userId: string;
  challengeId: string;
  /** The WebAuthn attestation response from `navigator.credentials.create()`. */
  response: RegistrationResponseJSON;
  /** Expected origin (e.g. https://atlas.example). */
  expectedOrigin: string;
  rpId: string;
  factorKind: 'passkey' | 'webauthn_mfa';
  /** Operator-friendly factor label (e.g. "YubiKey 5C", "Pixel 8"). */
  factorName: string;
}

export interface WebAuthnRegisterFinishResult {
  envelope: EventEnvelope;
  document: AuthFactorDocument;
}

export async function handleWebAuthnRegisterFinish(
  cmd: WebAuthnRegisterFinishCommand,
  eventStore: EventStore,
  entities: EntityStore,
): Promise<WebAuthnRegisterFinishResult> {
  const challenge = await getWebAuthnChallenge(
    entities,
    cmd.tenantId,
    cmd.challengeId,
  );
  if (!challenge) {
    throw new IdentityError(
      codes.WEBAUTHN_VERIFICATION_FAILED,
      'challenge not found or expired',
      400,
    );
  }
  if (challenge.kind !== 'register') {
    throw new IdentityError(
      codes.WEBAUTHN_VERIFICATION_FAILED,
      `challenge is for ${challenge.kind}, not register`,
      400,
    );
  }
  if (challenge.userId !== cmd.userId) {
    throw new IdentityError(
      codes.WEBAUTHN_VERIFICATION_FAILED,
      'challenge userId mismatch',
      403,
    );
  }
  if (new Date(challenge.expiresAt).getTime() <= Date.now()) {
    throw new IdentityError(
      codes.WEBAUTHN_VERIFICATION_FAILED,
      'challenge expired',
      400,
    );
  }
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: cmd.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: cmd.expectedOrigin,
      expectedRPID: cmd.rpId,
      requireUserVerification: cmd.factorKind === 'passkey',
    });
  } catch (e) {
    throw new IdentityError(
      codes.WEBAUTHN_VERIFICATION_FAILED,
      `attestation verification failed: ${e instanceof Error ? e.message : String(e)}`,
      400,
    );
  }
  if (!verification.verified || !verification.registrationInfo) {
    throw new IdentityError(
      codes.WEBAUTHN_VERIFICATION_FAILED,
      'attestation not verified',
      400,
    );
  }
  // Single-use challenge — consume regardless of downstream errors.
  await deleteWebAuthnChallenge(entities, cmd.tenantId, cmd.challengeId);

  const credInfo = verification.registrationInfo.credential;
  const fmt = verification.registrationInfo.fmt;
  const aaguid = verification.registrationInfo.aaguid;
  // Coerce publicKey (Uint8Array) to base64url.
  const publicKeyB64 = Buffer.from(credInfo.publicKey).toString('base64url');

  const occurredAt = new Date().toISOString();
  const factorId = newAuthFactorId();
  const attrs: WebAuthnFactorAttrs = {
    credentialId: credInfo.id,
    publicKey: publicKeyB64,
    signCount: credInfo.counter,
    aaguid,
    attestationFmt: fmt,
    userVerification: cmd.factorKind === 'passkey',
    label: cmd.factorName,
  };
  const document: AuthFactorDocument = {
    factorId,
    tenantId: cmd.tenantId,
    userId: cmd.userId,
    kind: cmd.factorKind satisfies AuthFactorKind,
    attrs,
    status: 'active',
    name: cmd.factorName,
    enrolledAt: occurredAt,
  };
  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Identity.AuthFactorEnrolled',
    schemaId: 'domain.identity.auth_factor.enrolled.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `identity.factor.enroll.${factorId}`,
    causationId: null,
    principalId: cmd.principalId,
    userId: cmd.userId,
    cacheInvalidationTags: [
      `Tenant:${cmd.tenantId}`,
      `User:${cmd.userId}`,
      `AuthFactor:${factorId}`,
    ],
    retentionTag: 'retention:1y',
    payload: {
      document,
      source: cmd.factorKind === 'passkey' ? 'passkey_register' : 'webauthn_register',
    },
  };
  const stored = await eventStore.append(envelope);
  envelope.eventId = stored.eventId;
  envelope.seq = stored.seq;
  return { envelope, document };
}

// Re-export the transport type for routes that need it.
export type { AuthenticatorTransportFuture };
