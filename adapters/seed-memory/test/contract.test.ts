import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type {
  Crypto,
  Fixture,
  Scenario,
} from '@atlas/ports';
import {
  InMemorySeedCorpus,
  computeFixtureRef,
  computeScenarioRef,
} from '@atlas/adapter-seed-memory';
import { canonicalJsonStringify } from '@atlas/platform-core';

/**
 * Smoke tests for `InMemorySeedCorpus`. The full contract suite arrives in
 * Phase 1.5 (`packages/contract-tests/src/seed-corpus.ts`); this file
 * exercises the smallest set of end-to-end paths so the adapter lands
 * green.
 *
 * Test crypto: a minimal `Crypto` stub backed by `node:crypto`. We do NOT
 * import `node:crypto` from the adapter itself (ADR 0008 leak #1 — modules
 * and adapter business logic read crypto via the port). The stub here is
 * test-scoped only.
 */
const testCrypto: Crypto = {
  randomBytes(n) {
    return new Uint8Array(randomBytes(n));
  },
  sha256(input) {
    const data =
      typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);
    return new Uint8Array(createHash('sha256').update(data).digest());
  },
  hmacSha1() {
    throw new Error('not used in seed-memory smoke');
  },
  aesGcmEncrypt() {
    throw new Error('not used in seed-memory smoke');
  },
  aesGcmDecrypt() {
    throw new Error('not used in seed-memory smoke');
  },
  scrypt() {
    throw new Error('not used in seed-memory smoke');
  },
  timingSafeEqual() {
    throw new Error('not used in seed-memory smoke');
  },
};

/**
 * A minimal scenario that matches `seed.scenario.v1.schema.json`. The
 * intent shape mirrors the IntentEnvelope contract from
 * `@atlas/platform-core` (every required field set with a non-empty
 * value). The seed-corpus spec does not include a worked-example
 * scenario inline (it ends at §9 cross-references), so this fixture is
 * the canonical Phase 1 example.
 */
const minimalScenario: Scenario = {
  schemaVersion: 1,
  scenarioId: 'minimal-tenant-bootstrap',
  description: 'Seeds a single tenant with no fixtures.',
  tags: ['smoke'],
  steps: [
    {
      stepId: 'create-tenant',
      intent: {
        eventId: '00000000-0000-4000-8000-000000000001',
        eventType: 'tenant.create',
        schemaId: 'tenant.create.v1',
        schemaVersion: 1,
        occurredAt: '2026-05-10T00:00:00.000Z',
        tenantId: 't_seed',
        correlationId: 'seed:minimal-tenant-bootstrap:0',
        idempotencyKey: 'seed-minimal-0',
        payload: {
          actionId: 'tenant.create',
          resourceType: 'tenant',
          handle: 'seed-tenant',
        },
      },
      asPrincipal: 'operator',
    },
  ],
};

const minimalFixture: Fixture = {
  schemaVersion: 1,
  fixtureId: 'fixtures/admin-principal',
  steps: [
    {
      stepId: 'register-admin',
      intent: {
        eventId: '00000000-0000-4000-8000-000000000002',
        eventType: 'identity.principalCreate',
        schemaId: 'identity.principal.create.v1',
        schemaVersion: 1,
        occurredAt: '2026-05-10T00:00:00.000Z',
        tenantId: 't_seed',
        correlationId: 'seed:fixtures/admin-principal:0',
        idempotencyKey: 'seed-fixture-admin-0',
        payload: {
          actionId: 'identity.principal.create',
          resourceType: 'principal',
          handle: 'admin',
        },
      },
    },
  ],
};

function buildCorpus(): InMemorySeedCorpus {
  const scenarios = new Map<string, Scenario>([
    [minimalScenario.scenarioId, minimalScenario],
  ]);
  const fixtures = new Map<string, Fixture>([
    [minimalFixture.fixtureId, minimalFixture],
  ]);
  return new InMemorySeedCorpus(scenarios, fixtures, testCrypto);
}

