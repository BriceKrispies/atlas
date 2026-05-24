/**
 * Integration regression: Postgres pools survive a container bounce
 * without an apps/server restart (same bootId).
 *
 * @spec specs/domains/runtime/capabilities/pool-resilience/README.md
 * @spec specs/crosscut/always-on.md §1 (I20)
 *
 * EMPIRICAL PROBE RESULT (2026-05-23, postgres.js 3.4.9): the driver
 * ALREADY recovers per-query after a container bounce — the same pool
 * object reconnects to the new postmaster on a later query (first query
 * errors with CONNECTION_CLOSED, the next few hit 57P03 "starting up",
 * then SELECT 1 succeeds; ~7 attempts / ~12s, dominated by Postgres
 * restart time, not driver latency). Tuning options did not change the
 * recovery profile. Per the spec's empirical-first directive, the
 * deliverable is therefore EXPLICIT, documented resilience config at both
 * pool sites (single-sourced as POSTGRES_RESILIENCE_OPTIONS) plus THIS
 * regression test — NOT a bespoke reconnect loop.
 *
 * This test is real-Postgres + real-bounce, HAS_DB-gated (skips silently
 * when TEST_TENANT_DB_URL is unset, matching the adapter-node suite), so
 * `pnpm test` without a DB stays green. The bounce only fires when a live
 * control-plane DB is present. Run it explicitly under the project runner:
 *
 *   TEST_TENANT_DB_URL=postgres://atlas_platform:local_dev_password@localhost:15433/control_plane \
 *   node packages/test/bin/atlas-test.mjs apps/server/test/always-on/pool-resilience.itest.ts
 *
 * It constructs the control-plane pool with the SAME options object
 * production uses (bootstrap.ts:264 and this test both import
 * POSTGRES_RESILIENCE_OPTIONS) and invokes the REAL `healthRoutes(state)`
 * Hono app via `.fetch()` so /readyz exercises the production readiness
 * code-path (no separate HTTP listener needed — Hono's `.fetch` runs the
 * exact handler). The per-tenant case drives a pool from
 * `PostgresTenantDbProvider` (which builds via `openPostgresFromInfo`).
 *
 * The bounce is a real `podman restart` of the control-plane container —
 * the same connection-drop a `make db-down && make db-up` produces,
 * without the volume wipe.
 */
import { describe, it, expect, before, after } from '@atlas/test';
import { execFileSync } from 'node:child_process';
import postgres from 'postgres';
import {
  PostgresTenantDbProvider,
  POSTGRES_RESILIENCE_OPTIONS,
} from '@atlas/adapter-node';
import { healthRoutes } from '../../src/routes/health.ts';

const CONTAINER = 'atlas-platform-control-plane-db';
const CP_URL = process.env['TEST_TENANT_DB_URL'];
const HAS_DB = typeof CP_URL === 'string' && CP_URL.length > 0;

interface ReadyBody {
  status: string;
  bootId: string;
  checks: Record<string, string>;
}

interface ReadyApp {
  fetch: (req: Request) => Response | Promise<Response>;
}

/** Bounce the control-plane container (kills + restarts the postmaster). */
function bounceContainer(): void {
  execFileSync('podman', ['restart', CONTAINER], { stdio: 'ignore' });
}

/** Invoke the real /readyz handler once via the Hono app's `.fetch`. */
async function hitReadyz(app: ReadyApp): Promise<{ ok: boolean; body: ReadyBody }> {
  const res = await app.fetch(new Request('http://local/readyz'));
  const body = (await res.json()) as ReadyBody;
  return { ok: res.ok, body };
}

/**
 * Poll `/readyz` until it reports ok or the attempt budget is exhausted.
 * The budget covers Postgres restart + startup (~12s observed in the
 * probe); 40 attempts × 500ms = 20s gives comfortable headroom.
 */
async function pollReadyz(
  app: ReadyApp,
  maxAttempts = 40,
): Promise<{ ok: boolean; attempts: number; body: ReadyBody | null }> {
  let body: ReadyBody | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const r = await hitReadyz(app);
      body = r.body;
      if (r.ok && body.status === 'ok') {
        return { ok: true, attempts: attempt, body };
      }
    } catch {
      /* handler may throw while Postgres is down — keep polling */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { ok: false, attempts: maxAttempts, body };
}

