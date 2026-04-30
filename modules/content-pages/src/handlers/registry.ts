import type {
  HandlerRegistry,
  IntentHandler,
  IntentHandlerContext,
  HandlerResult,
  ProjectionStore,
} from '@atlas/ports';
import type { IntentEnvelope } from '@atlas/platform-core';
import { handlePageCreate } from './page-create.ts';
import { handlePageUpdate } from './page-update.ts';
import { handlePageDelete } from './page-delete.ts';
import type { PageStatus } from '../types.ts';

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
    throw new Error(`expected string|null|undefined for payload.${key}`);
  }
  return v;
}

function readOptionalStatus(
  payload: Record<string, unknown>,
  key: string,
): PageStatus | undefined {
  const v = payload[key];
  if (v === undefined || v === null) return undefined;
  if (v !== 'draft' && v !== 'published' && v !== 'archived') {
    throw new Error(`expected page status for payload.${key}`);
  }
  return v;
}

/**
 * Construct content-pages handler entries.
 *
 * Update needs the `ProjectionStore` to read the prior document; that's
 * not on `IntentHandlerContext`, so the wiring layer injects it via a
 * closure (mirrors `authzHandlerEntries(store)`).
 */
export function contentPagesHandlerEntries(
  projections: ProjectionStore,
): ReadonlyArray<readonly [string, IntentHandler]> {
  const createHandler: IntentHandler = {
    async handle(
      ctx: IntentHandlerContext,
      envelope: IntentEnvelope,
    ): Promise<HandlerResult> {
      const payload = envelope.payload as Record<string, unknown>;
      const result = await handlePageCreate(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          pageId: readString(payload, 'pageId'),
          title: readString(payload, 'title'),
          slug: readString(payload, 'slug'),
          ...(readOptionalStatus(payload, 'status') !== undefined
            ? { status: readOptionalStatus(payload, 'status') as PageStatus }
            : {}),
          ...(readOptionalString(payload, 'content') !== undefined
            ? { content: readOptionalString(payload, 'content') as string }
            : {}),
          ...(readOptionalString(payload, 'authorId') !== undefined
            ? { authorId: readOptionalString(payload, 'authorId') as string }
            : {}),
          ...(readOptionalString(payload, 'templateId') !== undefined
            ? { templateId: readOptionalString(payload, 'templateId') as string }
            : {}),
          ...(readOptionalString(payload, 'templateVersion') !== undefined
            ? {
                templateVersion: readOptionalString(payload, 'templateVersion') as string,
              }
            : {}),
          ...(readOptionalString(payload, 'pluginRef') !== undefined
            ? { pluginRef: readOptionalString(payload, 'pluginRef') as string }
            : {}),
        },
        ctx.eventStore,
      );
      return { primary: result.envelope, follow: [] };
    },
  };

  const updateHandler: IntentHandler = {
    async handle(
      ctx: IntentHandlerContext,
      envelope: IntentEnvelope,
    ): Promise<HandlerResult> {
      const payload = envelope.payload as Record<string, unknown>;
      const result = await handlePageUpdate(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          pageId: readString(payload, 'pageId'),
          ...(readOptionalString(payload, 'title') !== undefined
            ? { title: readOptionalString(payload, 'title') as string }
            : {}),
          ...(readOptionalString(payload, 'slug') !== undefined
            ? { slug: readOptionalString(payload, 'slug') as string }
            : {}),
          ...(readOptionalStatus(payload, 'status') !== undefined
            ? { status: readOptionalStatus(payload, 'status') as PageStatus }
            : {}),
          ...(readOptionalString(payload, 'content') !== undefined
            ? { content: readOptionalString(payload, 'content') as string }
            : {}),
          ...(readOptionalString(payload, 'templateId') !== undefined
            ? { templateId: readOptionalString(payload, 'templateId') as string }
            : {}),
          ...(readOptionalString(payload, 'templateVersion') !== undefined
            ? {
                templateVersion: readOptionalString(payload, 'templateVersion') as string,
              }
            : {}),
        },
        ctx.eventStore,
        projections,
      );
      return { primary: result.envelope, follow: [] };
    },
  };

  const deleteHandler: IntentHandler = {
    async handle(
      ctx: IntentHandlerContext,
      envelope: IntentEnvelope,
    ): Promise<HandlerResult> {
      const payload = envelope.payload as Record<string, unknown>;
      const result = await handlePageDelete(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          pageId: readString(payload, 'pageId'),
        },
        ctx.eventStore,
      );
      return { primary: result.envelope, follow: [] };
    },
  };

  return [
    ['ContentPages.Page.Create', createHandler],
    ['ContentPages.Page.Update', updateHandler],
    ['ContentPages.Page.Delete', deleteHandler],
  ];
}

export function contentPagesHandlerRegistry(
  projections: ProjectionStore,
): HandlerRegistry {
  const map = new Map<string, IntentHandler>(contentPagesHandlerEntries(projections));
  return {
    get(actionId: string): IntentHandler | undefined {
      return map.get(actionId);
    },
  };
}
