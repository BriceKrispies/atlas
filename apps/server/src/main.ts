/**
 * Entry point for `@atlas/server` — the TypeScript Node ingress.
 *
 * Boots Hono on the configured port, wires the public + authenticated
 * route groups, and applies the principal middleware to the latter. Public
 * routes (health) intentionally bypass authn so probes work without a token.
 *
 * Lifecycle:
 *   - SIGINT / SIGTERM → graceful shutdown of the HTTP listener + DB pools.
 *   - Boot failure → log + exit(1).
 *
 * Env contract: see `config.ts`.
 */

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { loadConfig } from './config.ts';
import { bootstrap, shutdown, type AppState } from './bootstrap.ts';
import { healthRoutes } from './routes/health.ts';
import { metricsRoutes } from './routes/metrics.ts';
import { intentRoutes } from './routes/intents.ts';
import { catalogRoutes } from './routes/catalog.ts';
import { authzRoutes } from './routes/authz.ts';
import { contentPagesRoutes } from './routes/content-pages.ts';
import { debugRoutes } from './routes/debug.ts';
import { eventsRoutes } from './routes/events.ts';
import { identityAuthedRoutes, identityRoutes } from './routes/identity.ts';
import { identityA7Routes } from './routes/identity-a7.ts';
import { identityIdpRoutes } from './routes/identity-idp.ts';
import { mfaRoutes } from './routes/mfa.ts';
import { oauthRoutes } from './routes/oauth.ts';
import { samlRoutes } from './routes/saml.ts';
import { scimRoutes } from './routes/scim.ts';
import { signupRoutes } from './routes/signup.ts';
import { tenantHomeRoutes } from './routes/tenant-home.ts';
import { adminSignupRoutes } from './routes/admin-signups.ts';
import { principalMiddleware, type ServerVariables } from './middleware/principal.ts';

function buildApp(state: AppState): Hono<{ Variables: ServerVariables }> {
  const app = new Hono<{ Variables: ServerVariables }>();

  // Public routes — no authn.
  app.route('/', healthRoutes(state));
  // /metrics is also public — Prometheus scrapes from inside the cluster
  // network. If exposing the endpoint outside that perimeter, gate it with
  // authn here. Mirrors the Rust ingress's unauthenticated metrics route.
  app.route('/', metricsRoutes());
  // Identity invite-accept is also public: the token IS the auth. The
  // user has no JWT yet — that's exactly what they're getting by
  // accepting the invite.
  app.route('/', identityRoutes(state));
  // OAuth routes are also public — auth lives in client_id +
  // client_secret on the request body (RFC 6749).
  app.route('/', oauthRoutes(state));
  // SCIM 2.0 — public mount because auth is the SCIM bearer token,
  // not a JWT. The scim middleware self-validates the bearer.
  app.route('/', scimRoutes(state));
  // SAML 2.0 — public mount; ACS callback verifies the IdP's
  // signature inline (no JWT/cookie path).
  app.route('/', samlRoutes(state));
  // Public signup form, submit endpoint, and magic-link confirm —
  // anonymous; the signup intent is allowed without a principal.
  app.route('/', signupRoutes(state));
  // Tenant-home GET / — public; serves a minimal welcome HTML when
  // the request Host resolves to a registered custom-domain. Falls
  // back to a "not registered" page for unknown hosts (including the
  // bare `localhost` apex). Mounted last so route order doesn't
  // collide with /signup or /api/v1/...
  app.route('/', tenantHomeRoutes(state));

  // Authenticated routes — principal middleware first, then route group.
  const authed = new Hono<{ Variables: ServerVariables }>();
  authed.use('*', principalMiddleware(state));
  authed.route('/', intentRoutes(state));
  authed.route('/', catalogRoutes(state));
  authed.route('/', authzRoutes(state));
  authed.route('/', contentPagesRoutes(state));
  authed.route('/', eventsRoutes(state));
  authed.route('/', identityAuthedRoutes(state));
  authed.route('/', identityIdpRoutes(state));
  authed.route('/', identityA7Routes(state));
  authed.route('/', mfaRoutes(state));
  authed.route('/', adminSignupRoutes(state));
  if (state.config.testAuth.enabled && state.config.testAuth.debugEndpoints) {
    authed.route('/', debugRoutes(state));
  }
  app.route('/', authed);

  return app;
}

async function main(): Promise<void> {
  const config = loadConfig();
  console.log(
    `[server] starting @atlas/server (port=${config.port}, tenant=${config.tenantId}, ` +
      `testAuth=${config.testAuth.enabled}, RUST_LOG=${config.rustLog})`,
  );

  let state: AppState;
  try {
    state = await bootstrap(config);
    console.log('[server] bootstrap complete');
  } catch (e) {
    console.error('[server] bootstrap failed:', (e as Error).message);
    process.exit(1);
  }

  const app = buildApp(state);

  const server = serve(
    { fetch: app.fetch, port: config.port, hostname: '0.0.0.0' },
    (info) => {
      console.log(`[server] listening on http://${info.address}:${info.port}`);
    },
  );

  const stop = async (signal: string): Promise<void> => {
    console.log(`[server] received ${signal}, shutting down`);
    // 1. Stop accepting new connections, drain in-flight requests. Awaiting
    //    `server.close` is required — fire-and-forget would let the pool
    //    teardown below race a request that is mid-`postgres.Sql` query.
    try {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    } catch (e) {
      console.error(`[server] error while closing http server: ${(e as Error).message}`);
    }
    // 2. Tear down tenant pools, then the control-plane pool. See
    //    `bootstrap.shutdown` — order matters because tenant-DB lookups
    //    reference the control-plane Sql.
    await shutdown(state);
    process.exit(0);
  };
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));
}

void main();
