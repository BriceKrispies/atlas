import type { Audience } from './types.ts';

/**
 * Build the `securitySchemes` block. Differs by audience:
 *
 *   tenant   — bearerAuth (JWT) + apiKeyAuth + oauth2ClientCredentials
 *   operator — adds debugPrincipal so atlasctl can declare its dev-only
 *              X-Debug-Principal header. NEVER in the tenant document.
 *
 * Per specs/crosscut/openapi.md (Auth schemes).
 */
export function buildSecuritySchemes(audience: Audience): Record<string, unknown> {
  const base: Record<string, unknown> = {
    bearerAuth: {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'OIDC bearer token from the configured IdP. See atlasctl.md auth precedence.',
    },
    apiKeyAuth: {
      type: 'apiKey',
      in: 'header',
      name: 'X-Api-Key',
      description: 'Service-to-service / atlasctl. Format: `atlas_<keyId>_<secret>`.',
    },
    oauth2ClientCredentials: {
      type: 'oauth2',
      flows: {
        clientCredentials: {
          tokenUrl: '/oauth/token',
          scopes: {},
        },
      },
      description: 'OAuth2 client-credentials grant. RFC 6749.',
    },
  };

  if (audience === 'operator') {
    base['debugPrincipal'] = {
      type: 'apiKey',
      in: 'header',
      name: 'X-Debug-Principal',
      description:
        'DEV ONLY. Format: type:id[:tenantId] (type ∈ user|service|anonymous). Honored only when the server has TEST_AUTH_ENABLED=true.',
    };
  }

  return base;
}

/** Default `security` requirement at the document level. */
export function defaultSecurity(): ReadonlyArray<Record<string, ReadonlyArray<string>>> {
  return [{ bearerAuth: [] }, { apiKeyAuth: [] }];
}
