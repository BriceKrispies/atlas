import { describe, expect, it } from '@atlas/test';
import type { DslArtifact } from './artifact.ts';
import { isKind } from './artifact.ts';

/**
 * Liskov-base envelope tests.
 *
 * The Liskov property the user asked for is: any concrete DSL artifact
 * substitutes cleanly at `DslArtifact<string, unknown>`. These tests prove
 * the *structural* claim — different `TKind` / `TAst` parameterisations
 * compile against the same envelope, and a consumer that only knows the
 * base type can still operate on every kind.
 *
 * ADR 0007 §9 forbids a shared AST. Nothing here introduces one — the
 * envelope is shared; `TAst` stays opaque to base consumers.
 */

interface ExprAst {
  readonly kind: 'lit' | 'ident';
  readonly value: unknown;
}

interface TemplateAst {
  readonly nodes: ReadonlyArray<{ readonly text: string }>;
}

function baselineArtifact<TKind extends string, TAst>(
  kind: TKind,
  ast: TAst,
): DslArtifact<TKind, TAst> {
  return {
    kind,
    artifactId: 'art-test-1',
    apiName: 'welcome_message',
    tenantId: 'tenant-a',
    version: 1,
    substrateVersion: '0.1.0',
    source: 'placeholder source',
    ast,
    sourceMap: [{ nodeId: 'n1', range: { startLine: 1, startCol: 1, endLine: 1, endCol: 5 } }],
    dependencies: [],
    createdAt: '2026-05-21T00:00:00.000Z',
    updatedAt: '2026-05-21T00:00:00.000Z',
    createdBy: 'user:test',
    updatedBy: 'user:test',
  };
}

describe('DslArtifact — Liskov envelope', function () {
  it('compiles two different kinds with different AST types against the same envelope', function () {
    const exprArtifact: DslArtifact<'expression', ExprAst> = baselineArtifact('expression', {
      kind: 'lit',
      value: 42,
    });
    const tmplArtifact: DslArtifact<'template', TemplateAst> = baselineArtifact('template', {
      nodes: [{ text: 'hello' }],
    });

    expect(exprArtifact.kind).toBe('expression');
    expect(tmplArtifact.kind).toBe('template');
  });

  it('substitutes both kinds at the base DslArtifact<string, unknown>', function () {
    const items: ReadonlyArray<DslArtifact<string, unknown>> = [
      baselineArtifact('expression', { kind: 'lit', value: 1 }),
      baselineArtifact('template', { nodes: [{ text: 'x' }] }),
    ];

    // A consumer that only knows the base type can walk both uniformly —
    // exactly the Liskov property.
    const kinds = items.map(function (a) {
      return a.kind;
    });
    expect(kinds).toEqual(['expression', 'template']);
  });

  it('isKind narrows to the requested kind', function () {
    const base: DslArtifact<string, unknown> = baselineArtifact('expression', {
      kind: 'lit',
      value: 7,
    });
    if (isKind<'expression', ExprAst>(base, 'expression')) {
      // `base.ast` is now `ExprAst`.
      expect(base.ast.kind).toBe('lit');
      expect(base.ast.value).toBe(7);
    } else {
      throw new Error('isKind narrowing failed');
    }
  });

  it('isKind returns false for mismatched kinds', function () {
    const base: DslArtifact<string, unknown> = baselineArtifact('expression', {
      kind: 'lit',
      value: 0,
    });
    expect(isKind(base, 'template')).toBe(false);
  });

  it('preserves all envelope fields across kinds', function () {
    const exprArtifact = baselineArtifact('expression', { kind: 'lit', value: 1 });
    expect(exprArtifact.artifactId).toBe('art-test-1');
    expect(exprArtifact.apiName).toBe('welcome_message');
    expect(exprArtifact.tenantId).toBe('tenant-a');
    expect(exprArtifact.version).toBe(1);
    expect(exprArtifact.substrateVersion).toBe('0.1.0');
    expect(exprArtifact.source).toBe('placeholder source');
    expect(exprArtifact.sourceMap.length).toBe(1);
    expect(exprArtifact.dependencies).toEqual([]);
    expect(exprArtifact.createdBy).toBe('user:test');
  });
});
