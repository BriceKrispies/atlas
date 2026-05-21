/**
 * Cross-adapter contract for `DslArtifactStore`. Per `packages/CLAUDE.md`
 * and ADR 0007: every concrete adapter implementing the port MUST pass
 * this suite. Today there's one production adapter (Postgres); an IndexedDB
 * mirror lands later when sim needs DSL artifact persistence.
 *
 * The suite covers:
 *   - Lazy bootstrap: `ensureKindRegistered` is idempotent.
 *   - First save inserts at version 1 with outcome 'inserted'.
 *   - Subsequent saves version up with outcome 'versioned'; prior row lands
 *     in `_atlas_dsl_<kind>_versions`.
 *   - `get` returns the latest version; `getVersion` returns the requested
 *     version (current or historical); `getById` finds by uuid.
 *   - `list` enumerates latest versions for a kind.
 *   - Reading a never-bootstrapped kind returns null/empty (not throw).
 *   - The stored AST round-trips structurally (JSONB preserves shape).
 */

import { beforeEach, describe, expect, test } from '@atlas/test';
import type { DslArtifactStore } from '@atlas/ports';

interface FakeExprAst {
  readonly kind: 'lit' | 'binop';
  readonly value?: number;
  readonly op?: '+' | '-';
}

const KIND = 'expression';
const TENANT = 'tenant-contract-a';
const AUTHOR = 'user:contract-test';

function baseInput(overrides: {
  apiName: string;
  ast: FakeExprAst;
  source?: string;
  tenantId?: string;
  createdBy?: string;
}) {
  return {
    kind: KIND,
    apiName: overrides.apiName,
    tenantId: overrides.tenantId ?? TENANT,
    substrateVersion: '0.1.0',
    source: overrides.source ?? 'placeholder source',
    ast: overrides.ast,
    sourceMap: [{ nodeId: 'n1', range: { startLine: 1, startCol: 1, endLine: 1, endCol: 5 } }],
    dependencies: [],
    createdBy: overrides.createdBy ?? AUTHOR,
  };
}

