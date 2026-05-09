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
 * 2. `X-Debug-Principal: type:id[:tenantId[:role1,role2,...]]` → only
 *    honoured when `TEST_AUTH_ENABLED=true`. Bypasses verification
 *    entirely. The optional fourth segment is a comma-separated list of
 *    role slugs hydrated onto `Principal.roles` so dev/test flows can
 *    drive role-gated routes (e.g. the admin signup queue) without going
 *    through the full Membership lookup. Existing 2- and 3-segment values
 *    keep working — they parse to a principal with an empty roles array.
 *    Same base parsing rules as the Rust test-auth helper.
 *
 * On failure: 401 with the structured error envelope. Other errors propagate
 * to the central error mapper.
 */

import type { Context, Next } from 'hono';
import { jwtVerify } from 'jose';
import type { AtlasExecutionContext, Principal } from '@atlas/platform-core';
import { createRootContext } from '@atlas/logging';
import {
  PostgresEntityStore,
} from '@atlas/adapter-node';
import {
  parseApiKeyBearer,
  getApiKeyEntity,
  getSessionEntity,
  findActiveProviderByIssuer,
  findOAuthTokensByLookup,
  hashSecret,
  lookupOf,
  constantTimeEqual,
  verifyPassword,
  checkSessionLifetime,
  touchSessionLastSeen,
  resolveImpersonationToken,
  type ApiKeyDocument,
  type AuthSessionDocument,
  type IdentityProviderDocument,
  type OAuthAccessTokenDocument,
} from '@atlas/identity';
import { JwksCache } from './jwks-cache.ts';
import type { AppState } from '../bootstrap.ts';
import { ensureTenantMigrated } from '../bootstrap.ts';
import { errorResponse } from './errors.ts';
import { correlationIdFor } from './correlation.ts';
import { resolveHostTenant } from './tenant-resolution.ts';
import { parseSessionCookie } from './cookie.ts';

const DEBUG_PRINCIPAL_HEADER = 'X-Debug-Principal';
const VALID_DEBUG_TYPES = new Set(['user', 'service', 'anonymous']);

/**
 * Validate a tenant id. Mirrors the Rust counterpart `validate_tenant_id`
 * in `crates/ingress/src/authn.rs`. Length capped at 64; must start with
 * an ASCII alphanumeric; subsequent characters limited to alphanumerics,
 * `-`, and `_`.
 *
 * The 8/9/10 architectural audit flagged this as a BLOCKER for
 * production cutover: without validation, a tenant id from an untrusted
 * IdP claim becomes a tenant-injection primitive into cache keys
 * (Invariant I9), search scope (I7), and SQL `WHERE tenant_id = $1`.
 */
const TENANT_ID_FIRST_CHAR = /^[A-Za-z0-9]/;
const TENANT_ID_CHARSET = /^[A-Za-z0-9_-]+$/;

function isValidTenantId(value: string): boolean {
  if (value.length === 0 || value.length > 64) return false;
  if (!TENANT_ID_FIRST_CHAR.test(value)) return false;
  if (!TENANT_ID_CHARSET.test(value)) return false;
  return true;
}

export interface ServerVariables {
  state: AppState;
  principal: Principal;
  correlationId: string;
  /**
   * AtlasExecutionContext for the request. Set by executionContextMiddleware
   * before any downstream middleware runs. Replaced by principalMiddleware
   * once a real principal is resolved (correlationId is preserved across
   * the swap; tenantId is allowed to change on the swap because tenantId
   * is immutable across a SINGLE context's `.with*()` lineage, not across
   * boundary transitions). All log emission in the request path uses
   * `c.var.ctx.logger.<level>(...)`.
   */
  ctx: AtlasExecutionContext;
  /**
   * Tenant id resolved from the request Host header against the
   * `custom_domains` table. `null` when the host is not registered
   * (the common case — most requests come in via subdomain). When set,
   * the auth flow's tenant id MUST agree or the request is rejected
   * with PRINCIPAL_INVALID/403.
   */
  hostTenantId: string | null;
}

