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

/**
 * Per-scenario state for the `@server`-tagged track that drives the real
 * `apps/server` + Postgres + smtp4dev stack. Sim scenarios leave these
 * unset; the `After('@server', …)` hook in `hooks.ts` reads them for
 * row-level cleanup. The fields are kept narrow — anything that's only
 * read by a single step should stay local to that step.
 */
export interface ServerStackContext {
  /** `Date.now().toString(36)` per scenario — namespaces every identifier. */
  runId: string;
  /** Public-signup form input. */
  email: string;
  tenantSlug: string;
  organizationName: string;
  /** correlationId minted by the harness and pinned via `X-Correlation-Id`. */
  correlationId: string;
  /** Set after POST /api/v1/signup succeeds (returns 202 with `signupId`). */
  signupId: string | null;
  /** Set after POST /api/v1/admin/signups/:id/approve succeeds. */
  tenantId: string | null;
  /** Set in the Given that boots the postgres client. */
  hasPostgres: boolean;
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
  /**
   * Populated by `@server`-tagged scenarios. Sim scenarios leave this
   * `null`. Keeping it on `world` rather than a separate fixture means
   * the cleanup `After` hook can find the data without re-deriving it.
   */
  serverStack: ServerStackContext | null;
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
    serverStack: null,
  };
}
