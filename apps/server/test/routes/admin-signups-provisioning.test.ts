/**
 * Unit tests for the per-tenant provisioning step of the signup-approve
 * route handler.
 *
 * Wraps the BDD-level behaviors that failed on 2026-05-22's first
 * end-to-end run (all three failures from
 * `pnpm safe bdd:server` traced to the same root: `admin-approve` never
 * called `PostgresTenantDbProvider.provisionTenantDatabase`, so tenant
 * `acme` never got a per-tenant DB and every downstream assertion
 * crashed with TENANT_DATABASE_NOT_PROVISIONED / UNMAPPED_ERROR).
 *
 * These tests sit one layer below the BDD: they assert the wiring at
 * the function that the route's `ensureTenantProvisioned` callback
 * delegates to. When these pass, the BDD scenarios should reach their
 * actual surface/state assertions rather than crashing on the
 * provisioning gap.
 *
 * Strict TDD: written before the function being tested exists. The
 * Red phase is when this file fails to import; Green is the wire-in.
 *
 * Spec:
 *   - specs/decisions/0005-custom-schema-storage-strategy.md (db-per-tenant)
 *   - specs/domains/tenancy/capabilities/public-signup/README.md
 *   - tickets/tenancy/admin-approve-provisions-tenant-db.md
 */
import { describe, expect, test } from '@atlas/test';
import type { AppConfig, AppState } from '../../src/bootstrap.ts';
import type {
  PostgresTenantDbProvider,
  ProvisionTenantDatabaseArgs,
  ProvisionTenantDatabaseResult,
} from '@atlas/adapter-node';
import { provisionAndMigrateTenant } from '../../src/routes/admin-signups.ts';

// ---------------------------------------------------------------------------
// Recording stubs — verify observable side effects, not "was X called."
//
// The "no cheating" rule applied: each stub records call order via a shared
// timeline so ordering assertions check the real sequence (provision MUST
// run before getPool, or the latter throws on un-provisioned tenants — that
// IS the bug). Mocks that just record "X was called true" without ordering
// hide the actual failure mode.
// ---------------------------------------------------------------------------

interface CallRecord {
  step: string;
  args: unknown;
}

class StubTenantDbProvider {
  readonly timeline: CallRecord[];

  constructor(timeline: CallRecord[]) {
    this.timeline = timeline;
  }

  async provisionTenantDatabase(
    args: ProvisionTenantDatabaseArgs,
  ): Promise<ProvisionTenantDatabaseResult> {
    this.timeline.push({ step: 'provisionTenantDatabase', args });
    return {
      created: true,
      dbName: `atlas_t_${args.tenantId.replace(/-/g, '_')}`,
      runtimeRole: `atlas_t_${args.tenantId.replace(/-/g, '_')}_runtime`,
    };
  }

  async getPool(tenantId: string): Promise<unknown> {
    this.timeline.push({ step: 'getPool', args: { tenantId } });
    // Return a sentinel that the production path uses only by reference.
    // `ensureTenantMigrated` reads the return value but doesn't introspect
    // it in this code path (it only adds the tenantId to `migratedTenants`).
    return { __stub: 'tenant-sql' };
  }
}

class StubCustomDomainCache {
  readonly timeline: CallRecord[];

  constructor(timeline: CallRecord[]) {
    this.timeline = timeline;
  }

  invalidate(hostname: string): void {
    this.timeline.push({ step: 'invalidate', args: { hostname } });
  }
}

// Build a minimal AppState that has just enough wired for
// `provisionAndMigrateTenant` to execute. Everything else stays as the
// caller-supplied stubs above. We do NOT use buildFakeAppState here
// because (a) it builds many notWired proxies we'd have to undo, and
// (b) coupling to it spreads the test's surface beyond what the
// function under test actually reads.
interface BuildArgs {
  tenantApex: string;
  timeline: CallRecord[];
}

