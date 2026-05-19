import { describe, expect, it } from 'vitest';
import { canonicalJsonStringify } from '@atlas/platform-core';
/**
 * Spec: `specs/crosscut/seed-corpus.md` §4.1 — determinism contract for
 * `contentHash = sha256Hex(canonicalJsonStringify(resolvedScenario))`.
 * Two scenarios with the same logical content (regardless of key order)
 * MUST hash equal; two scenarios that differ in any observable value
 * MUST hash distinct.
 *
 * This is the consolidated implementation per
 * `specs/crosscut/scenario-fuzzing.md` §7 — re-exported from
 * `@atlas/platform-core` so the seeder package and adapter-seed-memory
 * share a single canonical-json definition.
 */
describe('canonicalJsonStringify', function () {
    it('emits object keys in lexical order regardless of insertion order', function () {
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
    it('emits NaN / Infinity as null (mirrors JSON.stringify of those primitives)', function () {
        expect(canonicalJsonStringify(NaN)).toBe('null');
        expect(canonicalJsonStringify(Infinity)).toBe('null');
        expect(canonicalJsonStringify(-Infinity)).toBe('null');
    });
    it('serialises Date via toJSON (ISO string), not as `{}`', function () {
        // Determinism contract: two scenarios differing only in a Date value
        // MUST produce distinct canonical bytes. Mirrors JSON.stringify
        // Date semantics.
        const d1 = canonicalJsonStringify({ at: new Date('2026-05-10T00:00:00Z') });
        const d2 = canonicalJsonStringify({ at: new Date('2026-05-11T00:00:00Z') });
        expect(d1).toBe('{"at":"2026-05-10T00:00:00.000Z"}');
        expect(d2).toBe('{"at":"2026-05-11T00:00:00.000Z"}');
        expect(d1).not.toBe(d2);
    });
});
