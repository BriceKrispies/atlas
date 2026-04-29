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
import { intentRoutes } from './routes/intents.ts';
import { catalogRoutes } from './routes/catalog.ts';
import { authzRoutes } from './routes/authz.ts';
import { debugRoutes } from './routes/debug.ts';
import { principalMiddleware, type ServerVariables } from './middleware/principal.ts';

function buildApp(state: AppState): Hono<{ Variables: ServerVariables }> {
  const app = new Hono<{ Variables: ServerVariables }>();

  // Public routes — no authn.
  app.route('/', healthRoutes(state));

  // Authenticated routes — principal middleware first, then route group.
  const authed = new Hono<{ Variables: ServerVariables }>();
  authed.use('*', principalMiddleware(state));
  authed.route('/', intentRoutes(state));
  authed.route('/', catalogRoutes(state));
  authed.route('/', authzRoutes(state));
  if (state.config.testAuth.enabled && state.config.testAuth.debugEndpoints) {
    authed.route('/', debugRoutes());
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
