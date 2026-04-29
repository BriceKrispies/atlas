/**
 * Adapter-level tests for `CedarPolicyEngine`.
 *
 * Pulls the `policyEngineContract` shared suite to confirm shape parity
 * with the stub, then layers Cedar-specific assertions: real
 * forbid-overrides-permit, attribute-based, cross-tenant + matched-policy
 * traceability.
 *
 * Uses `BundledFixtureLoader` to keep the tests pure (no DB). The WASM
 * binary loads on first `evaluate` — about one extra second on cold cache.
 */

import { describe, expect, test } from 'vitest';
import { policyEngineContract } from '@atlas/contract-tests';

import {
  BundledFixtureLoader,
  CedarPolicyEngine,
  parseWrapper,
} from '../src/index.ts';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

const FORBID_OVERRIDES = `
  @id("permit-everything")
  permit (principal, action, resource);

  @id("forbid-deletes")
  forbid (
    principal,
    action == Action::"Catalog.Family.Delete",
    resource
  );
`;

const DEPARTMENT_RBAC = `
  @id("same-department-publish")
  permit (
    principal,
    action == Action::"Catalog.Family.Publish",
    resource is Family
  ) when {
    principal.department == resource.department
  };
`;

const FAMILY_READ_ONLY = `
  @id("read-only")
  permit (
    principal,
    action == Action::"Catalog.Family.Read",
    resource is Family
  );
`;

function makeBundleLoader(map: Record<string, string>): BundledFixtureLoader {
  return new BundledFixtureLoader(new Map(Object.entries(map)));
}

// --- Contract suite -------------------------------------------------------

// The contract suite expects a tenant-match-permits, tenant-mismatch-denies
// engine. The Cedar engine satisfies both via the defensive cross-tenant
// check (mismatch) + permissive fallback (no bundle = permit-on-match).
policyEngineContract(async () => new CedarPolicyEngine(makeBundleLoader({})));

// --- Cedar-specific scenarios --------------------------------------------

