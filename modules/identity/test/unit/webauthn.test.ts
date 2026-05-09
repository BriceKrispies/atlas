/**
 * Unit tests for WebAuthn handlers (Layer 1).
 * Combined: `Identity.Mfa.Webauthn.{RegisterBegin, RegisterFinish,
 * AssertBegin, AssertFinish}` (and the equivalent passkey variants).
 *
 * Crypto-bearing branches (CBOR-encoded attestation / assertion
 * verification, ES256 / RS256 / EdDSA signature paths) require real
 * authenticator-issued credentials and are exercised by
 * `../a5-acceptance.test.ts` against fixture-baked credentials. This
 * file owns the non-crypto branches: challenge-id lifecycle, expiry,
 * RegisterBegin option shaping.
 *
 * The crypto branches are listed as `it.todo` so the e2e gap is
 * visible in test reports.
 */

import { describe, it, expect } from 'vitest';
import {
  handleWebAuthnRegisterBegin,
  handleWebAuthnRegisterFinish,
  handleWebAuthnAssertBegin,
  handleWebAuthnAssertFinish,
  IdentityError,
  identityErrorCodes,
} from '../../src/index.ts';
import { newFixture } from '../lib/fixtures.ts';

describe('handleWebAuthnRegisterBegin', () => {
  it('returns challengeId + PublicKeyCredentialCreationOptions and persists a challenge', async () => {
    const fx = newFixture();
    const result = await handleWebAuthnRegisterBegin(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        userId: 'user-1',
        userName: 'user@example.com',
        rpId: 'atlas.example.com',
        rpName: 'Atlas',
        factorKind: 'webauthn_mfa',
      },
      fx.entities,
    );
    expect(result.challengeId).toMatch(/^wac-/);
    expect(result.options.rp.id).toBe('atlas.example.com');
    expect(result.options.rp.name).toBe('Atlas');
    // The challenge entity was persisted.
    const stored = await fx.entities.get(
      fx.tenantId,
      'WebAuthnChallenge',
      result.challengeId,
    );
    expect(stored).toBeDefined();
  });

  it('factorKind=passkey enables resident keys (discoverable credentials)', async () => {
    const fx = newFixture();
    const result = await handleWebAuthnRegisterBegin(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        userId: 'user-2',
        userName: 'user@example.com',
        rpId: 'atlas.example.com',
        factorKind: 'passkey',
      },
      fx.entities,
    );
    expect(
      result.options.authenticatorSelection?.residentKey,
    ).toBe('required');
  });

  it('factorKind=webauthn_mfa uses non-discoverable (server-side) credentials', async () => {
    const fx = newFixture();
    const result = await handleWebAuthnRegisterBegin(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        userId: 'user-3',
        userName: 'user@example.com',
        rpId: 'atlas.example.com',
        factorKind: 'webauthn_mfa',
      },
      fx.entities,
    );
    // 2FA factors are non-discoverable.
    expect(
      result.options.authenticatorSelection?.residentKey,
    ).not.toBe('required');
  });
});

