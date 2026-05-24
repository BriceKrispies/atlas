/**
 * insert-rows — INSERT captured rows VERBATIM into a restored database.
 *
 * Values are decoded through the codec (bytea → Buffer, bigint → numeric
 * string, timestamptz → ISO string) and bound positionally via `sql.unsafe`
 * with `$1..$n` placeholders. Captured columns are listed explicitly so
 * `events.seq` (bigserial) is inserted with its exact value rather than
 * regenerated — sequence reset happens afterwards (`reset-sequences.ts`).
 *
 * Binding nuances for postgres.js parameter form:
 *   - jsonb/json columns: bind a JSON STRING (postgres.js binds a JS
 *     object to a composite/record otherwise). We stringify here.
 *   - text[] arrays: postgres.js binds a JS array to a Postgres array when the
 *     destination column is an array type — pass the JS array directly.
 *   - bytea: Buffer binds to bytea natively.
 *   - bigint: a numeric STRING binds to int8 losslessly.
 *
 * Insertion is wrapped per-DB in a transaction by the caller; this function
 * inserts one table within that transaction.
 */
import type postgres from 'postgres';
import type { ColumnMeta, TableSnapshot } from './types.ts';
import { isBigintWrapper, isByteaWrapper } from './encode.ts';

/**
 * Tables a migration pre-seeds a row into (so a plain INSERT of the captured
 * row would collide with the seeded one). For these we UPSERT on the primary
 * key, overwriting the seeded default with the captured value — the captured
 * value is authoritative (e.g. `registry_version.version` may be > 0 live).
 *
 * Value = PK column name(s) the ON CONFLICT targets.
 */
export const MIGRATION_SEEDED_TABLES: Record<string, string[]> = {
    registry_version: ['singleton'],
};

/** Quote a Postgres identifier defensively. */
function quoteIdent(ident: string): string {
    if (!/^[a-zA-Z0-9_]+$/.test(ident)) {
        throw new Error(`db-snapshot insert: refusing to quote unsafe identifier: ${ident}`);
    }
    return `"${ident}"`;
}

function isJsonbColumn(col: ColumnMeta): boolean {
    return (
        col.udtName === 'jsonb' ||
        col.udtName === 'json' ||
        col.dataType === 'jsonb' ||
        col.dataType === 'json'
    );
}

function isArrayColumn(col: ColumnMeta): boolean {
    return col.dataType === 'ARRAY' || col.udtName.startsWith('_');
}

/**
 * Decode one encoded cell into the JS value postgres.js needs as a bind param,
 * given the destination column type.
 */
export function decodeForBind(encoded: unknown, col: ColumnMeta): unknown {
    if (encoded === null || encoded === undefined) return null;
    if (isByteaWrapper(encoded)) return Buffer.from(encoded.$bytea, 'base64');
    if (isBigintWrapper(encoded)) return encoded.$bigint; // numeric string → int8
    if (isJsonbColumn(col)) {
        // Return the plain JS value; the caller wraps it with `sql.json(...)`
        // so postgres.js binds it as a json document (NOT a json scalar
        // string). Binding a pre-stringified value double-encodes.
        return encoded;
    }
    if (isArrayColumn(col)) {
        // text[] etc.: pass the JS array through; postgres.js binds it as an array.
        return encoded;
    }
    return encoded;
}

/**
 * Insert all rows of a table within an existing transaction `tx`.
 * `columns` is the full ColumnMeta list (positionally aligned to the snapshot
 * column order).
 */
export async function insertTableRows(
    tx: postgres.TransactionSql,
    table: TableSnapshot,
    columns: ColumnMeta[],
): Promise<void> {
    if (table.rows.length === 0) return;
    const colIdents = table.columns.map(quoteIdent).join(', ');
    const fqtn = `${quoteIdent(table.schema)}.${quoteIdent(table.table)}`;

    // Build a metadata lookup so each cell knows its destination column type.
    const metaByName = new Map(columns.map((c) => [c.name, c]));

    // Upsert clause for migration-seeded singleton tables.
    const seededPk = MIGRATION_SEEDED_TABLES[table.table];
    let conflictClause = '';
    if (seededPk) {
        const updates = table.columns
            .filter((c) => !seededPk.includes(c))
            .map((c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`)
            .join(', ');
        conflictClause =
            updates.length > 0
                ? ` ON CONFLICT (${seededPk.map(quoteIdent).join(', ')}) DO UPDATE SET ${updates}`
                : ` ON CONFLICT (${seededPk.map(quoteIdent).join(', ')}) DO NOTHING`;
    }

    for (const row of table.rows) {
        const placeholders = row.map((_, i) => `$${i + 1}`).join(', ');
        const params = row.map((cell, i) => {
            const colName = table.columns[i]!;
            const meta = metaByName.get(colName);
            if (!meta) throw new Error(`insert: no column meta for ${table.table}.${colName}`);
            const decoded = decodeForBind(cell, meta);
            // jsonb must be bound via `tx.json(...)` so postgres.js sends it as
            // a json document, not a json scalar string (double-encoding). A
            // null jsonb stays null.
            if (isJsonbColumn(meta) && decoded !== null) {
                return tx.json(decoded as never);
            }
            return decoded;
        });
        // Cast array params explicitly: postgres.js needs the array bound as a
        // typed array. For text[] the unsafe param path accepts a JS array and
        // serializes it; we rely on the destination column's implicit cast.
        await tx.unsafe(
            `INSERT INTO ${fqtn} (${colIdents}) VALUES (${placeholders})${conflictClause}`,
            params as never[],
        );
    }
}