describe('CedarPolicyEngine — real Cedar semantics', () => {
  test('permit on matching action when bundle permits', async () => {
    const engine = new CedarPolicyEngine(makeBundleLoader({ [TENANT_A]: FAMILY_READ_ONLY }));
    const decision = await engine.evaluate({
      principal: { id: 'alice', tenantId: TENANT_A, attributes: {} },
      action: 'Catalog.Family.Read',
      resource: { type: 'Family', id: 'fam-1', tenantId: TENANT_A, attributes: {} },
    });
    expect(decision.effect).toBe('permit');
    // Bundle uses the `@id("read-only")` annotation; the engine builds
    // the map form of `staticPolicies` so Cedar surfaces the
    // human-named id in `diagnostics.reason` rather than positional
    // `policy0`.
    expect(decision.matchedPolicies).toContain('read-only');
  });

  test('deny on non-matching action', async () => {
    const engine = new CedarPolicyEngine(makeBundleLoader({ [TENANT_A]: FAMILY_READ_ONLY }));
    const decision = await engine.evaluate({
      principal: { id: 'alice', tenantId: TENANT_A, attributes: {} },
      action: 'Catalog.Family.Delete',
      resource: { type: 'Family', id: 'fam-1', tenantId: TENANT_A, attributes: {} },
    });
    expect(decision.effect).toBe('deny');
  });

  test('forbid overrides permit (Invariant I4)', async () => {
    const engine = new CedarPolicyEngine(
      makeBundleLoader({ [TENANT_A]: FORBID_OVERRIDES }),
    );
    const permit = await engine.evaluate({
      principal: { id: 'alice', tenantId: TENANT_A, attributes: {} },
      action: 'Catalog.Family.Read',
      resource: { type: 'Family', id: 'fam-1', tenantId: TENANT_A, attributes: {} },
    });
    expect(permit.effect).toBe('permit');

    const denied = await engine.evaluate({
      principal: { id: 'alice', tenantId: TENANT_A, attributes: {} },
      action: 'Catalog.Family.Delete',
      resource: { type: 'Family', id: 'fam-1', tenantId: TENANT_A, attributes: {} },
    });
    expect(denied.effect).toBe('deny');
    // Cedar's "reason" set names policies that *contributed* to the
    // decision. For deny via forbid, the forbid policy is reported.
    // FORBID_OVERRIDES annotates the forbid as `@id("forbid-deletes")`.
    expect(denied.matchedPolicies).toContain('forbid-deletes');
  });

  test('attribute-based: principal.department == resource.department permits', async () => {
    const engine = new CedarPolicyEngine(
      makeBundleLoader({ [TENANT_A]: DEPARTMENT_RBAC }),
    );

    const matchingDept = await engine.evaluate({
      principal: {
        id: 'alice',
        tenantId: TENANT_A,
        attributes: { department: 'engineering' },
      },
      action: 'Catalog.Family.Publish',
      resource: {
        type: 'Family',
        id: 'fam-1',
        tenantId: TENANT_A,
        attributes: { department: 'engineering' },
      },
    });
    expect(matchingDept.effect).toBe('permit');

    const mismatchedDept = await engine.evaluate({
      principal: {
        id: 'alice',
        tenantId: TENANT_A,
        attributes: { department: 'engineering' },
      },
      action: 'Catalog.Family.Publish',
      resource: {
        type: 'Family',
        id: 'fam-2',
        tenantId: TENANT_A,
        attributes: { department: 'finance' },
      },
    });
    expect(mismatchedDept.effect).toBe('deny');
  });

  test('cross-tenant: tenant A bundle never evaluates against tenant B request', async () => {
    // Tenant A has a permissive bundle; tenant B has none. A B-tenant
    // request hits tenant B's loader path (not A's), so A's policies
    // can't accidentally permit B.
    const engine = new CedarPolicyEngine(
      makeBundleLoader({ [TENANT_A]: FAMILY_READ_ONLY }),
    );

    // Request whose principal + resource are tenant-B should fall
    // through to the permissive (no-bundle) path — since B has no
    // bundle. The point is that A's `read-only` policy MUST NOT be in
    // the matched list.
    const decisionB = await engine.evaluate({
      principal: { id: 'bob', tenantId: TENANT_B, attributes: {} },
      action: 'Catalog.Family.Read',
      resource: { type: 'Family', id: 'fam-1', tenantId: TENANT_B, attributes: {} },
    });
    expect(decisionB.effect).toBe('permit');
    expect(decisionB.matchedPolicies).toBeUndefined();
    expect(decisionB.reasons?.[0]).toMatch(/no policy bundle/i);
  });

  test('decision shape: matchedPolicies populated for diagnostics', async () => {
    const engine = new CedarPolicyEngine(
      makeBundleLoader({ [TENANT_A]: FAMILY_READ_ONLY }),
    );
    const decision = await engine.evaluate({
      principal: { id: 'alice', tenantId: TENANT_A, attributes: {} },
      action: 'Catalog.Family.Read',
      resource: { type: 'Family', id: 'fam-1', tenantId: TENANT_A, attributes: {} },
    });
    expect(decision.effect).toBe('permit');
    expect(Array.isArray(decision.matchedPolicies)).toBe(true);
    expect(decision.reasons).toBeDefined();
    expect(decision.reasons!.length).toBeGreaterThan(0);
  });

  test('cache invalidation: invalidate(tenantId) drops cached bundle', async () => {
    const map = new Map<string, string>();
    map.set(TENANT_A, FAMILY_READ_ONLY);
    const loader = new BundledFixtureLoader(map);
    const engine = new CedarPolicyEngine(loader);

    const first = await engine.evaluate({
      principal: { id: 'alice', tenantId: TENANT_A, attributes: {} },
      action: 'Catalog.Family.Read',
      resource: { type: 'Family', id: 'fam-1', tenantId: TENANT_A, attributes: {} },
    });
    expect(first.effect).toBe('permit');

    // Mutate the loader's map; next call without invalidate should see
    // the cached old bundle.
    map.set(TENANT_A, ''); // empty bundle: deny everything
    const cached = await engine.evaluate({
      principal: { id: 'alice', tenantId: TENANT_A, attributes: {} },
      action: 'Catalog.Family.Read',
      resource: { type: 'Family', id: 'fam-1', tenantId: TENANT_A, attributes: {} },
    });
    expect(cached.effect).toBe('permit');

    // Invalidate; next call sees the empty bundle and denies.
    engine.invalidate(TENANT_A);
    const refreshed = await engine.evaluate({
      principal: { id: 'alice', tenantId: TENANT_A, attributes: {} },
      action: 'Catalog.Family.Read',
      resource: { type: 'Family', id: 'fam-1', tenantId: TENANT_A, attributes: {} },
    });
    expect(refreshed.effect).toBe('deny');
  });

  test('bundle without @id annotations falls back to positional ids', async () => {
    // Sanity check: when policies omit `@id(...)`, the engine still
    // works (raw-string form). matchedPolicies will be Cedar's
    // positional ids (`policy0`, `policy1`, ...).
    const noAnnotations = `
      permit (
        principal,
        action == Action::"Catalog.Family.Read",
        resource is Family
      );
    `;
    const engine = new CedarPolicyEngine(
      makeBundleLoader({ [TENANT_A]: noAnnotations }),
    );
    const decision = await engine.evaluate({
      principal: { id: 'alice', tenantId: TENANT_A, attributes: {} },
      action: 'Catalog.Family.Read',
      resource: { type: 'Family', id: 'fam-1', tenantId: TENANT_A, attributes: {} },
    });
    expect(decision.effect).toBe('permit');
    expect(decision.matchedPolicies).toContain('policy0');
  });

  test('malformed bundle parses via wrapper helper', () => {
    expect(() =>
      parseWrapper('t', 1, { format: 'rule-json', policies: '...' }),
    ).toThrow(/unsupported format/);
    expect(() =>
      parseWrapper('t', 1, { format: 'cedar-text', policies: 42 }),
    ).toThrow(/policies must be a string/);
    const ok = parseWrapper('t', 7, {
      format: 'cedar-text',
      policies: 'permit (principal, action, resource);',
      schemaVersion: 2,
    });
    expect(ok).toEqual({
      tenantId: 't',
      version: 7,
      cedarText: 'permit (principal, action, resource);',
      schemaVersion: 2,
    });
  });
});
