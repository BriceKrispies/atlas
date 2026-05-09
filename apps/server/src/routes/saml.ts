/**
 * SAML 2.0 routes (Phase A6.9).
 *
 *   - GET  /sso/saml/:tenantId/metadata.xml — SP metadata
 *   - GET  /sso/saml/:tenantId/initiate?idp=<idpId> — start SP-initiated flow
 *   - POST /sso/saml/:tenantId/acs — Assertion Consumer Service (IdP posts back)
 *
 * Mounted PUBLIC: SAML doesn't speak through the standard JWT/cookie
 * auth path. The ACS callback verifies the IdP's signature inline.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  PostgresEntityStore,
  PostgresEventStore,
  PostgresRelationStore,
} from '@atlas/adapter-node';
import {
  buildAuthnRequest,
  getIdentityProviderEntity,
  handleSamlAcs,
  identityDispatcher,
  IdentityError,
  listMetadataSamlSpKeys,
} from '@atlas/identity';
import type { AppState } from '../bootstrap.ts';
import { ensureTenantMigrated } from '../bootstrap.ts';
import { errorResponse } from '../middleware/errors.ts';
import { correlationIdFor } from '../middleware/correlation.ts';
import type { ServerVariables } from '../middleware/principal.ts';

type AppCtx = Context<{ Variables: ServerVariables }>;

function spEntityIdFor(host: string, tenantId: string): string {
  return `https://${host}/sso/saml/${tenantId}`;
}

function acsUrlFor(host: string, tenantId: string): string {
  return `https://${host}/sso/saml/${tenantId}/acs`;
}

/** Strip PEM headers + whitespace, return base64 only. SAML metadata wants the bare cert. */
function pemToBareBase64(pem: string): string {
  return pem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');
}

