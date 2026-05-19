/**
 * Phase-1 runner contract tests.
 *
 * Spec: `specs/crosscut/seed-corpus.md` §4.3 + §6.
 *
 * Asserts:
 *   - 2-step scenario walks through the IntentDriver in order.
 *   - Idempotency key per step matches sha256(scenarioId+'::'+i)[:32].
 *   - correlationId per step matches `seed:${scenarioId}:${i}`.
 *   - RunResult shape (scenarioId, contentHash, steps[]).
 *   - Fail-fast: a failing step short-circuits the rest.
 *   - `expect` clause flips ok=true into reported ok=false on mismatch.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from '@atlas/test';
import { canonicalJsonStringify, deriveCorrelationId, deriveIdempotencyKey, runScenario, } from '../src/index.ts';
import type { IntentDriver, IntentResult, RunnerDeps, Scenario, ScenarioRef, SeedCorpus, } from '../src/index.ts';
import type { Crypto } from '@atlas/ports';
import type { IntentEnvelope } from '@atlas/platform-core';
import { assertDefined } from '@atlas/test-fixtures/assert';
// --- Test doubles -----------------------------------------------------------
const stubCrypto: Crypto = {
    randomBytes() {
        throw new Error('not used in seeder runner tests');
    },
    sha256(input) {
        const data = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);
        return new Uint8Array(createHash('sha256').update(data).digest());
    },
    hmacSha1() {
        throw new Error('not used in seeder runner tests');
    },
    aesGcmEncrypt() {
        throw new Error('not used in seeder runner tests');
    },
    aesGcmDecrypt() {
        throw new Error('not used in seeder runner tests');
    },
    scrypt() {
        throw new Error('not used in seeder runner tests');
    },
    timingSafeEqual() {
        throw new Error('not used in seeder runner tests');
    },
};
function makeIntent(actionId: string, resourceId: string): IntentEnvelope {
    return {
        eventType: 'TestIntent',
        schemaId: 'test.intent.v1',
        schemaVersion: 1,
        tenantId: 't-test',
        correlationId: 'will-be-overwritten',
        idempotencyKey: 'will-be-overwritten',
        payload: { actionId, resourceType: 'TestResource', resourceId },
    };
}
function makeScenario(): Scenario {
    return {
        schemaVersion: 1,
        scenarioId: 'unit/two-step',
        steps: [
            { stepId: 's1', intent: makeIntent('Test.Do.First', 'r1') },
            { stepId: 's2', intent: makeIntent('Test.Do.Second', 'r2') },
        ],
    };
}
function makeRef(scenarioId: string, contentHash: string): ScenarioRef {
    return { scenarioId, contentHash, origin: 'fixed' };
}
function corpusReturning(scenario: Scenario): SeedCorpus {
    return {
        listScenarios() {
            throw new Error('listScenarios not used in this test');
        },
        async loadScenario() {
            return scenario;
        },
        async loadFixture() {
            throw new Error('loadFixture not used in this test');
        },
    };
}
interface Recorder {
    driver: IntentDriver;
    envelopes: IntentEnvelope[];
    responses: IntentResult[];
}
function recordingDriver(responses: IntentResult[]): Recorder {
    const envelopes: IntentEnvelope[] = [];
    let i = 0;
    const driver: IntentDriver = {
        async submit(env) {
            envelopes.push(env);
            const r = responses[i++] ?? { ok: true };
            return r;
        },
    };
    return { driver, envelopes, responses };
}
function deps(scenario: Scenario, responses: IntentResult[]): {
    d: RunnerDeps;
    rec: Recorder;
} {
    const rec = recordingDriver(responses);
    return {
        d: {
            corpus: corpusReturning(scenario),
            driver: rec.driver,
            crypto: stubCrypto,
        },
        rec,
    };
}
// --- Tests ------------------------------------------------------------------
describe('runScenario (Phase 1 skeleton)', function () {
    it('walks a 2-step scenario through the IntentDriver in order', async function () {
        const scenario = makeScenario();
        const { d, rec } = deps(scenario, [
            { ok: true, resultRef: 'evt-1' },
            { ok: true, resultRef: 'evt-2' },
        ]);
        const ref = makeRef(scenario.scenarioId, 'hash-abc');
        const result = await runScenario(d, ref);
        expect(rec.envelopes).toHaveLength(2);
        expect(assertDefined(rec.envelopes[0], 'envelope[0] recorded after length check').payload
            .actionId).toBe('Test.Do.First');
        expect(assertDefined(rec.envelopes[1], 'envelope[1] recorded after length check').payload
            .actionId).toBe('Test.Do.Second');
        expect(result.scenarioId).toBe('unit/two-step');
        expect(result.contentHash).toBe('hash-abc');
        expect(result.steps).toHaveLength(2);
        expect(result.steps[0]).toMatchObject({
            stepId: 's1',
            ok: true,
            resultRef: 'evt-1',
        });
        expect(result.steps[1]).toMatchObject({
            stepId: 's2',
            ok: true,
            resultRef: 'evt-2',
        });
    });
    it('stamps the deterministic idempotencyKey + correlationId per step', async function () {
        const scenario = makeScenario();
        const { d, rec } = deps(scenario, [{ ok: true }, { ok: true }]);
        const ref = makeRef(scenario.scenarioId, 'hash-abc');
        await runScenario(d, ref);
        const key0 = deriveIdempotencyKey(stubCrypto, scenario.scenarioId, 0);
        const key1 = deriveIdempotencyKey(stubCrypto, scenario.scenarioId, 1);
        expect(assertDefined(rec.envelopes[0], 'envelope[0] stamped on a 2-step scenario').idempotencyKey).toBe(key0);
        expect(assertDefined(rec.envelopes[1], 'envelope[1] stamped on a 2-step scenario').idempotencyKey).toBe(key1);
        expect(assertDefined(rec.envelopes[0], 'envelope[0] stamped on a 2-step scenario').correlationId).toBe(deriveCorrelationId(scenario.scenarioId, 0));
        expect(assertDefined(rec.envelopes[1], 'envelope[1] stamped on a 2-step scenario').correlationId).toBe(deriveCorrelationId(scenario.scenarioId, 1));
        // Spec: idempotencyKey is sha256-hex truncated to 32 chars.
        expect(key0).toHaveLength(32);
        expect(key0).not.toBe(key1);
    });
    it('fails fast: a failing step short-circuits the remainder', async function () {
        const scenario = makeScenario();
        const { d, rec } = deps(scenario, [
            { ok: false, errorCode: 'BOOM' },
            { ok: true }, // never reached
        ]);
        const ref = makeRef(scenario.scenarioId, 'hash-abc');
        const result = await runScenario(d, ref);
        expect(rec.envelopes).toHaveLength(1);
        expect(result.steps).toHaveLength(1);
        expect(result.steps[0]).toMatchObject({ stepId: 's1', ok: false, errorCode: 'BOOM' });
    });
    it('honours the step.expect clause when present', async function () {
        const scenario: Scenario = {
            schemaVersion: 1,
            scenarioId: 'unit/expect',
            steps: [
                {
                    stepId: 's1',
                    intent: makeIntent('Test.Do', 'r1'),
                    // We expect this step to FAIL with NOT_FOUND. The driver returns
                    // ok:true → mismatch → reported ok:false.
                    expect: { ok: false, errorCode: 'NOT_FOUND' },
                },
            ],
        };
        const { d } = deps(scenario, [{ ok: true }]);
        const ref = makeRef(scenario.scenarioId, 'hash-x');
        const result = await runScenario(d, ref);
        expect(assertDefined(result.steps[0], 'single-step scenario reports one step').ok).toBe(false);
    });
});
describe('canonicalJsonStringify', function () {
    it('emits keys in lexical order regardless of insertion order', function () {
        const a = canonicalJsonStringify({ b: 2, a: 1, c: { y: 'Y', x: 'X' } });
        const b = canonicalJsonStringify({ c: { x: 'X', y: 'Y' }, a: 1, b: 2 });
        expect(a).toBe(b);
        expect(a).toBe('{"a":1,"b":2,"c":{"x":"X","y":"Y"}}');
    });
    it('preserves array order and stringifies primitives like JSON.stringify', function () {
        expect(canonicalJsonStringify([3, 1, 2])).toBe('[3,1,2]');
        expect(canonicalJsonStringify(null)).toBe('null');
        expect(canonicalJsonStringify('hi')).toBe('"hi"');
        expect(canonicalJsonStringify(42)).toBe('42');
        expect(canonicalJsonStringify(true)).toBe('true');
    });
    it('throws TypeError on a cyclic value rather than infinite-looping', function () {
        const cyc: Record<string, unknown> = { a: 1 };
        cyc['self'] = cyc;
        expect(function () {
            return canonicalJsonStringify(cyc);
        }).toThrow(TypeError);
    });
    it('throws TypeError on bigint values (not JSON-serialisable)', function () {
        expect(function () {
            return canonicalJsonStringify({ n: 1n });
        }).toThrow(TypeError);
    });
    it('drops undefined / function / symbol object values, mirroring JSON.stringify', function () {
        const out = canonicalJsonStringify({
            a: 1,
            b: undefined,
            c: function () {
                return 1;
            },
            d: Symbol('x'),
            e: null,
        });
        // Only `a` and `e: null` survive.
        expect(out).toBe('{"a":1,"e":null}');
    });
    it('replaces undefined / function / symbol array entries with null', function () {
        const out = canonicalJsonStringify([1, undefined, function () {
                return 1;
            }, Symbol('x'), 2]);
        expect(out).toBe('[1,null,null,null,2]');
    });
    it('emits NaN / Infinity as null (mirrors JSON.stringify of those primitives)', function () {
        expect(canonicalJsonStringify(NaN)).toBe('null');
        expect(canonicalJsonStringify(Infinity)).toBe('null');
        expect(canonicalJsonStringify(-Infinity)).toBe('null');
    });
    it('handles deeply nested arrays-of-objects deterministically', function () {
        const a = canonicalJsonStringify([{ b: 1, a: 2 }, { z: 3, x: 4 }]);
        const b = canonicalJsonStringify([{ a: 2, b: 1 }, { x: 4, z: 3 }]);
        expect(a).toBe(b);
    });
    it('Date objects serialise to ISO strings via toJSON — distinct dates hash distinct', function () {
        // Spec §4.1 determinism contract: two scenarios differing only in a
        // Date value MUST produce distinct canonical bytes (and therefore
        // distinct contentHashes). The consolidated canonicalJsonStringify in
        // @atlas/platform-core mirrors JSON.stringify Date semantics —
        // Dates serialise to their ISO string via toJSON, not `{}`.
        const a = canonicalJsonStringify({ at: new Date('2026-05-10T00:00:00Z') });
        const b = canonicalJsonStringify({ at: new Date('2026-05-11T00:00:00Z') });
        expect(a).toBe('{"at":"2026-05-10T00:00:00.000Z"}');
        expect(b).toBe('{"at":"2026-05-11T00:00:00.000Z"}');
        expect(a).not.toBe(b);
    });
});
describe('deriveIdempotencyKey', function () {
    it('is deterministic across calls', function () {
        const a = deriveIdempotencyKey(stubCrypto, 'sid', 0);
        const b = deriveIdempotencyKey(stubCrypto, 'sid', 0);
        expect(a).toBe(b);
        expect(a).toMatch(/^[0-9a-f]{32}$/);
    });
    it('produces distinct keys for distinct stepIndex with the same content', function () {
        const a = deriveIdempotencyKey(stubCrypto, 'sid', 0);
        const b = deriveIdempotencyKey(stubCrypto, 'sid', 1);
        expect(a).not.toBe(b);
    });
    it('produces distinct keys for distinct scenarioIds at the same stepIndex', function () {
        const a = deriveIdempotencyKey(stubCrypto, 'sid-a', 0);
        const b = deriveIdempotencyKey(stubCrypto, 'sid-b', 0);
        expect(a).not.toBe(b);
    });
    it('PINNED: exact bytes for known (scenarioId, stepIndex) pairs do not drift', function () {
        // The seeder uses these keys to dedupe re-applies. A byte-level shift
        // in the hash output (e.g. uppercase hex, leading-zero pruning,
        // a different UTF-8 encoding path) would silently invalidate every
        // existing replay log. Pin the exact 32 hex chars for a known input
        // so the sha256Hex extraction can't drift without the test failing.
        //
        // Source of truth: openssl-equivalent
        //   sha256("seed/scenario-1::0") = 7cb2e2ea83e721c5e4c1b50d96fa28fe<...>
        //   sha256("seed/scenario-1::1") = 91dc561f37e2f948436bca11f4f7956a<...>
        expect(deriveIdempotencyKey(stubCrypto, 'seed/scenario-1', 0)).toBe('7cb2e2ea83e721c5e4c1b50d96fa28fe');
        expect(deriveIdempotencyKey(stubCrypto, 'seed/scenario-1', 1)).toBe('91dc561f37e2f948436bca11f4f7956a');
    });
    it('SENTINEL COLLISION: scenarioIds containing "::" are NOT delimiter-safe', function () {
        // Spec §4.3: idempotencyKey = sha256Hex(scenarioId + '::' + i).slice(0, 32).
        // The current encoding has no field separator. Two distinct
        // (scenarioId, stepIndex) pairs that flatten to the same byte sequence
        // collide. e.g. ('abc::1', 2) and ('abc', '1::2'-shaped-step) cannot
        // collide because step is a number — but ('abc::', 12) → 'abc::::12'
        // and ('abc', '::12'-shaped-step) likewise can't because step is a
        // number. The realistic risk is: ('a', 12) → 'a::12' vs ('a::1', 2) →
        // 'a::1::2'. These don't collide. So with stepIndex-as-number the
        // grammar is in fact injective today. Document the assumption so a
        // future change (e.g. compound stepIds) doesn't break it silently.
        const k1 = deriveIdempotencyKey(stubCrypto, 'a', 12);
        const k2 = deriveIdempotencyKey(stubCrypto, 'a::1', 2);
        expect(k1).not.toBe(k2);
    });
});
describe('runScenario — additional coverage', function () {
    it('runs a 0-step scenario without invoking the driver', async function () {
        // Note: schema requires minItems:1 but the runner is the spec's
        // dispatch contract; AJV validation lives at the adapter level. The
        // runner must not crash on an empty steps array if a caller bypasses
        // validation (e.g. an in-process driver).
        const scenario: Scenario = {
            schemaVersion: 1,
            scenarioId: 'unit/empty',
            steps: [],
        };
        const { d, rec } = deps(scenario, []);
        const result = await runScenario(d, makeRef(scenario.scenarioId, 'h'));
        expect(rec.envelopes).toHaveLength(0);
        expect(result.steps).toHaveLength(0);
        expect(result.scenarioId).toBe('unit/empty');
    });
    it('propagates errors thrown by IntentDriver.submit (does not swallow)', async function () {
        const scenario = makeScenario();
        const driver: IntentDriver = {
            async submit() {
                throw new Error('transport-down');
            },
        };
        const d: RunnerDeps = {
            corpus: corpusReturning(scenario),
            driver,
            crypto: stubCrypto,
        };
        await expect(runScenario(d, makeRef(scenario.scenarioId, 'h'))).rejects.toThrow(/transport-down/);
    });
    it('propagates errors thrown by SeedCorpus.loadScenario (does not swallow)', async function () {
        const corpus: SeedCorpus = {
            listScenarios() {
                throw new Error('not-used');
            },
            async loadScenario() {
                throw new Error('SEED_SCENARIO_NOT_FOUND: ghost');
            },
            async loadFixture() {
                throw new Error('not-used');
            },
        };
        const { driver } = recordingDriver([]);
        await expect(runScenario({ corpus, driver, crypto: stubCrypto }, makeRef('ghost', 'h'))).rejects.toThrow(/SEED_SCENARIO_NOT_FOUND/);
    });
    it('expect.ok=true matches a driver-ok response (positive path)', async function () {
        const scenario: Scenario = {
            schemaVersion: 1,
            scenarioId: 'unit/expect-ok',
            steps: [
                {
                    stepId: 's1',
                    intent: makeIntent('Test.Do', 'r1'),
                    expect: { ok: true },
                },
            ],
        };
        const { d } = deps(scenario, [{ ok: true }]);
        const result = await runScenario(d, makeRef(scenario.scenarioId, 'h'));
        expect(assertDefined(result.steps[0], 'single-step scenario reports one step').ok).toBe(true);
    });
    it('expect.errorCode mismatch flips ok=false even when driver ok flag matches', async function () {
        const scenario: Scenario = {
            schemaVersion: 1,
            scenarioId: 'unit/expect-errcode',
            steps: [
                {
                    stepId: 's1',
                    intent: makeIntent('Test.Do', 'r1'),
                    expect: { ok: false, errorCode: 'WANTED' },
                },
            ],
        };
        const { d } = deps(scenario, [{ ok: false, errorCode: 'GOT_OTHER' }]);
        const result = await runScenario(d, makeRef(scenario.scenarioId, 'h'));
        expect(assertDefined(result.steps[0], 'single-step scenario reports one step').ok).toBe(false);
        expect(assertDefined(result.steps[0], 'single-step scenario reports one step').errorCode).toBe('GOT_OTHER');
    });
    it('does not mutate the caller-supplied intent envelope', async function () {
        const scenario = makeScenario();
        const step0 = assertDefined(scenario.steps[0], '2-step scenario has steps[0]');
        const originalIdempotencyKey = step0.intent.idempotencyKey;
        const originalCorrelationId = step0.intent.correlationId;
        const { d } = deps(scenario, [{ ok: true }, { ok: true }]);
        await runScenario(d, makeRef(scenario.scenarioId, 'h'));
        // The runner builds a NEW envelope per step; original must be intact.
        const step0After = assertDefined(scenario.steps[0], '2-step scenario still has steps[0]');
        expect(step0After.intent.idempotencyKey).toBe(originalIdempotencyKey);
        expect(step0After.intent.correlationId).toBe(originalCorrelationId);
    });
});