/**
 * Build a fresh root context after a real principal is resolved. Preserves
 * correlationId from the previous (anonymous) context so log lines from
 * before / after auth join cleanly. Replaces `c.var.ctx`.
 */
function upgradeContextWithPrincipal(
  c: Context<{ Variables: ServerVariables }>,
  state: AppState,
  principal: Principal,
): void {
  const prior = c.get('ctx');
  const ctxInput: Parameters<typeof createRootContext>[0] = {
    pipeline: state.logPipeline,
    tenantId: principal.tenantId,
    principalId: principal.principalId,
    environment: state.config.environment,
    incomingCorrelationId: prior.correlationId,
  };
  if (prior.requestId !== undefined) ctxInput.requestId = prior.requestId;
  const upgraded = createRootContext(ctxInput);
  c.set('ctx', upgraded);
  upgraded.logger.debug('authentication resolved', {
    event: 'Authn.Resolved',
    properties: {
      roles: principal.roles?.length ?? 0,
    },
  });
}

/**
 * Emit an `Authn.Failed` audit-style log line on the per-request ctx.
 * Safe to call before `upgradeContextWithPrincipal` runs — the anonymous
 * ctx set by `executionContextMiddleware` is always available.
 */
function logAuthnFailed(
  c: Context<{ Variables: ServerVariables }>,
  code: string,
  reason: string,
): void {
  const ctx = c.get('ctx');
  ctx?.logger.info('authentication failed', {
    event: 'Authn.Failed',
    properties: { code, reason },
  });
}

function parseDebugPrincipal(
  raw: string,
  defaultTenantId: string,
): Principal | null {
  const parts = raw.split(':');
  if (parts.length < 2 || parts.length > 4) return null;
  const typeStr = parts[0]?.toLowerCase() ?? '';
  if (!VALID_DEBUG_TYPES.has(typeStr)) return null;
  const id = parts[1] ?? '';
  if (!id) return null;
  const tenantId = parts.length >= 3 ? (parts[2] ?? '') : defaultTenantId;
  if (!isValidTenantId(tenantId)) return null;
  // Optional 4th segment: comma-separated role slugs. Empty string and
  // missing segment both yield an empty roles array. Empty entries
  // (e.g. trailing comma) are filtered so `:admin,` parses cleanly.
  let roles: string[] = [];
  if (parts.length === 4) {
    const roleSegment = parts[3] ?? '';
    roles = roleSegment
      .split(',')
      .map((r) => r.trim())
      .filter((r) => r.length > 0);
  }
  return { principalId: id, tenantId, roles };
}

/**
 * Process-wide JWKS cache. One instance shared across all requests —
 * the cache is keyed by (tenantId, idpId), so cross-tenant entries
 * coexist without collision. See `jwks-cache.ts`.
 */
const jwksCache = new JwksCache();

/**
 * Decode a JWT's `iss` claim WITHOUT verifying the signature. We need
 * the issuer to find the right IdP before we can verify. Standard
 * pattern — the verify step still rejects if the iss doesn't match
 * the IdP's stored issuer, so this can't be exploited.
 */
function jwtUnverifiedIssuer(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1]!, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    return typeof payload['iss'] === 'string' ? (payload['iss'] as string) : null;
  } catch {
    return null;
  }
}

/**
 * Try the three bearer-token schemes in order: ApiKey → AuthSession
 * access token → OAuth access token. Returns:
 *   - a `Principal` on success
 *   - `null` if no scheme could be tried (no Authorization header, or
 *     none of the prefix detectors matched) — caller falls back to
 *     JWT or rejects
 *   - `'fail-with-error'` if a scheme matched but the credential is
 *     bad — the function has already written the error response.
 *
 * Tenant id resolution: schemes that key off an entity row need the
 * tenant context. ApiKey + Session + OAuth tokens are tenant-scoped,
 * so we use the host-resolved tenant id (custom-domains stub) or the
 * configured default. Mismatch with the row's `tenantId` is treated
 * as "wrong scheme" so we fall through.
 */