export function samlRoutes(state: AppState): Hono<{ Variables: ServerVariables }> {
  const app = new Hono<{ Variables: ServerVariables }>();

  // ----- SP metadata -----------------------------------------------

  app.get('/sso/saml/:tenantId/metadata.xml', async (c: AppCtx) => {
    const correlationId = correlationIdFor(c);
    const tenantId = c.req.param('tenantId') ?? '';
    if (!tenantId) {
      return errorResponse(c, 'SCHEMA_VALIDATION_FAILED', 'tenantId required', 400, correlationId);
    }
    const host = c.req.header('host') ?? 'localhost';
    let sql: import('postgres').Sql;
    try {
      sql = await ensureTenantMigrated(state, tenantId);
    } catch (e) {
      c.get('ctx').logger.warn('tenant migrate failed; returning 404', {
        event: 'Tenancy.EnsureMigrated.Failed',
        properties: {
          tenantId,
          route: 'saml.metadata',
          cause: (e as Error).message,
        },
      });
      return errorResponse(c, 'NOT_FOUND', 'tenant not found', 404, correlationId);
    }
    const entities = new PostgresEntityStore(sql);
    const keys = await listMetadataSamlSpKeys(entities, tenantId);
    if (keys.length === 0) {
      return errorResponse(
        c,
        'SAML_SP_KEY_NOT_FOUND',
        `tenant ${tenantId} has no SP signing key — generate one via Identity.SamlSpKey.Generate`,
        404,
        correlationId,
      );
    }
    const spEntityId = spEntityIdFor(host, tenantId);
    const acsUrl = acsUrlFor(host, tenantId);
    const keyDescriptors = keys
      .map(
        (k) =>
          `<KeyDescriptor use="signing"><KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><X509Data><X509Certificate>${pemToBareBase64(k.publicCertPem)}</X509Certificate></X509Data></KeyInfo></KeyDescriptor>`,
      )
      .join('');
    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${spEntityId}">` +
      `<SPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol" AuthnRequestsSigned="true" WantAssertionsSigned="true">` +
      keyDescriptors +
      `<NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</NameIDFormat>` +
      `<NameIDFormat>urn:oasis:names:tc:SAML:2.0:nameid-format:persistent</NameIDFormat>` +
      `<AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${acsUrl}" index="0" isDefault="true"/>` +
      `</SPSSODescriptor>` +
      `</EntityDescriptor>`;
    c.header('content-type', 'application/samlmetadata+xml');
    return c.body(xml);
  });

  // ----- SP-initiated flow ----------------------------------------

  app.get('/sso/saml/:tenantId/initiate', async (c: AppCtx) => {
    const correlationId = correlationIdFor(c);
    const tenantId = c.req.param('tenantId') ?? '';
    const idpId = c.req.query('idp') ?? '';
    const relayState = c.req.query('RelayState') ?? '';
    if (!tenantId || !idpId) {
      return errorResponse(c, 'SCHEMA_VALIDATION_FAILED', 'tenantId + idp required', 400, correlationId);
    }
    let sql: import('postgres').Sql;
    try {
      sql = await ensureTenantMigrated(state, tenantId);
    } catch (e) {
      c.get('ctx').logger.warn('tenant migrate failed; returning 404', {
        event: 'Tenancy.EnsureMigrated.Failed',
        properties: {
          tenantId,
          route: 'saml.initiate',
          cause: (e as Error).message,
        },
      });
      return errorResponse(c, 'NOT_FOUND', 'tenant not found', 404, correlationId);
    }
    const entities = new PostgresEntityStore(sql);
    const idp = await getIdentityProviderEntity(entities, tenantId, idpId);
    if (!idp || idp.kind !== 'saml' || !idp.samlSsoUrl) {
      return errorResponse(c, 'IDP_NOT_FOUND', `no SAML IdP ${idpId}`, 404, correlationId);
    }
    if (idp.status !== 'active') {
      return errorResponse(c, 'IDP_DISABLED', `IdP ${idpId} not active`, 403, correlationId);
    }
    const host = c.req.header('host') ?? 'localhost';
    const built = buildAuthnRequest({
      spEntityId: idp.samlSpEntityId ?? spEntityIdFor(host, tenantId),
      destination: idp.samlSsoUrl,
      acsUrl: acsUrlFor(host, tenantId),
      ...(idp.samlNameIdFormat
        ? { nameIdFormat: `urn:oasis:names:tc:SAML:2.0:nameid-format:${idp.samlNameIdFormat}` }
        : {}),
    });
    // Stash the requestId so ACS can verify InResponseTo. For Phase
    // A6 we bind it into the RelayState (signed-cookie integration
    // is post-A6 polish). RelayState carries `<requestId>:<userRelay>`.
    const finalRelayState = `${built.requestId}:${relayState}`;
    return c.redirect(built.buildRedirectUrl(finalRelayState), 302);
  });

  // ----- ACS callback ---------------------------------------------

  app.post('/sso/saml/:tenantId/acs', async (c: AppCtx) => {
    const correlationId = correlationIdFor(c);
    const tenantId = c.req.param('tenantId') ?? '';
    if (!tenantId) {
      return errorResponse(c, 'SCHEMA_VALIDATION_FAILED', 'tenantId required', 400, correlationId);
    }
    let body: Record<string, unknown>;
    try {
      // IdPs POST `application/x-www-form-urlencoded` per the binding.
      const form = await c.req.parseBody();
      body = form as Record<string, unknown>;
    } catch {
      return errorResponse(c, 'SCHEMA_VALIDATION_FAILED', 'invalid form body', 400, correlationId);
    }
    const samlResponseB64 =
      typeof body['SAMLResponse'] === 'string' ? (body['SAMLResponse'] as string) : null;
    if (!samlResponseB64) {
      return errorResponse(c, 'SCHEMA_VALIDATION_FAILED', 'SAMLResponse required', 400, correlationId);
    }
    const relayState =
      typeof body['RelayState'] === 'string' ? (body['RelayState'] as string) : '';
    const inResponseTo = relayState.split(':')[0] ?? '';
    let sql: import('postgres').Sql;
    try {
      sql = await ensureTenantMigrated(state, tenantId);
    } catch (e) {
      c.get('ctx').logger.warn('tenant migrate failed; returning 404', {
        event: 'Tenancy.EnsureMigrated.Failed',
        properties: {
          tenantId,
          route: 'saml.acs',
          cause: (e as Error).message,
        },
      });
      return errorResponse(c, 'NOT_FOUND', 'tenant not found', 404, correlationId);
    }
    const eventStore = new PostgresEventStore(sql);
    const entities = new PostgresEntityStore(sql);
    const relations = new PostgresRelationStore(sql);
    const host = c.req.header('host') ?? 'localhost';
    try {
      const result = await handleSamlAcs(
        {
          tenantId,
          correlationId,
          samlResponseB64,
          spEntityId: spEntityIdFor(host, tenantId),
          ...(inResponseTo ? { expectedInResponseTo: inResponseTo } : {}),
        },
        eventStore,
        entities,
      );
      const dispatch = identityDispatcher({ entities, relations });
      await dispatch(result.envelope);
      for (const f of result.follow) await dispatch(f);
      return c.json(
        {
          ok: true,
          userId: result.user.userId,
          email: result.user.email,
          roles: result.membership.roles,
          assertionId: result.assertion.assertionId,
        },
        200,
      );
    } catch (e) {
      if (e instanceof IdentityError) {
        return errorResponse(c, e.code, e.message, e.status, correlationId);
      }
      c.get('ctx').logger.error('saml acs unmapped error', {
        event: 'Saml.Acs.UnmappedError',
        error:
          e instanceof Error
            ? {
                code: 'UNMAPPED_ERROR',
                message: e.message,
                ...(e.stack !== undefined ? { stack: e.stack } : {}),
              }
            : { code: 'UNMAPPED_ERROR', message: String(e) },
      });
      return errorResponse(c, 'TRANSACTION_FAILED', 'Internal failure', 500, correlationId);
    }
  });

  return app;
}
