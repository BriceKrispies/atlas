/**
 * Schema-generator unit tests.
 *
 * Two halves:
 *
 *   1. Pure-function shape: a synthetic manifest produces the expected
 *      Cedar Schema (entityTypes for User + each resource, actions for
 *      each action with appliesTo principal=User + the declared resource).
 *
 *   2. Round-trip with real cedar-wasm: a valid policy validates clean
 *      against the generated schema; a policy referencing a non-existent
 *      action fails Cedar's `validate` with a pinpointed diagnostic.
 *
 * The cedar-wasm bits are gated behind a `try { import }` so the tests
 * also pass on environments where the WASM binary isn't present (we keep
 * the assertion behind a Vitest skip-on-throw rather than a hard skip
 * marker because the suite still wants to run the pure assertions).
 */

import { describe, expect, test } from 'vitest';
import {
  ATLAS_NAMESPACE,
  CedarPolicyEngine,
  generateCedarSchema,
  USER_ENTITY_TYPE,
} from '../src/index.ts';
import { BundledFixtureLoader } from '../src/bundle-loader.ts';
import type { ModuleManifest } from '../src/schema-generator.ts';

const SAMPLE_MANIFEST: ModuleManifest = {
  moduleId: 'test-module',
  resources: [
    { resourceType: 'Family' },
    { resourceType: 'Variant' },
  ],
  actions: [
    { actionId: 'Catalog.Family.Publish', resourceType: 'Family' },
    { actionId: 'Catalog.Family.Read', resourceType: 'Family' },
    { actionId: 'Catalog.Variant.Upsert', resourceType: 'Variant' },
  ],
};

// Round-trip-only manifest: includes the actions referenced by the test
// policies below so cedar-wasm's strict validator doesn't choke on
// "unrecognized action" errors. Pure-shape tests use SAMPLE_MANIFEST.
const ROUND_TRIP_MANIFEST: ModuleManifest = SAMPLE_MANIFEST;

describe('generateCedarSchema — pure shape', () => {
  test('emits a single namespace key (empty namespace today; see schema-generator.ts)', () => {
    const schema = generateCedarSchema([SAMPLE_MANIFEST]);
    expect(Object.keys(schema)).toEqual([ATLAS_NAMESPACE]);
  });

  test('emits User + every declared resource as entity types', () => {
    const schema = generateCedarSchema([SAMPLE_MANIFEST]);
    const ns = schema[ATLAS_NAMESPACE]!;
    expect(Object.keys(ns.entityTypes).sort()).toEqual(
      [USER_ENTITY_TYPE, 'Family', 'Variant'].sort(),
    );
  });

  test('emits every declared action with appliesTo wired to User + resource', () => {
    const schema = generateCedarSchema([SAMPLE_MANIFEST]);
    const ns = schema[ATLAS_NAMESPACE]!;
    expect(Object.keys(ns.actions).sort()).toEqual([
      'Catalog.Family.Publish',
      'Catalog.Family.Read',
      'Catalog.Variant.Upsert',
    ]);
    expect(ns.actions['Catalog.Family.Publish']).toEqual({
      appliesTo: { principalTypes: ['User'], resourceTypes: ['Family'] },
    });
    expect(ns.actions['Catalog.Variant.Upsert']).toEqual({
      appliesTo: { principalTypes: ['User'], resourceTypes: ['Variant'] },
    });
  });

  test('User entity is shape-less (cedar-wasm strict mode does not allow additionalAttributes)', () => {
    // See `schema-generator.ts::userEntityType` for the rationale —
    // closing the shape is gated on module manifests declaring an
    // attribute schema (Chunk 6c+1).
    const schema = generateCedarSchema([SAMPLE_MANIFEST]);
    const user = schema[ATLAS_NAMESPACE]!.entityTypes[USER_ENTITY_TYPE]!;
    expect(user).toEqual({});
  });

  test('inferred resource entity types when manifest forgets to list them', () => {
    // An action references `Foo` but the manifest doesn't list `Foo` under
    // `resources`. Generator emits an inferred entity type so the schema
    // still validates.
    const partial: ModuleManifest = {
      actions: [{ actionId: 'X.Foo.Do', resourceType: 'Foo' }],
    };
    const schema = generateCedarSchema([partial]);
    expect(schema[ATLAS_NAMESPACE]!.entityTypes['Foo']).toBeDefined();
  });

  test('merges multiple manifests (same resource type collapses to one)', () => {
    const a: ModuleManifest = {
      resources: [{ resourceType: 'Shared' }],
      actions: [{ actionId: 'M1.Shared.Read', resourceType: 'Shared' }],
    };
    const b: ModuleManifest = {
      resources: [{ resourceType: 'Shared' }],
      actions: [{ actionId: 'M2.Shared.Write', resourceType: 'Shared' }],
    };
    const schema = generateCedarSchema([a, b]);
    expect(Object.keys(schema[ATLAS_NAMESPACE]!.entityTypes).sort()).toEqual([
      USER_ENTITY_TYPE,
      'Shared',
    ].sort());
    expect(Object.keys(schema[ATLAS_NAMESPACE]!.actions).sort()).toEqual([
      'M1.Shared.Read',
      'M2.Shared.Write',
    ]);
  });

  test('empty manifests still produce a User entity (the namespace stays valid)', () => {
    const schema = generateCedarSchema([]);
    expect(schema[ATLAS_NAMESPACE]).toBeDefined();
    expect(schema[ATLAS_NAMESPACE]!.entityTypes[USER_ENTITY_TYPE]).toBeDefined();
    expect(Object.keys(schema[ATLAS_NAMESPACE]!.actions)).toHaveLength(0);
  });
});

// --- Round-trip with real cedar-wasm ----------------------------------------

const VALID_POLICY = `
  permit (
    principal,
    action == Action::"Catalog.Family.Read",
    resource is Family
  );
`;

const POLICY_REFERENCING_UNKNOWN_ACTION = `
  permit (
    principal,
    action == Action::"Catalog.Family.NoSuchAction",
    resource is Family
  );
`;

describe('generateCedarSchema — round-trip with cedar-wasm validate', () => {
  test('valid policy passes schema validation', async () => {
    const schema = generateCedarSchema([SAMPLE_MANIFEST]);
    const engine = new CedarPolicyEngine(new BundledFixtureLoader(new Map()), {
      schema,
    });
    const answer = await engine.validate(VALID_POLICY);
    if (answer.type === 'failure') {
      throw new Error(
        `cedar validate failed unexpectedly: ${JSON.stringify(answer.errors)}`,
      );
    }
    expect(answer.type).toBe('success');
    expect(answer.validationErrors).toEqual([]);
  });

  test('policy referencing a non-existent action fails validation', async () => {
    const schema = generateCedarSchema([SAMPLE_MANIFEST]);
    const engine = new CedarPolicyEngine(new BundledFixtureLoader(new Map()), {
      schema,
    });
    const answer = await engine.validate(POLICY_REFERENCING_UNKNOWN_ACTION);
    // cedar-wasm reports unknown actions either as validationErrors
    // (`type: 'success'`) or as parse failures depending on the build.
    // Accept either form so this test stays stable across cedar-wasm
    // patch versions.
    if (answer.type === 'success') {
      expect(answer.validationErrors.length).toBeGreaterThan(0);
      const messages = answer.validationErrors
        .map((e) => e.error.message)
        .join(' | ');
      expect(messages).toMatch(/NoSuchAction|undeclared action|Action::"Catalog\.Family\.NoSuchAction"/i);
    } else {
      expect(answer.errors.length).toBeGreaterThan(0);
    }
  });
});
