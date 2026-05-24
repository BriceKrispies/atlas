/**
 * Lossless value codec — Postgres raw value → JSON-safe wrapper.
 *
 * `decode.ts` is the exact inverse. Pure functions; the only seam under unit
 * test for the type matrix. The wrappers exist because raw JSON cannot
 * represent: arbitrary-precision integers (bigint/bigserial), binary blobs
 * (bytea), and they cannot distinguish `text[]` from `jsonb` arrays. We make
 * those explicit so the decode side can bind the right Postgres parameter.
 *
 * Encoding rules, keyed off `ColumnMeta` (`udtName` is authoritative; postgres.js
 * already JS-parses many types so we inspect the JS runtime value too):
 *   - bytea         → { "$bytea": "<base64>" }
 *   - int8/bigint   → { "$bigint": "<decimal string>" }   (bigserial is int8)
 *   - timestamptz   → ISO-8601 string (verbatim, no reformatting drift)
 *   - text[]/_text  → JSON array of strings (passthrough)
 *   - jsonb/json    → value as-is (object/array/scalar)
 *   - uuid/text/... → passthrough
 *   - null          → null
 */
import type { ColumnMeta } from './types.ts';

/** Wrapper for binary (`bytea`) values. */
export interface ByteaWrapper {
    $bytea: string;
}
/** Wrapper for arbitrary-precision integer (`bigint`/`int8`/bigserial) values. */
export interface BigintWrapper {
    $bigint: string;
}

export function isByteaWrapper(v: unknown): v is ByteaWrapper {
    return (
        typeof v === 'object' &&
        v !== null &&
        typeof (v as { $bytea?: unknown }).$bytea === 'string' &&
        Object.keys(v).length === 1
    );
}

export function isBigintWrapper(v: unknown): v is BigintWrapper {
    return (
        typeof v === 'object' &&
        v !== null &&
        typeof (v as { $bigint?: unknown }).$bigint === 'string' &&
        Object.keys(v).length === 1
    );
}

/** True for the Postgres int8 family (bigint, bigserial). */
function isBigintColumn(col: ColumnMeta): boolean {
    return col.udtName === 'int8' || col.dataType === 'bigint';
}

/** True for bytea. */
function isByteaColumn(col: ColumnMeta): boolean {
    return col.udtName === 'bytea' || col.dataType === 'bytea';
}

/** True for timestamptz / timestamp. */
function isTimestampColumn(col: ColumnMeta): boolean {
    return (
        col.udtName === 'timestamptz' ||
        col.udtName === 'timestamp' ||
        col.dataType === 'timestamp with time zone' ||
        col.dataType === 'timestamp without time zone'
    );
}

/**
 * Encode a single raw Postgres value (as postgres.js delivered it) into a
 * JSON-safe form. `col` is the authoritative type hint.
 */
export function encodeValue(raw: unknown, col: ColumnMeta): unknown {
    if (raw === null || raw === undefined) {
        return null;
    }

    if (isByteaColumn(col)) {
        // postgres.js delivers bytea as a Node Buffer / Uint8Array.
        if (raw instanceof Uint8Array) {
            return { $bytea: Buffer.from(raw).toString('base64') } satisfies ByteaWrapper;
        }
        // Defensive: a hex string ("\\x...") fallback.
        if (typeof raw === 'string') {
            const hex = raw.startsWith('\\x') ? raw.slice(2) : raw;
            return { $bytea: Buffer.from(hex, 'hex').toString('base64') } satisfies ByteaWrapper;
        }
        throw new TypeError(`encodeValue: bytea column ${col.name} got unexpected ${typeof raw}`);
    }

    if (isBigintColumn(col)) {
        // postgres.js returns int8 as a JS string by default (to avoid
        // precision loss); it may also be a number or bigint depending on
        // config. Normalise to a decimal string.
        if (typeof raw === 'bigint') {
            return { $bigint: raw.toString() } satisfies BigintWrapper;
        }
        if (typeof raw === 'number') {
            return { $bigint: String(raw) } satisfies BigintWrapper;
        }
        if (typeof raw === 'string') {
            return { $bigint: raw } satisfies BigintWrapper;
        }
        throw new TypeError(`encodeValue: bigint column ${col.name} got unexpected ${typeof raw}`);
    }

    if (isTimestampColumn(col)) {
        // postgres.js parses timestamptz into a JS Date. ISO string is the
        // verbatim, round-trippable representation (UTC instant preserved).
        if (raw instanceof Date) {
            return raw.toISOString();
        }
        if (typeof raw === 'string') {
            return raw;
        }
        throw new TypeError(`encodeValue: timestamp column ${col.name} got unexpected ${typeof raw}`);
    }

    // text[] / arrays: postgres.js parses these into JS arrays. jsonb is
    // delivered already-parsed too. Both pass through as JSON-native — the
    // codec wrappers above are the only special cases. uuid/text/int4/bool
    // are JSON-native scalars.
    return raw;
}

/** Encode a full row tuple positionally against the column list. */
export function encodeRow(raw: unknown[], columns: ColumnMeta[]): unknown[] {
    if (raw.length !== columns.length) {
        throw new Error(
            `encodeRow: row arity ${raw.length} != column count ${columns.length}`,
        );
    }
    return raw.map((v, i) => encodeValue(v, columns[i]!));
}
