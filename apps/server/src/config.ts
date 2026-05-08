/**
 * Environment-driven configuration for the Node server.
 *
 * Mirrors the env-var conventions the existing Rust ingress + itest
 * supervisor use (see `tools/cli/src/itest_supervisor.rs`) so `atlas itest`
 * can target this server interchangeably:
 *
 * - CONTROL_PLANE_DB_URL              required to connect to control-plane
 * - OIDC_ISSUER_URL / OIDC_JWKS_URL   required when TEST_AUTH_ENABLED!=true
 * - OIDC_AUDIENCE                     required in strict mode (when TEST_AUTH_ENABLED!=true);
 *                                     defaults to "account" in test-auth mode
 * - TEST_AUTH_ENABLED                 enables X-Debug-Principal pathway
 * - DEBUG_AUTH_ENDPOINT_ENABLED       gates /debug/whoami
 * - TENANT_ID                         dev fallback tenant
 * - INGRESS_PORT or PORT              server port (default 3000)
 * - RUST_LOG                          logged on boot for parity (no-op)
 * - POLICY_ENGINE                     `stub` | `cedar` (default `stub`)
 * - WORKER_MODE                       `inline` | `async` (default `inline`)
 */

import type { AtlasEnvironment } from '@atlas/platform-core';
import {
  envBool,
  envOr,
  envRequired,
  forbidInStrict,
} from '@atlas/platform-core';

export type PolicyEngineKind = 'stub' | 'cedar';

/**
 * Phase-3 cut-over flag for the worker migration (see
 * `specs/worker.md`).
 *
 * - `inline` (default): the dispatcher chain composed in
 *   `middleware/state.ts` runs synchronously inside the request, exactly
 *   as it has since Chunk 8. Projections rebuild and cache invalidates
 *   before the 202 is returned. This preserves pre-cut-over behaviour
 *   so existing deployments and tests are unaffected unless they opt in.
 * - `async`: the per-request `state.dispatch` becomes a no-op closure.
 *   Events are still appended to the event store (that happens in
 *   `submitIntent` and the audit hook); the projection-worker
 *   (`apps/projection-worker`) is responsible for draining them via
 *   `WorkerSource` and running the chain out-of-band.
 */
export type WorkerMode = 'inline' | 'async';

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
  /**
   * Atlas environment for log/audit emission. Read from ATLAS_ENVIRONMENT
   * (preferred), falling back to NODE_ENV, defaulting to 'development'.
   */
  environment: AtlasEnvironment;
  /**
   * Which `PolicyEngine` adapter to wire at boot.
   *
   * - `stub` (default): allow-all + tenant-scope. Preserves the
   *   pre-Cedar behaviour the TS rewrite shipped with.
   * - `cedar`: production. Loads per-tenant Cedar bundles from the
   *   `control_plane.policies` table. Wired in Chunk 6b.
   */
  policyEngine: PolicyEngineKind;
  /**
   * Phase-3 worker cut-over flag. Read from `WORKER_MODE`; defaults to
   * `'inline'`. When `'async'`, `apps/server`'s per-request
   * `state.dispatch` is a no-op and the projection-worker is the sole
   * consumer of new events. See {@link WorkerMode}.
   */
  workerMode: WorkerMode;
  /**
   * Drop the `Secure` flag from cookies the server emits. **Dev only** —
   * Vite SPAs run on plain http://localhost:<port> and browsers refuse
   * `Secure` cookies on plain HTTP. Read from `INSECURE_COOKIES`.
   */
  insecureCookies: boolean;
  /**
   * Domain attribute on session cookies. Set to `.localhost` so a
   * cookie minted on `localhost:3000` (during /signup/confirm) survives
   * the redirect to `<slug>.localhost:3000`. Empty string = host-only.
   * Read from `COOKIE_DOMAIN`.
   */
  cookieDomain: string;
  /**
   * Apex domain for tenant subdomains (e.g. `localhost` in dev means
   * `<slug>.localhost`). Read from `TENANT_APEX`.
   */
  tenantApex: string;
  /**
   * Origin for the parent-domain pages (signup form, /signup/confirm,
   * /play). Read from `PUBLIC_BASE_URL`. Default
   * `http://localhost:<port>`.
   */
  publicBaseUrl: string;
  /**
   * Build the canonical origin URL for a given tenant. The default
   * implementation uses `<slug>.<tenantApex>:<port>` over http; prod
   * deployments override the scheme/port via environment.
   */
  tenantBaseUrl: (tenantId: string) => string;
  /**
   * Outbound mailer adapter. `stdout` writes to stdout + the
   * `control_plane.email_log` table (dev/sim default). `noop`
   * silently drops sends. `smtp` hands the message to a real SMTP
   * relay (e.g. `smtp4dev` for local dev) and ALSO mirrors to
   * `email_log` for the in-app mailbox. Read from `MAILER_MODE`.
   */
  mailerMode: MailerMode;
  /**
   * SMTP transport configuration. Required when `mailerMode === 'smtp'`,
   * ignored otherwise. Read from `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`.
   */
  smtp: SmtpConfig | null;
}

export type MailerMode = 'stdout' | 'noop' | 'smtp';

export interface SmtpConfig {
  host: string;
  port: number;
  /** RFC-5322 From address used for every outbound message. */
  from: string;
}

function inferEnvironment(): AtlasEnvironment {
  const explicit = process.env['ATLAS_ENVIRONMENT'];
  if (
    explicit === 'development' ||
    explicit === 'staging' ||
    explicit === 'production' ||
    explicit === 'test'
  ) {
    return explicit;
  }
  const nodeEnv = process.env['NODE_ENV'];
  if (nodeEnv === 'production') return 'production';
  if (nodeEnv === 'test') return 'test';
  return 'development';
}

