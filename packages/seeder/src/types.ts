/**
 * Public types for `@atlas/seeder`. The domain shapes (`Scenario`,
 * `Fixture`, `ScenarioStep`, `ScenarioRef`, `FixtureRef`,
 * `ScenarioFilter`) live in `@atlas/ports` to avoid a `ports → seeder`
 * runtime cycle (see the comment block atop
 * `ports/src/seed-corpus.ts`); they are re-exported here so consumers
 * can import them from `@atlas/seeder/types` per the spec layout.
 *
 * Spec: `specs/crosscut/seed-corpus.md` §4.
 */

export type {
  Scenario,
  Fixture,
  ScenarioStep,
  ScenarioRef,
  FixtureRef,
  ScenarioFilter,
  SeedCorpus,
} from '@atlas/ports';

import type { IntentEnvelope } from '@atlas/platform-core';
import type { Crypto, SeedCorpus } from '@atlas/ports';

/**
 * Result of submitting a single intent through the runner's transport.
 * Mirrors the `IntentDriver.submit` contract from
 * `specs/crosscut/test-fabric.md` §4 — kept narrow so Phase 1 doesn't
 * couple to fabric internals.
 */
export interface IntentResult {
  ok: boolean;
  errorCode?: string;
  resultRef?: string;
}

/**
 * Transport used by the runner. Locked to consume an `IntentDriver`
 * (Phase 1 declares the interface locally; Phase 5 wires the concrete
 * `HttpIntentDriver` / `SimIntentDriver` from `@atlas/test-fabric`).
 *
 * The runner does NOT import `submitIntent` or `@atlas/ingress`
 * directly — the driver is the single dispatch point so the seeder
 * inherits the test-fabric's transport split for free.
 */
export interface IntentDriver {
  submit(envelope: IntentEnvelope): Promise<IntentResult>;
}

/**
 * Dependencies handed to `runScenario`. Pure injection — no
 * filesystem, no network, no adapter imports inside the runner.
 *
 * `crypto` is the `Crypto` port from `@atlas/ports`. Per ADR 0008
 * (atlas-on-atlas) leak #1 the runner MUST NOT import `node:crypto`
 * directly; sha256 for idempotency-key derivation comes through
 * the port.
 */
export interface RunnerDeps {
  corpus: SeedCorpus;
  driver: IntentDriver;
  crypto: Crypto;
}

export interface RunOptions {
  /**
   * Number of times to retry a failing step. Default 0 (fail-fast).
   * Phase 1 ships the field on the type for forward compatibility but
   * the runner itself does not retry — fail-fast surfaces real bugs.
   */
  retry?: number;
}

export interface StepResult {
  stepId: string;
  idempotencyKey: string;
  ok: boolean;
  errorCode?: string;
  resultRef?: string;
}

export interface RunResult {
  scenarioId: string;
  contentHash: string;
  steps: ReadonlyArray<StepResult>;
}
