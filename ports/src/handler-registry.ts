import type { EventEnvelope, IntentEnvelope } from '@atlas/platform-core';
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
}

export interface HandlerResult {
  // Primary event whose id is returned in the IntentResponse.
  primary: EventEnvelope;
  // Additional events produced by the handler. Dispatched in order after
  // the primary event. Empty for single-event handlers.
  follow: ReadonlyArray<EventEnvelope>;
}

export interface IntentHandler {
  handle(ctx: IntentHandlerContext, envelope: IntentEnvelope): Promise<HandlerResult>;
}

export interface HandlerRegistry {
  get(actionId: string): IntentHandler | undefined;
}
