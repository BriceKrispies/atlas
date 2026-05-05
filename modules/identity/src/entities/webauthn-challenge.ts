/**
 * `WebAuthnChallenge` entity — short-lived state for the WebAuthn
 * register + assert ceremonies.
 *
 * The browser's `navigator.credentials.create/get` flow is two-step:
 *
 *   1. Server generates a challenge (random 32 bytes) and returns
 *      `PublicKeyCredentialCreationOptions` (or `…RequestOptions`).
 *   2. The authenticator signs the challenge; the client posts the
 *      attestation/assertion back. Server verifies that the signed
 *      challenge equals the one we issued.
 *
 * Step 2 happens on a separate request, so we need to persist the
 * challenge between them. A `WebAuthnChallenge` entity with a 5-min
 * TTL fits the L3 substrate; the verify handler deletes the row on
 * use (single-use challenge — basic replay protection).
 *
 * Used for both register (kind='register') and assert
 * (kind='authenticate') — the flow shape is identical, only the
 * verify call differs.
 */

import type { EntityStore } from '@atlas/ports';

export type WebAuthnChallengeKind = 'register' | 'authenticate';

export interface WebAuthnChallengeDocument {
  challengeId: string;
  tenantId: string;
  userId: string;
  /** Base64url-encoded random challenge bytes. */
  challenge: string;
  kind: WebAuthnChallengeKind;
  /** ISO timestamp; verify rejects past this point. */
  expiresAt: string;
  createdAt: string;
}

export const WEBAUTHN_CHALLENGE_ENTITY_TYPE = 'WebAuthnChallenge';
export const WEBAUTHN_CHALLENGE_LATEST_VERSION = 1;

export async function getWebAuthnChallenge(
  store: EntityStore,
  tenantId: string,
  challengeId: string,
): Promise<WebAuthnChallengeDocument | null> {
  const row = await store.get<WebAuthnChallengeDocument>(
    tenantId,
    WEBAUTHN_CHALLENGE_ENTITY_TYPE,
    challengeId,
  );
  if (!row || row.status === 'deleted') return null;
  return row.attrs;
}

export async function putWebAuthnChallenge(
  store: EntityStore,
  doc: WebAuthnChallengeDocument,
): Promise<void> {
  await store.put<WebAuthnChallengeDocument>({
    tenantId: doc.tenantId,
    entityType: WEBAUTHN_CHALLENGE_ENTITY_TYPE,
    entityId: doc.challengeId,
    attrs: doc,
    schemaVersion: WEBAUTHN_CHALLENGE_LATEST_VERSION,
  });
}

export async function deleteWebAuthnChallenge(
  store: EntityStore,
  tenantId: string,
  challengeId: string,
): Promise<void> {
  await store.delete(tenantId, WEBAUTHN_CHALLENGE_ENTITY_TYPE, challengeId);
}