if (HAS_DB) {
  describe('pool resilience — survive a Postgres bounce without restart (W1)', function () {
    let controlPlaneSql: postgres.Sql;
    let app: ReadyApp;
    const bootId = 'pool-resilience-itest-boot';

    before(async function () {
      // Construct the control-plane pool EXACTLY as bootstrap.ts:264 does:
      // the URL + the shared resilience options. This is the production
      // pool-construction site under test.
      controlPlaneSql = postgres(CP_URL as string, {
        max: 5,
        ...POSTGRES_RESILIENCE_OPTIONS,
      });
      await controlPlaneSql`SELECT 1`;

      // Minimal AppState slice: /readyz reads controlPlaneSql,
      // controlPlaneRegistry.hasAction(...), bootId, startedAt. We stub the
      // registry to report the action loaded so /readyz's readiness gate
      // turns on the DB-check result alone (the behaviour under test).
      const state = {
        controlPlaneSql,
        controlPlaneRegistry: {
          hasAction: (_id: string): boolean => true,
        },
        bootId,
        startedAt: new Date(),
      };
      // Real production readiness route — this is the bounce witness. We
      // drive it via Hono's `.fetch` (no socket needed); the handler runs
      // the same `state.controlPlaneSql`SELECT 1`` production hits.
      app = healthRoutes(state as never) as unknown as ReadyApp;
    });

    after(async function () {
      await controlPlaneSql.end({ timeout: 2 }).catch(() => {});
    });

    it('control-plane pool survives a Postgres container bounce without a server restart', async function () {
      // Capture bootId before the bounce.
      const pre = await hitReadyz(app);
      expect(pre.body.status).toBe('ok');
      expect(pre.body.checks['control_plane_db']).toBe('ok');
      const bootIdBefore = pre.body.bootId;

      // Real bounce — every server-side socket the CP pool holds dies.
      bounceContainer();

      // Non-vacuous guard: the FIRST probe after the bounce must observe a
      // severed connection (status unavailable / control_plane_db not ok).
      // If this ever reports ok immediately, the bounce did not actually
      // drop the pool's sockets and the recovery assertion below would pass
      // vacuously — fail loudly instead.
      const immediatelyAfter = await hitReadyz(app);
      expect(
        immediatelyAfter.body.status !== 'ok' ||
          immediatelyAfter.body.checks['control_plane_db'] !== 'ok',
        `bounce did not sever the CP pool — recovery test would be vacuous (got ${JSON.stringify(immediatelyAfter.body)})`,
      ).toBe(true);

      // Poll until the same process serves a healthy /readyz again. If the
      // pool latched a permanent error, this would never report ok and the
      // test would fail.
      const recovered = await pollReadyz(app);
      expect(recovered.ok).toBe(true);
      expect(recovered.body?.checks['control_plane_db']).toBe('ok');
      // Same process answered both probes — no restart occurred (I20).
      expect(recovered.body?.bootId).toBe(bootIdBefore);
      expect(recovered.body?.bootId).toBe(bootId);
    });

    it('per-tenant pool survives a Postgres bounce', async function () {
      // Resolve every tenant to the control-plane DB (privileged user) via
      // a resolveConnection override, so this exercises a pool built by
      // `openPostgresFromInfo` (the per-tenant construction site) without
      // needing a provisioned tenant DB.
      const opts = controlPlaneSql.options as {
        host: string | string[];
        port: number | number[];
        user?: string;
        pass?: string;
      };
      const host = Array.isArray(opts.host) ? opts.host[0] : opts.host;
      const port = Array.isArray(opts.port) ? opts.port[0] : opts.port;
      const provider = new PostgresTenantDbProvider(controlPlaneSql, {
        resolveConnection: async function () {
          return {
            host: host as string,
            port: port as number,
            name: 'control_plane',
            user: opts.user ?? 'atlas_platform',
            password: opts.pass ?? '',
          };
        },
      });
      try {
        const pool = await provider.getPool('pool-resilience-tenant');
        // Prime it pre-bounce.
        const pre = await pool<{ ok: number }[]>`SELECT 1 AS ok`;
        expect(pre[0]?.ok).toBe(1);

        bounceContainer();

        // Poll the SAME pool (no invalidate) across the bounce — the
        // per-tenant pool's resilience config must let it reconnect
        // per-query, identical to the CP pool.
        let recovered = false;
        let lastErr: unknown;
        for (let attempt = 1; attempt <= 40; attempt += 1) {
          try {
            const r = await pool<{ ok: number }[]>`SELECT 1 AS ok`;
            if (r[0]?.ok === 1) {
              recovered = true;
              break;
            }
          } catch (e) {
            lastErr = e;
          }
          await new Promise((r) => setTimeout(r, 500));
        }
        expect(recovered, `per-tenant pool never recovered: ${String(lastErr)}`).toBe(true);

        // The bootId witness: /readyz on the same process still reports the
        // same bootId — no restart happened during the per-tenant bounce.
        const ready = await pollReadyz(app);
        expect(ready.body?.bootId).toBe(bootId);
      } finally {
        await provider.close();
      }
    });
  });
}