describe('InMemorySeedCorpus (smoke)', () => {
  it('listScenarios yields a ScenarioRef with sha256 contentHash', async () => {
    const corpus = buildCorpus();
    const refs = [];
    for await (const ref of corpus.listScenarios()) refs.push(ref);

    expect(refs).toHaveLength(1);
    const [ref] = refs;
    expect(ref!.scenarioId).toBe('minimal-tenant-bootstrap');
    expect(ref!.origin).toBe('fixed');
    expect(ref!.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('PINNED: contentHash for minimalScenario is byte-stable across the sha256Hex extraction', async () => {
    // The contentHash drives fuzz reproducibility (specs/crosscut/
    // seed-corpus.md §4.1): the same scenario body MUST always hash to
    // the same 64-char hex string, otherwise replays diverge between
    // runs. The recent extraction replaced an inline `bytesToHex` helper
    // with `sha256Hex` from @atlas/platform-core; the previous regex pin
    // would pass even if the helper silently changed casing or padding
    // semantics. Pin the literal value of the canonical fixture so any
    // such drift fails the suite.
    //
    // To recompute (when minimalScenario changes intentionally):
    //   node -e "console.log(require('crypto').createHash('sha256')
    //     .update(canonicalJsonStringify(minimalScenario)).digest('hex'))"
    const ref = computeScenarioRef(minimalScenario, testCrypto);
    expect(ref.contentHash).toBe(
      '52140527f2273d4163c2df17c76509106432e74a418e8ae1a179918638940972',
    );
  });

  it('loadScenario validates against seed.scenario.v1 and round-trips', async () => {
    const corpus = buildCorpus();
    const ref = computeScenarioRef(minimalScenario, testCrypto);
    const loaded = await corpus.loadScenario(ref);
    expect(loaded.scenarioId).toBe(minimalScenario.scenarioId);
    expect(loaded.steps).toHaveLength(1);
  });

  it('loadFixture validates against seed.fixture.v1 and round-trips', async () => {
    const corpus = buildCorpus();
    const ref = computeFixtureRef(minimalFixture, testCrypto);
    const loaded = await corpus.loadFixture(ref);
    expect(loaded.fixtureId).toBe(minimalFixture.fixtureId);
  });

  it('throws SEED_SCENARIO_NOT_FOUND for unknown scenarioId', async () => {
    const corpus = buildCorpus();
    await expect(
      corpus.loadScenario({
        scenarioId: 'does-not-exist',
        contentHash: '0'.repeat(64),
        origin: 'fixed',
      }),
    ).rejects.toThrow(/SEED_SCENARIO_NOT_FOUND/);
  });

  it('listScenarios respects prefix filter', async () => {
    const corpus = buildCorpus();
    const matches = [];
    for await (const ref of corpus.listScenarios({ prefix: 'minimal-' })) {
      matches.push(ref);
    }
    expect(matches).toHaveLength(1);

    const misses = [];
    for await (const ref of corpus.listScenarios({ prefix: 'no-match-' })) {
      misses.push(ref);
    }
    expect(misses).toHaveLength(0);
  });

  it('listScenarios respects tags filter (all tags must match)', async () => {
    const corpus = buildCorpus();
    const matches = [];
    for await (const ref of corpus.listScenarios({ tags: ['smoke'] })) {
      matches.push(ref);
    }
    expect(matches).toHaveLength(1);

    const misses = [];
    for await (const ref of corpus.listScenarios({ tags: ['smoke', 'absent'] })) {
      misses.push(ref);
    }
    expect(misses).toHaveLength(0);
  });

  it('canonicalJsonStringify is order-stable across key insertion order', () => {
    const a = JSON.stringify({ b: 1, a: 2 });
    const b = JSON.stringify({ a: 2, b: 1 });
    // JSON.stringify preserves insertion order, so these differ.
    expect(a).not.toBe(b);
    // canonical must not.
    const ca = canonicalJsonStringify({ b: 1, a: 2 });
    const cb = canonicalJsonStringify({ a: 2, b: 1 });
    expect(ca).toBe(cb);
  });

  it('worked-example scenario validates against seed.scenario.v1 via AJV', async () => {
    // The AJV validator is exercised inside loadScenario; if the schema
    // were missing or the example malformed, this would throw
    // SEED_VALIDATION_FAILED. Smoke check that the spec-aligned example
    // round-trips clean.
    const corpus = buildCorpus();
    const ref = computeScenarioRef(minimalScenario, testCrypto);
    const loaded = await corpus.loadScenario(ref);
    expect(loaded).toEqual(minimalScenario);
  });

  it('throws SEED_VALIDATION_FAILED when a stored scenario violates the schema', async () => {
    // A schemaVersion of 2 violates the const:1 constraint in
    // seed.scenario.v1. AJV validation must catch it on load.
    const bad: Scenario = {
      ...minimalScenario,
      // @ts-expect-error — deliberately malformed for the test
      schemaVersion: 2,
    };
    const scenarios = new Map<string, Scenario>([[bad.scenarioId, bad]]);
    const corpus = new InMemorySeedCorpus(scenarios, new Map(), testCrypto);
    const badRef = {
      scenarioId: bad.scenarioId,
      contentHash: '0'.repeat(64),
      origin: 'fixed' as const,
    };
    await expect(corpus.loadScenario(badRef)).rejects.toThrow(
      /SEED_VALIDATION_FAILED/,
    );
    // Symmetry with the not-registered test below: a body-invalid fault
    // must NOT collapse into the registry-misconfig code. Pins the
    // distinction in BOTH directions, so a future swap of the two
    // branches in validateOrThrow would fail this assertion AND the
    // not-registered one (not just one of them).
    await expect(corpus.loadScenario(badRef)).rejects.not.toThrow(
      /SEED_VALIDATOR_NOT_REGISTERED/,
    );
  });

  it('throws SEED_VALIDATION_FAILED when an unknown top-level field is added (additionalProperties:false)', async () => {
    const bad = {
      ...minimalScenario,
      // Schema declares additionalProperties: false; this must be rejected.
      extraneous: 'nope',
    } as unknown as Scenario;
    const scenarios = new Map<string, Scenario>([[bad.scenarioId, bad]]);
    const corpus = new InMemorySeedCorpus(scenarios, new Map(), testCrypto);
    await expect(
      corpus.loadScenario({
        scenarioId: bad.scenarioId,
        contentHash: '0'.repeat(64),
        origin: 'fixed',
      }),
    ).rejects.toThrow(/SEED_VALIDATION_FAILED/);
  });

  it('throws SEED_VALIDATOR_NOT_REGISTERED when the AJV schema is missing from the registry', async () => {
    // Distinct from SEED_VALIDATION_FAILED (body-invalid path). This
    // condition is a platform/config fault — the seed.scenario.v1 schema
    // was never loaded into the AJV registry — and must surface a
    // dedicated code per specs/crosscut/errors.md Seeder section.
    const schemasModule = await import('@atlas/schemas');
    const spy = vi
      .spyOn(schemasModule, 'getSchemaValidator')
      .mockReturnValue(null);
    try {
      const corpus = buildCorpus();
      const ref = computeScenarioRef(minimalScenario, testCrypto);
      await expect(corpus.loadScenario(ref)).rejects.toThrow(
        /SEED_VALIDATOR_NOT_REGISTERED/,
      );
      // Must NOT collapse into the body-invalid code.
      await expect(corpus.loadScenario(ref)).rejects.not.toThrow(
        /SEED_VALIDATION_FAILED/,
      );
      // Message must name the schemaId that wasn't registered — without
      // this, observability can't distinguish which of the two seed
      // schemas tripped the misconfig.
      await expect(corpus.loadScenario(ref)).rejects.toThrow(
        /seed\.scenario\.v1/,
      );
    } finally {
      spy.mockRestore();
    }
  });

  it('throws SEED_VALIDATOR_NOT_REGISTERED on loadFixture when seed.fixture.v1 is missing from the registry', async () => {
    // loadFixture takes the same validateOrThrow branch as loadScenario
    // but with schemaId='seed.fixture.v1'. Pin the new code for the
    // fixture path independently — otherwise a regression that only
    // touched the scenario branch would silently lose fixture coverage.
    const schemasModule = await import('@atlas/schemas');
    const spy = vi
      .spyOn(schemasModule, 'getSchemaValidator')
      .mockReturnValue(null);
    try {
      const corpus = buildCorpus();
      const ref = computeFixtureRef(minimalFixture, testCrypto);
      await expect(corpus.loadFixture(ref)).rejects.toThrow(
        /SEED_VALIDATOR_NOT_REGISTERED/,
      );
      await expect(corpus.loadFixture(ref)).rejects.not.toThrow(
        /SEED_VALIDATION_FAILED/,
      );
      await expect(corpus.loadFixture(ref)).rejects.toThrow(
        /seed\.fixture\.v1/,
      );
    } finally {
      spy.mockRestore();
    }
  });

  it('loadFixture throws SEED_FIXTURE_NOT_FOUND for unknown fixtureId', async () => {
    // Fixture-shaped error code distinguishes the miss from
    // SEED_SCENARIO_NOT_FOUND so callers can branch. Spec entry in
    // `specs/crosscut/errors.md` Seeder section.
    const corpus = buildCorpus();
    await expect(
      corpus.loadFixture({ fixtureId: 'ghost', contentHash: '0'.repeat(64) }),
    ).rejects.toThrow(/SEED_FIXTURE_NOT_FOUND/);
    // Must NOT use the scenario-shaped code anymore.
    await expect(
      corpus.loadFixture({ fixtureId: 'ghost', contentHash: '0'.repeat(64) }),
    ).rejects.not.toThrow(/SEED_SCENARIO_NOT_FOUND/);
  });

  it('listScenarios respects the axes filter for materialized scenarios', async () => {
    const materialised: Scenario = {
      ...minimalScenario,
      scenarioId: 'tpl/region=us-east-1/tier=pro',
      axisBindings: { region: 'us-east-1', tier: 'pro' },
    };
    const scenarios = new Map<string, Scenario>([
      [minimalScenario.scenarioId, minimalScenario],
      [materialised.scenarioId, materialised],
    ]);
    const corpus = new InMemorySeedCorpus(scenarios, new Map(), testCrypto);

    const matches = [];
    for await (const ref of corpus.listScenarios({ axes: { region: 'us-east-1' } })) {
      matches.push(ref);
    }
    expect(matches.map((r) => r.scenarioId)).toEqual(['tpl/region=us-east-1/tier=pro']);

    const missMatches = [];
    for await (const ref of corpus.listScenarios({ axes: { region: 'eu-west-1' } })) {
      missMatches.push(ref);
    }
    expect(missMatches).toHaveLength(0);

    const partialMatches = [];
    for await (const ref of corpus.listScenarios({
      axes: { region: 'us-east-1', tier: 'pro' },
    })) {
      partialMatches.push(ref);
    }
    expect(partialMatches).toHaveLength(1);
  });

  it('listScenarios sets origin=materialized when axisBindings present', async () => {
    const materialised: Scenario = {
      ...minimalScenario,
      scenarioId: 'tpl/k=v',
      axisBindings: { k: 'v' },
    };
    const scenarios = new Map<string, Scenario>([
      [materialised.scenarioId, materialised],
    ]);
    const corpus = new InMemorySeedCorpus(scenarios, new Map(), testCrypto);
    const refs: Array<{ scenarioId: string; origin: string }> = [];
    for await (const ref of corpus.listScenarios()) refs.push(ref);
    expect(refs[0]!.origin).toBe('materialized');
  });

  it('listScenarios is snapshot-at-iteration-start: post-start adds are NOT observed', async () => {
    // Pinned by `specs/crosscut/seed-corpus.md` §4.1 and the port JSDoc
    // on `SeedCorpus.listScenarios`. Rationale: fuzz reproducibility —
    // a run's corpus view is fixed at the moment listScenarios() is
    // called, regardless of concurrent mutations during iteration. The
    // fs and sqlite adapters MUST honour the same semantic.
    const scenarios = new Map<string, Scenario>([
      [minimalScenario.scenarioId, minimalScenario],
    ]);
    const corpus = new InMemorySeedCorpus(scenarios, new Map(), testCrypto);
    const it = corpus.listScenarios()[Symbol.asyncIterator]();
    const first = await it.next();
    expect(first.done).toBe(false);
    // Mutate AFTER the iterator started.
    scenarios.set('late-add', { ...minimalScenario, scenarioId: 'late-add' });
    const next = await it.next();
    expect(next.done).toBe(true); // snapshot semantics: 'late-add' not seen
  });

  it('listScenarios is snapshot-at-iteration-start: post-start DELETES of not-yet-yielded entries are NOT observed', async () => {
    // The §4.1 wording calls out "adds, removes, fs/sqlite writes" as
    // all-excluded. Pin the remove path too — without this assertion
    // an adapter could legally return undefined for a deleted entry
    // mid-iteration and still claim spec compliance.
    const scenarios = new Map<string, Scenario>();
    for (let i = 0; i < 3; i++) {
      scenarios.set(`s-${i}`, { ...minimalScenario, scenarioId: `s-${i}` });
    }
    const corpus = new InMemorySeedCorpus(scenarios, new Map(), testCrypto);
    const it = corpus.listScenarios()[Symbol.asyncIterator]();
    const first = await it.next();
    expect(first.done).toBe(false);
    // Remove an entry the iterator hasn't reached yet.
    scenarios.delete('s-2');
    const second = await it.next();
    const third = await it.next();
    const fourth = await it.next();
    // All three originally-snapshotted scenarios must still yield.
    expect([first.value!.scenarioId, second.value!.scenarioId, third.value!.scenarioId].sort())
      .toEqual(['s-0', 's-1', 's-2']);
    expect(fourth.done).toBe(true);
  });

  it('listScenarios snapshot is per-call: a NEW listScenarios() after a mutation DOES observe the mutation', async () => {
    // The other half of the snapshot contract: consumers that want to
    // see post-start writes call listScenarios() again. This is the
    // documented re-call path in the port JSDoc and §4.1.
    const scenarios = new Map<string, Scenario>([
      [minimalScenario.scenarioId, minimalScenario],
    ]);
    const corpus = new InMemorySeedCorpus(scenarios, new Map(), testCrypto);

    const before: string[] = [];
    for await (const ref of corpus.listScenarios()) before.push(ref.scenarioId);
    expect(before).toEqual([minimalScenario.scenarioId]);

    scenarios.set('late-add', { ...minimalScenario, scenarioId: 'late-add' });

    const after: string[] = [];
    for await (const ref of corpus.listScenarios()) after.push(ref.scenarioId);
    expect(after.sort()).toEqual([minimalScenario.scenarioId, 'late-add'].sort());
  });

  it('listScenarios early-break does not leak state (re-iterating yields full list)', async () => {
    const scenarios = new Map<string, Scenario>();
    for (let i = 0; i < 3; i++) {
      scenarios.set(`s-${i}`, { ...minimalScenario, scenarioId: `s-${i}` });
    }
    const corpus = new InMemorySeedCorpus(scenarios, new Map(), testCrypto);
    // First iteration with early break.
    let count = 0;
    for await (const _ref of corpus.listScenarios()) {
      count++;
      if (count === 1) break;
    }
    expect(count).toBe(1);
    // Second iteration should see all 3 again.
    const second: string[] = [];
    for await (const ref of corpus.listScenarios()) {
      second.push(ref.scenarioId);
    }
    expect(second).toHaveLength(3);
  });

  it('listScenarios over an empty corpus completes without error', async () => {
    const corpus = new InMemorySeedCorpus(new Map(), new Map(), testCrypto);
    const refs = [];
    for await (const ref of corpus.listScenarios()) refs.push(ref);
    expect(refs).toHaveLength(0);
  });

  it('canonicalJsonStringify (consolidated in @atlas/platform-core): Date → ISO string, distinct dates hash distinct', () => {
    // Consolidated impl: both adapter and seeder now import from
    // @atlas/platform-core. Date values serialise via toJSON (ISO
    // string), mirroring JSON.stringify. Two scenarios differing only
    // in a Date value MUST yield distinct canonical bytes per spec
    // §4.1 determinism contract.
    const a = canonicalJsonStringify({ at: new Date('2026-05-10T00:00:00Z') });
    const b = canonicalJsonStringify({ at: new Date('2026-05-11T00:00:00Z') });
    expect(a).toBe('{"at":"2026-05-10T00:00:00.000Z"}');
    expect(b).toBe('{"at":"2026-05-11T00:00:00.000Z"}');
    expect(a).not.toBe(b);
  });

  it('contentHash is stable across rebuilds of the same scenario', () => {
    const r1 = computeScenarioRef(minimalScenario, testCrypto);
    const r2 = computeScenarioRef(minimalScenario, testCrypto);
    expect(r1.contentHash).toBe(r2.contentHash);
  });

  it('contentHash is stable under shuffled top-level key insertion order', () => {
    const reordered = {
      tags: minimalScenario.tags,
      steps: minimalScenario.steps,
      schemaVersion: minimalScenario.schemaVersion,
      description: minimalScenario.description,
      scenarioId: minimalScenario.scenarioId,
    } as Scenario;
    const r1 = computeScenarioRef(minimalScenario, testCrypto);
    const r2 = computeScenarioRef(reordered, testCrypto);
    expect(r1.contentHash).toBe(r2.contentHash);
  });

  // Regression pin for chore/event-envelope-schema-id-rename.
  //
  // The seed.scenario.v1 / seed.fixture.v1 contracts reference the event
  // envelope by its short `$id` (`$ref: "event-envelope.v1#"`). The
  // @atlas/schemas loader registers `event_envelope.schema.json` via
  // `ajv.addSchema(eventEnvelope)` — no alias, no explicit key — so AJV
  // discovers the schema strictly by the schema's own `$id`.
  //
  // If anyone re-introduces a long-URL `$id` on event_envelope.schema.json
  // (and forgets to either restore the loader alias or rewrite the seed
  // schemas' $refs), this test fails fast with a focused signal instead of
  // a noisy AJV "can't resolve reference" deep in the seed-validation path.
  it('regression: getSchemaValidator("event-envelope.v1") returns a usable validator (no loader alias needed)', async () => {
    const { getSchemaValidator } = await import('@atlas/schemas');
    const validate = getSchemaValidator('event-envelope.v1', 1);
    expect(validate).not.toBeNull();
    // Sanity-check the validator with the in-test minimalScenario's intent —
    // that intent is the canonical envelope-shaped payload we already round-
    // trip elsewhere in this file, so if event-envelope.v1 resolved to a
    // mis-bound schema we'd see it here too.
    const intent = minimalScenario.steps[0]!.intent;
    expect(validate!(intent)).toBe(true);
  });
});
