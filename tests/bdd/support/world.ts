import type { IntentEnvelope } from '@atlas/platform-core';

/**
 * Per-scenario state carried across step definitions. Stashed on the
 * `world` Playwright fixture so each scenario gets a fresh instance.
 *
 * The shape is deliberately permissive — steps drop whatever they need
 * the next step to read. Treat it like a scratchpad, not a schema.
 */
export interface IngressFailureRecord {
  code: string;
  status: number;
  message: string;
  correlationId?: string;
}

export interface BddWorld {
  /** Maps human-readable tenant aliases ("acme", "globex") to real ids. */
  readonly tenantsByAlias: Map<string, string>;
  /** The primary tenant alias (default the one the simPage was booted with). */
  primaryTenantAlias: string | null;
  /** Last correlationId minted by a publish step (used by Then assertions). */
  lastCorrelationId: string | null;
  /** Last idempotency key used by a publish step. */
  lastIdempotencyKey: string | null;
  /** Last envelope submitted (for replay-with-same-key scenarios). */
  lastEnvelope: IntentEnvelope | null;
  /** Last submitIntentRaw outcome — set by every When that submits. */
  lastSubmitOk: { ok: true; eventId: string } | null;
  lastSubmitFailure: IngressFailureRecord | null;
  /** Last query response (for "the response describes …" assertions). */
  lastQueryResponse: unknown;
}

export function createWorld(): BddWorld {
  return {
    tenantsByAlias: new Map(),
    primaryTenantAlias: null,
    lastCorrelationId: null,
    lastIdempotencyKey: null,
    lastEnvelope: null,
    lastSubmitOk: null,
    lastSubmitFailure: null,
    lastQueryResponse: null,
  };
}
