import type { EventEnvelope, IntentEnvelope, IntentPayload, Logger } from '@atlas/abi';
import type { EventStore } from './event-store.ts';
import type { CatalogStateStore } from './catalog-state-store.ts';

// Handlers receive only the ports + identity they need to run; concrete
// adapters never reach this layer.
export interface IntentHandlerContext {
  tenantId: string;
  principalId: string;
  correlationId: string;
  eventStore: EventStore;
  catalogState: CatalogStateStore;
  /**
   * Per-request logger. Optional so test fixtures and pre-existing
   * `IntentHandlerContext` constructions don't need to thread one
   * through. When present, handler wrappers (e.g. identity's registry
   * shim) emit Domain.Verb.Outcome lines on success / rejection /
   * failure. Built from an `AtlasExecutionContext` at the wiring layer.
   */
  logger?: Logger;
}

export interface HandlerResult {
  // Primary event whose id is returned in the IntentResponse.
  primary: EventEnvelope;
  // Additional events produced by the handler. Dispatched in order after
  // the primary event. Empty for single-event handlers.
  follow: ReadonlyArray<EventEnvelope>;
}

/**
 * Generic intent handler.
 *
 * `TPayload` defaults to `IntentPayload` so existing handlers
 * (`async (ctx, envelope) => …` with `envelope.payload` typed as
 * `IntentPayload`) continue to compile unchanged. Modules with a
 * typed payload union — see `modules/identity/src/intents.ts` —
 * specialise per-action so the registry's closures receive the
 * narrowed shape directly instead of re-parsing the payload at
 * runtime.
 */
export interface IntentHandler<TPayload extends IntentPayload = IntentPayload> {
  handle(ctx: IntentHandlerContext, envelope: IntentEnvelope<TPayload>): Promise<HandlerResult>;
}

export interface HandlerRegistry {
  get(actionId: string): IntentHandler | undefined;
}
