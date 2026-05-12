/**
 * Unit tests for the IdentityProvider quintet (Layer 1).
 * Combined: `Identity.IdentityProvider.{Configure, Activate, Disable, RotateJwks}`
 * + a smoke pass over `handleJitProvision` (the deeper JIT branches
 * are exercised by the SAML ACS / OIDC route paths in
 * `../a3-acceptance.test.ts` / `../a6-acceptance.test.ts`).
 */

import { describe, it, expect } from 'vitest';
import {
  handleIdpConfigure,
  handleIdpActivate,
  handleIdpDisable,
  handleIdpRotateJwks,
  handleJitProvision,
  IdentityError,
  identityErrorCodes,
  type IdentityProviderDocument,
} from '../../src/index.ts';
import { newFixture, dispatchAll } from '../lib/fixtures.ts';

async function configureIdp(
  fx: ReturnType<typeof newFixture>,
  overrides: Partial<Parameters<typeof handleIdpConfigure>[0]> = {},
): Promise<IdentityProviderDocument> {
  const result = await handleIdpConfigure(
    {
      tenantId: fx.tenantId,
      correlationId: 'seed',
      principalId: 'admin',
      displayName: 'Test IdP',
      issuer: 'https://idp.example.com',
      audience: 'https://atlas.example.com',
      jwksUri: 'https://idp.example.com/.well-known/jwks.json',
      ...overrides,
    },
    fx.events,
  );
  await dispatchAll(fx);
  return result.document;
}

describe('handleIdpConfigure', () => {
  it('emits IdentityProviderConfigured with status=configured (NOT active)', async () => {
    const fx = newFixture();
    const result = await handleIdpConfigure(
      {
        tenantId: fx.tenantId,
        correlationId: 'corr-1',
        principalId: 'admin',
        displayName: 'Okta',
        issuer: 'https://example.okta.com',
        audience: 'https://atlas.example.com',
        jwksUri: 'https://example.okta.com/.well-known/jwks.json',
      },
      fx.events,
    );
    expect(result.envelope.eventType).toBe('Identity.IdentityProviderConfigured');
    expect(result.envelope.cacheInvalidationTags).toEqual([
      `Tenant:${fx.tenantId}`,
      `IdentityProvider:${result.document.idpId}`,
    ]);
    expect(result.document.status).toBe('configured');
  });

  it('rejects when neither jwksUri nor discoveryDocument.jwks_uri is provided', async () => {
    const fx = newFixture();
    await expect(
      handleIdpConfigure(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: 'admin',
          displayName: 'Bad IdP',
          issuer: 'https://idp.example.com',
          audience: 'https://atlas.example.com',
        },
        fx.events,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.IDP_INVALID_CONFIG });
    expect(fx.events.events).toHaveLength(0);
  });

  it('accepts discoveryDocument.jwks_uri as fallback when jwksUri not provided', async () => {
    const fx = newFixture();
    const result = await handleIdpConfigure(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        displayName: 'Discovery IdP',
        issuer: 'https://idp.example.com',
        audience: 'https://atlas.example.com',
        discoveryDocument: {
          issuer: 'https://idp.example.com',
          authorization_endpoint: 'https://idp.example.com/auth',
          token_endpoint: 'https://idp.example.com/token',
          jwks_uri: 'https://idp.example.com/jwks',
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
        },
      },
      fx.events,
    );
    expect(result.document.jwksUri).toBe('https://idp.example.com/jwks');
  });

  it('rejects empty issuer or audience with IDP_INVALID_CONFIG', async () => {
    const fx = newFixture();
    await expect(
      handleIdpConfigure(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: 'admin',
          displayName: 'No issuer',
          issuer: '',
          audience: 'https://atlas.example.com',
          jwksUri: 'https://idp.example.com/jwks',
        },
        fx.events,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.IDP_INVALID_CONFIG });
  });

  it('defaults kind=oidc, requireInvite=false, priority=100', async () => {
    const fx = newFixture();
    const result = await handleIdpConfigure(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        displayName: 'Defaults',
        issuer: 'https://defaults.example.com',
        audience: 'https://atlas.example.com',
        jwksUri: 'https://defaults.example.com/jwks',
      },
      fx.events,
    );
    expect(result.document.kind).toBe('oidc');
    expect(result.document.requireInvite).toBe(false);
    expect(result.document.priority).toBe(100);
  });

  it('persists overrides for kind, requireInvite, priority, groupClaimPath', async () => {
    const fx = newFixture();
    const result = await handleIdpConfigure(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        displayName: 'SAML',
        kind: 'saml',
        issuer: 'https://saml.example.com',
        audience: 'https://atlas.example.com',
        jwksUri: 'https://saml.example.com/jwks',
        requireInvite: true,
        priority: 10,
        groupClaimPath: 'realm_access.roles',
      },
      fx.events,
    );
    expect(result.document.kind).toBe('saml');
    expect(result.document.requireInvite).toBe(true);
    expect(result.document.priority).toBe(10);
    expect(result.document.groupClaimPath).toBe('realm_access.roles');
  });
});

