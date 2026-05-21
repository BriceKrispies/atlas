import { beforeEach, describe, expect, it } from '@atlas/test';
import { handleDslUpdate, makeDslKindRegistry } from '../src/index.ts';
import type { DslUpdateDeps, DslKind } from '../src/index.ts';
import { DslHandlerError } from '../src/errors.ts';
import {
  makeExpressionEvaluator,
  makeDefaultHostContext,
  makeExpressionRegistry,
  parse,
} from '@atlas/dsl-expression';
import type { HostOpSet } from '@atlas/dsl-substrate';
import { MemoryDslArtifactStore } from './memory-store.ts';

/**
 * Handler tests using an in-memory artifact store + the real expression DSL
 * as the registered kind. Exercises the full handler path: parse, static
 * check, save, emit event.
 *
 * The event store is mocked as the smallest viable shape — `append` records
 * envelopes and returns a stored event with a fresh seq.
 */

function makeFakeEventStore() {
  const appended: { eventId: string; seq: bigint }[] = [];
  let seq = 0n;
  return {
    appended,
    eventStore: {
      append: async (env: { eventId: string }) => {
        seq += 1n;
        const stored = { eventId: env.eventId, seq };
        appended.push(stored);
        return stored;
      },
    } as unknown as Parameters<typeof handleDslUpdate>[1]['eventStore'],
  };
}

function makeDeps(): DslUpdateDeps & {
  store: MemoryDslArtifactStore;
  appended: { eventId: string; seq: bigint }[];
} {
  const store = new MemoryDslArtifactStore();
  const evaluator = makeExpressionEvaluator(makeDefaultHostContext('2026-05-21T00:00:00.000Z'));
  const registry = makeExpressionRegistry();
  const expressionKind: DslKind<unknown, unknown, unknown, HostOpSet> = {
    kind: 'expression',
    parse: (source: string) =>
      parse(source) as ReturnType<DslKind<unknown, unknown, unknown, HostOpSet>['parse']>,
    evaluator,
    registry,
  };
  const kindRegistry = makeDslKindRegistry([expressionKind]);
  const fake = makeFakeEventStore();
  return {
    eventStore: fake.eventStore,
    artifactStore: store,
    registry: kindRegistry,
    store,
    appended: fake.appended,
    newEventId: () => 'evt-test-1',
    now: () => '2026-05-21T00:00:00.000Z',
  };
}

describe('handleDslUpdate — happy path', function () {
  let deps: ReturnType<typeof makeDeps>;
  beforeEach(function () {
    deps = makeDeps();
  });

  it('first save returns outcome=inserted with version 1', async function () {
    const result = await handleDslUpdate(
      {
        tenantId: 'tenant-a',
        correlationId: 'corr-1',
        principalId: 'user:alice',
        kind: 'expression',
        apiName: 'welcome',
        source: '"hello" | upper',
        substrateVersion: '0.1.0',
      },
      deps,
    );
    expect(result.outcome).toBe('inserted');
    expect(result.artifact.version).toBe(1);
    expect(result.artifact.apiName).toBe('welcome');
    expect(result.artifact.tenantId).toBe('tenant-a');
    expect(result.envelope.eventType).toBe('Dsl.Expression.Updated');
    expect(result.envelope.cacheInvalidationTags).toEqual([
      'Tenant:tenant-a',
      `DslArtifact:${result.artifact.artifactId}`,
    ]);
    expect(deps.appended.length).toBe(1);
  });

  it('second save returns outcome=versioned with stable artifactId', async function () {
    const cmd = {
      tenantId: 'tenant-a',
      correlationId: 'corr-1',
      principalId: 'user:alice',
      kind: 'expression',
      apiName: 'welcome',
      source: '"v1" | upper',
      substrateVersion: '0.1.0',
    };
    const first = await handleDslUpdate(cmd, deps);
    const second = await handleDslUpdate({ ...cmd, source: '"v2" | upper' }, deps);
    expect(second.outcome).toBe('versioned');
    expect(second.artifact.version).toBe(2);
    expect(second.artifact.artifactId).toBe(first.artifact.artifactId);
  });

  it('idempotencyKey is deterministic per (tenant, apiName, version)', async function () {
    const cmd = {
      tenantId: 'tenant-a',
      correlationId: 'corr-1',
      principalId: 'user:alice',
      kind: 'expression',
      apiName: 'welcome',
      source: '"v1"',
      substrateVersion: '0.1.0',
    };
    const r1 = await handleDslUpdate(cmd, deps);
    expect(r1.envelope.idempotencyKey).toBe('dsl.expression.update.tenant-a.welcome.1');
  });
});

describe('handleDslUpdate — rejections', function () {
  it('rejects unknown kind with DSL_UNKNOWN_KIND', async function () {
    const deps = makeDeps();
    await expect(
      handleDslUpdate(
        {
          tenantId: 't',
          correlationId: 'c',
          principalId: 'u',
          kind: 'template',
          apiName: 'x',
          source: 'a',
          substrateVersion: '0.1.0',
        },
        deps,
      ),
    ).rejects.toThrow(DslHandlerError);
  });

  it('rejects invalid apiName with DSL_INVALID_API_NAME', async function () {
    const deps = makeDeps();
    await expect(
      handleDslUpdate(
        {
          tenantId: 't',
          correlationId: 'c',
          principalId: 'u',
          kind: 'expression',
          apiName: 'Bad-Name!',
          source: '"x"',
          substrateVersion: '0.1.0',
        },
        deps,
      ),
    ).rejects.toThrow(/invalid apiName/);
  });

  it('rejects unparseable source with DSL_PARSE_ERROR + sourceRange', async function () {
    const deps = makeDeps();
    let captured: DslHandlerError | null = null;
    try {
      await handleDslUpdate(
        {
          tenantId: 't',
          correlationId: 'c',
          principalId: 'u',
          kind: 'expression',
          apiName: 'broken',
          source: '"unterminated',
          substrateVersion: '0.1.0',
        },
        deps,
      );
    } catch (e) {
      captured = e as DslHandlerError;
    }
    expect(captured).toBeInstanceOf(DslHandlerError);
    expect(captured?.code).toBe('DSL_PARSE_ERROR');
    expect(captured?.sourceRange).toBeDefined();
  });

  it('rejects unknown host op via static check', async function () {
    const deps = makeDeps();
    await expect(
      handleDslUpdate(
        {
          tenantId: 't',
          correlationId: 'c',
          principalId: 'u',
          kind: 'expression',
          apiName: 'badcall',
          source: 'nonexistent_op()',
          substrateVersion: '0.1.0',
        },
        deps,
      ),
    ).rejects.toThrow(/unknown host op/);
  });
});
