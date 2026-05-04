# Authentication

This document describes the **implemented** authentication system in
TypeScript (the Hono server in `apps/server` and the identity module in
`modules/identity`). Treat it as the source of truth for runtime behavior.
Upcoming methods (OIDC code flow, magic-link, MFA, WebAuthn, SAML) are
listed at the bottom under "Not yet implemented."

## Invariants

**A1 — Single Authentication Point.**
- All external requests enter through `apps/server` (Invariant **I1**).
- Authentication runs exactly once, in `principalMiddleware`
  (`apps/server/src/middleware/principal.ts`).
- No business logic executes before the principal is resolved.

**A2 — Principal Required for Protected Routes.**
- Every request to a protected route MUST have a valid `Principal`.
- Requests without valid authentication receive `401`.
- Public routes (`/health`, `/metrics`) are exempt.

## Trust Boundaries

**Server (`apps/server`).** Only external entry point. Owns credential
validation. Constructs the canonical `Principal` and attaches it to the
Hono context.

**Modules.** Trust the `Principal` provided by the server; never re-parse
raw credentials, never make their own HTTP/network calls. Receive the
principal via `IntentHandlerContext.principalId`.

## Principal Model

Defined in `packages/platform-core/src/types.ts`:

```ts
export interface Principal {
  principalId: string;
  tenantId: string;
  userId?: string;     // set when JWT/session resolves to a User entity
  attributes?: Record<string, unknown>;
}
```

`attributes` carries scheme-specific context: `sessionId` for cookie
sessions, `apiKeyId` and `scopes` for API keys, `oauthTokenId` for OAuth
access tokens.

## Tenant Resolution

`principalMiddleware` resolves `tenantId` in the following order
(first match wins):

1. **`Host` header** matches a row in `control_plane.custom_domains`
   (cached). On match, the host's tenant id is the authoritative source;
   any JWT/debug `tenantId` that disagrees is rejected as
   `PRINCIPAL_INVALID` / 403.
2. **Bearer / cookie scheme tenant.** API keys, sessions, and OAuth
   tokens are tenant-scoped entities; the row's own `tenantId` is used.
3. **JWT `tenant_id` claim.**
4. **`X-Debug-Principal` third segment** (test-auth mode only).
5. **`TENANT_ID` env var** (dev convenience, forbidden in `strict` mode).

A tenant id MUST start with `[A-Za-z0-9]`, contain only `[A-Za-z0-9_-]`,
and be ≤ 64 characters. Failed validation → `400`.

## Authentication Methods — Implemented

### 1. Cookie session (browser SPA flow)

Cookie value: `<sessionId>.<refreshSecret>`. The refresh secret is
256-bit, base64url-encoded; only its SHA-256 hash and an 8-hex lookup
prefix live in the entity row.

On every request with a cookie:
- `parseSessionCookie` extracts `sessionId` + `refreshSecret`
- `getSessionEntity` loads the `AuthSession` row, scoped by tenant
- `constantTimeEqual` compares hashes
- `checkSessionLifetime` enforces both idle + hard timeouts
- `touchSessionLastSeen` updates `lastSeenAt` (best-effort, non-blocking)

When a bearer token is also present, the bearer path wins (browser flows
typically carry both — cookie for refresh, access token in
`Authorization`).

Implementation: `apps/server/src/middleware/principal.ts:300-348`.

### 2. Session access token (bearer)

`Authorization: Bearer <opaqueToken>`. The token's lookup prefix
narrows the candidate set; constant-time hash compare confirms the
match. Expired access tokens skip to the next scheme.

Implementation: `tryAccessToken` in `principal.ts:202-244`.

### 3. API key (bearer)

Format: `atlas_<keyId>_<secret>`. `parseApiKeyBearer` splits the three
fields; `getApiKeyEntity` loads the row; `verifyPassword` (Argon2id)
compares the secret. Status (`active` / `rotated` with overlap window /
`revoked`) and `expiresAt` are enforced.

Implementation: `principal.ts:148-187`.

### 4. OAuth access token (bearer)

RFC 6749 client_credentials grant. Tokens are issued via dedicated
`/oauth/token` and revoked via `/oauth/revoke` routes (the wire shape is
RFC 6749, not the Atlas intent envelope). Validation mirrors session
access tokens but reads the `OAuthAccessToken` entity.

Issuer handlers (direct exports, **not** in the intent registry):
`oauthIssueToken`, `oauthRevokeToken` in `modules/identity/src/index.ts`.

