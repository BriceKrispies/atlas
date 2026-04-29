/**
 * Keycloak parity in node mode.
 *
 * Mirrors the three Rust scenarios in
 * `tests/blackbox/suites/authentication_test.rs`:
 *
 *   - `test_keycloak_is_reachable` — OIDC discovery returns 200 with the
 *     expected issuer claim.
 *   - `test_valid_keycloak_token_returns_200_with_principal` (renamed here
 *     to `test_valid_keycloak_token_grants_access`) — a real
 *     `client_credentials` token from the baked `atlas-s2s` client passes
 *     ingress JWT verification end-to-end.
 *   - `test_valid_token_extracts_correct_principal` (renamed here to
 *     `test_valid_keycloak_token_principal_extraction`) — `apps/server`'s
 *     JWT middleware lifts the `tenant_id` claim that the realm export
 *     pre-bakes for the `atlas-s2s` service-account user.
 *
 * Skip gates:
 *   - `KEYCLOAK_BASE_URL` must point at a running Keycloak (mirrors the
 *     Rust harness `KEYCLOAK_BASE_URL` env var). The `atlas itest`
 *     supervisor exports it; standalone runs need to set it manually
 *     (e.g. `KEYCLOAK_BASE_URL=http://localhost:8081`).
 *   - `NODE_PARITY_BASE_URL` must point at a running `apps/server` for
 *     the two scenarios that hit the server. The first scenario is
 *     Keycloak-only and runs without it.
 *
 * Both gates skip describe-level so CI without the itest stack stays
 * green and the parity scoreboard counts these as covered-but-skipped
 * exactly the way `NODE_PARITY_BASE_URL` already gates the rest of the
 * `*-node.test.ts` files.
 */

import { describe, test, expect } from 'vitest';

const keycloakBaseUrl = process.env['KEYCLOAK_BASE_URL'];
const serverBaseUrl = process.env['NODE_PARITY_BASE_URL'];

// Realm + client are baked into the realm export at
// infra/compose/config/keycloak/atlas-realm.json. Override env vars only
// if you ship a different export (e.g. a CI-managed realm).
const REALM = process.env['KEYCLOAK_REALM'] ?? 'atlas';
const CLIENT_ID = process.env['KEYCLOAK_CLIENT_ID'] ?? 'atlas-s2s';
const CLIENT_SECRET =
  process.env['KEYCLOAK_CLIENT_SECRET'] ??
  // The realm export ships this as the dev secret. Treat it as
  // dev-only — production deployments should never reuse it.
  'sQgPBnIo4TyopWfovMHhq6PaMEALlFt0';

interface DiscoveryDoc {
  issuer: string;
  token_endpoint: string;
  jwks_uri: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

async function fetchDiscovery(): Promise<{
  status: number;
  body: DiscoveryDoc;
}> {
  const url = `${keycloakBaseUrl}/realms/${REALM}/.well-known/openid-configuration`;
  const res = await fetch(url, { method: 'GET' });
  const body = (await res.json()) as DiscoveryDoc;
  return { status: res.status, body };
}

async function mintClientCredentialsToken(): Promise<TokenResponse> {
  const url = `${keycloakBaseUrl}/realms/${REALM}/protocol/openid-connect/token`;
  const form = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token mint failed (${res.status}): ${text}`);
  }
  return (await res.json()) as TokenResponse;
}

const dKeycloak = keycloakBaseUrl ? describe : describe.skip;

dKeycloak('[node] keycloak parity', () => {
  test('test_keycloak_is_reachable', async () => {
    const { status, body } = await fetchDiscovery();
    expect(status).toBe(200);
    // The Rust counterpart asserts the issuer references both the host
    // (localhost:8081) and the realm name. We assert against the configured
    // base URL + realm so non-default deployments still match.
    expect(body.issuer).toContain(REALM);
    // The discovery doc must echo the same base URL the test agreed to
    // use — otherwise tokens minted via this endpoint will fail issuer
    // verification at the server side.
    const u = new URL(body.issuer);
    const configured = new URL(keycloakBaseUrl as string);
    // Compare host:port; protocol may differ between dev (http) and
    // production (https) and is not a parity concern here.
    expect(u.host).toBe(configured.host);
  });

  const dWithServer = serverBaseUrl ? describe : describe.skip;

  dWithServer('with apps/server', () => {
    test('test_valid_keycloak_token_grants_access', async () => {
      const token = await mintClientCredentialsToken();
      expect(token.access_token).toBeTypeOf('string');
      expect(token.access_token.length).toBeGreaterThan(0);

      const res = await fetch(`${serverBaseUrl}/debug/whoami`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      // Rust counterpart accepts 200 (auth succeeded) or 403 (policy
      // denied after auth). 401 means the JWT pipeline rejected the
      // token — that's the failure mode this test guards against.
      expect([200, 403]).toContain(res.status);
    });

    test('test_valid_keycloak_token_principal_extraction', async () => {
      const token = await mintClientCredentialsToken();
      const res = await fetch(`${serverBaseUrl}/debug/whoami`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token.access_token}` },
      });

      if (res.status === 403) {
        // Policy denied the service-account principal — the JWT was
        // verified but a tenant policy rejected the call. The principal
        // *was* extracted (otherwise we'd have 401); skip the body
        // assertions, mirroring the Rust counterpart's policy-denied
        // skip path.
        return;
      }
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        principalId?: string;
        tenantId?: string;
      };
      // The realm export bakes a tenant_id hardcoded-claim mapper on
      // atlas-s2s with value tenant-itest-001 (see atlas-realm.json).
      // The middleware extracts that into the principal.
      expect(body.tenantId).toBe('tenant-itest-001');
      // For client_credentials the JWT's `sub` claim is the
      // service-account user id (a UUID Keycloak generates per realm).
      // We don't assert the exact value, only that something flowed
      // through — the realm-mapped tenant_id is the parity claim.
      expect(body.principalId).toBeTypeOf('string');
      expect((body.principalId ?? '').length).toBeGreaterThan(0);
    });
  });
});
