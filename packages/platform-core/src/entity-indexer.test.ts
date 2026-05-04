import { describe, it, expect } from 'vitest';
import type { IndexDeclarationRow } from './control-plane-db.ts';
import {
  createIndexSql,
  dropIndexSql,
  indexNameFor,
  jsonbPathExpr,
  reconcile as reconcileEntityIndexes,
} from './entity-indexer.ts';

function decl(partial: Partial<IndexDeclarationRow>): IndexDeclarationRow {
  return {
    entity_type: partial.entity_type ?? 'Page',
    tenant_id: partial.tenant_id ?? null,
    index_name: partial.index_name ?? 'unnamed',
    field_paths: partial.field_paths ?? ['name'],
    is_unique: partial.is_unique ?? false,
    where_clause: partial.where_clause ?? null,
    origin: partial.origin ?? 'platform',
    package_id: partial.package_id ?? null,
    created_at: partial.created_at ?? '2026-05-03T00:00:00Z',
  };
}

describe('indexNameFor', () => {
  it('renders entities_<type>_<name>_idx', () => {
    expect(indexNameFor({ entity_type: 'Page', index_name: 'name' })).toBe(
      'entities_Page_name_idx',
    );
  });
});

describe('jsonbPathExpr', () => {
  it('renders single-segment as ->>', () => {
    expect(jsonbPathExpr('familyKey')).toBe(`(attrs->>'familyKey')`);
  });

  it('renders nested path with -> chain + final ->>', () => {
    expect(jsonbPathExpr('metadata.priority')).toBe(
      `(attrs->'metadata'->>'priority')`,
    );
  });

  it('handles three-level nesting', () => {
    expect(jsonbPathExpr('a.b.c')).toBe(`(attrs->'a'->'b'->>'c')`);
  });

  it('escapes single quotes in a path key', () => {
    expect(jsonbPathExpr("foo'bar")).toBe(`(attrs->>'foo''bar')`);
  });

  it('throws on empty path', () => {
    expect(() => jsonbPathExpr('')).toThrow();
  });
});

describe('createIndexSql', () => {
  it('renders a basic single-column index', () => {
    const sql = createIndexSql(decl({ index_name: 'familyKey', field_paths: ['familyKey'] }));
    expect(sql).toBe(
      `CREATE INDEX IF NOT EXISTS entities_Page_familyKey_idx ON entities (tenant_id, entity_type, (attrs->>'familyKey'))`,
    );
  });

  it('renders a unique index with the UNIQUE keyword', () => {
    const sql = createIndexSql(
      decl({ index_name: 'slug', field_paths: ['slug'], is_unique: true }),
    );
    expect(sql).toContain('CREATE UNIQUE INDEX');
  });

  it('renders a composite-column index in declared order', () => {
    const sql = createIndexSql(
      decl({
        index_name: 'composite',
        field_paths: ['familyKey', 'revisionNumber'],
      }),
    );
    expect(sql).toContain(`(attrs->>'familyKey'), (attrs->>'revisionNumber')`);
  });

  it('renders a partial index when where_clause is present', () => {
    const sql = createIndexSql(
      decl({
        index_name: 'active_only',
        field_paths: ['name'],
        where_clause: { status: 'active' },
      }),
    );
    expect(sql).toContain(`WHERE attrs @> '{"status":"active"}'::jsonb`);
  });
});

describe('reconcile', () => {
  it('emits CREATE for declared-but-not-live indexes', () => {
    const declared = [decl({ index_name: 'familyKey', field_paths: ['familyKey'] })];
    const live = new Set<string>();
    const { create, drop } = reconcileEntityIndexes(declared, live);
    expect(create).toHaveLength(1);
    expect(drop).toHaveLength(0);
    expect(create[0]).toContain('entities_Page_familyKey_idx');
  });

  it('skips already-live indexes', () => {
    const declared = [decl({ index_name: 'familyKey', field_paths: ['familyKey'] })];
    const live = new Set(['entities_Page_familyKey_idx']);
    const { create, drop } = reconcileEntityIndexes(declared, live);
    expect(create).toHaveLength(0);
    expect(drop).toHaveLength(0);
  });

  it('emits DROP for materializer-managed indexes no longer declared', () => {
    const declared: IndexDeclarationRow[] = [];
    const live = new Set(['entities_Page_oldIdx_idx']);
    const { create, drop } = reconcileEntityIndexes(declared, live);
    expect(create).toHaveLength(0);
    expect(drop).toHaveLength(1);
    expect(drop[0]).toBe('DROP INDEX IF EXISTS entities_Page_oldIdx_idx');
  });

  it('does not drop the baseline tenant_type_status index', () => {
    const declared: IndexDeclarationRow[] = [];
    const live = new Set(['entities_tenant_type_status_idx']);
    const { drop } = reconcileEntityIndexes(declared, live);
    expect(drop).toHaveLength(0);
  });

  it('does not drop the baseline GIN index', () => {
    const declared: IndexDeclarationRow[] = [];
    const live = new Set(['entities_attrs_gin_idx']);
    const { drop } = reconcileEntityIndexes(declared, live);
    expect(drop).toHaveLength(0);
  });

  it('ignores non-materializer-managed indexes', () => {
    const declared: IndexDeclarationRow[] = [];
    const live = new Set(['some_human_added_index', 'pages_pkey']);
    const { drop } = reconcileEntityIndexes(declared, live);
    expect(drop).toHaveLength(0);
  });
});

describe('dropIndexSql', () => {
  it('renders IF EXISTS', () => {
    expect(dropIndexSql('foo_idx')).toBe('DROP INDEX IF EXISTS foo_idx');
  });
});
