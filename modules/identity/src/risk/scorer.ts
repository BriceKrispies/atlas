/**
 * Phase A7 — Risk engine.
 *
 * Pluggable scorer over a small, fixed signal set. The default impl
 * weights five signals, returns `score ∈ [0, 1]`, and emits per-signal
 * contributions for explainability + audit.
 *
 * Per the plan: ship Phase A7 with three live signals (geo, ua-class,
 * recent-failure-rate). `ip` is captured but doesn't yet score —
 * geo-classification is the IP-derived signal. `hourUtc` reserves a slot
 * for time-of-day learning; the default impl scores it conservatively.
 *
 * The scorer is PURE — no I/O, no clock reads, no state. Apps that want
 * to fold in user-specific history (recent-geo set, typical-hour set)
 * compose a wrapping scorer that fetches the priors and forwards into
 * `defaultRiskScorer`.
 */

import type { RiskScore, RiskScorer, RiskSignals } from '../types.ts';

/**
 * Reference scorer.
 *
 * Weights:
 *   - geo:           up to 0.4 (mismatch with `expectedGeo` when given)
 *   - uaClass:       up to 0.2 (cli > unknown > mobile > browser)
 *   - recentFailure: up to 0.4 (linear in `recentFailureRate`)
 *   - hourUtc:       small constant when nightly (0-5 UTC) — 0.05
 *
 * Score is clamped to `[0, 1]`. Contributions are exposed unmodified for
 * audit (the policy layer can show "geo=0.4, ua=0.2, ..." in alerts).
 */
export interface DefaultScorerOptions {
  /**
   * Optional: known-good geo set for the user. Mismatch with `signals.geo`
   * pushes the geo contribution to the cap; match returns 0. When unset,
   * geo is treated as a no-signal (contribution=0) — calling code has to
   * pass priors in to make geo meaningful.
   */
  expectedGeo?: ReadonlyArray<string>;
}

const UA_CLASS_WEIGHTS: Record<NonNullable<RiskSignals['uaClass']>, number> = {
  browser: 0,
  mobile: 0.05,
  unknown: 0.1,
  cli: 0.2,
};

export function defaultRiskScorer(opts: DefaultScorerOptions = {}): RiskScorer {
  return (signals: RiskSignals): RiskScore => {
    const contributions: Record<string, number> = {};

    // Geo: only contributes when we have an expected set to compare against.
    const signalGeo = signals.geo;
    if (
      opts.expectedGeo !== undefined &&
      signalGeo !== undefined &&
      signalGeo !== 'unknown'
    ) {
      const geoLc = signalGeo.toLowerCase();
      const matched = opts.expectedGeo.some((g) => g.toLowerCase() === geoLc);
      contributions['geo'] = matched ? 0 : 0.4;
    } else {
      contributions['geo'] = 0;
    }

    // UA class.
    contributions['uaClass'] = signals.uaClass
      ? UA_CLASS_WEIGHTS[signals.uaClass]
      : 0;

    // Recent-failure rate: linear, capped at 0.4.
    const failureRate = signals.recentFailureRate ?? 0;
    contributions['recentFailureRate'] = Math.max(
      0,
      Math.min(0.4, failureRate * 0.4),
    );

    // Time-of-day: small constant when nightly UTC.
    if (
      signals.hourUtc !== undefined &&
      signals.hourUtc >= 0 &&
      signals.hourUtc < 6
    ) {
      contributions['hourUtc'] = 0.05;
    } else {
      contributions['hourUtc'] = 0;
    }

    const total = Object.values(contributions).reduce((a, b) => a + b, 0);
    const score = Math.max(0, Math.min(1, total));

    return { score, signals, contributions };
  };
}

/**
 * Convenience: a scorer that returns a fixed score regardless of signals.
 * Useful in tests when the policy under test cares about the threshold,
 * not the scoring function.
 */
export function fixedRiskScorer(score: number): RiskScorer {
  const clamped = Math.max(0, Math.min(1, score));
  return (signals: RiskSignals): RiskScore => ({
    score: clamped,
    signals,
    contributions: { fixed: clamped },
  });
}

/**
 * Resolve a risk decision from a score against a tenant policy.
 *
 *   score >= hardDenyThreshold     → 'hard_deny'
 *   score >= stepUpMfaThreshold    → 'step_up'
 *   else                           → 'allow'
 */
export type RiskDecision = 'allow' | 'step_up' | 'hard_deny';

export function decideFromScore(
  score: number,
  thresholds: { stepUpMfaThreshold: number; hardDenyThreshold: number },
): RiskDecision {
  if (score >= thresholds.hardDenyThreshold) return 'hard_deny';
  if (score >= thresholds.stepUpMfaThreshold) return 'step_up';
  return 'allow';
}