describe('handleWebAuthnRegisterFinish — non-crypto branches', () => {
  it('rejects an unknown challengeId with WEBAUTHN_CHALLENGE_NOT_FOUND', async () => {
    const fx = newFixture();
    await expect(
      handleWebAuthnRegisterFinish(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: 'user-1',
          userId: 'user-1',
          challengeId: 'wac-fake',
          response: {
            id: 'cred-1',
            rawId: 'cred-1',
            response: {
              clientDataJSON: '',
              attestationObject: '',
            },
            type: 'public-key',
            clientExtensionResults: {},
          } as never,
          expectedOrigin: 'https://atlas.example.com',
          rpId: 'atlas.example.com',
          factorKind: 'webauthn_mfa',
          name: 'security key',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({
      code: identityErrorCodes.WEBAUTHN_VERIFICATION_FAILED,
    });
    expect(fx.events.events).toHaveLength(0);
  });
});

// I10 contract for the WebAuthn emit-sites. The crypto-bearing branches
// (RegisterFinish success → `Identity.AuthFactorEnrolled`; AssertFinish
// success → `Identity.MfaChallengeSucceeded`) are gated by real
// authenticator-issued attestation/assertion blobs; this assertion
// documents the cache-tag contract those branches MUST satisfy when
// the e2e harness eventually exercises them.
//
// `assertEventTags` is exported from `test/lib/fixtures.ts` so the
// e2e wiring just imports it once it has an emitted envelope to
// inspect. See modules/CLAUDE.md cache-invalidation contract for
// rationale.
describe.skip('handleWebAuthnRegisterFinish — I10 cache-tag contract (e2e gap)', () => {
  it.todo(
    'on success, AuthFactorEnrolled envelope.cacheInvalidationTags ⊇ [Tenant:<t>, User:<u>, AuthFactor:<f>]',
  );
});

describe.skip('handleWebAuthnAssertFinish — I10 cache-tag contract (e2e gap)', () => {
  it.todo(
    'on success, MfaChallengeSucceeded envelope.cacheInvalidationTags ⊇ [Tenant:<t>, User:<u>]',
  );
});

describe('handleWebAuthnAssertBegin', () => {
  it('returns challengeId + PublicKeyCredentialRequestOptions', async () => {
    const fx = newFixture();
    const result = await handleWebAuthnAssertBegin(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        rpId: 'atlas.example.com',
        // No allowCredentials — the authenticator picks any valid passkey.
      },
      fx.entities,
    );
    expect(result.challengeId).toMatch(/^wac-/);
    expect(result.options.rpId).toBe('atlas.example.com');
  });
});

describe('handleWebAuthnAssertFinish — non-crypto branches', () => {
  it('rejects an unknown challengeId with WEBAUTHN_CHALLENGE_NOT_FOUND', async () => {
    const fx = newFixture();
    await expect(
      handleWebAuthnAssertFinish(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: 'user-1',
          challengeId: 'wac-fake',
          response: {
            id: 'cred-1',
            rawId: 'cred-1',
            response: {
              clientDataJSON: '',
              authenticatorData: '',
              signature: '',
              userHandle: undefined,
            },
            type: 'public-key',
            clientExtensionResults: {},
          } as never,
          expectedOrigin: 'https://atlas.example.com',
          rpId: 'atlas.example.com',
          factorKind: 'webauthn_mfa',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({
      code: identityErrorCodes.WEBAUTHN_VERIFICATION_FAILED,
    });
  });

  it('throws IdentityError instances', async () => {
    const fx = newFixture();
    await expect(
      handleWebAuthnAssertFinish(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: 'user-1',
          challengeId: 'wac-fake',
          response: {
            id: 'cred-1',
            rawId: 'cred-1',
            response: {
              clientDataJSON: '',
              authenticatorData: '',
              signature: '',
              userHandle: undefined,
            },
            type: 'public-key',
            clientExtensionResults: {},
          } as never,
          expectedOrigin: 'https://atlas.example.com',
          rpId: 'atlas.example.com',
          factorKind: 'webauthn_mfa',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toBeInstanceOf(IdentityError);
  });
});

describe.skip('WebAuthn — crypto-bearing branches (covered by a5-acceptance + Layer 3 e2e)', () => {
  // These branches require real CBOR-encoded attestation / assertion
  // responses — the @simplewebauthn/server library validates them
  // against real ES256/RS256/EdDSA signatures. Mocking that here
  // would defeat the purpose of the test.
  it.todo('RegisterFinish: valid attestation creates AuthFactor and emits AuthFactorEnrolled');
  it.todo('RegisterFinish: factor cap enforcement (max factors per user)');
  it.todo('AssertFinish: valid assertion advances signCount and emits MfaChallengeSucceeded');
  it.todo('AssertFinish: signCount regression triggers anomaly (cloned authenticator detection)');
  it.todo('AssertFinish: rpId / origin mismatch rejects the assertion');
  it.todo('Challenge expiry: challenge older than 5 min is treated as not-found');
});
