/**
 * Unit tests for SAML SP-key handlers.
 *
 * Trio: `Identity.Saml.SpKey.{Generate,Rotate}`. These mint and rotate
 * the X.509 SP key pair used to sign SAML AuthnRequests / decrypt
 * IdP-encrypted assertions. The events carry tenant + key-id tags
 * (I10); rotation refuses on missing predecessors and on
 * already-rotated keys.
 *
 * Crypto branches (RSA keypair generation) are real — the handler
 * delegates to `node:crypto` via `generateSamlSpKey`. Tests use
 * smaller-than-default key lengths so they finish in seconds rather
 * than the ~30s a 4096-bit pair takes; the assertions are about
 * envelope shape + idempotency, not key strength.
 */

import { describe, it, expect } from 'vitest';
import {
  handleSamlSpKeyGenerate,
  handleSamlSpKeyRotate,
  IdentityError,
  identityErrorCodes,
} from '../../src/index.ts';
import { assertEventTags, newFixture } from '../lib/fixtures.ts';

describe('handleSamlSpKeyGenerate — happy path', () => {
  it('emits Identity.SamlSpKeyGenerated with Tenant + SamlSpKey tags (I10)', async () => {
    const fx = newFixture();
    const result = await handleSamlSpKeyGenerate(
      {
        tenantId: fx.tenantId,
        correlationId: 'corr-gen',
        principalId: 'usr-admin',
        keyLength: 2048, // shortest path the API exposes; ~1s
      },
      fx.events,
      fx.entities,
    );
    expect(result.envelope.eventType).toBe('Identity.SamlSpKeyGenerated');
    expect(result.document.status).toBe('active');
    assertEventTags(result.envelope, [
      `Tenant:${fx.tenantId}`,
      `SamlSpKey:${result.document.keyId}`,
    ]);
  });
});

describe('handleSamlSpKeyGenerate — failure: already-active key', () => {
  it('refuses when an active key already exists; first event remains the only one', async () => {
    const fx = newFixture();
    // Mint a first key so the second call sees an active predecessor.
    await handleSamlSpKeyGenerate(
      {
        tenantId: fx.tenantId,
        correlationId: 'corr-1',
        principalId: 'usr-admin',
        keyLength: 2048,
      },
      fx.events,
      fx.entities,
    );
    // Persist the entity row by reading + putting (the handler does not
    // currently write the document into the entity store on Generate —
    // it only emits the event. Until a dispatcher runs, `findActiveSamlSpKey`
    // sees nothing. To exercise the guard we manually seed the active row.)
    const initial = fx.events.events[0];
    expect(initial).toBeDefined();
    const doc = (initial!.payload as { document: unknown }).document as {
      keyId: string;
      tenantId: string;
      status: 'active';
    };
    await fx.entities.put({
      tenantId: doc.tenantId,
      entityType: 'SamlSpKey',
      entityId: doc.keyId,
      attrs: doc,
      schemaVersion: 1,
    });

    await expect(
      handleSamlSpKeyGenerate(
        {
          tenantId: fx.tenantId,
          correlationId: 'corr-2',
          principalId: 'usr-admin',
          keyLength: 2048,
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toBeInstanceOf(IdentityError);

    // No new event was appended.
    expect(fx.events.events).toHaveLength(1);
  });
});

describe('handleSamlSpKeyRotate — failure: predecessor not found', () => {
  it('throws SAML_SP_KEY_NOT_FOUND with no events appended', async () => {
    const fx = newFixture();
    await expect(
      handleSamlSpKeyRotate(
        {
          tenantId: fx.tenantId,
          correlationId: 'corr-rot',
          principalId: 'usr-admin',
          keyId: 'sks-nonexistent',
          keyLength: 2048,
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({
      code: identityErrorCodes.SAML_SP_KEY_NOT_FOUND,
    });
    expect(fx.events.events).toHaveLength(0);
  });
});
