import type {
  Crypto,
  Fixture,
  FixtureRef,
  Scenario,
  ScenarioFilter,
  ScenarioRef,
  SeedCorpus,
} from '@atlas/ports';
import { canonicalJsonStringify, sha256Hex } from '@atlas/platform-core';
import { getSchemaValidator } from '@atlas/schemas';

/**
 * In-memory `SeedCorpus` (Phase 1 of the seeder slice).
 *
 * Backing: two `Map`s — one keyed by `scenarioId`, one by `fixtureId`. No
 * filesystem, no network. Suitable as the default substrate for unit and
 * contract tests; the FS and SQLite adapters land in Phases 2 and 4 of the
 * seeder spec (`specs/crosscut/seed-corpus.md` §5).
 *
 * Tenant scoping note: the corpus is operator/SDET-scoped per the port
 * doc. The scenarios it yields contain intents that resolve to a tenant at
 * runtime via `asTenant`; I7/I9 apply to the events those intents produce,
 * not to the corpus itself.
 *
 * Validation note: AJV runs lazily on `loadScenario` / `loadFixture`. The
 * constructor accepts whatever `Map`s it is handed — callers (tests, fuzz
 * setup) build the corpus by mutating the maps before any reads. This
 * matches the Phase 1 spec which calls out "addScenario / addFixture" as
 * setup conveniences; we expose those mutations through the maps directly
 * to avoid premature API surface.
 */
export class InMemorySeedCorpus implements SeedCorpus {
  constructor(
    private readonly scenarios: Map<string, Scenario>,
    private readonly fixtures: Map<string, Fixture>,
    private readonly crypto: Crypto,
  ) {}

  listScenarios(filter?: ScenarioFilter): AsyncIterable<ScenarioRef> {
    // Snapshot at iteration-start so concurrent mutations don't surprise
    // the consumer. AsyncIterable shape mirrors `WorkerSubscription.events()`
    // (ports/src/worker-source.ts) per the seed-corpus spec §4.1.
    const snapshot = Array.from(this.scenarios.values());
    const cryptoRef = this.crypto;
    return {
      async *[Symbol.asyncIterator](): AsyncIterator<ScenarioRef> {
        for (const scenario of snapshot) {
          if (!matchesFilter(scenario, filter)) continue;
          yield computeScenarioRef(scenario, cryptoRef);
        }
      },
    };
  }

  async loadScenario(ref: ScenarioRef): Promise<Scenario> {
    const scenario = this.scenarios.get(ref.scenarioId);
    if (!scenario) {
      throw new Error(
        `SEED_SCENARIO_NOT_FOUND: ${ref.scenarioId}`,
      );
    }
    validateOrThrow('seed.scenario.v1', scenario, ref.scenarioId);
    return scenario;
  }

  async loadFixture(ref: FixtureRef): Promise<Fixture> {
    const fixture = this.fixtures.get(ref.fixtureId);
    if (!fixture) {
      throw new Error(`SEED_FIXTURE_NOT_FOUND: ${ref.fixtureId}`);
    }
    validateOrThrow('seed.fixture.v1', fixture, ref.fixtureId);
    return fixture;
  }
}

/**
 * Compute a `ScenarioRef` for a stored `Scenario`. `contentHash` is
 * `sha256Hex(canonicalJsonStringify(scenario))`. Phase 1 hashes the
 * stored body; Phase 2+ runner is responsible for `apply:` flattening
 * before re-hashing.
 */
export function computeScenarioRef(
  scenario: Scenario,
  crypto: Crypto,
): ScenarioRef {
  const body = canonicalJsonStringify(scenario);
  const hash = sha256Hex(body, crypto);
  const ref: ScenarioRef = {
    scenarioId: scenario.scenarioId,
    contentHash: hash,
    origin: scenario.axisBindings ? 'materialized' : 'fixed',
  };
  if (scenario.axisBindings) {
    return { ...ref, axisBindings: scenario.axisBindings };
  }
  return ref;
}

/**
 * Compute a `FixtureRef` for a stored `Fixture`. Same hashing rule as
 * `computeScenarioRef` — useful when wiring `apply:` chains in tests.
 */
export function computeFixtureRef(
  fixture: Fixture,
  crypto: Crypto,
): FixtureRef {
  const body = canonicalJsonStringify(fixture);
  return {
    fixtureId: fixture.fixtureId,
    contentHash: sha256Hex(body, crypto),
  };
}

function matchesFilter(
  scenario: Scenario,
  filter: ScenarioFilter | undefined,
): boolean {
  if (!filter) return true;
  if (filter.prefix && !scenario.scenarioId.startsWith(filter.prefix)) {
    return false;
  }
  if (filter.tags && filter.tags.length > 0) {
    const have = new Set(scenario.tags ?? []);
    for (const t of filter.tags) {
      if (!have.has(t)) return false;
    }
  }
  if (filter.axes) {
    const bound = scenario.axisBindings ?? {};
    for (const [axis, want] of Object.entries(filter.axes)) {
      if (bound[axis] !== want) return false;
    }
  }
  return true;
}

function validateOrThrow(
  schemaId: string,
  body: unknown,
  refId: string,
): void {
  const validate = getSchemaValidator(schemaId, 1);
  if (!validate) {
    // Schema not registered in the AJV registry — a host/platform
    // misconfiguration distinct from a caller-supplied body failing
    // validation. Surface a dedicated code so observability and error
    // handling can branch on tenant-data vs platform-config faults.
    throw new Error(
      `SEED_VALIDATOR_NOT_REGISTERED: schema ${schemaId} not registered (loading ${refId})`,
    );
  }
  if (!validate(body)) {
    const errors = validate.errors ?? [];
    throw new Error(
      `SEED_VALIDATION_FAILED: ${refId} failed ${schemaId}: ${JSON.stringify(errors)}`,
    );
  }
}

