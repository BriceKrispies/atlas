/**
 * Per-step idempotency-key + correlationId derivation.
 *
 * Spec: `specs/crosscut/seed-corpus.md` §4.3.
 *
 *   idempotencyKey = sha256Hex(scenarioId + '::' + i).slice(0, 32)
 *   correlationId  = `seed:${scenarioId}:${i}`
 *
 * Both are stable across reruns — re-running an already-applied
 * scenario is a no-op at the dispatch layer (the platform's
 * idempotency contract — Invariant I3 — deduplicates).
 */

import { sha256Hex } from '@atlas/platform-core';
import type { Crypto } from '@atlas/ports';

export function deriveIdempotencyKey(
  crypto: Crypto,
  scenarioId: string,
  stepIndex: number,
): string {
  return sha256Hex(scenarioId + '::' + String(stepIndex), crypto).slice(0, 32);
}

export function deriveCorrelationId(scenarioId: string, stepIndex: number): string {
  return `seed:${scenarioId}:${stepIndex}`;
}
