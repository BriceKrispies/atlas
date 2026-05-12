import type {
  EntityStore,
  HandlerRegistry,
  IntentHandler,
  HandlerResult,
} from '@atlas/ports';
import { handlePageCreate } from './page-create.ts';
import { handlePageUpdate } from './page-update.ts';
import { handlePageDelete } from './page-delete.ts';
import type {
  ContentPagesIntentPayload,
  PageCreatePayload,
  PageDeletePayload,
  PageUpdatePayload,
} from '../intents.ts';

/**
 * Erase the typed-payload generic when binding a handler into the
 * registry map. The HandlerRegistry's `get(actionId): IntentHandler`
 * surface returns the default-generic shape (`IntentPayload`) — ingress
 * dispatches by `actionId` string and doesn't know payload-shape
 * statically — so the action-specific narrowing only lives *inside*
 * each closure. Same pattern as `modules/identity/src/handlers/registry.ts`.
 */
function asWide<TPayload extends ContentPagesIntentPayload>(
  h: IntentHandler<TPayload>,
): IntentHandler {
  // eslint-disable-next-line atlas-widgets/no-double-cast, @typescript-eslint/no-unsafe-type-assertion -- boundary: registry erases payload-generic; ingress dispatches by actionId string and the narrowed types only live inside each closure
  return h as unknown as IntentHandler;
}

/**
 * Construct content-pages handler entries.
 *
 * Update needs the `EntityStore` to read the prior document; that's
 * not on `IntentHandlerContext`, so the wiring layer injects it via a
 * closure — same shape as `modules/identity/src/handlers/registry.ts`.
 */
export function contentPagesHandlerEntries(
  entities: EntityStore,
): ReadonlyArray<readonly [string, IntentHandler]> {
  const createHandler: IntentHandler<PageCreatePayload> = {
    async handle(ctx, envelope): Promise<HandlerResult> {
      const p = envelope.payload;
      const result = await handlePageCreate(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          pageId: p.pageId,
          title: p.title,
          slug: p.slug,
          ...(p.status !== undefined ? { status: p.status } : {}),
          ...(p.content !== undefined ? { content: p.content } : {}),
          ...(p.authorId !== undefined ? { authorId: p.authorId } : {}),
          ...(p.templateId !== undefined ? { templateId: p.templateId } : {}),
          ...(p.templateVersion !== undefined
            ? { templateVersion: p.templateVersion }
            : {}),
          ...(p.pluginRef !== undefined ? { pluginRef: p.pluginRef } : {}),
        },
        ctx.eventStore,
      );
      return { primary: result.envelope, follow: [] };
    },
  };

  const updateHandler: IntentHandler<PageUpdatePayload> = {
    async handle(ctx, envelope): Promise<HandlerResult> {
      const p = envelope.payload;
      const result = await handlePageUpdate(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          pageId: p.pageId,
          ...(p.title !== undefined ? { title: p.title } : {}),
          ...(p.slug !== undefined ? { slug: p.slug } : {}),
          ...(p.status !== undefined ? { status: p.status } : {}),
          ...(p.content !== undefined ? { content: p.content } : {}),
          ...(p.templateId !== undefined ? { templateId: p.templateId } : {}),
          ...(p.templateVersion !== undefined
            ? { templateVersion: p.templateVersion }
            : {}),
        },
        ctx.eventStore,
        entities,
      );
      return { primary: result.envelope, follow: [] };
    },
  };

  const deleteHandler: IntentHandler<PageDeletePayload> = {
    async handle(ctx, envelope): Promise<HandlerResult> {
      const p = envelope.payload;
      const result = await handlePageDelete(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          pageId: p.pageId,
        },
        ctx.eventStore,
      );
      return { primary: result.envelope, follow: [] };
    },
  };

  return [
    ['ContentPages.Page.Create', asWide(createHandler)],
    ['ContentPages.Page.Update', asWide(updateHandler)],
    ['ContentPages.Page.Delete', asWide(deleteHandler)],
  ];
}

export function contentPagesHandlerRegistry(
  entities: EntityStore,
): HandlerRegistry {
  const map = new Map<string, IntentHandler>(contentPagesHandlerEntries(entities));
  return {
    get(actionId: string): IntentHandler | undefined {
      return map.get(actionId);
    },
  };
}