async function tryBearerSchemes(
  c: Context<{ Variables: ServerVariables }>,
  state: AppState,
  correlationId: string,
): Promise<Principal | null | 'fail-with-error'> {
  const authHeader = c.req.header('Authorization') ?? c.req.header('authorization');
  const cookieHeader = c.req.header('cookie');
  // Try the access-token from `Authorization: Bearer ...` if present;
  // otherwise the cookie's refresh-secret can authorize ONLY for
  // /refresh and /logout routes (handled separately).
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    // No bearer header. The cookie alone isn't sufficient for authed
    // routes — fall through to JWT (which will reject if also absent).
    return null;
  }
  const token = authHeader.slice(7).trim();
  if (!token) return null;

  const tenantId = c.get('hostTenantId') ?? state.config.tenantId ?? null;
  if (!tenantId) return null;

  // Resolve the per-tenant entity store ONCE; all three schemes share it.
  let entities: PostgresEntityStore;
  try {
    const sql = await ensureTenantMigrated(state, tenantId);
    entities = new PostgresEntityStore(sql);
  } catch {
    // Tenant unknown / migration error — treat as JWT-fallback.
    return null;
  }

  // (a) ApiKey: `atlas_<keyId>_<secret>`.
  if (token.startsWith('atlas_')) {
    const parsed = parseApiKeyBearer(token);
    if (!parsed) {
      errorResponse(c, 'API_KEY_MALFORMED', 'malformed API key', 401, correlationId);
      return 'fail-with-error';
    }
    const apiKey: ApiKeyDocument | null = await getApiKeyEntity(
      entities,
      tenantId,
      parsed.keyId,
    );
    if (!apiKey) {
      errorResponse(c, 'API_KEY_NOT_FOUND', 'unknown API key', 401, correlationId);
      return 'fail-with-error';
    }
    const now = Date.now();
    const validStatus =
      apiKey.status === 'active' ||
      (apiKey.status === 'rotated' &&
        apiKey.rotationOverlapUntil &&
        new Date(apiKey.rotationOverlapUntil).getTime() > now);
    if (!validStatus) {
      errorResponse(c, 'API_KEY_REVOKED', 'API key not valid', 401, correlationId);
      return 'fail-with-error';
    }
    if (apiKey.expiresAt && new Date(apiKey.expiresAt).getTime() <= now) {
      errorResponse(c, 'API_KEY_EXPIRED', 'API key expired', 401, correlationId);
      return 'fail-with-error';
    }
    const ok = await verifyPassword(parsed.secret, apiKey.secretHash);
    if (!ok) {
      errorResponse(c, 'API_KEY_NOT_FOUND', 'unknown API key', 401, correlationId);
      return 'fail-with-error';
    }
    return {
      principalId: apiKey.userId ?? apiKey.servicePrincipalId ?? apiKey.keyId,
      tenantId,
      attributes: { apiKeyId: apiKey.keyId, scopes: apiKey.scopes },
    };
  }

  // (b) Impersonation bearer: `imp-<impersonationId>.<secret>`.
  //     Resolved against the TARGET tenant's entity store. The principal
  //     becomes the IMPERSONATED user (so authz/RBAC/policy evaluation
  //     runs as if the target was acting), but `attributes.impersonatedBy`
  //     and `attributes.impersonationId` are stamped so audit events can
  //     record the operator. `attributes.readonlyResourceTypes` propagates
  //     the impersonation's mutation veto to the action dispatch.
  //
  //     SECURITY: uniform 401 on every failure path (malformed / not
  //     found / hash mismatch / expired / revoked / ended) — no timing
  //     or message side-channel for token enumeration.
  if (token.startsWith('imp-')) {
    const resolved = await resolveImpersonationToken(entities, tenantId, token);
    if (!resolved.ok) {
      errorResponse(
        c,
        'IMPERSONATION_NOT_FOUND',
        'impersonation token invalid',
        401,
        correlationId,
      );
      return 'fail-with-error';
    }
    const doc = resolved.document;
    return {
      principalId: doc.targetUserId,
      tenantId,
      userId: doc.targetUserId,
      attributes: {
        impersonatedBy: doc.operatorId,
        impersonationId: doc.impersonationId,
        ...(doc.readonlyResourceTypes !== undefined
          ? { readonlyResourceTypes: doc.readonlyResourceTypes }
          : {}),
      },
    };
  }

  // (c) AuthSession access token. Lookup by hash prefix; constant-time
  // hash compare.
  const sessionPrincipal = await tryAccessToken(c, entities, tenantId, token);
  if (sessionPrincipal) return sessionPrincipal;

  // (d) OAuth access token. Same opaque-token shape, different entity.
  const oauthPrincipal = await tryOAuthToken(entities, tenantId, token);
  if (oauthPrincipal) return oauthPrincipal;

  // None of the opaque-token schemes matched → fall through to JWT.
  return null;
}

