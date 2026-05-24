/**
 * Regression pins for the `userId`-subject sweep
 * (`tickets/chore/handler-userid-propagation-sweep.md`).
 *
 * The `userId` envelope field is the SUBJECT of an event — the entity the
 * event is ABOUT. `principalId` is the ACTOR — the principal that caused it.
 * A prior pattern stamped `userId: cmd.principalId` across 23 identity
 * handler sites, leaking the actor into the subject field. Audit rows index
 * by `userId` to answer "show events about user X"; letting the actor land
 * there pollutes per-user queries (and, post ADR-0008, would put the
 * platform-robot id there for front-door flows).
 *
 * This file mirrors the regression-pin pattern in
 * `platform-robot-principal.test.ts` ("subject-vs-actor invariant" block).
 * Each test asserts the EXPECTED `userId` value (not merely non-null), so
 * future drift fails loudly. Sites fall into three categories:
 *
 *   - null-subject     — system / tenant-config / non-User principal events
 *                        (IdP config, audit-export config, SAML SP keys,
 *                        SCIM tokens, ServicePrincipals, SP-owned API keys)
 *   - user-subject     — events about a specific User (Membership.Create,
 *                        User.SetPassword, user-owned API keys)
 *   - actor-is-subject — none in this sweep; documented below so a future
 *                        reviewer knows the category was considered and is
 *                        deliberately empty.
 */
import { describe, it, expect } from '@atlas/test';
import { PLATFORM_ROBOT_PRINCIPAL_ID } from '@atlas/platform-core';
import {
  handleApiKeyCreate,
  handleApiKeyRotate,
  handleApiKeyRevoke,
  handleMembershipCreate,
  handlePasswordSet,
  handleUserCreate,
  handleServicePrincipalCreate,
  handleScimTokenEnable,
  handleScimTokenRotate,
  handleScimTokenRevoke,
  handleIdpConfigure,
  handleIdpActivate,
  handleIdpDisable,
  handleIdpRotateJwks,
  handleAuditExportConfigure,
  handleSamlSpKeyGenerate,
  handleSamlSpKeyRotate,
} from '../../src/index.ts';
import { newFixture, dispatchAll } from '../lib/fixtures.ts';

const ACTOR = 'usr-operator-actor';

