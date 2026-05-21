import { beforeEach, describe, expect, it } from '@atlas/test';
import {
  getDslArtifact,
  getDslArtifactById,
  getDslArtifactVersion,
  handleDslUpdate,
  listDslArtifacts,
  makeDslKindRegistry,
  validateDslSource,
} from '../src/index.ts';
import type { DslKind, DslUpdateDeps } from '../src/index.ts';
import {
  makeDefaultHostContext,
  makeExpressionEvaluator,
  makeExpressionRegistry,
  parse,
} from '@atlas/dsl-expression';
import type { HostOpSet } from '@atlas/dsl-substrate';
import { MemoryDslArtifactStore } from './memory-store.ts';

function makeRegistry() {
  const evaluator = makeExpressionEvaluator(makeDefaultHostContext('2026-05-21T00:00:00.000Z'));
  const registry = makeExpressionRegistry();
  const expressionKind: DslKind<unknown, unknown, unknown, HostOpSet> = {
    kind: 'expression',
    parse: (source: string) =>
      parse(source) as ReturnType<DslKind<unknown, unknown, unknown, HostOpSet>['parse']>,
    evaluator,
    registry,
  };
  return makeDslKindRegistry([expressionKind]);
}

function makeFakeEventStore(): DslUpdateDeps['eventStore'] {
  let seq = 0n;
  return {
    append: async (env: { eventId: string }) => {
      seq += 1n;
      return { eventId: env.eventId, seq };
    },
  } as unknown as DslUpdateDeps['eventStore'];
}

describe('validateDslSource', function () {
  const registry = makeRegistry();

  it('returns ok+ast+sourceMap for a clean source', function () {
    const r = validateDslSource(
      { registry },
      {
        kind: 'expression',
        source: '"hello" | upper',
      },
    );
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.ast).toBeDefined();
    expect(r.sourceMap).toBeDefined();
  });

  it('returns parse errors with sourceRange', function () {
    const r = validateDslSource(
      { registry },
      {
        kind: 'expression',
        source: '"oh no',
      },
    );
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]?.sourceRange).toBeDefined();
  });

  it('returns static-check errors (unknown identifier) without saving', function () {
    const r = validateDslSource(
      { registry },
      {
        kind: 'expression',
        source: 'mystery.thing',
        hints: { expectedScopeShape: { user: { name: 'alice' } } },
      },
    );
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.code).toBe('DSL_UNKNOWN_IDENTIFIER');
    // Even on static-check failure, AST is returned for agent introspection.
    expect(r.ast).toBeDefined();
  });

  it('returns multiple errors for multi-failure sources', function () {
    const r = validateDslSource(
      { registry },
      {
        kind: 'expression',
        source: 'unknown1 | nonexistent_filter',
      },
    );
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('throws DSL_UNKNOWN_KIND for an unregistered kind', function () {
    expect(() => validateDslSource({ registry }, { kind: 'template', source: '"x"' })).toThrow(
      /unknown DSL kind/,
    );
  });
});

describe('read-side queries', function () {
  let store: MemoryDslArtifactStore;
  let deps: DslUpdateDeps;
  let registry: ReturnType<typeof makeRegistry>;
  let queryDeps: {
    tenantId: string;
    artifactStore: MemoryDslArtifactStore;
    registry: ReturnType<typeof makeRegistry>;
  };

  beforeEach(async function () {
    store = new MemoryDslArtifactStore();
    registry = makeRegistry();
    deps = {
      eventStore: makeFakeEventStore(),
      artifactStore: store,
      registry,
      newEventId: () => 'evt-test',
      now: () => '2026-05-21T00:00:00.000Z',
    };
    queryDeps = { tenantId: 'tenant-a', artifactStore: store, registry };

    // Seed two artifacts via the real handler.
    await handleDslUpdate(
      {
        tenantId: 'tenant-a',
        correlationId: 'c1',
        principalId: 'u',
        kind: 'expression',
        apiName: 'alpha',
        source: '"alpha"',
        substrateVersion: '0.1.0',
      },
      deps,
    );
    await handleDslUpdate(
      {
        tenantId: 'tenant-a',
        correlationId: 'c2',
        principalId: 'u',
        kind: 'expression',
        apiName: 'beta',
        source: '"beta"',
        substrateVersion: '0.1.0',
      },
      deps,
    );
    await handleDslUpdate(
      {
        tenantId: 'tenant-a',
        correlationId: 'c3',
        principalId: 'u',
        kind: 'expression',
        apiName: 'beta',
        source: '"beta v2"',
        substrateVersion: '0.1.0',
      },
      deps,
    );
  });

  it('getDslArtifact returns the latest version', async function () {
    const got = await getDslArtifact(queryDeps, 'expression', 'beta');
    expect(got).not.toBeNull();
    expect(got?.version).toBe(2);
    expect(got?.source).toBe('"beta v2"');
  });

  it('returns null for missing apiName', async function () {
    const got = await getDslArtifact(queryDeps, 'expression', 'missing');
    expect(got).toBeNull();
  });

  it('getDslArtifactVersion returns historical and current', async function () {
    const v1 = await getDslArtifactVersion(queryDeps, 'expression', 'beta', 1);
    const v2 = await getDslArtifactVersion(queryDeps, 'expression', 'beta', 2);
    expect(v1?.source).toBe('"beta"');
    expect(v2?.source).toBe('"beta v2"');
  });

  it('getDslArtifactById finds the latest by uuid', async function () {
    const found = await getDslArtifact(queryDeps, 'expression', 'alpha');
    const byId = await getDslArtifactById(queryDeps, 'expression', found?.artifactId ?? '');
    expect(byId?.apiName).toBe('alpha');
  });

  it('listDslArtifacts enumerates latest versions', async function () {
    const all = await listDslArtifacts(queryDeps, 'expression');
    expect(all.length).toBe(2);
    const byName = new Map(all.map((a) => [a.apiName, a]));
    expect(byName.get('alpha')?.version).toBe(1);
    expect(byName.get('beta')?.version).toBe(2);
  });

  it('throws DSL_UNKNOWN_KIND for an unregistered kind on read', async function () {
    await expect(getDslArtifact(queryDeps, 'template', 'x')).rejects.toThrow(/unknown DSL kind/);
  });
});
