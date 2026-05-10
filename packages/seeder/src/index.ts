/**
 * `@atlas/seeder` — operator/SDET-scoped scenario runner.
 *
 * Phase 1 surface: the runner, idempotency-key derivation, canonical
 * JSON stringify, schema-id constants, and the public types. The
 * memory adapter (`@atlas/adapter-seed-memory`) and CLI integration
 * land in subsequent phases per `specs/crosscut/seed-corpus.md` §8.
 */

export { runScenario } from './runner.ts';
export {
  deriveIdempotencyKey,
  deriveCorrelationId,
} from './idempotency.ts';
export { canonicalJsonStringify } from './canonical-json.ts';
export {
  SEED_SCENARIO_SCHEMA_ID,
  SEED_FIXTURE_SCHEMA_ID,
  SEED_TEMPLATE_SCHEMA_ID,
  SEED_AXIS_DEFINITION_SCHEMA_ID,
} from './schema.ts';
export type { SeedSchemaId } from './schema.ts';

export type {
  Scenario,
  Fixture,
  ScenarioStep,
  ScenarioRef,
  FixtureRef,
  ScenarioFilter,
  SeedCorpus,
  IntentDriver,
  IntentResult,
  RunnerDeps,
  RunOptions,
  StepResult,
  RunResult,
} from './types.ts';