// ---------------------------------------------------------------------
// Category: null-subject — events with no User subject
// ---------------------------------------------------------------------
describe('userId subject sweep — null-subject events (no User subject)', function () {
  it('handleIdpConfigure: IdentityProviderConfigured.userId is null (tenant config)', async function () {
    const fx = newFixture();
    const result = await handleIdpConfigure(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: ACTOR,
        displayName: 'Test IDP',
        issuer: 'https://idp.example.com',
        audience: 'atlas',
        jwksUri: 'https://idp.example.com/jwks',
      },
      fx.events,
    );
    expect(result.envelope.eventType).toBe('Identity.IdentityProviderConfigured');
    expect(result.envelope.principalId).toBe(ACTOR);
    expect(result.envelope.userId).toBeNull();
  });

  it('handleIdpActivate / Disable / RotateJwks: userId is null on each', async function () {
    const fx = newFixture();
    const configured = await handleIdpConfigure(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: ACTOR,
        displayName: 'Test IDP',
        issuer: 'https://idp.example.com',
        audience: 'atlas',
        jwksUri: 'https://idp.example.com/jwks',
      },
      fx.events,
    );
    await dispatchAll(fx);
    const idpId = configured.document.idpId;

    const activated = await handleIdpActivate(
      { tenantId: fx.tenantId, correlationId: 'c', principalId: ACTOR, idpId },
      fx.events,
      fx.entities,
    );
    expect(activated.envelope.eventType).toBe('Identity.IdentityProviderActivated');
    expect(activated.envelope.userId).toBeNull();
    await dispatchAll(fx);

    const rotated = await handleIdpRotateJwks(
      { tenantId: fx.tenantId, correlationId: 'c', principalId: ACTOR, idpId },
      fx.events,
      fx.entities,
    );
    expect(rotated.envelope.userId).toBeNull();
    await dispatchAll(fx);

    const disabled = await handleIdpDisable(
      { tenantId: fx.tenantId, correlationId: 'c', principalId: ACTOR, idpId },
      fx.events,
      fx.entities,
    );
    expect(disabled.envelope.eventType).toBe('Identity.IdentityProviderDisabled');
    expect(disabled.envelope.userId).toBeNull();
  });

  it('handleAuditExportConfigure: AuditExportConfigured.userId is null (tenant config)', async function () {
    const fx = newFixture();
    const result = await handleAuditExportConfigure(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: ACTOR,
        destination: { bucket: 'b', region: 'r', accessKeyId: 'ak', secretAccessKey: 'sk' },
        cadence: 'daily',
      },
      fx.events,
      fx.entities,
    );
    expect(result.envelope.eventType).toBe('Identity.AuditExportConfigured');
    expect(result.envelope.principalId).toBe(ACTOR);
    expect(result.envelope.userId).toBeNull();
  });

  it('handleSamlSpKeyGenerate + Rotate: userId is null on both (tenant SP signing key)', async function () {
    const fx = newFixture();
    const gen = await handleSamlSpKeyGenerate(
      { tenantId: fx.tenantId, correlationId: 'c', principalId: ACTOR },
      fx.events,
      fx.entities,
      fx.secrets,
    );
    expect(gen.envelope.eventType).toBe('Identity.SamlSpKeyGenerated');
    expect(gen.envelope.userId).toBeNull();
    await dispatchAll(fx);

    const rot = await handleSamlSpKeyRotate(
      { tenantId: fx.tenantId, correlationId: 'c', principalId: ACTOR, keyId: gen.document.keyId },
      fx.events,
      fx.entities,
      fx.secrets,
    );
    // Primary (predecessor flip) and follow (successor mint) both null.
    expect(rot.envelope.eventType).toBe('Identity.SamlSpKeyRotated');
    expect(rot.envelope.userId).toBeNull();
    for (const f of rot.follow) {
      expect(f.userId).toBeNull();
    }
  });

  it('handleScimTokenEnable / Rotate / Revoke: userId is null on each (tenant connector credential)', async function () {
    const fx = newFixture();
    const enabled = await handleScimTokenEnable(
      { tenantId: fx.tenantId, correlationId: 'c', principalId: ACTOR, name: 'prod' },
      fx.events,
    );
    expect(enabled.envelope.eventType).toBe('Identity.ScimTokenEnabled');
    expect(enabled.envelope.userId).toBeNull();
    await dispatchAll(fx);

    const rotated = await handleScimTokenRotate(
      { tenantId: fx.tenantId, correlationId: 'c', principalId: ACTOR, tokenId: enabled.document.tokenId },
      fx.events,
      fx.entities,
    );
    expect(rotated.envelope.eventType).toBe('Identity.ScimTokenRotated');
    expect(rotated.envelope.userId).toBeNull();
    for (const f of rotated.follow) {
      expect(f.userId).toBeNull();
    }
    await dispatchAll(fx);

    const revoked = await handleScimTokenRevoke(
      { tenantId: fx.tenantId, correlationId: 'c', principalId: ACTOR, tokenId: rotated.successor.tokenId },
      fx.events,
      fx.entities,
    );
    expect(revoked.envelope.eventType).toBe('Identity.ScimTokenRevoked');
    expect(revoked.envelope.userId).toBeNull();
  });

  it('handleServicePrincipalCreate: ServicePrincipalCreated.userId is null (SP is a non-User principal)', async function () {
    const fx = newFixture();
    const result = await handleServicePrincipalCreate(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: ACTOR,
        ownerUserId: 'usr-owner',
        displayName: 'CI bot',
        scopes: ['Catalog.Read'],
      },
      fx.events,
    );
    expect(result.envelope.eventType).toBe('Identity.ServicePrincipalCreated');
    expect(result.envelope.principalId).toBe(ACTOR);
    // Subject is the SP, not the human owner and not the actor.
    expect(result.envelope.userId).toBeNull();
  });

  it('handleApiKeyCreate (SP-owned): ApiKeyCreated.userId is null', async function () {
    const fx = newFixture();
    const sp = await handleServicePrincipalCreate(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: ACTOR,
        ownerUserId: 'usr-owner',
        displayName: 'CI bot',
        scopes: ['Catalog.Read'],
      },
      fx.events,
    );
    await dispatchAll(fx);
    const result = await handleApiKeyCreate(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: ACTOR,
        name: 'ci-key',
        servicePrincipalId: sp.document.spId,
        scopes: ['Catalog.Read'],
      },
      fx.events,
      fx.entities,
    );
    expect(result.envelope.eventType).toBe('Identity.ApiKeyCreated');
    expect(result.envelope.userId).toBeNull();
  });
});

