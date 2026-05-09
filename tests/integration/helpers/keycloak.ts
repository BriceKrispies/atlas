/**
 * Keycloak helper for Layer 3 e2e auth tests.
 *
 * Wraps the bits of the Keycloak admin + token-issuance API that the
 * integration tests need. The realm + clients are pre-imported by
 * `infra/compose/compose.itest-infra.yml` (mounting
 * `infra/compose/config/keycloak/atlas-realm.json` into Keycloak's
 * `data/import/` directory). See `infra/compose/keycloak/README.md`
 * for what's in the realm and how to refresh the export.
 *
 * This helper does NOT create realms or clients at runtime — that
 * would couple the tests to admin-API churn between Keycloak majors.
 * Tests that need a fresh realm shape should refresh the JSON export
 * and reset the itest stack with `make itest-reset`.
 *
 * Pre-requisites:
 *   - `compose.itest-infra.yml` up (or `atlas itest up` / `make itest-up`).
 *   - Default config from the README: realm `atlas`, client `atlas-s2s`
 *     with secret `sQgPBnIo4TyopWfovMHhq6PaMEALlFt0`, test user
 *     `test-user` / `test-password`.
 */

const KEYCLOAK_BASE =
  process.env['KEYCLOAK_BASE_URL'] ?? 'http://localhost:8081';
const REALM = process.env['KEYCLOAK_REALM'] ?? 'atlas';
const S2S_CLIENT_ID = process.env['KEYCLOAK_S2S_CLIENT'] ?? 'atlas-s2s';
const S2S_CLIENT_SECRET =
  process.env['KEYCLOAK_S2S_SECRET'] ??
  'sQgPBnIo4TyopWfovMHhq6PaMEALlFt0';
const TEST_USER = process.env['KEYCLOAK_TEST_USER'] ?? 'test-user';
const TEST_PASSWORD =
  process.env['KEYCLOAK_TEST_PASSWORD'] ?? 'test-password';

export interface KeycloakConfig {
  baseUrl: string;
  realm: string;
  s2sClientId: string;
  s2sClientSecret: string;
  testUser: string;
  testPassword: string;
}

export const keycloakConfig: KeycloakConfig = {
  baseUrl: KEYCLOAK_BASE,
  realm: REALM,
  s2sClientId: S2S_CLIENT_ID,
  s2sClientSecret: S2S_CLIENT_SECRET,
  testUser: TEST_USER,
  testPassword: TEST_PASSWORD,
};

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_expires_in?: number;
  refresh_token?: string;
  token_type: string;
  scope?: string;
}

/**
 * Probe whether Keycloak is reachable. Tests use this in `beforeAll`
 * and `test.skip()` if false so a missing itest stack doesn't tank
 * the rest of the suite.
 */
export async function isKeycloakReachable(
  config: KeycloakConfig = keycloakConfig,
): Promise<boolean> {
  try {
    const res = await fetch(
      `${config.baseUrl}/realms/${config.realm}/.well-known/openid-configuration`,
      { signal: AbortSignal.timeout(2000) },
    );
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Fetch an access token via OAuth 2.0 client_credentials grant against
 * the `atlas-s2s` client. Useful for tests that need a Keycloak-issued
 * Bearer token to present to Atlas.
 */
export async function getClientCredentialsToken(
  config: KeycloakConfig = keycloakConfig,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.s2sClientId,
    client_secret: config.s2sClientSecret,
  });
  const res = await fetch(
    `${config.baseUrl}/realms/${config.realm}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    },
  );
  if (!res.ok) {
    throw new Error(
      `Keycloak token endpoint returned ${res.status}: ${await res.text()}`,
    );
  }
  return (await res.json()) as TokenResponse;
}

/**
 * Fetch an access token via the `password` grant for the pre-seeded
 * test user. Useful for tests that need a Keycloak-issued user token.
 */
export async function getPasswordGrantToken(
  config: KeycloakConfig = keycloakConfig,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: config.s2sClientId,
    client_secret: config.s2sClientSecret,
    username: config.testUser,
    password: config.testPassword,
    scope: 'openid',
  });
  const res = await fetch(
    `${config.baseUrl}/realms/${config.realm}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    },
  );
  if (!res.ok) {
    throw new Error(
      `Keycloak password grant returned ${res.status}: ${await res.text()}`,
    );
  }
  return (await res.json()) as TokenResponse;
}

/**
 * Revoke a token via the OIDC revocation endpoint (RFC 7009). Useful
 * for tests that exercise revocation paths.
 */
export async function revokeKeycloakToken(
  token: string,
  config: KeycloakConfig = keycloakConfig,
): Promise<void> {
  const body = new URLSearchParams({
    token,
    client_id: config.s2sClientId,
    client_secret: config.s2sClientSecret,
  });
  await fetch(
    `${config.baseUrl}/realms/${config.realm}/protocol/openid-connect/revoke`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    },
  );
}

/**
 * The OIDC discovery document. Tests can use this to drive issuer
 * configuration on the Atlas side without hard-coding URLs.
 */
export interface DiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
  revocation_endpoint?: string;
}

export async function getDiscoveryDocument(
  config: KeycloakConfig = keycloakConfig,
): Promise<DiscoveryDocument> {
  const res = await fetch(
    `${config.baseUrl}/realms/${config.realm}/.well-known/openid-configuration`,
  );
  if (!res.ok) {
    throw new Error(`Keycloak discovery failed: ${res.status}`);
  }
  return (await res.json()) as DiscoveryDocument;
}
