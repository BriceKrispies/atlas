/**
 * Health parity in node mode.
 *
 * Calls /healthz, /readyz, and / against the running apps/server.
 * Mirrors `tests/blackbox/suites/health_test.rs` minus the metrics-related
 * scenarios (apps/server hasn't shipped /metrics yet — see DEFERRED.md).
 */
import { describe, test, expect } from 'vitest';
const baseUrl = process.env['NODE_PARITY_BASE_URL'];
const d = baseUrl ? describe : describe.skip;
/**
 * Boundary reader for parity-test JSON responses. The wire shape is the
 * route's contract (apps/server/src/routes/health.ts here); we narrow
 * `any` to `T` once in this helper instead of at every call site.
 */
async function readJsonAs<T>(res: Response): Promise<T> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary: HTTP parity test — T is the route's contracted response shape.
    return (await res.json()) as T;
}
d('[node] health parity', function () {
    test('test_health_endpoint_returns_200', async function () {
        const res = await fetch(`${baseUrl}/`, { method: 'GET' });
        expect(res.status).toBe(200);
    });
    test('test_liveness_endpoint_returns_200_without_auth', async function () {
        const res = await fetch(`${baseUrl}/healthz`, { method: 'GET' });
        expect(res.status).toBe(200);
        const body = await readJsonAs<{
            status: string;
        }>(res);
        expect(body.status).toBe('ok');
    });
    test('test_readiness_endpoint_returns_200_when_ready', async function () {
        const res = await fetch(`${baseUrl}/readyz`, { method: 'GET' });
        expect(res.status).toBe(200);
        const body = await readJsonAs<{
            status: string;
            checks?: unknown;
        }>(res);
        expect(body.status).toBe('ok');
        expect(body.checks).toBeDefined();
    });
    test('test_readiness_endpoint_accessible_without_auth', async function () {
        const res = await fetch(`${baseUrl}/readyz`, { method: 'GET' });
        expect([200, 503]).toContain(res.status);
    });
    test('test_readiness_includes_checks', async function () {
        const res = await fetch(`${baseUrl}/readyz`, { method: 'GET' });
        const body = await readJsonAs<{
            checks?: Record<string, unknown>;
        }>(res);
        expect(body.checks).toBeDefined();
        // The TS readyz reports control_plane_db + registry rather than the
        // Rust schema_registry + policies, but at least one check must be present.
        expect(Object.keys(body.checks ?? {}).length).toBeGreaterThan(0);
    });
    test('root_endpoint_returns_metadata', async function () {
        const res = await fetch(`${baseUrl}/`, { method: 'GET' });
        const body = await readJsonAs<{
            ok?: boolean;
            name?: string;
        }>(res);
        expect(body.ok).toBe(true);
        expect(body.name).toBe('@atlas/server');
    });
});
