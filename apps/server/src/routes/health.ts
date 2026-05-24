/**
 * Health endpoints — `/healthz`, `/readyz`.
 *
 * Mirrors the Rust ingress: liveness returns 200 if the process is up;
 * readiness pings the control-plane DB + asserts the registry has actions
 * loaded (registry replaces the Rust schema_registry/policies check, since
 * the TS registry binds the bundled module manifest at construction time).
 *
 * Note: the legacy `GET /` handler that returned `{ok, name, version}` was
 * removed 2026-05-21 — it shadowed the admin SPA serveStatic catch-all
 * mounted last in `main.ts` (the fourth §11 retro's structural fix). Root
 * path now correctly falls through to the SPA. The five §11.2 fields are
 * archived at `tickets/archive/kernel-extraction/admin-spa-root-shadow.md`.
 */
import { Hono } from 'hono';
import { errorMessage } from '../middleware/errors.ts';
import type { AppState } from '../bootstrap.ts';
export function healthRoutes(state: AppState): Hono {
    const app = new Hono();
    app.get('/healthz', function (c) {
        return c.json({ status: 'ok' });
    });
    app.get('/readyz', async function (c) {
        const checks: Record<string, string> = {};
        let ready = true;
        try {
            await state.controlPlaneSql `SELECT 1`;
            checks['control_plane_db'] = 'ok';
        }
        catch (e) {
            ready = false;
            checks['control_plane_db'] = errorMessage(e);
        }
        if (state.controlPlaneRegistry.hasAction('Catalog.SeedPackage.Apply')) {
            checks['registry'] = 'ok';
        }
        else {
            ready = false;
            checks['registry'] = 'no actions loaded';
        }
        // bootId + startedAt are stamped at process start (see
        // bootstrap.ts AppState docs). They surface here — not on
        // /healthz — so liveness probes stay terse and readiness
        // carries the I20 zero-restart witness. Test harnesses compare
        // bootId across probes to assert "same process answered both."
        const bootId = state.bootId;
        const startedAt = state.startedAt.toISOString();
        if (!ready) {
            return c.json({ status: 'unavailable', bootId, startedAt, checks }, 503);
        }
        return c.json({ status: 'ok', bootId, startedAt, checks });
    });
    return app;
}
