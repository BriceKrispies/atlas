import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type {
  Crypto,
  Fixture,
  Scenario,
} from '@atlas/ports';
import {
  InMemorySeedCorpus,
  canonicalJsonStringify,
  computeFixtureRef,
  computeScenarioRef,
} from '@atlas/adapter-seed-memory';

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
});
