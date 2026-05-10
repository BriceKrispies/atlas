/**
 * Schema-id constants for the four seed payload contracts.
 *
 * The actual JSON Schemas live under
 * `specs/schemas/contracts/seed.<name>.v1.schema.json` and are
 * registered with AJV in `packages/schemas/src/loader.ts`. This file
 * is the single source of truth for the *ids* used at validation
 * sites — runner / adapters / atlasctl all import from here so a
 * rename ripples through compile errors, not silent string drift.
 *
 * Spec: `specs/crosscut/seed-corpus.md` §4 + §9 cross-references.
 */

export const SEED_SCENARIO_SCHEMA_ID = 'seed.scenario.v1' as const;
export const SEED_FIXTURE_SCHEMA_ID = 'seed.fixture.v1' as const;
export const SEED_TEMPLATE_SCHEMA_ID = 'seed.template.v1' as const;
export const SEED_AXIS_DEFINITION_SCHEMA_ID = 'seed.axis_definition.v1' as const;

export type SeedSchemaId =
  | typeof SEED_SCENARIO_SCHEMA_ID
  | typeof SEED_FIXTURE_SCHEMA_ID
  | typeof SEED_TEMPLATE_SCHEMA_ID
  | typeof SEED_AXIS_DEFINITION_SCHEMA_ID;
