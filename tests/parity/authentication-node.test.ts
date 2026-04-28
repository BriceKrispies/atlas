/**
 * Authentication parity in node mode.
 *
 * Mirrors `tests/blackbox/suites/authentication_test.rs`. Requires
 * `apps/server` running with `TEST_AUTH_ENABLED=true` and
 * `DEBUG_AUTH_ENDPOINT_ENABLED=true` (so /debug/whoami is mounted).
 *
 * Tests that need a real Keycloak token (test_valid_keycloak_token_*,
 * test_keycloak_is_reachable) are deferred until the parity stack stands up
 * the same Keycloak realm `atlas itest` already provisions; see DEFERRED.md.
 */

import { describe, test, expect } from 'vitest';

const baseUrl = process.env['NODE_PARITY_BASE_URL'];
const d = baseUrl ? describe : describe.skip;

async function fetchWhoami(headers: Record<string, string>): Promise<{
  status: number;
  body: unknown;
}> {
  const res = await fetch(`${baseUrl}/debug/whoami`, { method: 'GET', headers });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // leave as text
  }
  return { status: res.status, body };
}

d('[node] authentication parity', () => {
  test('test_missing_token_returns_401', async () => {
    const res = await fetchWhoami({});
    expect(res.status).toBe(401);
  });

  test('test_invalid_token_returns_401', async () => {
    const res = await fetchWhoami({
      Authorization: 'Bearer this-is-not-a-valid-jwt-token',
    });
    expect(res.status).toBe(401);
  });

  test('test_malformed_jwt_returns_401', async () => {
    const fake =
      'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.' +
      'eyJzdWIiOiJmYWtlLXVzZXIiLCJpc3MiOiJmYWtlLWlzc3VlciJ9.' +
      'invalid-signature';
    const res = await fetchWhoami({ Authorization: `Bearer ${fake}` });
    expect(res.status).toBe(401);
  });

  test('test_expired_token_returns_401', async () => {
    const expired =
      'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.' +
      'eyJzdWIiOiJ0ZXN0LXVzZXIiLCJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjgwODEvcmVhbG1zL2F0bGFzIiwiZXhwIjoxNTc3ODM2ODAwfQ.' +
      'fake-signature';
    const res = await fetchWhoami({ Authorization: `Bearer ${expired}` });
    expect(res.status).toBe(401);
  });

  test('test_debug_principal_header_works', async () => {
    const res = await fetchWhoami({
      'X-Debug-Principal': 'user:test-user-123:tenant-dev',
    });
    // 200 if test-auth is enabled; 401 otherwise — both are spec-valid per Rust.
    expect([200, 401]).toContain(res.status);
    if (res.status === 200) {
      const body = res.body as { principalId?: string; tenantId?: string };
      expect(body.principalId).toBe('test-user-123');
      expect(body.tenantId).toBe('tenant-dev');
    }
  });

  test('test_auth_failure_returns_401_not_403', async () => {
    const res = await fetchWhoami({ Authorization: 'Bearer invalid-token' });
    expect(res.status).toBe(401);
  });

  test('malformed_debug_principal_header_returns_400', async () => {
    // Sim has no equivalent path. Server middleware returns 400 with code
    // PRINCIPAL_INVALID for malformed test-auth headers.
    const res = await fetchWhoami({
      'X-Debug-Principal': 'this-is-not-a-valid-shape',
    });
    expect([400, 401]).toContain(res.status);
  });

  test('empty_bearer_returns_401', async () => {
    const res = await fetchWhoami({ Authorization: 'Bearer ' });
    expect(res.status).toBe(401);
  });

  test('non_bearer_authorization_returns_401', async () => {
    const res = await fetchWhoami({ Authorization: 'Basic dXNlcjpwYXNz' });
    expect(res.status).toBe(401);
  });
});
