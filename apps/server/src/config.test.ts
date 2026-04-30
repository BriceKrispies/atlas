import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from './config.ts';

const REQUIRED_ENVS = [
  'CONTROL_PLANE_DB_URL',
  'OIDC_ISSUER_URL',
  'OIDC_JWKS_URL',
  'OIDC_AUDIENCE',
  'TENANT_ID',
  'TEST_AUTH_ENABLED',
  'DEBUG_AUTH_ENDPOINT_ENABLED',
  'ATLAS_ENV',
  'INGRESS_PORT',
  'PORT',
  'POLICY_ENGINE',
  'RUST_LOG',
] as const;

describe('loadConfig() — TENANT_ID forbidden in strict mode (parity with Rust forbid_in_strict)', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Save and clear all envs we touch, so each test starts from a known state.
    for (const k of REQUIRED_ENVS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    // Restore prior process.env so we don't bleed into other tests.
    for (const k of REQUIRED_ENVS) {
      if (saved[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = saved[k];
      }
    }
  });

  test('throws when ATLAS_ENV is strict (TEST_AUTH_ENABLED unset) and TENANT_ID is set', () => {
    process.env['CONTROL_PLANE_DB_URL'] =
      'postgres://atlas_platform:local_dev_password@localhost:5433/control_plane';
    process.env['OIDC_ISSUER_URL'] = 'https://issuer.example.com';
    process.env['OIDC_JWKS_URL'] = 'https://issuer.example.com/jwks';
    process.env['OIDC_AUDIENCE'] = 'atlas';
    process.env['TENANT_ID'] = 'foo';
    // TEST_AUTH_ENABLED intentionally unset => strict mode

    expect(() => loadConfig()).toThrow(/TENANT_ID.*strict|forbid/i);
  });

  test('succeeds when ATLAS_ENV is dev (TEST_AUTH_ENABLED=true) and TENANT_ID is set', () => {
    process.env['CONTROL_PLANE_DB_URL'] =
      'postgres://atlas_platform:local_dev_password@localhost:5433/control_plane';
    process.env['TEST_AUTH_ENABLED'] = 'true';
    process.env['TENANT_ID'] = 'foo';

    const cfg = loadConfig();
    expect(cfg.tenantId).toBe('foo');
    expect(cfg.testAuth.enabled).toBe(true);
  });

  test('succeeds when strict mode and TENANT_ID is unset', () => {
    process.env['CONTROL_PLANE_DB_URL'] =
      'postgres://atlas_platform:local_dev_password@localhost:5433/control_plane';
    process.env['OIDC_ISSUER_URL'] = 'https://issuer.example.com';
    process.env['OIDC_JWKS_URL'] = 'https://issuer.example.com/jwks';
    process.env['OIDC_AUDIENCE'] = 'atlas';
    // TENANT_ID unset, TEST_AUTH_ENABLED unset => strict, no tenant override.

    const cfg = loadConfig();
    expect(cfg.tenantId).toBe('dev-tenant');
    expect(cfg.testAuth.enabled).toBe(false);
  });
});
