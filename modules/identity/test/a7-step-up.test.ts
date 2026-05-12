/**
 * Phase A7.7 — risk → step-up MFA gate.
 *
 * Pure-function tests for the risk gate decision + acknowledgement
 * helpers. Wiring these into the principal middleware is exercised
 * by the route-level integration tests in `apps/server`.
 */

import { describe, expect, it } from 'vitest';
import { assertDefined } from '@atlas/test-fixtures/assert';
import {
  DEFAULT_RISK_ACK_WINDOW_SECONDS,
  DEFAULT_RISK_POLICY,
  acknowledgeStepUp,
  defaultRiskScorer,
  evaluateRiskGate,
  fixedRiskScorer,
  type AuthSessionDocument,
} from '../src/index.ts';

function fakeSession(overrides: Partial<AuthSessionDocument> = {}): AuthSessionDocument {
  const base: AuthSessionDocument = {
    sessionId: 'ses-test',
    tenantId: 't',
    userId: 'usr-1',
    refreshTokenHash: 'h',
    refreshTokenLookup: 'l',
    accessTokenHash: 'h',
    accessTokenLookup: 'l',
    accessExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    issuedAt: new Date().toISOString(),
    lastRefreshedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    hardExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
    status: 'active',
  };
  return { ...base, ...overrides };
}

describe('evaluateRiskGate', () => {
  it('low score allows the request', () => {
    const out = evaluateRiskGate({
      scorer: fixedRiskScorer(0.1),
      policy: DEFAULT_RISK_POLICY,
      signals: {},
    });
    expect(out.decision).toBe('allow');
  });

  it('mid score returns step_up when not acknowledged', () => {
    const out = evaluateRiskGate({
      scorer: fixedRiskScorer(0.8),
      policy: DEFAULT_RISK_POLICY,
      signals: {},
    });
    expect(out.decision).toBe('step_up');
    expect(out.acknowledged).toBe(false);
  });

  it('mid score with fresh acknowledgement returns allow', () => {
    const session = fakeSession({
      riskAcknowledgedUntil: new Date(Date.now() + 60_000).toISOString(),
    });
    const out = evaluateRiskGate({
      scorer: fixedRiskScorer(0.8),
      policy: DEFAULT_RISK_POLICY,
      signals: {},
      session,
    });
    expect(out.decision).toBe('allow');
    expect(out.acknowledged).toBe(true);
  });

  it('mid score with stale acknowledgement still requires step_up', () => {
    const session = fakeSession({
      riskAcknowledgedUntil: new Date(Date.now() - 60_000).toISOString(),
    });
    const out = evaluateRiskGate({
      scorer: fixedRiskScorer(0.8),
      policy: DEFAULT_RISK_POLICY,
      signals: {},
      session,
    });
    expect(out.decision).toBe('step_up');
    expect(out.acknowledged).toBe(false);
  });

  it('hard_deny is NOT overridden by a fresh acknowledgement', () => {
    const session = fakeSession({
      riskAcknowledgedUntil: new Date(Date.now() + 60_000).toISOString(),
    });
    const out = evaluateRiskGate({
      scorer: fixedRiskScorer(1.0),
      policy: DEFAULT_RISK_POLICY,
      signals: {},
      session,
    });
    expect(out.decision).toBe('hard_deny');
  });

  it('respects custom tenant thresholds', () => {
    const policy = { stepUpMfaThreshold: 0.3, hardDenyThreshold: 0.6 };
    expect(
      evaluateRiskGate({
        scorer: fixedRiskScorer(0.2),
        policy,
        signals: {},
      }).decision,
    ).toBe('allow');
    expect(
      evaluateRiskGate({
        scorer: fixedRiskScorer(0.4),
        policy,
        signals: {},
      }).decision,
    ).toBe('step_up');
    expect(
      evaluateRiskGate({
        scorer: fixedRiskScorer(0.7),
        policy,
        signals: {},
      }).decision,
    ).toBe('hard_deny');
  });

  it('uses real defaultRiskScorer signals when provided', () => {
    const scorer = defaultRiskScorer({ expectedGeo: ['US'] });
    const out = evaluateRiskGate({
      scorer,
      policy: DEFAULT_RISK_POLICY,
      signals: {
        geo: 'CN',
        uaClass: 'cli',
        recentFailureRate: 1,
      },
    });
    // 0.4 (geo) + 0.2 (cli) + 0.4 (failure) = 1.0 → hard_deny
    expect(out.decision).toBe('hard_deny');
  });
});

describe('acknowledgeStepUp', () => {
  it('returns a session with riskAcknowledgedUntil set in the future', () => {
    const session = fakeSession();
    const updated = acknowledgeStepUp(session);
    expect(updated.riskAcknowledgedUntil).toBeDefined();
    const ack = new Date(
      assertDefined(updated.riskAcknowledgedUntil, 'just acked'),
    ).getTime();
    expect(ack).toBeGreaterThan(Date.now());
    // Default window 5 minutes — clamp to a generous range to avoid flake.
    expect(ack - Date.now()).toBeLessThanOrEqual(
      DEFAULT_RISK_ACK_WINDOW_SECONDS * 1000 + 1000,
    );
  });

  it('returns a NEW object — does not mutate the input', () => {
    const session = fakeSession();
    const before = JSON.stringify(session);
    acknowledgeStepUp(session);
    expect(JSON.stringify(session)).toBe(before);
  });

  it('honours a custom window', () => {
    const session = fakeSession();
    const updated = acknowledgeStepUp(session, 10);
    const ack = new Date(
      assertDefined(updated.riskAcknowledgedUntil, 'just acked'),
    ).getTime();
    expect(ack - Date.now()).toBeLessThanOrEqual(11_000);
    expect(ack - Date.now()).toBeGreaterThan(8_000);
  });

  it('honours an explicit clock for deterministic tests', () => {
    const session = fakeSession();
    const fixedNow = 1_700_000_000_000;
    const updated = acknowledgeStepUp(session, 60, fixedNow);
    expect(updated.riskAcknowledgedUntil).toBe(
      new Date(fixedNow + 60_000).toISOString(),
    );
  });
});

describe('step-up: pen-test scenarios', () => {
  it('cannot bypass step_up by setting an acknowledgement timestamp in the past', () => {
    const session = fakeSession({
      riskAcknowledgedUntil: '2020-01-01T00:00:00.000Z',
    });
    const out = evaluateRiskGate({
      scorer: fixedRiskScorer(0.8),
      policy: DEFAULT_RISK_POLICY,
      signals: {},
      session,
    });
    expect(out.decision).toBe('step_up');
  });

  it('cannot bypass hard_deny by acknowledging step-up', () => {
    const session = fakeSession({
      riskAcknowledgedUntil: new Date(Date.now() + 3600_000).toISOString(),
    });
    const out = evaluateRiskGate({
      scorer: fixedRiskScorer(0.99),
      policy: DEFAULT_RISK_POLICY,
      signals: {},
      session,
    });
    expect(out.decision).toBe('hard_deny');
  });

  it('cannot forge ack via empty session — no session means no ack regardless of score', () => {
    const out = evaluateRiskGate({
      scorer: fixedRiskScorer(0.8),
      policy: DEFAULT_RISK_POLICY,
      signals: {},
      session: null,
    });
    expect(out.decision).toBe('step_up');
    expect(out.acknowledged).toBe(false);
  });
});
