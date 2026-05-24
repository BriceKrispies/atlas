/**
 * Lossless value decoder — JSON wrapper → Postgres bind parameter.
 *
 * Exact inverse of `encode.ts`. Produces a value postgres.js will bind
 * correctly for the column's type:
 *   - { $bytea }   → Buffer            (binds as bytea)
 *   - { $bigint }  → string            (postgres.js binds numeric strings to int8 losslessly)
 *   - timestamptz  → string (ISO)      (binds as timestamptz; instant preserved)
 *   - text[]       → string[]          (postgres.js array binding) wrapped via sql.array at call site
 *   - jsonb        → object/array      (must be JSON-stringified for bind — see decodeForBind)
 *   - uuid/null    → passthrough
 *
 * Two surfaces:
 *   - `decodeValue` — inverse for round-trip equality testing (the value as
 *     a plain JS value: Buffer, string, array, object).
 *   - `decodeForBind` — adapts a decoded value into what postgres.js needs as
 *     a `sql(...)`-helper parameter (jsonb → JSON string; text[] via sql.array).
 *     Implemented in `insert-rows.ts` because it needs the `sql` tag; kept here
 *     only as documentation of intent.
 */
import type { ColumnMeta } from './types.ts';
import { isBigintWrapper, isByteaWrapper } from './encode.ts';

/** True for the Postgres int8 family (bigint, bigserial). */
function isBigintColumn(col: ColumnMeta): boolean {
    return col.udtName === 'int8' || col.dataType === 'bigint';
}

function isByteaColumn(col: ColumnMeta): boolean {
    return col.udtName === 'bytea' || col.dataType === 'bytea';
}

/**
 * Decode a JSON-safe encoded value back into a plain JS value. This is the
 * exact inverse used for round-trip equality assertions and as the basis for
 * binding (see `insert-rows.ts`).
 *
 *   { $bytea }  → Buffer
 *   { $bigint } → string (decimal)
 *   else        → passthrough (string / number / boolean / array / object / null)
 */
export function decodeValue(encoded: unknown, _col: ColumnMeta): unknown {
    if (encoded === null || encoded === undefined) {
        return null;
    }
    if (isByteaWrapper(encoded)) {
        return Buffer.from(encoded.$bytea, 'base64');
    }
    if (isBigintWrapper(encoded)) {
        return encoded.$bigint;
    }
    return encoded;
}

/** Decode a full encoded row tuple positionally. */
export function decodeRow(encoded: unknown[], columns: ColumnMeta[]): unknown[] {
    if (encoded.length !== columns.length) {
        throw new Error(
            `decodeRow: row arity ${encoded.length} != column count ${columns.length}`,
        );
    }
    return encoded.map((v, i) => decodeValue(v, columns[i]!));
}

/**
 * Normalise an encoded value for *comparison* (used by `diff.ts`). Bytea and
 * bigint wrappers are already JSON-stable; jsonb is compared structurally by
 * the caller's deep-equal. We keep wrappers intact here (they deep-equal fine)
 * and only need to guarantee both sides went through the SAME normalisation.
 * This is a passthrough kept for symmetry / future canonicalisation needs.
 */
export function normaliseForCompare(encoded: unknown, col: ColumnMeta): unknown {
    // bigint may have been stored as number on one capture and string on
    // another depending on driver settings; canonicalise to the decimal
    // string form so the comparison is representation-independent.
    if (isBigintColumn(col) && isBigintWrapper(encoded)) {
        return { $bigint: String(encoded.$bigint) };
    }
    if (isByteaColumn(col) && isByteaWrapper(encoded)) {
        return { $bytea: encoded.$bytea };
    }
    return encoded;
}