function buildMinimalAppState(args: BuildArgs): AppState {
  const config: AppConfig = {
    controlPlaneDbUrl: 'postgres://x@x/x',
    oidcIssuerUrl: '',
    oidcJwksUrl: '',
    oidcAudience: '',
    testAuth: { enabled: false, debugEndpoints: false },
    tenantId: 'dev-tenant',
    tenantApex: args.tenantApex,
    cookieDomain: '',
    publicBaseUrl: '',
    tenantBaseUrl: function () {
      return '';
    },
    mailerMode: 'noop',
    smtp: null,
    devMode: {
      enabled: false,
      principalId: 'dev-admin',
      tenantId: 'dev-tenant',
      roles: ['admin'],
    },
    ingressPort: 3000,
    workerMode: 'inline',
    policyEngine: 'stub',
    environment: 'test',
    insecureCookies: true,
    enableLoggingAdmin: false,
  } as AppConfig;

  const tenantDb = new StubTenantDbProvider(
    args.timeline,
  ) as unknown as PostgresTenantDbProvider;
  const customDomainCache = new StubCustomDomainCache(args.timeline);
  const migratedTenants = new Set<string>();

  // Use Partial<AppState> + a cast so we only wire what the function
  // under test reads. Any field the function accidentally touches that
  // we didn't wire would throw `undefined.xxx`, which the test would
  // surface as a clear failure rather than a silent skip.
  const partial: Partial<AppState> = {
    config,
    tenantDb,
    customDomainCache: customDomainCache as unknown as AppState['customDomainCache'],
    migratedTenants,
  };
  return partial as AppState;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('provisionAndMigrateTenant', function () {
  test('calls provisionTenantDatabase with the tenant id', async function () {
    const timeline: CallRecord[] = [];
    const state = buildMinimalAppState({
      tenantApex: 'localhost',
      timeline,
    });

    await provisionAndMigrateTenant(state, 'acme');

    const provisionCalls = timeline.filter(function (c) {
      return c.step === 'provisionTenantDatabase';
    });
    expect(provisionCalls.length).toBe(1);
    const args = provisionCalls[0]!.args as { tenantId: string };
    expect(args.tenantId).toBe('acme');
  });

  test('provisions BEFORE getPool — the ordering that makes the path actually work', async function () {
    const timeline: CallRecord[] = [];
    const state = buildMinimalAppState({
      tenantApex: 'localhost',
      timeline,
    });

    await provisionAndMigrateTenant(state, 'acme');

    const steps = timeline.map(function (c) {
      return c.step;
    });
    const provisionIdx = steps.indexOf('provisionTenantDatabase');
    const getPoolIdx = steps.indexOf('getPool');
    // Ordering matters: if getPool runs first against an un-provisioned
    // tenant, PostgresTenantDbProvider throws TENANT_DATABASE_NOT_PROVISIONED
    // (adapters/node/src/tenant-db-provider.ts:160-167) and we never
    // reach the provisioner. This is the exact failure mode the BDD
    // surfaced as a 503 on signup-approve and a 500 on subsequent
    // ingress requests.
    expect(provisionIdx).toBeGreaterThanOrEqual(0);
    expect(getPoolIdx).toBeGreaterThanOrEqual(0);
    expect(provisionIdx).toBeLessThan(getPoolIdx);
  });

  test('invalidates the customDomainCache for the new tenant hostname', async function () {
    const timeline: CallRecord[] = [];
    const state = buildMinimalAppState({
      tenantApex: 'localhost',
      timeline,
    });

    await provisionAndMigrateTenant(state, 'acme');

    const invalidations = timeline.filter(function (c) {
      return c.step === 'invalidate';
    });
    expect(invalidations.length).toBe(1);
    const args = invalidations[0]!.args as { hostname: string };
    expect(args.hostname).toBe('acme.localhost');
  });

  test('records the tenant as migrated after provisioning', async function () {
    const timeline: CallRecord[] = [];
    const state = buildMinimalAppState({
      tenantApex: 'localhost',
      timeline,
    });

    await provisionAndMigrateTenant(state, 'acme');

    // migratedTenants is the cache that prevents re-running the
    // migration probe on subsequent requests for the same tenant.
    // ensureTenantMigrated populates it. We verify the side effect
    // landed rather than asserting "ensureTenantMigrated was called"
    // (which would test the wiring shape instead of the contract).
    expect(state.migratedTenants.has('acme')).toBe(true);
  });
});