describe('handleIdpActivate', () => {
  it('flips status from configured to active', async () => {
    const fx = newFixture();
    const idp = await configureIdp(fx);
    expect(idp.status).toBe('configured');
    const result = await handleIdpActivate(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        idpId: idp.idpId,
      },
      fx.events,
      fx.entities,
    );
    expect(result.envelope.eventType).toBe('Identity.IdentityProviderActivated');
    expect(result.document.status).toBe('active');
    expect(result.document.activatedAt).toBeDefined();
  });

  it('is idempotent — activating an already-active IdP returns NoOp event', async () => {
    const fx = newFixture();
    const idp = await configureIdp(fx);
    await handleIdpActivate(
      {
        tenantId: fx.tenantId,
        correlationId: 'first',
        principalId: 'admin',
        idpId: idp.idpId,
      },
      fx.events,
      fx.entities,
    );
    await dispatchAll(fx);
    const second = await handleIdpActivate(
      {
        tenantId: fx.tenantId,
        correlationId: 'second',
        principalId: 'admin',
        idpId: idp.idpId,
      },
      fx.events,
      fx.entities,
    );
    expect(second.envelope.eventType).toBe(
      'Identity.IdentityProviderActivated.NoOp',
    );
  });

  it('rejects unknown idpId with IDP_NOT_FOUND', async () => {
    const fx = newFixture();
    await expect(
      handleIdpActivate(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: 'admin',
          idpId: 'idp-fake',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.IDP_NOT_FOUND });
  });
});

describe('handleIdpDisable', () => {
  it('flips status to disabled and stamps disabledAt + disabledBy', async () => {
    const fx = newFixture();
    const idp = await configureIdp(fx);
    const result = await handleIdpDisable(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        idpId: idp.idpId,
      },
      fx.events,
      fx.entities,
    );
    expect(result.envelope.eventType).toBe('Identity.IdentityProviderDisabled');
    expect(result.document.status).toBe('disabled');
    expect(result.document.disabledAt).toBeDefined();
    expect(result.document.disabledBy).toBe('admin');
  });

  it('rejects unknown idpId with IDP_NOT_FOUND', async () => {
    const fx = newFixture();
    await expect(
      handleIdpDisable(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: 'admin',
          idpId: 'idp-fake',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.IDP_NOT_FOUND });
  });
});

describe('handleIdpRotateJwks', () => {
  it('clears jwksFetchedAt and emits RotatedJwks with Jwks tag', async () => {
    const fx = newFixture();
    const idp = await configureIdp(fx);
    // Stamp a jwksFetchedAt to verify it gets cleared.
    await fx.entities.put({
      tenantId: fx.tenantId,
      entityType: 'IdentityProvider',
      entityId: idp.idpId,
      attrs: { ...idp, jwksFetchedAt: new Date().toISOString() },
    });
    const result = await handleIdpRotateJwks(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        idpId: idp.idpId,
      },
      fx.events,
      fx.entities,
    );
    expect(result.envelope.eventType).toBe(
      'Identity.IdentityProviderRotatedJwks',
    );
    expect(result.envelope.cacheInvalidationTags).toEqual([
      `Tenant:${fx.tenantId}`,
      `IdentityProvider:${idp.idpId}`,
      `Jwks:${idp.idpId}`,
    ]);
    expect(result.document.jwksFetchedAt).toBeUndefined();
  });

  it('updates jwksUri when override provided', async () => {
    const fx = newFixture();
    const idp = await configureIdp(fx);
    const result = await handleIdpRotateJwks(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        idpId: idp.idpId,
        jwksUri: 'https://new.example.com/jwks',
      },
      fx.events,
      fx.entities,
    );
    expect(result.document.jwksUri).toBe('https://new.example.com/jwks');
  });

  it('rejects unknown idpId with IDP_NOT_FOUND', async () => {
    const fx = newFixture();
    await expect(
      handleIdpRotateJwks(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: 'admin',
          idpId: 'idp-fake',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.IDP_NOT_FOUND });
  });
});

