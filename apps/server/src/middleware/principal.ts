/**
 * Principal middleware.
 *
 * Resolves a `Principal` for every authenticated route, mirroring the Rust
 * `authn_middleware` (see crates/ingress/src/authn.rs).
 *
 * Two paths:
 * 1. `Authorization: Bearer <jwt>` → verified against the OIDC JWKS via
 *    `jose`, audience-checked, principalId from `sub`, tenantId from the
 *    `tenant_id` claim if present, falling back to the configured default.
 * 2. `X-Debug-Principal: type:id[:tenantId]` → only honoured when
 *    `TEST_AUTH_ENABLED=true`. Bypasses verification entirely. Same parsing
 *    rules as the Rust test-auth helper.
 *
 * On failure: 401 with the structured error envelope. Other errors propagate
 * to the central error mapper.
 */

import type { Context, Next } from 'hono';
import { jwtVerify } from 'jose';
import type { Principal } from '@atlas/platform-core';
import type { AppState } from '../bootstrap.ts';
import { errorResponse } from './errors.ts';
import { correlationIdFor } from './correlation.ts';

const DEBUG_PRINCIPAL_HEADER = 'X-Debug-Principal';
const VALID_DEBUG_TYPES = new Set(['user', 'service', 'anonymous']);

export interface ServerVariables {
  state: AppState;
  principal: Principal;
  correlationId: string;
}

function parseDebugPrincipal(
  raw: string,
  defaultTenantId: string,
): Principal | null {
  const parts = raw.split(':');
  if (parts.length !== 2 && parts.length !== 3) return null;
  const typeStr = parts[0]?.toLowerCase() ?? '';
  if (!VALID_DEBUG_TYPES.has(typeStr)) return null;
  const id = parts[1] ?? '';
  if (!id) return null;
  const tenantId = parts.length === 3 ? (parts[2] ?? '') : defaultTenantId;
  if (!tenantId) return null;
  return { principalId: id, tenantId };
}

export function principalMiddleware(state: AppState) {
  return async (
    c: Context<{ Variables: ServerVariables }>,
    next: Next,
  ): Promise<Response | void> => {
    const correlationId = correlationIdFor(c);
    c.set('correlationId', correlationId);
    c.set('state', state);

    // 1. Try X-Debug-Principal first when test-auth is enabled.
    if (state.config.testAuth.enabled) {
      const debugHeader = c.req.header(DEBUG_PRINCIPAL_HEADER);
      if (debugHeader) {
        const debug = parseDebugPrincipal(debugHeader, state.config.tenantId);
        if (!debug) {
          return errorResponse(
            c,
            'UNAUTHORIZED',
            'Invalid X-Debug-Principal header',
            401,
            correlationId,
          );
        }
        c.set('principal', debug);
        await next();
        return;
      }
    }

    // 2. JWT path.
    const authHeader = c.req.header('Authorization') ?? c.req.header('authorization');
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      return errorResponse(
        c,
        'UNAUTHENTICATED',
        'Missing or malformed Authorization header',
        401,
        correlationId,
      );
    }
    const token = authHeader.slice(7).trim();
    if (!token) {
      return errorResponse(
        c,
        'UNAUTHENTICATED',
        'Empty bearer token',
        401,
        correlationId,
      );
    }
    if (!state.jwks) {
      return errorResponse(
        c,
        'UNAUTHENTICATED',
        'Server has no JWKS configured',
        401,
        correlationId,
      );
    }

    let claims: Record<string, unknown>;
    try {
      const { payload } = await jwtVerify(token, state.jwks, {
        audience: state.config.oidc.audience,
        ...(state.config.oidc.issuerUrl ? { issuer: state.config.oidc.issuerUrl } : {}),
      });
      claims = payload as Record<string, unknown>;
    } catch (e) {
      return errorResponse(
        c,
        'UNAUTHENTICATED',
        `JWT verification failed: ${(e as Error).message}`,
        401,
        correlationId,
      );
    }

    const sub = typeof claims['sub'] === 'string' ? claims['sub'] : '';
    if (!sub) {
      return errorResponse(
        c,
        'UNAUTHENTICATED',
        'Token missing sub claim',
        401,
        correlationId,
      );
    }
    const tenantClaim = claims['tenant_id'];
    const tenantId =
      typeof tenantClaim === 'string' && tenantClaim.length > 0
        ? tenantClaim
        : state.config.tenantId;
    c.set('principal', { principalId: sub, tenantId });
    await next();
    return;
  };
}
