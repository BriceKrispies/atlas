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

import { describe, expect, it } from 'vitest';

import {
  canonicalJsonStringify,
  deriveCorrelationId,
  deriveIdempotencyKey,
  runScenario,
} from '../src/index.ts';
import type {
  IntentDriver,
  IntentResult,
  RunnerDeps,
  Scenario,
  ScenarioRef,
  SeedCorpus,
} from '../src/index.ts';
import type { Crypto } from '@atlas/ports';
import type { IntentEnvelope } from '@atlas/platform-core';

// --- Test doubles -----------------------------------------------------------

/**
 * Pure-TS sha256, used only by the test stub crypto. The runtime
 * runner gets a real `Crypto` impl from the host (e.g. node-backed).
 * Implementation: FIPS 180-4 §6.2 — the standard 64-round form.
 */
function sha256(input: Uint8Array | string): Uint8Array {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const bitLen = bytes.length * 8;
  const padLen = (bytes.length + 9 + 63) & ~63;
  const padded = new Uint8Array(padLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  // Big-endian bit-length in last 8 bytes.
  const view = new DataView(padded.buffer);
  view.setUint32(padLen - 4, bitLen >>> 0, false);
  view.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000), false);

  const w = new Uint32Array(64);
  for (let off = 0; off < padLen; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = [H[0]!, H[1]!, H[2]!, H[3]!, H[4]!, H[5]!, H[6]!, H[7]!];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i]! + w[i]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0]! + a) >>> 0;
    H[1] = (H[1]! + b) >>> 0;
    H[2] = (H[2]! + c) >>> 0;
    H[3] = (H[3]! + d) >>> 0;
    H[4] = (H[4]! + e) >>> 0;
    H[5] = (H[5]! + f) >>> 0;
    H[6] = (H[6]! + g) >>> 0;
    H[7] = (H[7]! + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) dv.setUint32(i * 4, H[i]!, false);
  return out;
}

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

const stubCrypto: Pick<Crypto, 'sha256'> = { sha256 };

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
      envelopes.push(env as IntentEnvelope);
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
      crypto: stubCrypto as Crypto,
    },
    rec,
  };
}

// --- Tests ------------------------------------------------------------------

describe('runScenario (Phase 1 skeleton)', () => {
  it('walks a 2-step scenario through the IntentDriver in order', async () => {
    const scenario = makeScenario();
    const { d, rec } = deps(scenario, [
      { ok: true, resultRef: 'evt-1' },
      { ok: true, resultRef: 'evt-2' },
    ]);
    const ref = makeRef(scenario.scenarioId, 'hash-abc');

    const result = await runScenario(d, ref);

    expect(rec.envelopes).toHaveLength(2);
    expect((rec.envelopes[0]!.payload as { actionId: string }).actionId).toBe('Test.Do.First');
    expect((rec.envelopes[1]!.payload as { actionId: string }).actionId).toBe('Test.Do.Second');

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

  it('stamps the deterministic idempotencyKey + correlationId per step', async () => {
    const scenario = makeScenario();
    const { d, rec } = deps(scenario, [{ ok: true }, { ok: true }]);
    const ref = makeRef(scenario.scenarioId, 'hash-abc');

    await runScenario(d, ref);

    const key0 = deriveIdempotencyKey(stubCrypto as Crypto, scenario.scenarioId, 0);
    const key1 = deriveIdempotencyKey(stubCrypto as Crypto, scenario.scenarioId, 1);

    expect(rec.envelopes[0]!.idempotencyKey).toBe(key0);
    expect(rec.envelopes[1]!.idempotencyKey).toBe(key1);
    expect(rec.envelopes[0]!.correlationId).toBe(deriveCorrelationId(scenario.scenarioId, 0));
    expect(rec.envelopes[1]!.correlationId).toBe(deriveCorrelationId(scenario.scenarioId, 1));

    // Spec: idempotencyKey is sha256-hex truncated to 32 chars.
    expect(key0).toHaveLength(32);
    expect(key0).not.toBe(key1);
  });

  it('fails fast: a failing step short-circuits the remainder', async () => {
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

  it('honours the step.expect clause when present', async () => {
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

    expect(result.steps[0]!.ok).toBe(false);
  });
});

describe('canonicalJsonStringify', () => {
  it('emits keys in lexical order regardless of insertion order', () => {
    const a = canonicalJsonStringify({ b: 2, a: 1, c: { y: 'Y', x: 'X' } });
    const b = canonicalJsonStringify({ c: { x: 'X', y: 'Y' }, a: 1, b: 2 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":1,"b":2,"c":{"x":"X","y":"Y"}}');
  });

  it('preserves array order and stringifies primitives like JSON.stringify', () => {
    expect(canonicalJsonStringify([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalJsonStringify(null)).toBe('null');
    expect(canonicalJsonStringify('hi')).toBe('"hi"');
    expect(canonicalJsonStringify(42)).toBe('42');
    expect(canonicalJsonStringify(true)).toBe('true');
  });
});
