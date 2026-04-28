/**
 * Shared parity-mode factory contract.
 *
 * Both the IDB factory (sim mode) and the HTTP factory (node mode) implement
 * `BrowserIngress`. The same Vitest scenarios are written twice (sim and node
 * suffixes) — they import the matching factory but otherwise share the test
 * body shape via this interface.
 *
 * The `__db` / `__search` escape hatches are sim-only. Node mode raises
 * `UnsupportedInMode` for those calls; tests that need them are sim-only and
 * should be in `*-sim.test.ts` files only.
 */

import type {
  IntentEnvelope,
  IntentResponse,
  SearchDocument,
} from '@atlas/platform-core';
import type {
  TaxonomyNavigationResponse,
  FamilyDetailResponse,
  VariantTableParams,
  VariantTableResponse,
  SearchParams,
  SearchResponse,
} from '@atlas/modules-catalog';

export interface IngressFailure {
  code: string;
  status: number;
  message: string;
  correlationId?: string;
}

export class IngressFailureError extends Error {
  readonly code: string;
  readonly status: number;
  readonly correlationId: string | undefined;
  constructor(failure: IngressFailure) {
    super(failure.message);
    this.code = failure.code;
    this.status = failure.status;
    this.correlationId = failure.correlationId;
  }
}

export interface HealthResponse {
  status: 'ok' | 'unavailable' | string;
  checks?: Record<string, unknown>;
}

export interface BrowserIngress {
  readonly mode: 'sim' | 'node';
  readonly tenantId: string;
  readonly principalId: string;

  /** Submit an intent envelope. Throws `IngressFailureError` on non-2xx. */
  submitIntent(envelope: IntentEnvelope): Promise<IntentResponse>;

  /** As above, but returns the failure envelope instead of throwing. */
  submitIntentRaw(envelope: IntentEnvelope): Promise<
    | { ok: true; response: IntentResponse }
    | { ok: false; failure: IngressFailure }
  >;

  getTaxonomyNodes(treeKey: string): Promise<TaxonomyNavigationResponse | null>;
  getFamilyDetail(familyKey: string): Promise<FamilyDetailResponse | null>;
  getVariantTable(
    familyKey: string,
    params?: VariantTableParams,
  ): Promise<VariantTableResponse | null>;
  searchCatalog(params: SearchParams): Promise<SearchResponse>;

  /** Sim-only: read the cacheInvalidationTags off the stored event envelope. */
  readEventTags(eventId: string): Promise<string[] | null>;

  /** Sim-only: clear all search documents for the tenant (mimics SQL DELETE). */
  truncateSearch(): Promise<void>;

  /** Sim-only: write a search doc directly into the engine for permission tests. */
  indexSearchDocument(doc: SearchDocument): Promise<void>;

  /** Liveness check: returns the parsed body and the HTTP-equivalent status. */
  health(): Promise<{ status: number; body: HealthResponse }>;

  /** Readiness check: same shape; sim approximates by returning ok when registry has actions. */
  ready(): Promise<{ status: number; body: HealthResponse }>;

  /** Probe an unauthenticated route — used by auth tests in node mode. Sim returns null. */
  whoami(headerOverride?: { debugPrincipal?: string; bearer?: string }): Promise<{
    status: number;
    body: unknown;
  } | null>;

  close(): Promise<void>;
}

export interface FactoryOptions {
  tenantId: string;
  principalId: string;
}

export class UnsupportedInMode extends Error {
  constructor(method: string, mode: 'sim' | 'node') {
    super(`${method} is not supported in ${mode} mode`);
  }
}