Implementation: `tryOAuthToken` in `principal.ts:246-273`.

### 5. JWT bearer (OIDC platform IdP)

`Authorization: Bearer <jwt>` validated via `jose.jwtVerify` against the
JWKS at `OIDC_JWKS_URL` / `OIDC_ISSUER_URL`. Audience-checked.
`principalId` from `sub`; `tenantId` from a `tenant_id` claim if present
(else falls back to host/default).

The OIDC integration today supports the **platform IdP** only — a
single configured issuer. **Per-tenant federated OIDC** (where each
tenant configures its own IdP) is on the A3 roadmap.

### 6. Debug principal (test mode)

Header: `X-Debug-Principal: <type>:<id>[:<tenantId>]`. Honoured **only**
when `TEST_AUTH_ENABLED=true`. Ignored otherwise. Never enable in prod.

Implementation: `parseDebugPrincipal` in `principal.ts:85-98`.

## Routes Classification

**Public:**
- `GET /health` — liveness/readiness
- `GET /metrics` — Prometheus

**Protected:** all other routes, including `POST /api/v1/intents`.

## Error Model

| Code | HTTP | Meaning |
|---|---|---|
| `PRINCIPAL_REQUIRED` | 401 | No valid credential found |
| `PRINCIPAL_INVALID` | 401 / 403 | Credential bad, tenant mismatch, host/JWT disagree |
| `API_KEY_MALFORMED` | 401 | `atlas_*` parse failure |
| `API_KEY_NOT_FOUND` | 401 | Unknown / wrong-secret API key |
| `API_KEY_REVOKED` | 401 | API key not active |
| `API_KEY_EXPIRED` | 401 | API key past `expiresAt` |
| `TENANT_INVALID` | 400 | Tenant id failed validation |

Error responses do not leak internal details. The above codes are
internal — see `errors.md` for the public taxonomy mapping. The A2
hardening pass (in flight) collapses session-validation codes
(`SESSION_NOT_FOUND` / `_REVOKED` / `_EXPIRED`) into a single
`SESSION_INVALID` at the HTTP boundary to remove the user-enumeration
oracle.

## Logging

**Success (INFO):** `principalId`, `tenantId`, `correlationId`, scheme.
**Failure (WARN):** category-only `reason`, `correlationId`. Never log
plaintext tokens or hashes.

## Configuration

| Env var | Purpose |
|---|---|
| `OIDC_ISSUER_URL` / `OIDC_JWKS_URL` | Platform-IdP JWT validation |
| `TEST_AUTH_ENABLED` | Allow `X-Debug-Principal` (never in prod) |
| `TENANT_ID` | Fallback tenant id (forbidden in `strict` mode) |
| `INGRESS_PORT` | HTTP port (default 3000) |

## Authentication Flow

```
Request
  └─ principalMiddleware
       ├─ resolve correlationId
       ├─ resolve hostTenantId (custom-domains lookup, cached)
       ├─ if cookie && no bearer → try cookie-session path
       ├─ if Authorization: Bearer …
       │    ├─ atlas_*  → API key path
       │    ├─ opaque    → AuthSession access token path
       │    └─ opaque    → OAuth access token path
       │    └─ JWT       → jose.jwtVerify against JWKS
       ├─ X-Debug-Principal (test mode only)
       └─ on success: c.set('principal', …); next()
          on failure: 401 with structured error envelope
```

## Not Yet Implemented

| Capability | Phase | Notes |
|---|---|---|
| Per-tenant federated OIDC | A3 | Today: single platform IdP only |
| OIDC code flow with PKCE | A3 | Today: bearer-validation only |
| Magic-link login | A3 | Distinct from invite-redemption (which is implemented) |
| Password reset issue/redeem | A3 | `password-set.ts` is the primitive; reset-token handler missing |
| Principal enforcement on suspended / no-membership | A3 | Today: status fields exist, not enforced at auth |
| SCIM 2.0 provisioning | A4 | |
| TOTP MFA + recovery codes | A5 | `AuthFactor` entity TBD |
| WebAuthn / passkeys | A6 | `@simplewebauthn/server` integration TBD |
| Risk engine signals | A7 | Anomaly detection beyond refresh-reuse |
| SAML 2.0 | A8 | |

## Open Questions

- Per-tenant JWKS endpoint structure (config row vs IdP-discovery).
- Should refresh cookies move to a `Secure; HttpOnly; SameSite=Strict`
  scheme that excludes `sessionId` from the value? (See A2-hardening.)
- IP allowlisting for service principals — defer to risk engine?