// ---------------------------------------------------------------------
// Category: user-subject — events about a specific User
// ---------------------------------------------------------------------
describe('userId subject sweep — user-subject events (about a specific User)', function () {
  it('handleMembershipCreate: MembershipCreated.userId is the membership User, not the actor', async function () {
    const fx = newFixture();
    const user = await handleUserCreate(
      { tenantId: fx.tenantId, correlationId: 'seed', principalId: ACTOR, email: 'member@example.com' },
      fx.events,
    );
    await dispatchAll(fx);
    const result = await handleMembershipCreate(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: ACTOR,
        userId: user.document.userId,
        roles: ['Author'],
      },
      fx.events,
      fx.entities,
    );
    expect(result.envelope.eventType).toBe('Identity.MembershipCreated');
    expect(result.envelope.principalId).toBe(ACTOR);
    expect(result.envelope.userId).toBe(user.document.userId);
    expect(result.envelope.userId).not.toBe(ACTOR);
  });

  it('handlePasswordSet: PasswordChanged.userId is the User whose password changed, not the actor', async function () {
    const fx = newFixture();
    const user = await handleUserCreate(
      { tenantId: fx.tenantId, correlationId: 'seed', principalId: ACTOR, email: 'pwd@example.com' },
      fx.events,
    );
    await dispatchAll(fx);
    const result = await handlePasswordSet(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: ACTOR,
        userId: user.document.userId,
        newPassword: 'CorrectPa55word!',
      },
      fx.events,
      fx.entities,
    );
    expect(result.envelope.eventType).toBe('Identity.PasswordChanged');
    expect(result.envelope.principalId).toBe(ACTOR);
    expect(result.envelope.userId).toBe(user.document.userId);
    expect(result.envelope.userId).not.toBe(ACTOR);
  });

  it('handleApiKeyCreate / Rotate / Revoke (user-owned): userId is the owning User across the lifecycle', async function () {
    const fx = newFixture();
    const OWNER = 'usr-key-owner';
    const created = await handleApiKeyCreate(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: ACTOR,
        name: 'personal-key',
        userId: OWNER,
        scopes: ['Catalog.Read'],
      },
      fx.events,
      fx.entities,
    );
    expect(created.envelope.eventType).toBe('Identity.ApiKeyCreated');
    // Subject is the OWNER (the User the key belongs to), not the actor.
    expect(created.envelope.userId).toBe(OWNER);
    expect(created.envelope.userId).not.toBe(ACTOR);
    await dispatchAll(fx);

    const rotated = await handleApiKeyRotate(
      { tenantId: fx.tenantId, correlationId: 'c', principalId: ACTOR, keyId: created.document.keyId },
      fx.events,
      fx.entities,
    );
    // Predecessor flip (primary) carries the owner; successor (follow) too.
    expect(rotated.envelope.eventType).toBe('Identity.ApiKeyRotated');
    expect(rotated.envelope.userId).toBe(OWNER);
    expect(rotated.follow[0]?.eventType).toBe('Identity.ApiKeyCreated');
    expect(rotated.follow[0]?.userId).toBe(OWNER);
    await dispatchAll(fx);

    const revoked = await handleApiKeyRevoke(
      { tenantId: fx.tenantId, correlationId: 'c', principalId: ACTOR, keyId: rotated.successor.keyId },
      fx.events,
      fx.entities,
    );
    expect(revoked.envelope.eventType).toBe('Identity.ApiKeyRevoked');
    expect(revoked.envelope.userId).toBe(OWNER);
  });
});

// ---------------------------------------------------------------------
// Category: actor-is-subject — deliberately empty in this sweep
// ---------------------------------------------------------------------
describe('userId subject sweep — actor-is-subject category is empty', function () {
  it('documents that none of the 23 swept sites retained userId: cmd.principalId', async function () {
    // No site in this sweep had the actor genuinely AS the subject. Every
    // site resolved to either null (no User subject) or a concrete User id
    // distinct from the actor. The robot-id front-door flows (User.Create,
    // Invite.Accept) that DO involve self-as-subject reasoning were already
    // fixed in Stage 2 and are pinned in platform-robot-principal.test.ts.
    //
    // This test is a canary: if a future change reintroduces an
    // actor-is-subject site, document it here and add a real assertion.
    const fx = newFixture();
    const user = await handleUserCreate(
      { tenantId: fx.tenantId, correlationId: 'seed', principalId: PLATFORM_ROBOT_PRINCIPAL_ID, email: 'canary@example.com' },
      fx.events,
    );
    // Even when the actor is the robot, the subject is the new user.
    expect(user.envelope.userId).toBe(user.document.userId);
    expect(user.envelope.userId).not.toBe(PLATFORM_ROBOT_PRINCIPAL_ID);
  });
});
