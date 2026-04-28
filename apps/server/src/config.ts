/**
 * Environment-driven configuration for the Node server.
 *
 * Mirrors the env-var conventions the existing Rust ingress + itest
 * supervisor use (see `tools/cli/src/itest_supervisor.rs`) so `atlas itest`
 * can target this server interchangeably:
 *
 * - CONTROL_PLANE_DB_URL              required to connect to control-plane
 * - OIDC_ISSUER_URL / OIDC_JWKS_URL   required when TEST_AUTH_ENABLED!=true
 * - OIDC_AUDIENCE                     defaults to "account"
 * - TEST_AUTH_ENABLED                 enables X-Debug-Principal pathway
 * - DEBUG_AUTH_ENDPOINT_ENABLED       gates /debug/whoami
 * - TENANT_ID                         dev fallback tenant
 * - INGRESS_PORT or PORT              server port (default 3000)
 * - RUST_LOG                          logged on boot for parity (no-op)
 */

export interface OidcConfig {
  issuerUrl: string;
  jwksUrl: string;
  audience: string;
}

export interface TestAuthConfig {
  enabled: boolean;
  debugEndpoints: boolean;
}

export interface AppConfig {
  port: number;
  controlPlaneDbUrl: string;
  oidc: OidcConfig;
  testAuth: TestAuthConfig;
  tenantId: string;
  rustLog: string;
}

function envBool(name: string): boolean {
  const v = process.env[name];
  if (v === undefined) return false;
  const lower = v.toLowerCase();
  return lower === '1' || lower === 'true' || lower === 'yes';
}

function envOr(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function envRequired(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    throw new Error(`required env var ${name} is unset`);
  }
  return v;
}

export function loadConfig(): AppConfig {
  const portRaw = process.env['INGRESS_PORT'] ?? process.env['PORT'] ?? '3000';
  const portNum = Number.parseInt(portRaw, 10);
  if (!Number.isFinite(portNum) || portNum <= 0) {
    throw new Error(`invalid port: ${portRaw}`);
  }

  const testAuthEnabled = envBool('TEST_AUTH_ENABLED');
  const debugEndpoints = envBool('DEBUG_AUTH_ENDPOINT_ENABLED');

  // OIDC config: required only when test-auth is OFF, since otherwise the
  // server has no way to verify real tokens. In test-auth mode, missing
  // OIDC values default to empty strings; the verifier is never invoked.
  const issuerUrl = testAuthEnabled
    ? envOr('OIDC_ISSUER_URL', '')
    : envRequired('OIDC_ISSUER_URL');
  const jwksUrl = testAuthEnabled
    ? envOr('OIDC_JWKS_URL', '')
    : envRequired('OIDC_JWKS_URL');
  const audience = envOr('OIDC_AUDIENCE', 'account');

  const tenantId = envOr('TENANT_ID', 'dev-tenant');
  const controlPlaneDbUrl = envRequired('CONTROL_PLANE_DB_URL');
  const rustLog = envOr('RUST_LOG', 'info');

  return {
    port: portNum,
    controlPlaneDbUrl,
    oidc: { issuerUrl, jwksUrl, audience },
    testAuth: { enabled: testAuthEnabled, debugEndpoints },
    tenantId,
    rustLog,
  };
}
