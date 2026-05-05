/**
 * SCIM bearer auth middleware (Phase A4.3).
 *
 * Validates `Authorization: Bearer <secret>` against the tenant's
 * `ScimToken` entity. Separate from the main principal middleware
 * because:
 *   - SCIM responses use the RFC 7644 §3.12 error envelope
 *     (`urn:ietf:params:scim:api:messages:2.0:Error` JSON shape)
 *     — distinct from the Atlas standard error envelope.
 *   - SCIM requests don't establish a User session; the Principal
 *     attached to the request is a pseudo-principal whose
 *     `principalId` is the SCIM token id.
 *
 * Tenant resolution: pulls from the host header (custom-domains
 * stub) or `?tenant_id=...` query param. SCIM connectors typically
 * configure a per-tenant URL so the host is the natural source.
 */

import type { Context, Next } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import {
  PostgresEntityStore,
} from '@atlas/adapter-node';
import {
  findScimTokensByLookup,
  hashSecret,
  lookupOf,
  verifyPassword,
  type ScimTokenDocument,
} from '@atlas/identity';
import type { Principal } from '@atlas/platform-core';
import type { AppState } from '../bootstrap.ts';
import { ensureTenantMigrated } from '../bootstrap.ts';
import { correlationIdFor } from './correlation.ts';
import { resolveHostTenant } from './tenant-resolution.ts';
import type { ServerVariables } from './principal.ts';

/**
 * RFC 7644 error response shape. `scimType` is set when the spec
 * defines a structured sub-code; otherwise omitted.
 */
function scimError(
  c: Context<{ Variables: ServerVariables }>,
  status: number,
  detail: string,
  scimType?: string,
): Response {
  const body: Record<string, unknown> = {
    schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
    status: String(status),
    detail,
  };
  if (scimType) body['scimType'] = scimType;
  return c.json(body, status as ContentfulStatusCode);
}

export const SCIM_RESPONSE_HEADERS = {
  'content-type': 'application/scim+json',
} as const;

/**
 * Returns the validated SCIM bearer auth result, or `null` if no
 * valid token was presented (caller responds with 401).
 */
async function validateScimBearer(
  c: Context<{ Variables: ServerVariables }>,
  state: AppState,
): Promise<{ tenantId: string; token: ScimTokenDocument } | null> {
  const authHeader = c.req.header('Authorization') ?? c.req.header('authorization');
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    return null;
  }
  const presented = authHeader.slice(7).trim();
  if (!presented) return null;

  const hostTenantId = await resolveHostTenant(
    c.req.header('host'),
    state.customDomains,
    state.customDomainCache,
  );
  const tenantId =
    hostTenantId ?? c.req.query('tenant_id') ?? state.config.tenantId ?? null;
  if (!tenantId) return null;

  let entities: PostgresEntityStore;
  try {
    const sql = await ensureTenantMigrated(state, tenantId);
    entities = new PostgresEntityStore(sql);
  } catch {
    return null;
  }

  const candidates = await findScimTokensByLookup(
    entities,
    tenantId,
    lookupOf(presented),
  );
  // Constant-time compare: verifyPassword is Argon2id; the per-bucket
  // candidate count is small (<10 typically) so the wall-clock cost
  // is bounded.
  void hashSecret; // imported for parity with other middlewares
  const now = Date.now();
  for (const t of candidates) {
    const validStatus =
      t.status === 'active' ||
      (t.status === 'rotated' &&
        t.rotationOverlapUntil &&
        new Date(t.rotationOverlapUntil).getTime() > now);
    if (!validStatus) continue;
    if (t.expiresAt && new Date(t.expiresAt).getTime() <= now) continue;
    if (await verifyPassword(presented, t.secretHash)) {
      return { tenantId, token: t };
    }
  }
  return null;
}

/**
 * SCIM auth middleware. Mounted on the SCIM route group only — DOES
 * NOT chain with the standard `principalMiddleware` (the SCIM error
 * envelope is incompatible with the Atlas one).
 */
export function scimAuthMiddleware(state: AppState) {
  return async (
    c: Context<{ Variables: ServerVariables }>,
    next: Next,
  ): Promise<Response | void> => {
    const correlationId = correlationIdFor(c);
    c.set('correlationId', correlationId);
    c.set('state', state);

    const result = await validateScimBearer(c, state);
    if (!result) {
      return scimError(c, 401, 'invalid or missing SCIM bearer token');
    }
    // Attach a pseudo-principal so the route layer + audit hooks see
    // a stable identity. `principalId` is the SCIM token id —
    // distinguishable from User principals by the `scimtok-` prefix.
    const principal: Principal = {
      principalId: result.token.tokenId,
      tenantId: result.tenantId,
      attributes: { scim: true, scimTokenId: result.token.tokenId },
    };
    c.set('principal', principal);
    await next();
    return;
  };
}

export { scimError };
