/**
 * Phase-1 scenario runner. Pure dispatch loop — no filesystem, no
 * network, no adapter imports. Steps are submitted through the
 * injected `IntentDriver`, never `submitIntent` directly (locked
 * decision; see plan).
 *
 * Out of scope for Phase 1:
 *   - `apply:` fixture flattening (Phase 2)
 *   - axis expansion (Phase 3)
 *   - retries (Phase 2 CLI; types declare the option, runner ignores it)
 *   - schema validation (Phase 1 declares schema ids in `schema.ts`;
 *     AJV registration lands when the schema files are committed)
 *
 * Spec: `specs/crosscut/seed-corpus.md` §4.3 + §6.
 */

import type { IntentEnvelope } from '@atlas/platform-core';

import { deriveCorrelationId, deriveIdempotencyKey } from './idempotency.ts';
import type {
  IntentResult,
  RunResult,
  RunnerDeps,
  ScenarioRef,
  StepResult,
} from './types.ts';

export async function runScenario(
  deps: RunnerDeps,
  ref: ScenarioRef,
): Promise<RunResult> {
  const scenario = await deps.corpus.loadScenario(ref);
  const results: StepResult[] = [];

  for (let i = 0; i < scenario.steps.length; i++) {
    const step = scenario.steps[i];
    if (!step) continue;
    const idempotencyKey = deriveIdempotencyKey(deps.crypto, ref.scenarioId, i);
    const correlationId = deriveCorrelationId(ref.scenarioId, i);
    const envelope = buildEnvelope(step.intent, { idempotencyKey, correlationId });

    const r = await deps.driver.submit(envelope);
    const ok = step.expect ? matchesExpect(r, step.expect) : r.ok;

    results.push({
      stepId: step.stepId,
      idempotencyKey,
      ok,
      ...(r.errorCode !== undefined ? { errorCode: r.errorCode } : {}),
      ...(r.resultRef !== undefined ? { resultRef: r.resultRef } : {}),
    });

    // Fail-fast (default `retry: 0`). Phase 2's CLI can opt into
    // `--continueOnError`; the Phase 1 runner stops on first failure.
    if (!ok) break;
  }

  return {
    scenarioId: ref.scenarioId,
    contentHash: ref.contentHash,
    steps: results,
  };
}

function buildEnvelope(
  intent: IntentEnvelope,
  overrides: { idempotencyKey: string; correlationId: string },
): IntentEnvelope {
  return {
    ...intent,
    idempotencyKey: overrides.idempotencyKey,
    correlationId: overrides.correlationId,
  };
}

function matchesExpect(
  r: IntentResult,
  expect: { ok?: boolean; errorCode?: string },
): boolean {
  if (expect.ok !== undefined && r.ok !== expect.ok) return false;
  if (expect.errorCode !== undefined && r.errorCode !== expect.errorCode) return false;
  return true;
}
