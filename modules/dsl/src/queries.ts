/**
 * Read-side query helpers for the DSL module.
 *
 * Three flavours:
 *   - `getDslArtifact` / `getDslArtifactVersion` / `getDslArtifactById` /
 *     `listDslArtifacts` — straight read passes through the
 *     `DslArtifactStore` port.
 *   - `validateDslSource` — parse + static-check WITHOUT saving. Returns
 *     the full list of errors per ADR 0007 §8: agents iterate against
 *     this endpoint without burning the artifact-write budget.
 *
 * Each query takes a tenant-scoped dependency bundle (`DslQueryDeps`).
 * The wiring layer (apps/server) builds the bundle per-request from
 * the tenant pool + the kind registry composed at boot.
 */

import type { DslArtifactStore } from '@atlas/ports';
import type { DslArtifact, DslError, SourceMap, StaticCheckHints } from '@atlas/dsl-substrate';
import type { DslKindRegistry } from './kind-registry.ts';
import { DslHandlerError, codes } from './errors.ts';

export interface DslQueryDeps {
  readonly tenantId: string;
  readonly artifactStore: DslArtifactStore;
  readonly registry: DslKindRegistry;
}

/**
 * Read the latest version of an artifact. Returns null when the artifact
 * doesn't exist (caller decides whether to surface 404 or treat as
 * implicit "create on save" — the handler does the latter).
 */
export async function getDslArtifact(
  deps: DslQueryDeps,
  kind: string,
  apiName: string,
): Promise<DslArtifact<string, unknown> | null> {
  assertKnownKind(deps.registry, kind);
  return deps.artifactStore.get<unknown>(kind, apiName);
}

export async function getDslArtifactVersion(
  deps: DslQueryDeps,
  kind: string,
  apiName: string,
  version: number,
): Promise<DslArtifact<string, unknown> | null> {
  assertKnownKind(deps.registry, kind);
  return deps.artifactStore.getVersion<unknown>(kind, apiName, version);
}

export async function getDslArtifactById(
  deps: DslQueryDeps,
  kind: string,
  artifactId: string,
): Promise<DslArtifact<string, unknown> | null> {
  assertKnownKind(deps.registry, kind);
  return deps.artifactStore.getById<unknown>(kind, artifactId);
}

export async function listDslArtifacts(
  deps: DslQueryDeps,
  kind: string,
): Promise<ReadonlyArray<DslArtifact<string, unknown>>> {
  assertKnownKind(deps.registry, kind);
  return deps.artifactStore.list<unknown>(kind);
}

export interface ValidateDslSourceInput {
  readonly kind: string;
  readonly source: string;
  readonly hints?: StaticCheckHints;
}

export interface ValidateDslSourceResult {
  readonly ok: boolean;
  /** Empty array when ok === true. */
  readonly errors: ReadonlyArray<DslError>;
  /** Present only when parsing succeeded (regardless of static-check result). */
  readonly ast?: unknown;
  readonly sourceMap?: SourceMap;
}

/**
 * Parse + static-check a candidate source WITHOUT writing anything.
 * Returns the full list of errors (parse errors at index 0 if parsing
 * failed; static-check errors otherwise). Per ADR 0007 §8, this is
 * the validate-without-commit primitive — agents iterate against it
 * cheaply.
 */
export function validateDslSource(
  deps: Pick<DslQueryDeps, 'registry'>,
  input: ValidateDslSourceInput,
): ValidateDslSourceResult {
  assertKnownKind(deps.registry, input.kind);
  const kindDescriptor = deps.registry.get(input.kind);
  if (!kindDescriptor) {
    // assertKnownKind would have thrown — defensive fallback.
    return {
      ok: false,
      errors: [{ code: 'DSL_PARSE_ERROR', message: `unknown kind '${input.kind}'` }],
    };
  }
  const parsed = kindDescriptor.parse(input.source);
  if (!parsed.ok) {
    return { ok: false, errors: [parsed.error] };
  }
  const staticErrors = kindDescriptor.evaluator.staticCheck(parsed.value.ast, input.hints ?? {});
  if (staticErrors.length > 0) {
    return {
      ok: false,
      errors: staticErrors,
      ast: parsed.value.ast,
      sourceMap: parsed.value.sourceMap,
    };
  }
  return {
    ok: true,
    errors: [],
    ast: parsed.value.ast,
    sourceMap: parsed.value.sourceMap,
  };
}

function assertKnownKind(registry: DslKindRegistry, kind: string): void {
  if (!registry.has(kind)) {
    throw new DslHandlerError(codes.DSL_UNKNOWN_KIND, `unknown DSL kind: '${kind}'`, 400);
  }
}
