/**
 * Health endpoints — `/`, `/healthz`, `/readyz`.
 *
 * Mirrors the Rust ingress: liveness returns 200 if the process is up;
 * readiness pings the control-plane DB + asserts the registry has actions
 * loaded (registry replaces the Rust schema_registry/policies check, since
 * the TS registry binds the bundled module manifest at construction time).
 */

import { Hono } from 'hono';
import type { AppState } from '../bootstrap.ts';

const PACKAGE_VERSION = '0.1.0';

export function healthRoutes(state: AppState): Hono {
  const app = new Hono();

  app.get('/', (c) =>
    c.json({ ok: true, name: '@atlas/server', version: PACKAGE_VERSION }),
  );

  app.get('/healthz', (c) => c.json({ status: 'ok' }));

  app.get('/readyz', async (c) => {
    const checks: Record<string, string> = {};
    let ready = true;

    try {
      await state.controlPlaneSql`SELECT 1`;
      checks['control_plane_db'] = 'ok';
    } catch (e) {
      ready = false;
      checks['control_plane_db'] = (e as Error).message;
    }

    if (state.controlPlaneRegistry.hasAction('Catalog.SeedPackage.Apply')) {
      checks['registry'] = 'ok';
    } else {
      ready = false;
      checks['registry'] = 'no actions loaded';
    }

    if (!ready) {
      return c.json({ status: 'unavailable', checks }, 503);
    }
    return c.json({ status: 'ok', checks });
  });

  return app;
}
