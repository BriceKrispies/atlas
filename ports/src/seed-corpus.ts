import type { IntentEnvelope } from '@atlas/platform-core';

/**
 * Seed corpus port — the library of scenarios and fixtures the system can
 * apply to a fresh instance to produce a known starting state. Backed by
 * memory / fs / sqlite adapters.
 *
 * Spec: `specs/crosscut/seed-corpus.md`.
 *
 * Tenant scoping note: this port is intentionally NOT tenant-scoped. The
 * corpus is operator/SDET-scoped — it is a library of *inputs* an operator
 * applies through the same chokepoint a real tenant would use (I1
 * dogfooding). The scenarios it yields contain intents that resolve to
 * tenants at runtime via `asTenant`. I7 (search isolation) and I9 (cache
 * keys) apply to the events those intents produce, not to the corpus
 * itself, so taking `tenantId` here would be meaningless.
 *
 * Cycle-breaking note: the domain types `Scenario` / `Fixture` /
 * `ScenarioStep` live HERE rather than in `@atlas/seeder` so both the port
 * and adapters can import them from `@atlas/ports` without creating a
 * runtime cycle (the seeder package re-exports them from
 * `@atlas/seeder/types`). This is the pragmatic resolution of the
 * `ports/CLAUDE.md` "no domain types" guidance for a case where the domain
 * shape *is* the port's payload shape.
 */
export interface SeedCorpus {
  /**
   * Stream refs for every scenario in the corpus matching `filter`. Always
   * AsyncIterable regardless of adapter — fuzz expansions of large
   * templates produce 10K+ refs and uniform streaming avoids buffering.
   * Mirrors `WorkerSubscription.events()`.
   */
  listScenarios(filter?: ScenarioFilter): AsyncIterable<ScenarioRef>;

  /**
   * Resolve a scenario by stable ref. The ref's `contentHash` lets the
   * caller verify integrity after `apply:` flattening; implementations
   * MAY reject on hash mismatch.
   */
  loadScenario(ref: ScenarioRef): Promise<Scenario>;

  /**
   * Resolve a fixture by stable ref. Used by the runner's apply-resolver
   * to flatten `apply:` chains bottom-up.
   */
  loadFixture(ref: FixtureRef): Promise<Fixture>;
}

export interface ScenarioFilter {
  prefix?: string;
  tags?: ReadonlyArray<string>;
  axes?: Readonly<Record<string, string>>;
}

export interface ScenarioRef {
  /** Stable id; for materialized refs: `<template>/<axis>=<v>/...`. */
  scenarioId: string;
  /** sha256Hex of canonicalJsonStringify(resolvedScenario). */
  contentHash: string;
  origin: 'fixed' | 'materialized';
  axisBindings?: Readonly<Record<string, string>>;
}

export interface FixtureRef {
  fixtureId: string;
  contentHash: string;
}

export interface Scenario {
  schemaVersion: 1;
  scenarioId: string;
  description?: string;
  tags?: ReadonlyArray<string>;
  apply?: ReadonlyArray<FixtureRef>;
  steps: ReadonlyArray<ScenarioStep>;
  axisBindings?: Readonly<Record<string, string>>;
}

export interface Fixture {
  schemaVersion: 1;
  fixtureId: string;
  /** Recursive composition; depth-limited to 8 by the runner. */
  apply?: ReadonlyArray<FixtureRef>;
  steps: ReadonlyArray<ScenarioStep>;
}

export interface ScenarioStep {
  stepId: string;
  intent: IntentEnvelope;
  /** Resolves to a tenantId at runtime. */
  asTenant?: string;
  /** Resolves to a principalId at runtime. */
  asPrincipal?: string;
  expect?: { ok?: boolean; errorCode?: string };
}
