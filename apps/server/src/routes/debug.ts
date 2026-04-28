/**
 * Test-only debug routes. Registered only when both
 * `TEST_AUTH_ENABLED=true` AND `DEBUG_AUTH_ENDPOINT_ENABLED=true`.
 * Mirrors the Rust `/debug/whoami` endpoint.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ServerVariables } from '../middleware/principal.ts';

type AppCtx = Context<{ Variables: ServerVariables }>;

export function debugRoutes(): Hono<{ Variables: ServerVariables }> {
  const app = new Hono<{ Variables: ServerVariables }>();
  app.get('/debug/whoami', (c: AppCtx) => {
    const principal = c.get('principal');
    return c.json({
      principalId: principal.principalId,
      tenantId: principal.tenantId,
    });
  });
  return app;
}
