/**
 * Handler registry for the repository module.
 *
 * Maps action ids to `IntentHandler` shims that decode the inbound
 * `IntentEnvelope.payload` into a typed command and dispatch to the
 * underlying domain function.
 *
 * Action ids:
 *   - `Repository.Create` → `handleRepositoryCreate`
 *   - `Repository.Upload` → `handleRepositoryUpload`
 *
 * The wiring layer (`apps/server/src/middleware/state.ts`) composes this
 * registry through `composeRegistries` alongside the registries for the
 * other modules. The route layer never imports this directly — it
 * resolves through the composed registry.
 *
 * **Cross-agent contract:** the standard `IntentHandlerContext` shape
 * defined in `@atlas/ports/handler-registry.ts` exposes
 * `tenantId / principalId / correlationId / eventStore / catalogState`.
 * The repository handlers also need a `RepositoryStore` and a
 * `RepositoryRevisionStore`, which the context type does not currently
 * include. The wiring layer must extend the context (the catalog module
 * uses `ctx.catalogState` the same way) — the registry below pulls the
 * stores off the context with a narrowed cast. If `IntentHandlerContext`
 * is broadened to include them in a follow-up, drop the cast.
 */

import type {
  HandlerRegistry,
  IntentHandler,
  IntentHandlerContext,
  HandlerResult,
  RepositoryStore,
  RepositoryRevisionStore,
} from '@atlas/ports';
import type { IntentEnvelope } from '@atlas/platform-core';
import type { EventEnvelope } from '@atlas/platform-core';
import { handleRepositoryCreate } from './repository-create.ts';
import { handleRepositoryUpload } from './repository-upload.ts';
import {
  REPOSITORY_CREATED_EVENT_TYPE,
  REPOSITORY_CREATED_SCHEMA_ID,
  REPOSITORY_CREATED_SCHEMA_VERSION,
} from '../events.ts';
import { newEventId } from '../ids.ts';

interface RepositoryHandlerContext extends IntentHandlerContext {
  repositories: RepositoryStore;
  revisions: RepositoryRevisionStore;
}

function readString(payload: Record<string, unknown>, key: string): string {
  const v = payload[key];
  if (typeof v !== 'string') {
    throw new Error(`expected string for payload.${key}`);
  }
  return v;
}

function readOptionalString(
  payload: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = payload[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') {
    throw new Error(`expected string for payload.${key}`);
  }
  return v;
}

function readNumber(payload: Record<string, unknown>, key: string): number {
  const v = payload[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`expected number for payload.${key}`);
  }
  return v;
}

function ctxAsRepoCtx(ctx: IntentHandlerContext): RepositoryHandlerContext {
  const c = ctx as Partial<RepositoryHandlerContext>;
  if (!c.repositories || !c.revisions) {
    throw new Error(
      'repository handlers require `repositories` + `revisions` on IntentHandlerContext (wired by apps/server)',
    );
  }
  return c as RepositoryHandlerContext;
}

const repositoryCreateHandler: IntentHandler = {
  async handle(
    ctx: IntentHandlerContext,
    envelope: IntentEnvelope,
  ): Promise<HandlerResult> {
    const c = ctxAsRepoCtx(ctx);
    const result = await handleRepositoryCreate(
      {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        principalId: ctx.principalId,
        repoSlug: readString(envelope.payload, 'repoSlug'),
        name: readString(envelope.payload, 'name'),
        ...(readOptionalString(envelope.payload, 'description') !== undefined
          ? {
              description: readOptionalString(
                envelope.payload,
                'description',
              ) as string,
            }
          : {}),
      },
      c.repositories,
      ctx.eventStore,
    );
    if (!result.envelope) {
      // Idempotent no-op on an existing slug. The intent pipeline expects
      // a primary event; synthesize a non-persisted envelope describing
      // the existing row so the response is well-formed. The wiring
      // layer's idempotency check will resolve the original event via
      // the matching `idempotencyKey` if it needs the persisted one.
      const synthesized: EventEnvelope = {
        eventId: newEventId(),
        eventType: REPOSITORY_CREATED_EVENT_TYPE,
        schemaId: REPOSITORY_CREATED_SCHEMA_ID,
        schemaVersion: REPOSITORY_CREATED_SCHEMA_VERSION,
        occurredAt: result.repository.createdAt,
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        idempotencyKey: `repository.create.${ctx.tenantId}.${result.repository.repoSlug}`,
        causationId: null,
        principalId: ctx.principalId,
        userId: ctx.principalId,
        cacheInvalidationTags: [
          `Tenant:${ctx.tenantId}`,
          `Repository:${result.repository.repoId}`,
        ],
        payload: {
          repoId: result.repository.repoId,
          repoSlug: result.repository.repoSlug,
          name: result.repository.name,
          description: result.repository.description,
        },
      };
      return { primary: synthesized, follow: [] };
    }
    return { primary: result.envelope, follow: [] };
  },
};

const repositoryUploadHandler: IntentHandler = {
  async handle(
    ctx: IntentHandlerContext,
    envelope: IntentEnvelope,
  ): Promise<HandlerResult> {
    const c = ctxAsRepoCtx(ctx);
    const result = await handleRepositoryUpload(
      {
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        principalId: ctx.principalId,
        repoId: readString(envelope.payload, 'repoId'),
        byteCount: readNumber(envelope.payload, 'byteCount'),
        contentHash: readString(envelope.payload, 'contentHash'),
        bytesBase64: readString(envelope.payload, 'bytesBase64'),
      },
      c.repositories,
      c.revisions,
      ctx.eventStore,
    );
    return { primary: result.envelope, follow: [] };
  },
};

export function repositoryHandlerEntries(): ReadonlyArray<readonly [string, IntentHandler]> {
  return [
    ['Repository.Create', repositoryCreateHandler],
    ['Repository.Upload', repositoryUploadHandler],
  ];
}

export function repositoryHandlerRegistry(): HandlerRegistry {
  const map = new Map<string, IntentHandler>(repositoryHandlerEntries());
  return {
    get(actionId: string): IntentHandler | undefined {
      return map.get(actionId);
    },
  };
}
