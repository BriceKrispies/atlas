/**
 * `dslHandlerRegistry` — builds a `HandlerRegistry` with one entry per
 * registered DSL kind. Each entry adapts the inbound `IntentEnvelope`
 * into a `DslUpdateCommand` and delegates to the kind-erased
 * `handleDslUpdate` from `./dsl-update.ts`.
 *
 * Mirrors the shape of `modules/content-pages/src/handlers/registry.ts`:
 * deps that aren't part of `IntentHandlerContext` (here: the kind
 * registry + the DSL artifact store) are closed over by the factory.
 * The wiring layer in `apps/server/src/middleware/state.ts` invokes
 * this factory per-request with the per-tenant `DslArtifactStore`.
 *
 * Action naming: `Dsl.${TitleCase(kind)}.Update`. Each kind registered
 * in the `DslKindRegistry` gets exactly one entry; unregistered kinds
 * are not reachable through this registry (ingress's
 * `controlPlaneRegistry.hasAction` check rejects them earlier).
 */

import type { HandlerRegistry, HandlerResult, IntentHandler, DslArtifactStore } from '@atlas/ports';
import { handleDslUpdate } from './dsl-update.ts';
import type { DslKindRegistry } from '../kind-registry.ts';

interface DslUpdatePayloadOnWire {
  readonly apiName: string;
  readonly source: string;
  readonly substrateVersion?: string;
}

export interface DslHandlerRegistryDeps {
  readonly kindRegistry: DslKindRegistry;
  readonly artifactStore: DslArtifactStore;
  /** Default substrate version stamped on artifacts when the payload omits it. */
  readonly defaultSubstrateVersion?: string;
}

function capitalise(s: string): string {
  if (s.length === 0) return s;
  const head = s[0] ?? '';
  return `${head.toUpperCase()}${s.slice(1)}`;
}

/**
 * Generate the canonical `(actionId, handler)` entries for every kind
 * registered in `deps.kindRegistry`. Order matches the kind registry's
 * `list()` order. Exposed alongside `dslHandlerRegistry` so callers can
 * compose the entries into a larger registry via `composeRegistries`.
 */
export function dslHandlerEntries(
  deps: DslHandlerRegistryDeps,
): ReadonlyArray<readonly [string, IntentHandler]> {
  const entries: Array<readonly [string, IntentHandler]> = [];
  for (const kind of deps.kindRegistry.list()) {
    const actionId = `Dsl.${capitalise(kind)}.Update`;
    const handler: IntentHandler = {
      async handle(ctx, envelope): Promise<HandlerResult> {
        const payload = envelope.payload as unknown as DslUpdatePayloadOnWire;
        const result = await handleDslUpdate(
          {
            tenantId: ctx.tenantId,
            correlationId: ctx.correlationId,
            principalId: ctx.principalId,
            kind,
            apiName: payload.apiName,
            source: payload.source,
            substrateVersion: payload.substrateVersion ?? deps.defaultSubstrateVersion ?? '0.1.0',
          },
          {
            eventStore: ctx.eventStore,
            artifactStore: deps.artifactStore,
            registry: deps.kindRegistry,
          },
        );
        return { primary: result.envelope, follow: [] };
      },
    };
    entries.push([actionId, handler]);
  }
  return entries;
}

export function dslHandlerRegistry(deps: DslHandlerRegistryDeps): HandlerRegistry {
  const map = new Map<string, IntentHandler>(dslHandlerEntries(deps));
  return {
    get(actionId: string): IntentHandler | undefined {
      return map.get(actionId);
    },
  };
}
