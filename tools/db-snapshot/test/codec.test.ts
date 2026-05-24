/**
 * Codec round-trip unit tests — encode.ts / decode.ts.
 *
 * For each Postgres type the codec handles, assert encode → decode is an exact
 * inverse (modulo the documented driver-form: e.g. raw Buffer in, Buffer out;
 * Date in, ISO string out which is what we persist & re-bind).
 *
 * Pure seam — no DB required.
 */
import { describe, it, expect } from '@atlas/test';
import { encodeValue, isBigintWrapper, isByteaWrapper } from '../src/encode.ts';
import { decodeValue } from '../src/decode.ts';
import type { ColumnMeta } from '../src/types.ts';

function col(partial: Partial<ColumnMeta>): ColumnMeta {
    return {
        name: 'c',
        ordinalPosition: 1,
        dataType: 'text',
        udtName: 'text',
        nullable: true,
        ...partial,
    };
}

describe('codec round-trip', () => {
    it('bytea: Buffer → {$bytea} → Buffer (bytes preserved)', () => {
        const c = col({ dataType: 'bytea', udtName: 'bytea' });
        const raw = Buffer.from([0x00, 0x01, 0xff, 0x7f, 0x80]);
        const enc = encodeValue(raw, c);
        expect(isByteaWrapper(enc)).toBe(true);
        const dec = decodeValue(enc, c) as Buffer;
        expect(Buffer.isBuffer(dec)).toBe(true);
        expect(dec.equals(raw)).toBe(true);
    });

    it('bigint: string → {$bigint} → string (precision preserved)', () => {
        const c = col({ dataType: 'bigint', udtName: 'int8' });
        const raw = '9223372036854775807'; // max int8, beyond Number safe range
        const enc = encodeValue(raw, c);
        expect(isBigintWrapper(enc)).toBe(true);
        expect((enc as { $bigint: string }).$bigint).toBe(raw);
        const dec = decodeValue(enc, c);
        expect(dec).toBe(raw);
    });

    it('bigint: numeric input also normalises to decimal string', () => {
        const c = col({ dataType: 'bigint', udtName: 'int8' });
        const enc = encodeValue(42, c);
        expect((enc as { $bigint: string }).$bigint).toBe('42');
        expect(decodeValue(enc, c)).toBe('42');
    });

    it('timestamptz: Date → ISO string verbatim', () => {
        const c = col({ dataType: 'timestamp with time zone', udtName: 'timestamptz' });
        const d = new Date('2026-05-23T12:34:56.789Z');
        const enc = encodeValue(d, c);
        expect(enc).toBe('2026-05-23T12:34:56.789Z');
        // decode passes ISO string through (bound back as timestamptz literal).
        expect(decodeValue(enc, c)).toBe('2026-05-23T12:34:56.789Z');
    });

    it('text[]: array passthrough both ways', () => {
        const c = col({ dataType: 'ARRAY', udtName: '_text' });
        const raw = ['Tenant:acme', 'Event:Created'];
        const enc = encodeValue(raw, c);
        expect(enc).toEqual(raw);
        expect(decodeValue(enc, c)).toEqual(raw);
    });

    it('jsonb: object passthrough preserves structure', () => {
        const c = col({ dataType: 'jsonb', udtName: 'jsonb' });
        const raw = { a: 1, nested: { b: [true, null, 'x'] } };
        const enc = encodeValue(raw, c);
        expect(enc).toEqual(raw);
        expect(decodeValue(enc, c)).toEqual(raw);
    });

    it('uuid: string passthrough', () => {
        const c = col({ dataType: 'uuid', udtName: 'uuid' });
        const raw = '550e8400-e29b-41d4-a716-446655440000';
        expect(encodeValue(raw, c)).toBe(raw);
        expect(decodeValue(encodeValue(raw, c), c)).toBe(raw);
    });

    it('null: encodes and decodes to null for any type', () => {
        for (const c of [
            col({ dataType: 'bytea', udtName: 'bytea' }),
            col({ dataType: 'bigint', udtName: 'int8' }),
            col({ dataType: 'jsonb', udtName: 'jsonb' }),
            col({ dataType: 'text', udtName: 'text' }),
        ]) {
            expect(encodeValue(null, c)).toBe(null);
            expect(decodeValue(null, c)).toBe(null);
        }
    });
});
