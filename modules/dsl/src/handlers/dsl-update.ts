/**
 * `Dsl.<Kind>.Update` handler.
 *
 * Generic over DSL kinds — the action's `kind` segment is dispatched
 * against a `DslKindRegistry` at runtime. The handler is uniform: parse,
 * static-check, save, emit. Each kind brings its own parser and
 * evaluator via the registry; the handler control flow doesn't care.
 *
 * Per ADR 0007 §5:
 *   - Parse `source` → produce `ast` → store both in the same transaction
 *   - Emit `Dsl.<Kind>.Updated` event with cacheInvalidationTags
 *     `['Tenant:${tenantId}', 'DslArtifact:${artifactId}']`
 *
 * The DSL artifact storage IS the projection (per ADR 0007 §3). No
 * dispatcher rebuilds anything from the event; cache invalidation is
 * tag-driven from the event's `cacheInvalidationTags`.
 *
 * `idempotencyKey` is deterministic: `dsl.<kind>.update.<tenantId>.<apiName>.<version>`.
 * Re-submitting the same intent envelope produces the same key.
 */

import type { EventEnvelope } from '@atlas/platform-core';
import type { DslArtifactStore, EventStore } from '@atlas/ports';
import type { DslArtifact, StaticCheckHints } from '@atlas/dsl-substrate';
import type { DslKindRegistry } from '../kind-registry.ts';
import { DslHandlerError, codes, assertApiName } from '../errors.ts';

/**
 * Command shape the handler accepts. The wiring layer (apps/server route)
 * builds this from the inbound intent envelope; the handler itself is
 * agnostic to the request transport.
 */
export interface DslUpdateCommand {
  readonly tenantId: string;
  readonly correlationId: string;
  readonly principalId: string;
  readonly kind: string;
  readonly apiName: string;
  readonly source: string;
  readonly substrateVersion: string;
  readonly hints?: StaticCheckHints;
}

export interface DslUpdateResult {
  readonly envelope: EventEnvelope;
  readonly artifact: DslArtifact<string, unknown>;
  readonly outcome: 'inserted' | 'versioned';
}

export interface DslUpdateDeps {
  readonly eventStore: EventStore;
  readonly artifactStore: DslArtifactStore;
  readonly registry: DslKindRegistry;
  /**
   * Generator for the event's `eventId`. Default is a small random id
   * with `evt-` prefix; tests inject a deterministic generator.
   */
  newEventId?: () => string;
  /**
   * ISO-8601 timestamp factory. Default `new Date().toISOString()`;
   * tests inject a frozen clock.
   */
  now?: () => string;
}

function capitalise(s: string): string {
  if (s.length === 0) return s;
  const head = s[0] ?? '';
  return `${head.toUpperCase()}${s.slice(1)}`;
}

function defaultEventId(): string {
  return `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function handleDslUpdate(
  cmd: DslUpdateCommand,
  deps: DslUpdateDeps,
): Promise<DslUpdateResult> {
  // 1. Kind lookup. Unknown kind = 400 with DSL_UNKNOWN_KIND.
  const kindDescriptor = deps.registry.get(cmd.kind);
  if (!kindDescriptor) {
    throw new DslHandlerError(codes.DSL_UNKNOWN_KIND, `unknown DSL kind: '${cmd.kind}'`, 400);
  }

  // 2. ApiName validation at the boundary.
  assertApiName(cmd.apiName);

  // 3. Parse. Substrate-shaped error → handler error with sourceRange.
  const parsed = kindDescriptor.parse(cmd.source);
  if (!parsed.ok) {
    throw new DslHandlerError(codes.DSL_PARSE_ERROR, parsed.error.message, 400, {
      ...(parsed.error.sourceRange ? { sourceRange: parsed.error.sourceRange } : {}),
      ...(parsed.error.suggestion ? { suggestion: parsed.error.suggestion } : {}),
    });
  }

  // 4. Static check. Multiple errors possible; surface the first so
  //    the handler error envelope stays single-error-shaped (matches
  //    every other handler). The validate endpoint (see queries.ts)
  //    returns ALL errors for agent iteration.
  const staticErrors = kindDescriptor.evaluator.staticCheck(parsed.value.ast, cmd.hints ?? {});
  if (staticErrors.length > 0) {
    const e = staticErrors[0];
    if (!e) {
      throw new DslHandlerError(codes.DSL_PARSE_ERROR, 'static check returned an empty error', 500);
    }
    const code: (typeof codes)[keyof typeof codes] =
      e.code === 'DSL_TYPE_ERROR'
        ? codes.DSL_TYPE_ERROR
        : e.code === 'DSL_UNKNOWN_IDENTIFIER'
          ? codes.DSL_UNKNOWN_IDENTIFIER
          : e.code === 'DSL_BROKEN_REFERENCE'
            ? codes.DSL_BROKEN_REFERENCE
            : e.code === 'DSL_SUBSTRATE_VERSION_MISMATCH'
              ? codes.DSL_SUBSTRATE_VERSION_MISMATCH
              : codes.DSL_PARSE_ERROR;
    throw new DslHandlerError(code, e.message, 400, {
      ...(e.sourceRange ? { sourceRange: e.sourceRange } : {}),
      ...(e.suggestion ? { suggestion: e.suggestion } : {}),
    });
  }

  // 5. Ensure storage tables exist for this kind (idempotent), then save.
  await deps.artifactStore.ensureKindRegistered(cmd.kind);
  const saved = await deps.artifactStore.save({
    kind: cmd.kind,
    apiName: cmd.apiName,
    tenantId: cmd.tenantId,
    substrateVersion: cmd.substrateVersion,
    source: cmd.source,
    ast: parsed.value.ast,
    sourceMap: parsed.value.sourceMap,
    dependencies: [],
    createdBy: cmd.principalId,
  });

  // 6. Build + append the event envelope per ADR 0007 §5.
  const now = (deps.now ?? (() => new Date().toISOString()))();
  const newEventId = deps.newEventId ?? defaultEventId;
  const eventType = `Dsl.${capitalise(cmd.kind)}.Updated`;
  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType,
    schemaId: `dsl.${cmd.kind}.updated.v1`,
    schemaVersion: 1,
    occurredAt: now,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `dsl.${cmd.kind}.update.${cmd.tenantId}.${cmd.apiName}.${saved.artifact.version}`,
    causationId: null,
    principalId: cmd.principalId,
    userId: cmd.principalId,
    cacheInvalidationTags: [`Tenant:${cmd.tenantId}`, `DslArtifact:${saved.artifact.artifactId}`],
    payload: {
      kind: cmd.kind,
      apiName: cmd.apiName,
      artifactId: saved.artifact.artifactId,
      version: saved.artifact.version,
      outcome: saved.outcome,
    },
  };
  const stored = await deps.eventStore.append(envelope);
  envelope.eventId = stored.eventId;
  envelope.seq = stored.seq;

  return { envelope, artifact: saved.artifact, outcome: saved.outcome };
}
