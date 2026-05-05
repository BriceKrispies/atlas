/**
 * Phase A7.7 — Risk → step-up MFA gate.
 *
 * A pure helper for the principal middleware:
 *
 *   1. Compute risk score from request signals (caller wires the
 *      scorer; we don't read priors here).
 *   2. If score >= stepUpMfaThreshold AND the session's
 *      `riskAcknowledgedUntil` is stale → return decision='step_up'.
 *   3. If score >= hardDenyThreshold → 'hard_deny' regardless.
 *   4. Else 'allow'.
 *
 * `acknowledgeStepUp(session)` produces the UPDATED AuthSession with
 * a fresh `riskAcknowledgedUntil` window — call this from the MFA
 * challenge handler when the user successfully re-verifies. The
 * window default is 5 minutes; tenants can override via policy.
 *
 * SECURITY:
 *   - The acknowledgement timestamp lives ON THE ENTITY, never on the
 *     wire. A client cannot bypass the gate by forging a "step-up
 *     completed" claim.
 *   - The principal middleware is the only enforcement point — routes
 *     trust the resolved principal.
 *   - On hard_deny, the request is rejected even if the user just
 *     completed step-up; this is a defence-in-depth ceiling.
 */

import type {
  AuthSessionDocument,
  RiskPolicy,
  RiskScore,
  RiskScorer,
  RiskSignals,
} from '../types.ts';
import { decideFromScore, type RiskDecision } from './scorer.ts';

/** Default acknowledgement window. Tenants override via policy. */
export const DEFAULT_RISK_ACK_WINDOW_SECONDS = 5 * 60;

export interface RiskGateInput {
  /** Pluggable risk scorer (typically from app bootstrap). */
  scorer: RiskScorer;
  /** Per-tenant thresholds. */
  policy: RiskPolicy;
  /** Per-request signals — IP, UA-class, geo, etc. */
  signals: RiskSignals;
  /**
   * The session being evaluated. When unset (e.g. JWT path with no
   * Atlas session), step-up cannot be acknowledged via this entity —
   * the gate falls back to score-only behaviour: the request is
   * rejected outright with RISK_STEP_UP_REQUIRED, since there's no
   * session-side ack timestamp to consult. JWT-authed flows that need
   * step-up will need a session minted first.
   */
  session?: AuthSessionDocument | null;
  /** Optional clock override for testing. Default `Date.now()`. */
  now?: number;
}

export interface RiskGateOutcome {
  decision: RiskDecision;
  score: RiskScore;
  /** True iff the session's `riskAcknowledgedUntil` is in the future. */
  acknowledged: boolean;
}

/**
 * Pure decision function. Does NOT mutate the session — the caller
 * must persist any updates.
 */
export function evaluateRiskGate(input: RiskGateInput): RiskGateOutcome {
  const score = input.scorer(input.signals);
  const baseDecision = decideFromScore(score.score, input.policy);
  const now = input.now ?? Date.now();
  const ackUntil = input.session?.riskAcknowledgedUntil;
  const acknowledged =
    ackUntil !== undefined && new Date(ackUntil).getTime() > now;
  // Hard deny: never overridden by acknowledgement.
  if (baseDecision === 'hard_deny') {
    return { decision: 'hard_deny', score, acknowledged };
  }
  // Step-up but already acknowledged → allow.
  if (baseDecision === 'step_up' && acknowledged) {
    return { decision: 'allow', score, acknowledged };
  }
  return { decision: baseDecision, score, acknowledged };
}

/**
 * Returns an UPDATED session document with `riskAcknowledgedUntil` set
 * `windowSeconds` into the future. Pure — caller persists.
 *
 * Use this from the MFA challenge submit handler on successful verify.
 */
export function acknowledgeStepUp(
  session: AuthSessionDocument,
  windowSeconds = DEFAULT_RISK_ACK_WINDOW_SECONDS,
  now = Date.now(),
): AuthSessionDocument {
  return {
    ...session,
    riskAcknowledgedUntil: new Date(now + windowSeconds * 1000).toISOString(),
  };
}
