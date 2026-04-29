/**
 * GET /metrics — Prometheus text-format scrape endpoint.
 *
 * Mirrors the Rust `crates/ingress/src/metrics.rs::gather_metrics`
 * surface: returns whatever the in-memory registry has been populated
 * with by the various intent / authz / projection code paths.
 *
 * Public — no authn — same as `/healthz` / `/readyz`. Operators
 * scrape this from inside the cluster network. If you ever expose it
 * publicly, add an authn gate here.
 *
 * Content-Type follows the Prometheus exposition spec:
 *   `text/plain; version=0.0.4; charset=utf-8`
 */

import { Hono } from 'hono';
import { getRegistry } from '@atlas/metrics';

export function metricsRoutes(): Hono {
  const app = new Hono();

  app.get('/metrics', (c) => {
    const body = getRegistry().serialize();
    return c.body(body, 200, {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
    });
  });

  return app;
}
