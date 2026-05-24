/**
 * reset-sequences — after a verbatim INSERT (which writes explicit serial
 * values like `events.seq`), the owning sequence is left behind. `setval` each
 * serial sequence to `COALESCE(MAX(col), 1)` so the next generated value
 * doesn't collide with restored rows.
 *
 * Discovers serial-backed columns via `pg_get_serial_sequence`. Runs against
 * the restored tenant/control-plane DB.
 */
import type postgres from 'postgres';

interface SerialColumn {
    schema: string;
    table: string;
    column: string;
    sequence: string;
}

/**
 * Find every column in the given schema that owns a sequence (serial /
 * bigserial / identity), resolving the sequence name via
 * `pg_get_serial_sequence`.
 */
export async function findSerialColumns(
    sql: postgres.Sql,
    schema: string,
): Promise<SerialColumn[]> {
    const rows = await sql<{ schema: string; table: string; column: string }[]>`
    SELECT c.table_schema AS schema, c.table_name AS table, c.column_name AS column
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = ${schema}
      AND t.table_type = 'BASE TABLE'
      AND (
        c.column_default LIKE 'nextval(%'
        OR c.is_identity = 'YES'
      )
  `;
    const out: SerialColumn[] = [];
    for (const r of rows) {
        const seqRows = await sql<{ seq: string | null }[]>`
      SELECT pg_get_serial_sequence(${`${r.schema}.${r.table}`}, ${r.column}) AS seq
    `;
        const seq = seqRows[0]?.seq;
        if (seq) out.push({ schema: r.schema, table: r.table, column: r.column, sequence: seq });
    }
    return out;
}

/** Quote an identifier defensively. */
function q(ident: string): string {
    if (!/^[a-zA-Z0-9_]+$/.test(ident)) {
        throw new Error(`reset-sequences: refusing to quote unsafe identifier: ${ident}`);
    }
    return `"${ident}"`;
}

/**
 * Reset every serial sequence in `schema` to `COALESCE(MAX(col), 1)`.
 * Uses `setval(seq, value, is_called)`: with `MAX(col)` present we set
 * `is_called=true` so the next value is MAX+1; with no rows we set value 1 and
 * `is_called=false` so the next value is 1.
 */
export async function resetSequences(sql: postgres.Sql, schema: string): Promise<void> {
    const serials = await findSerialColumns(sql, schema);
    for (const s of serials) {
        const fqtn = `${q(s.schema)}.${q(s.table)}`;
        // `s.sequence` comes back already-quoted/qualified from
        // pg_get_serial_sequence (e.g. public.events_seq_seq). Pass it as a
        // literal to setval via regclass.
        await sql.unsafe(
            `SELECT setval(
                 ${literal(s.sequence)},
                 COALESCE((SELECT MAX(${q(s.column)}) FROM ${fqtn}), 1),
                 (SELECT COUNT(*) > 0 FROM ${fqtn})
             )`,
        );
    }
}

function literal(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}
