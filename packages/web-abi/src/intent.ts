/**
 * The client → BFF intent contract (ADR 0017).
 *
 * The browser kernel (`@atlas/web-kernel`) sends the UNWRAPPED action payload
 * plus the client-stamped `correlationId` (I5) and `idempotencyKey` (I3).
 * `apps/web-bff` builds the full backend `IntentEnvelope` (stamping tenant,
 * principal, schemaId, eventType) and forwards it to `apps/server`'s ingress.
 * The browser never builds the envelope — that is the BFF's job, so the wire
 * shape here is deliberately the minimal action+fields, not the envelope.
 */

/** The action and its domain fields — mirrors the backend `IntentPayload`. */
export interface IntentActionPayload {
  actionId: string;
  resourceType: string;
  resourceId?: string | null;
  [field: string]: unknown;
}

/** What the kernel POSTs to `{BFF}/intents`. */
export interface IntentRequest {
  payload: IntentActionPayload;
  /** Stamped by the kernel at the point of user action (constitution C6 / I5). */
  correlationId: string;
  /** Stamped by the kernel for dedupe (I3). */
  idempotencyKey: string;
}

/** What the BFF returns to the browser after the ingress accepts the intent. */
export interface IntentResult {
  eventId: string;
  tenantId: string;
  principalId: string | null;
  /** Echoed back so the kernel can correlate the response to the request. */
  correlationId: string;
}