async function tryAccessToken(
  c: Context<{ Variables: ServerVariables }>,
  entities: PostgresEntityStore,
  tenantId: string,
  token: string,
): Promise<Principal | null> {
  const presentedHash = hashSecret(token);
  const lookup = lookupOf(token);
  // Scan the lookup bucket. The index makes this O(bucket size).
  const candidates = await (entities as unknown as {
    query: <T>(t: string, type: string, opts: { attrsEqual: Record<string, unknown> }) => Promise<{ attrs: T }[]>;
  }).query<AuthSessionDocument>(tenantId, 'AuthSession', {
    attrsEqual: { accessTokenLookup: lookup },
  });
  for (const row of candidates) {
    if (!constantTimeEqual(row.attrs.accessTokenHash, presentedHash)) continue;
    const session = row.attrs;
    if (new Date(session.accessExpiresAt).getTime() <= Date.now()) {
      // Access token expired. Don't return null/auth-fail — the route
      // path expects 401 with a clear code. We let it fall through to
      // JWT scheme below; that scheme will reject with PRINCIPAL_INVALID.
      // A future refinement: return SESSION_EXPIRED here.
      continue;
    }
    const lifetime = checkSessionLifetime(session);
    if (!lifetime.ok) continue;
    // Touch lastSeenAt — keeps idle-timeout alive while the user is
    // active. Best-effort: a failure here doesn't block the request.
    try {
      await touchSessionLastSeen(entities, session);
    } catch {
      // Swallow — see comment.
    }
    void c; // reserved for future surfacing
    return {
      principalId: session.userId,
      tenantId,
      userId: session.userId,
      attributes: { sessionId: session.sessionId },
    };
  }
  return null;
}

async function tryOAuthToken(
  entities: PostgresEntityStore,
  tenantId: string,
  token: string,
): Promise<Principal | null> {
  const presentedHash = hashSecret(token);
  const lookup = lookupOf(token);
  const candidates: OAuthAccessTokenDocument[] = await findOAuthTokensByLookup(
    entities,
    tenantId,
    lookup,
  );
  for (const t of candidates) {
    if (!constantTimeEqual(t.secretHash, presentedHash)) continue;
    if (t.status !== 'active') continue;
    if (new Date(t.expiresAt).getTime() <= Date.now()) continue;
    return {
      principalId: t.servicePrincipalId || t.apiKeyId,
      tenantId,
      attributes: {
        apiKeyId: t.apiKeyId,
        oauthTokenId: t.tokenId,
        scopes: t.scopes,
      },
    };
  }
  return null;
}

