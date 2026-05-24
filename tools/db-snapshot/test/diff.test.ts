/**
 * diff.ts unit tests — the pure comparison core.
 *
 *   - identical bundles → []
 *   - single-cell diff detected
 *   - excluded column (search_vector) ignored
 *   - _migrations set-match (order/extra-non-key columns ignored; missing detected)
 *
 * Pure seam — no DB required.
 */
import { describe, it, expect } from '@atlas/test';
import { diffBundle, diffTable, EXCLUDED_COLUMNS, SET_MATCH_TABLES } from '../src/diff.ts';
import type { DatabaseSnapshot, SnapshotBundle, TableSnapshot } from '../src/types.ts';

function table(over: Partial<TableSnapshot>): TableSnapshot {
    const columns = over.columns ?? ['id', 'name'];
    const rows = over.rows ?? [];
    return {
        table: over.table ?? 'widgets',
        schema: over.schema ?? 'public',
        columns,
        rows,
        rowCount: over.rowCount ?? rows.length,
    };
}

function bundle(tables: TableSnapshot[]): SnapshotBundle {
    const db: DatabaseSnapshot = {
        database: 'control_plane',
        kind: 'control-plane',
        migrations: ['00000001_initial.sql'],
        tables,
    };
    return { capturedAt: '2026-05-23T00:00:00.000Z', databases: [db] };
}

describe('diffBundle', () => {
    it('identical bundles produce no diffs', () => {
        const t = table({ rows: [['1', 'a'], ['2', 'b']] });
        const diffs = diffBundle(bundle([t]), bundle([table({ rows: [['1', 'a'], ['2', 'b']] })]));
        expect(diffs).toEqual([]);
    });

    it('detects a single-cell difference', () => {
        const golden = bundle([table({ rows: [['1', 'a'], ['2', 'b']] })]);
        const actual = bundle([table({ rows: [['1', 'a'], ['2', 'CHANGED']] })]);
        const diffs = diffBundle(golden, actual);
        expect(diffs.length).toBe(1);
        expect(diffs[0]!.kind).toBe('cell');
        expect(diffs[0]!.rowIndex).toBe(1);
        expect(diffs[0]!.column).toBe('name');
        expect(diffs[0]!.golden).toBe('b');
        expect(diffs[0]!.actual).toBe('CHANGED');
    });

    it('detects a row-count difference', () => {
        const golden = bundle([table({ rows: [['1', 'a'], ['2', 'b']] })]);
        const actual = bundle([table({ rows: [['1', 'a']] })]);
        const diffs = diffBundle(golden, actual);
        expect(diffs.some((d) => d.kind === 'row-count')).toBe(true);
    });

    it('jsonb cells compare structurally (key order irrelevant)', () => {
        const g = table({ columns: ['id', 'doc'], rows: [['1', { a: 1, b: 2 }]] });
        const a = table({ columns: ['id', 'doc'], rows: [['1', { b: 2, a: 1 }]] });
        expect(diffBundle(bundle([g]), bundle([a]))).toEqual([]);
    });
});

describe('exclusion set', () => {
    it('catalog_search_documents.search_vector is in EXCLUDED_COLUMNS', () => {
        expect(EXCLUDED_COLUMNS['catalog_search_documents']).toContain('search_vector');
    });

    it('excluded column differences are ignored', () => {
        const cols = ['document_id', 'search_vector'];
        const golden = table({
            table: 'catalog_search_documents',
            columns: cols,
            rows: [['d1', "'foo':1A"]],
        });
        const actual = table({
            table: 'catalog_search_documents',
            columns: cols,
            rows: [['d1', "'bar':2B'"]], // different search_vector
        });
        const diffs = diffTable('control_plane', golden, actual);
        expect(diffs).toEqual([]);
    });

    it('non-excluded column differences in the same table are still caught', () => {
        const cols = ['document_id', 'search_vector'];
        const golden = table({
            table: 'catalog_search_documents',
            columns: cols,
            rows: [['d1', 'X']],
        });
        const actual = table({
            table: 'catalog_search_documents',
            columns: cols,
            rows: [['CHANGED', 'Y']],
        });
        const diffs = diffTable('control_plane', golden, actual);
        expect(diffs.length).toBe(1);
        expect(diffs[0]!.column).toBe('document_id');
    });
});

describe('_migrations set-match', () => {
    it('_migrations is configured for set-match on filename', () => {
        expect(SET_MATCH_TABLES['_migrations']?.keyColumns).toEqual(['filename']);
    });

    it('ignores ordering and non-key columns; matches on filename set', () => {
        const cols = ['id', 'filename', 'executed_at'];
        const golden = table({
            table: '_migrations',
            columns: cols,
            rows: [
                ['1', '00000001_initial.sql', '2026-01-01T00:00:00Z'],
                ['2', '00000002_x.sql', '2026-01-02T00:00:00Z'],
            ],
        });
        // Same filename set, different ids/timestamps and reversed order.
        const actual = table({
            table: '_migrations',
            columns: cols,
            rows: [
                ['7', '00000002_x.sql', '2026-09-09T09:09:09Z'],
                ['8', '00000001_initial.sql', '2026-09-09T09:09:10Z'],
            ],
        });
        expect(diffTable('control_plane', golden, actual)).toEqual([]);
    });

    it('detects a missing migration filename', () => {
        const cols = ['id', 'filename', 'executed_at'];
        const golden = table({
            table: '_migrations',
            columns: cols,
            rows: [
                ['1', '00000001_initial.sql', 't'],
                ['2', '00000002_x.sql', 't'],
            ],
        });
        const actual = table({
            table: '_migrations',
            columns: cols,
            rows: [['1', '00000001_initial.sql', 't']],
        });
        const diffs = diffTable('control_plane', golden, actual);
        expect(diffs.length).toBe(1);
        expect(diffs[0]!.kind).toBe('migration-set');
        expect(diffs[0]!.detail).toContain('00000002_x.sql');
    });
});