export function loadConfig(): AppConfig {
  const portRaw = process.env['INGRESS_PORT'] ?? process.env['PORT'] ?? '3000';
  const portNum = Number.parseInt(portRaw, 10);
  if (!Number.isFinite(portNum) || portNum <= 0) {
    throw new Error(`invalid port: ${portRaw}`);
  }

  const testAuthEnabled = envBool('TEST_AUTH_ENABLED');
  const debugEndpoints = envBool('DEBUG_AUTH_ENDPOINT_ENABLED');

  // OIDC config. Strict mode (test-auth OFF) requires the full triplet
  // (OIDC_ISSUER_URL, OIDC_JWKS_URL, OIDC_AUDIENCE) so JWT verification
  // has an authoritative issuer + audience to enforce. In test-auth
  // mode we still honour any values that are set — when both
  // OIDC_ISSUER_URL and OIDC_JWKS_URL are present the JWT path is wired
  // up alongside X-Debug-Principal (the `atlas itest` supervisor uses
  // exactly this combination so the Keycloak parity tests can mint a
  // real token while X-Debug-Principal stays available for the rest of
  // the suite). Audience defaults to "account" only as a dev convenience
  // in test-auth mode; production deployments must opt in explicitly.
  const issuerUrl = testAuthEnabled
    ? envOr('OIDC_ISSUER_URL', '')
    : envRequired('OIDC_ISSUER_URL');
  const jwksUrl = testAuthEnabled
    ? envOr('OIDC_JWKS_URL', '')
    : envRequired('OIDC_JWKS_URL');
  const audience = testAuthEnabled
    ? envOr('OIDC_AUDIENCE', 'account')
    : envRequired('OIDC_AUDIENCE');

  forbidInStrict(
    'TENANT_ID',
    'TENANT_ID is a dev-only override; production tenancy must come from the authenticated principal.',
  );
  const tenantId = envOr('TENANT_ID', 'dev-tenant');
  const controlPlaneDbUrl = envRequired('CONTROL_PLANE_DB_URL');
  const rustLog = envOr('RUST_LOG', 'info');

  const policyEngineRaw = envOr('POLICY_ENGINE', 'stub');
  if (policyEngineRaw !== 'stub' && policyEngineRaw !== 'cedar') {
    throw new Error(
      `invalid POLICY_ENGINE: ${policyEngineRaw} (expected 'stub' or 'cedar')`,
    );
  }
  const policyEngine: PolicyEngineKind = policyEngineRaw;

  const workerModeRaw = envOr('WORKER_MODE', 'inline');
  if (workerModeRaw !== 'inline' && workerModeRaw !== 'async') {
    throw new Error(
      `invalid WORKER_MODE: ${workerModeRaw} (expected 'inline' or 'async')`,
    );
  }
  const workerMode: WorkerMode = workerModeRaw;

  const insecureCookies = envBool('INSECURE_COOKIES');
  const cookieDomain = envOr('COOKIE_DOMAIN', '');
  const tenantApex = envOr('TENANT_APEX', 'localhost');
  const publicBaseUrl = envOr('PUBLIC_BASE_URL', `http://localhost:${portNum}`);

  const mailerModeRaw = envOr('MAILER_MODE', 'stdout');
  if (
    mailerModeRaw !== 'stdout' &&
    mailerModeRaw !== 'noop' &&
    mailerModeRaw !== 'smtp'
  ) {
    throw new Error(
      `invalid MAILER_MODE: ${mailerModeRaw} (expected 'stdout', 'noop', or 'smtp')`,
    );
  }
  const mailerMode: MailerMode = mailerModeRaw;

  // SMTP transport config — required only when MAILER_MODE=smtp. Read
  // unconditionally (so a misconfigured value fails loud at boot rather
  // than at first send), then enforced as required for the smtp branch.
  const smtpHost = envOr('SMTP_HOST', '');
  const smtpPortRaw = envOr('SMTP_PORT', '');
  const smtpFrom = envOr('SMTP_FROM', '');
  let smtp: SmtpConfig | null = null;
  if (mailerMode === 'smtp') {
    if (!smtpHost || !smtpPortRaw || !smtpFrom) {
      throw new Error(
        `MAILER_MODE=smtp requires SMTP_HOST, SMTP_PORT, and SMTP_FROM to be set`,
      );
    }
    const smtpPort = Number.parseInt(smtpPortRaw, 10);
    if (!Number.isFinite(smtpPort) || smtpPort <= 0) {
      throw new Error(`invalid SMTP_PORT: ${smtpPortRaw}`);
    }
    smtp = { host: smtpHost, port: smtpPort, from: smtpFrom };
  }

  // The tenant origin builder. Defaults to <slug>.<apex>:<port> over
  // http (the local-dev shape). Production wiring sets `TENANT_APEX`
  // to the apex domain and the scheme/port via override.
  const tenantBaseUrl = (slug: string): string => {
    if (tenantApex === 'localhost') {
      return `http://${slug}.${tenantApex}:${portNum}`;
    }
    return `https://${slug}.${tenantApex}`;
  };

  return {
    port: portNum,
    controlPlaneDbUrl,
    oidc: { issuerUrl, jwksUrl, audience },
    testAuth: { enabled: testAuthEnabled, debugEndpoints },
    tenantId,
    rustLog,
    environment: inferEnvironment(),
    policyEngine,
    workerMode,
    insecureCookies,
    cookieDomain,
    tenantApex,
    publicBaseUrl,
    tenantBaseUrl,
    mailerMode,
    smtp,
  };
}