export function dslArtifactStoreContract(makeStore: () => Promise<DslArtifactStore>): void {
  describe('DslArtifactStore contract', function () {
    let store: DslArtifactStore;
    beforeEach(async function () {
      store = await makeStore();
    });

    test('ensureKindRegistered is idempotent', async function () {
      await store.ensureKindRegistered(KIND);
      // Second call must not throw and must not break subsequent saves.
      await store.ensureKindRegistered(KIND);
      const result = await store.save(
        baseInput({ apiName: 'idem_check', ast: { kind: 'lit', value: 1 } }),
      );
      expect(result.outcome).toBe('inserted');
    });

    test('first save inserts at version 1 with outcome "inserted"', async function () {
      await store.ensureKindRegistered(KIND);
      const result = await store.save<FakeExprAst>(
        baseInput({ apiName: 'first_save', ast: { kind: 'lit', value: 42 } }),
      );
      expect(result.outcome).toBe('inserted');
      expect(result.artifact.version).toBe(1);
      expect(result.artifact.apiName).toBe('first_save');
      expect(result.artifact.tenantId).toBe(TENANT);
      expect(result.artifact.kind).toBe(KIND);
      expect(typeof result.artifact.artifactId).toBe('string');
      expect(result.artifact.artifactId.length).toBeGreaterThan(0);
      expect(result.artifact.createdBy).toBe(AUTHOR);
      expect(result.artifact.updatedBy).toBe(AUTHOR);
      expect(result.artifact.ast.kind).toBe('lit');
      expect(result.artifact.ast.value).toBe(42);
    });

    test('second save versions up with outcome "versioned"; artifactId stable', async function () {
      await store.ensureKindRegistered(KIND);
      const first = await store.save<FakeExprAst>(
        baseInput({ apiName: 'evolves', ast: { kind: 'lit', value: 1 } }),
      );
      const second = await store.save<FakeExprAst>(
        baseInput({ apiName: 'evolves', ast: { kind: 'lit', value: 2 } }),
      );
      expect(second.outcome).toBe('versioned');
      expect(second.artifact.version).toBe(2);
      expect(second.artifact.artifactId).toBe(first.artifact.artifactId);
      expect(second.artifact.ast.value).toBe(2);
    });

    test('getVersion returns prior version after subsequent save', async function () {
      await store.ensureKindRegistered(KIND);
      await store.save<FakeExprAst>(
        baseInput({ apiName: 'history', ast: { kind: 'lit', value: 1 } }),
      );
      await store.save<FakeExprAst>(
        baseInput({ apiName: 'history', ast: { kind: 'lit', value: 2 } }),
      );
      const v1 = await store.getVersion<FakeExprAst>(KIND, 'history', 1);
      const v2 = await store.getVersion<FakeExprAst>(KIND, 'history', 2);
      expect(v1).not.toBeNull();
      expect(v2).not.toBeNull();
      expect(v1?.ast.value).toBe(1);
      expect(v2?.ast.value).toBe(2);
    });

    test('get returns latest version', async function () {
      await store.ensureKindRegistered(KIND);
      await store.save<FakeExprAst>(
        baseInput({ apiName: 'latest_check', ast: { kind: 'lit', value: 100 } }),
      );
      await store.save<FakeExprAst>(
        baseInput({ apiName: 'latest_check', ast: { kind: 'lit', value: 200 } }),
      );
      const latest = await store.get<FakeExprAst>(KIND, 'latest_check');
      expect(latest).not.toBeNull();
      expect(latest?.version).toBe(2);
      expect(latest?.ast.value).toBe(200);
    });

    test('getById finds the current row by uuid', async function () {
      await store.ensureKindRegistered(KIND);
      const saved = await store.save<FakeExprAst>(
        baseInput({ apiName: 'by_id', ast: { kind: 'lit', value: 7 } }),
      );
      const found = await store.getById<FakeExprAst>(KIND, saved.artifact.artifactId);
      expect(found).not.toBeNull();
      expect(found?.apiName).toBe('by_id');
    });

    test('list enumerates latest versions for the tenant', async function () {
      await store.ensureKindRegistered(KIND);
      await store.save<FakeExprAst>(
        baseInput({ apiName: 'list_a', ast: { kind: 'lit', value: 1 } }),
      );
      await store.save<FakeExprAst>(
        baseInput({ apiName: 'list_b', ast: { kind: 'lit', value: 2 } }),
      );
      await store.save<FakeExprAst>(
        baseInput({ apiName: 'list_b', ast: { kind: 'lit', value: 22 } }),
      );
      const items = await store.list<FakeExprAst>(KIND);
      const byName = new Map(
        items.map(function (i) {
          return [i.apiName, i] as const;
        }),
      );
      expect(byName.has('list_a')).toBe(true);
      expect(byName.has('list_b')).toBe(true);
      expect(byName.get('list_a')?.version).toBe(1);
      expect(byName.get('list_b')?.version).toBe(2);
      expect(byName.get('list_b')?.ast.value).toBe(22);
    });

    test('reads against a never-bootstrapped kind return null/empty', async function () {
      // Do NOT call ensureKindRegistered for this kind. The reads should
      // return null/empty rather than erroring on "relation does not exist".
      const get = await store.get('formula', 'nonexistent');
      const getV = await store.getVersion('formula', 'nonexistent', 1);
      const getById = await store.getById('formula', '00000000-0000-0000-0000-000000000000');
      const list = await store.list('formula');
      expect(get).toBeNull();
      expect(getV).toBeNull();
      expect(getById).toBeNull();
      expect(list.length).toBe(0);
    });

    test('AST round-trips structurally through JSONB', async function () {
      await store.ensureKindRegistered(KIND);
      const complexAst: FakeExprAst = { kind: 'binop', op: '+', value: 99 };
      const saved = await store.save<FakeExprAst>(
        baseInput({ apiName: 'jsonb_rt', ast: complexAst }),
      );
      expect(saved.artifact.ast).toEqual(complexAst);
      const fetched = await store.get<FakeExprAst>(KIND, 'jsonb_rt');
      expect(fetched?.ast).toEqual(complexAst);
    });

    test('save rejects invalid kind via the assertKind boundary', async function () {
      await expect(
        store.save<FakeExprAst>({
          ...baseInput({ apiName: 'reject', ast: { kind: 'lit', value: 1 } }),
          kind: 'Bad-Kind!',
        }),
      ).rejects.toThrow(/invalid DSL kind/);
    });
  });
}
