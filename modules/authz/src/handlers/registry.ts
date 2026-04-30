import type {
  HandlerRegistry,
  IntentHandler,
  IntentHandlerContext,
  HandlerResult,
} from '@atlas/ports';
import type { IntentEnvelope } from '@atlas/platform-core';
import { handleCreatePolicy } from './create-policy.ts';
import { handleActivatePolicy } from './activate-policy.ts';
import { handleArchivePolicy } from './archive-policy.ts';
import type { PolicyStore } from '../policy-store.ts';

function readString(payload: Record<string, unknown>, key: string): string {
  const v = payload[key];
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

function readOptionalString(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const v = payload[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') {
    throw new Error(`expected string|null for payload.${key}`);
  }
  return v;
}

/**
 * Construct authz handler entries against a {@link PolicyStore}. The
 * store is injected so the wiring layer (server) can build it from its
 * `controlPlaneSql` pool without dragging Postgres into this package.
 */
export function authzHandlerEntries(
  store: PolicyStore,
): ReadonlyArray<readonly [string, IntentHandler]> {
  const createHandler: IntentHandler = {
    async handle(ctx: IntentHandlerContext, envelope: IntentEnvelope): Promise<HandlerResult> {
      const { envelope: ev } = await handleCreatePolicy(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          cedarText: readString(envelope.payload, 'cedarText'),
          description: readOptionalString(envelope.payload, 'description'),
        },
        store,
      );
      return { primary: ev, follow: [] };
    },
  };

  const activateHandler: IntentHandler = {
    async handle(ctx: IntentHandlerContext, envelope: IntentEnvelope): Promise<HandlerResult> {
      const { envelope: ev } = await handleActivatePolicy(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          version: readNumber(envelope.payload, 'version'),
        },
        store,
      );
      return { primary: ev, follow: [] };
    },
  };

  const archiveHandler: IntentHandler = {
    async handle(ctx: IntentHandlerContext, envelope: IntentEnvelope): Promise<HandlerResult> {
      const { envelope: ev } = await handleArchivePolicy(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          version: readNumber(envelope.payload, 'version'),
        },
        store,
      );
      return { primary: ev, follow: [] };
    },
  };

  return [
    ['Authz.Policy.Create', createHandler],
    ['Authz.Policy.Activate', activateHandler],
    ['Authz.Policy.Archive', archiveHandler],
  ];
}

/**
 * Registry combining catalog + authz handlers. The wiring layer should
 * compose this with `catalogHandlerRegistry` — `composeRegistries` is
 * exported from this module for convenience.
 */
export function authzHandlerRegistry(store: PolicyStore): HandlerRegistry {
  const map = new Map<string, IntentHandler>(authzHandlerEntries(store));
  return {
    get(actionId: string): IntentHandler | undefined {
      return map.get(actionId);
    },
  };
}

/**
 * Combine multiple HandlerRegistry instances into one. First-hit wins;
 * later registries can override earlier ones.
 */
export function composeRegistries(
  ...registries: ReadonlyArray<HandlerRegistry>
): HandlerRegistry {
  return {
    get(actionId: string): IntentHandler | undefined {
      for (const r of registries) {
        const h = r.get(actionId);
        if (h) return h;
      }
      return undefined;
    },
  };
}