describe('handleJitProvision — smoke', () => {
  // Deep group-claim-mapping branches live in `a3-acceptance.test.ts`
  // and `a6-acceptance.test.ts`; this block confirms the basic
  // create-on-first-login + reuse-on-second-login branches.

  async function activeIdp(
    fx: ReturnType<typeof newFixture>,
    overrides: Partial<Parameters<typeof handleIdpConfigure>[0]> = {},
  ) {
    const idp = await configureIdp(fx, overrides);
    await handleIdpActivate(
      {
        tenantId: fx.tenantId,
        correlationId: 'a',
        principalId: 'admin',
        idpId: idp.idpId,
      },
      fx.events,
      fx.entities,
    );
    await dispatchAll(fx);
    const entity = await fx.entities.get<IdentityProviderDocument>(
      fx.tenantId,
      'IdentityProvider',
      idp.idpId,
    );
    if (!entity) throw new Error(`IdentityProvider ${idp.idpId} missing after activation`);
    return entity.attrs;
  }

  it('creates a new User + Membership on first login', async () => {
    const fx = newFixture();
    const idp = await activeIdp(fx, {
      defaultRolesOnFirstLogin: ['Author'],
    });
    const result = await handleJitProvision(
      {
        tenantId: fx.tenantId,
        correlationId: 'jit',
        idp,
        claims: {
          sub: 'sub-alice',
          email: 'alice@example.com',
          raw: { sub: 'sub-alice', email: 'alice@example.com' },
        },
      },
      fx.events,
      fx.entities,
    );
    expect(result.created).toBe(true);
    expect(result.user.email).toBe('alice@example.com');
    expect(result.user.primaryIdpSubject).toBe('sub-alice');
    expect(result.membership.roles).toEqual(['Author']);
    expect(
      result.events.some((e) => e.eventType === 'Identity.UserCreated'),
    ).toBe(true);
    expect(
      result.events.some((e) => e.eventType === 'Identity.MembershipCreated'),
    ).toBe(true);
  });

  it('reuses the existing User on second login (created=false)', async () => {
    const fx = newFixture();
    const idp = await activeIdp(fx, {
      defaultRolesOnFirstLogin: ['Author'],
    });
    const claims = {
      sub: 'sub-bob',
      email: 'bob@example.com',
      raw: { sub: 'sub-bob', email: 'bob@example.com' },
    };
    const first = await handleJitProvision(
      { tenantId: fx.tenantId, correlationId: 'jit-1', idp, claims },
      fx.events,
      fx.entities,
    );
    await dispatchAll(fx);
    const second = await handleJitProvision(
      { tenantId: fx.tenantId, correlationId: 'jit-2', idp, claims },
      fx.events,
      fx.entities,
    );
    expect(second.created).toBe(false);
    expect(second.user.userId).toBe(first.user.userId);
  });
});

describe('IdP suite — tenant scoping', () => {
  it('IdP in tenant B is invisible to tenant A handler invocations', async () => {
    const fx = newFixture('tenant-a');
    const inB = await handleIdpConfigure(
      {
        tenantId: 'tenant-b',
        correlationId: 's',
        principalId: 'admin-b',
        displayName: 'cross',
        issuer: 'https://cross.example.com',
        audience: 'https://atlas.example.com',
        jwksUri: 'https://cross.example.com/jwks',
      },
      fx.events,
    );
    await dispatchAll(fx);
    await expect(
      handleIdpActivate(
        {
          tenantId: 'tenant-a',
          correlationId: 'cross',
          principalId: 'admin-a',
          idpId: inB.document.idpId,
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.IDP_NOT_FOUND });
  });
});

describe('IdP suite — error type', () => {
  it('all rejection paths throw IdentityError instances', async () => {
    const fx = newFixture();
    await expect(
      handleIdpActivate(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: 'admin',
          idpId: 'idp-fake',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toBeInstanceOf(IdentityError);
  });
});