export function principalMiddleware(state: AppState) {
  return async (
    c: Context<{ Variables: ServerVariables }>,
    next: Next,
  ): Promise<Response | void> => {
    const correlationId = correlationIdFor(c);
    c.set('correlationId', correlationId);
    c.set('state', state);

    // 0. Custom-domain resolution. If the Host header is registered in
    //    `control_plane.custom_domains` (active row), stash the
    //    associated tenant id on the context so the auth path can
    //    cross-check it. A mismatch with the JWT/debug `tenantId` is
    //    rejected below as PRINCIPAL_INVALID/403.
    //
    //    No-match is the common case (subdomain / unrecognized host) —
    //    we silently fall through. See
    //    `specs/domains/tenancy/capabilities/custom-domains/README.md`.
    const hostTenantId = await resolveHostTenant(
      c.req.header('host'),
      state.customDomains,
      state.customDomainCache,
    );
    c.set('hostTenantId', hostTenantId);

    // 1. Cookie session — only used when the request didn't ALSO bring
    //    a bearer token. Browser flows usually carry both (cookie for
    //    refresh, access token in Authorization header) — bearer wins
    //    in that case. This branch handles routes that the SPA hits
    //    without a fresh access token (e.g. an XHR right after a
    //    refresh response landed but before the in-memory access token
    //    was updated).
    const bearerPresent =
      !!(c.req.header('Authorization') ?? c.req.header('authorization'));
    if (!bearerPresent) {
      const cookie = parseSessionCookie(c.req.header('cookie'));
      if (cookie) {
        const tenantId = hostTenantId ?? state.config.tenantId ?? null;
        if (tenantId) {
          try {
            const sql = await ensureTenantMigrated(state, tenantId);
            const entities = new PostgresEntityStore(sql);
            const session = await getSessionEntity(
              entities,
              tenantId,
              cookie.sessionId,
            );
            if (session) {
              const presented = hashSecret(cookie.refreshSecret);
              if (constantTimeEqual(session.refreshTokenHash, presented)) {
                const lifetime = checkSessionLifetime(session);
                if (lifetime.ok) {
                  // Best-effort touch — same pattern as bearer path.
                  try {
                    await touchSessionLastSeen(entities, session);
                  } catch {
                    // ignore
                  }
                  const sessionPrincipal: Principal = {
                    principalId: session.userId,
                    tenantId,
                    userId: session.userId,
                    attributes: { sessionId: session.sessionId },
                  };
                  c.set('principal', sessionPrincipal);
                  upgradeContextWithPrincipal(c, state, sessionPrincipal);
                  await next();
                  return;
                }
              }
            }
          } catch {
            // tenant resolution / DB error — fall through to other schemes.
          }
        }
      }
    }

    // 2. X-Debug-Principal — test-auth shortcut.
    if (state.config.testAuth.enabled) {
      const debugHeader = c.req.header(DEBUG_PRINCIPAL_HEADER);
      if (debugHeader) {
        const debug = parseDebugPrincipal(debugHeader, state.config.tenantId);
        if (!debug) {
          // Rust counterpart: AuthnError::malformed → 400 BAD_REQUEST. Code is
          // PRINCIPAL_INVALID because the spec-taxonomy AUTHN bucket has no
          // dedicated "malformed test-auth header" entry; collapsing here.
          logAuthnFailed(c, 'PRINCIPAL_INVALID', 'debug-principal-malformed');
          return errorResponse(
            c,
            'PRINCIPAL_INVALID',
            'Invalid X-Debug-Principal header',
            400,
            correlationId,
          );
        }
        if (hostTenantId !== null && hostTenantId !== debug.tenantId) {
          // Host says tenantA, debug principal claims tenantB → reject.
          // Prevents "log in to tenantA, browse to a custom-branded URL
          // owned by tenantB to trigger tenantB-side actions".
          logAuthnFailed(c, 'PRINCIPAL_INVALID', 'debug-principal-host-tenant-mismatch');
          return errorResponse(
            c,
            'PRINCIPAL_INVALID',
            'Tenant scope mismatch between Host and X-Debug-Principal',
            403,
            correlationId,
          );
        }
        c.set('principal', debug);
        upgradeContextWithPrincipal(c, state, debug);
        await next();
        return;
      }
    }

    // 3. Bearer Authorization — three sub-schemes detected by prefix.
    //    a) `atlas_<keyId>_<secret>` → ApiKey
    //    b) JWT (three dot-separated base64url segments)         → JWT
    //    c) anything else (opaque)                               → AuthSession access OR OAuth token
    //
    //    The schemes are tried in order; a mismatch falls through
    //    rather than rejecting outright so we don't lock out a
    //    legitimate JWT just because someone fat-fingered a key.

    const bearerPrincipal = await tryBearerSchemes(c, state, correlationId);
    if (bearerPrincipal === 'fail-with-error') return; // already responded
    if (bearerPrincipal) {
      c.set('principal', bearerPrincipal);
      upgradeContextWithPrincipal(c, state, bearerPrincipal);
      await next();
      return;
    }

    // 4. JWT path (fallback).
    // Rust counterpart: authn_middleware in crates/ingress/src/authn.rs returns
    // 401 with a non-structured `{error: "unauthorized"}` body for every authn
    // failure (missing creds, malformed JWT, signature/audience/expiry, missing
    // sub claim). We collapse all of those into PRINCIPAL_INVALID/401 to keep
    // a structured envelope while staying behaviourally aligned with Rust.
    const authHeader = c.req.header('Authorization') ?? c.req.header('authorization');
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      logAuthnFailed(c, 'PRINCIPAL_INVALID', 'missing-or-malformed-authorization-header');
      return errorResponse(
        c,
        'PRINCIPAL_INVALID',
        'Missing or malformed Authorization header',
        401,
        correlationId,
      );
    }
    const token = authHeader.slice(7).trim();
    if (!token) {
      logAuthnFailed(c, 'PRINCIPAL_INVALID', 'empty-bearer-token');
      return errorResponse(
        c,
        'PRINCIPAL_INVALID',
        'Empty bearer token',
        401,
        correlationId,
      );
    }
    // Phase A3: per-tenant IDP-driven JWT validation.
    //
    // Resolution order:
    //   1. Read the JWT's `iss` claim (UNVERIFIED) to pick the right
    //      IdentityProvider.
    //   2. Look up an active IDP in the request tenant whose
    //      `issuer` matches.
    //   3. Verify the JWT against THAT IDP's JWKS, with
    //      audience=idp.audience.
    //   4. If no IDP matches AND the deployment has a global
    //      `OIDC_ISSUER_URL` configured (legacy path), fall back to
    //      that — keeps existing single-tenant deployments working
    //      during the per-tenant rollout.
    //
    // `iss` mismatch with the IDP row OR JWKS verification failure
    // both surface as PRINCIPAL_INVALID/401 (Rust parity).
    const claimedIssuer = jwtUnverifiedIssuer(token);
    let claims: Record<string, unknown> | null = null;
    let resolvedAudience: string | undefined;
    let resolvedTenantId: string | null = null;

    if (claimedIssuer && hostTenantId) {
      try {
        const sql = await ensureTenantMigrated(state, hostTenantId);
        const entities = new PostgresEntityStore(sql);
        const idp: IdentityProviderDocument | null =
          await findActiveProviderByIssuer(entities, hostTenantId, claimedIssuer);
        if (idp && idp.jwksUri) {
          resolvedTenantId = hostTenantId;
          resolvedAudience = idp.audience;
          const jwks = jwksCache.resolve(hostTenantId, idp.idpId, idp.jwksUri);
          try {
            const { payload } = await jwtVerify(token, jwks, {
              audience: idp.audience,
              issuer: idp.issuer,
            });
            claims = payload as Record<string, unknown>;
          } catch (e) {
            // On `kid` miss, force one refetch (rate-limited inside
            // the cache) and retry. Other failures bubble out.
            const errStr = (e as Error).message;
            if (errStr.includes('kid') || errStr.includes('no applicable key')) {
              const refetched = jwksCache.resolve(
                hostTenantId,
                idp.idpId,
                idp.jwksUri,
                { forceRefetch: true },
              );
              try {
                const { payload } = await jwtVerify(token, refetched, {
                  audience: idp.audience,
                  issuer: idp.issuer,
                });
                claims = payload as Record<string, unknown>;
              } catch {
                return errorResponse(
                  c,
                  'PRINCIPAL_INVALID',
                  `JWT verification failed after JWKS refresh: ${errStr}`,
                  401,
                  correlationId,
                );
              }
            } else {
              return errorResponse(
                c,
                'PRINCIPAL_INVALID',
                `JWT verification failed: ${errStr}`,
                401,
                correlationId,
              );
            }
          }
        }
      } catch {
        // Tenant resolution / DB error — fall through to global JWKS.
      }
    }

    // Legacy fallback: global JWKS configured at boot via
    // `OIDC_ISSUER_URL` + `OIDC_JWKS_URL`. Only used when no
    // per-tenant IDP matched the JWT issuer. Pre-A3 single-tenant
    // deployments rely on this; deployments that have moved every
    // tenant to a per-tenant IDP can leave the global config unset
    // and reject any JWT whose `iss` doesn't match a configured IDP.
    if (!claims) {
      if (!state.jwks || !state.config.oidc.issuerUrl) {
        return errorResponse(
          c,
          'PRINCIPAL_INVALID',
          claimedIssuer
            ? `no IdentityProvider for issuer ${claimedIssuer}`
            : 'Token missing iss claim',
          401,
          correlationId,
        );
      }
      try {
        const { payload } = await jwtVerify(token, state.jwks, {
          audience: state.config.oidc.audience,
          issuer: state.config.oidc.issuerUrl,
        });
        claims = payload as Record<string, unknown>;
        resolvedAudience = state.config.oidc.audience;
      } catch (e) {
        return errorResponse(
          c,
          'PRINCIPAL_INVALID',
          `JWT verification failed: ${(e as Error).message}`,
          401,
          correlationId,
        );
      }
    }
    void resolvedAudience;
    void resolvedTenantId;

    const sub = typeof claims['sub'] === 'string' ? claims['sub'] : '';
    if (!sub) {
      return errorResponse(
        c,
        'PRINCIPAL_INVALID',
        'Token missing sub claim',
        401,
        correlationId,
      );
    }
    const tenantClaim = claims['tenant_id'];
    const candidateTenant =
      typeof tenantClaim === 'string' && tenantClaim.length > 0
        ? tenantClaim
        : state.config.tenantId;
    if (hostTenantId !== null && hostTenantId !== candidateTenant) {
      return errorResponse(
        c,
        'PRINCIPAL_INVALID',
        'Tenant scope mismatch between Host and JWT tenant_id claim',
        403,
        correlationId,
      );
    }
    if (!isValidTenantId(candidateTenant)) {
      // Reject malformed tenant ids from any source — JWT claim or
      // configured default. The downstream invariants (I7, I9, SQL
      // tenant scope) all assume the value is a well-formed identifier.
      return errorResponse(
        c,
        'PRINCIPAL_INVALID',
        'Invalid tenant_id claim',
        401,
        correlationId,
      );
    }
    const jwtPrincipal: Principal = { principalId: sub, tenantId: candidateTenant };
    c.set('principal', jwtPrincipal);
    upgradeContextWithPrincipal(c, state, jwtPrincipal);
    await next();
    return;
  };
}
