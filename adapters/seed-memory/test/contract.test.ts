import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from '@atlas/test';
import type { Crypto, Fixture, Scenario, } from '@atlas/ports';
import { canonicalJsonStringify } from '@atlas/platform-core';
import { seedCorpusContract, type SeedCorpusFactory, type SeedCorpusFactoryResult, } from '@atlas/contract-tests';
import { InMemorySeedCorpus, } from '@atlas/adapter-seed-memory';
/**
 * Adapter test wiring for `@atlas/adapter-seed-memory`.
 *
 * Most coverage lives in `@atlas/contract-tests/src/seed-corpus.ts` —
 * the suite every `SeedCorpus` adapter must pass. This file is the
 * adapter-specific bridge: it builds a factory that produces
 * `InMemorySeedCorpus` instances + mutation hooks for snapshot tests,
 * plus the registry-spy used to simulate
 * `SEED_VALIDATOR_NOT_REGISTERED`.
 *
 * Three regression pins remain here that are NOT port-contract
 * concerns: two pin `@atlas/platform-core`'s `canonicalJsonStringify`
 * (order-stability + Date semantics) and one pins
 * `@atlas/schemas`' registration of `event-envelope.v1`. They use the
 * same in-memory adapter as a vehicle but the asserted behavior lives
 * in those upstream packages.
 */
const testCrypto: Crypto = {
    randomBytes(n) {
        return new Uint8Array(randomBytes(n));
    },
    sha256(input) {
        const data = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);
        return new Uint8Array(createHash('sha256').update(data).digest());
    },
    hmacSha1() {
        throw new Error('not used in seed-memory contract');
    },
    aesGcmEncrypt() {
        throw new Error('not used in seed-memory contract');
    },
    aesGcmDecrypt() {
        throw new Error('not used in seed-memory contract');
    },
    scrypt() {
        throw new Error('not used in seed-memory contract');
    },
    timingSafeEqual() {
        throw new Error('not used in seed-memory contract');
    },
};
/**
 * Factory for the contract suite. Each test gets a fresh corpus +
 * mutation hooks; the hooks operate on the same Maps the corpus
 * captures so post-construction add / remove are visible to the
 * adapter (whose `listScenarios()` then snapshots at iterator-start).
 *
 * The `simulateValidatorMissing` hook scopes a `vi.spyOn` on
 * `getSchemaValidator` to the callback. We restore the spy in a
 * `finally` so a failing assertion can't leak the missing-validator
 * state across tests.
 */
const factory: SeedCorpusFactory = async function ({ scenarios, fixtures }): Promise<SeedCorpusFactoryResult> {
    const scenarioMap = new Map<string, Scenario>(scenarios.map(function (s) {
        return [s.scenarioId, s];
    }));
    const fixtureMap = new Map<string, Fixture>(fixtures.map(function (f) {
        return [f.fixtureId, f];
    }));
    const corpus = new InMemorySeedCorpus(scenarioMap, fixtureMap, testCrypto);
    return {
        corpus,
        addScenario(scenario: Scenario) {
            scenarioMap.set(scenario.scenarioId, scenario);
        },
        addFixture(fixture: Fixture) {
            fixtureMap.set(fixture.fixtureId, fixture);
        },
        removeScenario(scenarioId: string) {
            scenarioMap.delete(scenarioId);
        },
        async simulateValidatorMissing(schemaId, fn) {
            // Node ESM forbids reassigning module exports, so the legacy
            // `vi.spyOn(schemasModule, 'getSchemaValidator')` no longer
            // works. `@atlas/schemas` exposes a test-only override map
            // (`__setSchemaValidatorOverrideForTest`) that the loader
            // consults before Ajv; setting `null` simulates "missing".
            const { __setSchemaValidatorOverrideForTest } = await import('@atlas/schemas');
            __setSchemaValidatorOverrideForTest(schemaId, null);
            try {
                await fn();
            } finally {
                __setSchemaValidatorOverrideForTest(schemaId, undefined);
            }
        },
    };
};
seedCorpusContract(factory);
// ─── Adapter-local regression pins ─────────────────────────────────
//
// These do not belong in the port contract — they pin behavior of
// `@atlas/platform-core` (canonical JSON) and `@atlas/schemas`
// (event-envelope registration). The in-memory adapter is the
// convenient vehicle; the assertions are about those upstream
// packages.
describe('InMemorySeedCorpus — adapter-local regressions', function () {
    it('canonicalJsonStringify is order-stable across key insertion order', function () {
        // JSON.stringify preserves insertion order; canonical must not.
        const a = JSON.stringify({ b: 1, a: 2 });
        const b = JSON.stringify({ a: 2, b: 1 });
        expect(a).not.toBe(b);
        const ca = canonicalJsonStringify({ b: 1, a: 2 });
        const cb = canonicalJsonStringify({ a: 2, b: 1 });
        expect(ca).toBe(cb);
    });
    it('canonicalJsonStringify: Date → ISO string, distinct dates hash distinct', function () {
        // Two scenarios differing only in a Date value MUST yield distinct
        // canonical bytes per spec §4.1 determinism contract.
        const a = canonicalJsonStringify({ at: new Date('2026-05-10T00:00:00Z') });
        const b = canonicalJsonStringify({ at: new Date('2026-05-11T00:00:00Z') });
        expect(a).toBe('{"at":"2026-05-10T00:00:00.000Z"}');
        expect(b).toBe('{"at":"2026-05-11T00:00:00.000Z"}');
        expect(a).not.toBe(b);
    });
    it('regression: getSchemaValidator("event-envelope.v1") returns a usable validator (no loader alias needed)', async function () {
        // The seed.scenario.v1 / seed.fixture.v1 contracts reference the
        // event envelope by its short `$id` (`$ref: "event-envelope.v1#"`).
        // The @atlas/schemas loader registers `event_envelope.schema.json`
        // via `ajv.addSchema(eventEnvelope)` — no alias, no explicit key.
        //
        // If anyone re-introduces a long-URL `$id` on
        // event_envelope.schema.json (and forgets to either restore the
        // loader alias or rewrite the seed schemas' $refs), this test
        // fails fast with a focused signal instead of a noisy AJV
        // "can't resolve reference" deep in the seed-validation path.
        const { getSchemaValidator } = await import('@atlas/schemas');
        const validate = getSchemaValidator('event-envelope.v1', 1);
        expect(validate).not.toBeNull();
        // Sanity-check the validator with an envelope-shaped intent.
        const sampleIntent = {
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
        };
        if (!validate)
            throw new Error('validator should be non-null');
        expect(validate(sampleIntent)).toBe(true);
    });
});
