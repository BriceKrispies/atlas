/**
 * Cross-adapter contract for `SeedCorpus` (memory / fs / sqlite).
 *
 * Spec: `specs/crosscut/seed-corpus.md` — §4.1 (port contract,
 * snapshot-at-iteration-start), §9 (worked-example scenario + fixture),
 * cross-references to `crosscut/errors.md` for the SEED_* error taxonomy.
 *
 * Pattern mirrors `event-store.ts` / `crypto.ts`: every adapter that
 * implements `SeedCorpus` runs this suite via a factory and must pass.
 *
 * # The factory shape
 *
 * The suite is adapter-agnostic: it makes NO assumptions about whether
 * the corpus is backed by a `Map`, a filesystem walk, a SQLite query, or
 * anything else. Adapters surface their mutation paths through the
 * factory result so snapshot-at-iteration-start can be exercised
 * uniformly:
 *
 *   const adapter   = result.corpus              — read-side surface
 *   addScenario(s)  — mutate after a listScenarios() call (snapshot tests)
 *   addFixture(f)   — same for fixtures
 *   removeScenario(scenarioId) — required for the "delete during
 *                                iteration" snapshot test
 *
 * For the `SEED_VALIDATOR_NOT_REGISTERED` branch the factory exposes
 * `simulateValidatorMissing(schemaId, fn)` which scopes the missing-
 * validator condition around `fn`. Adapters that use `@atlas/schemas`
 * implement it via `vi.spyOn`; adapters that bring their own validator
 * registry can swap it however they like. The contract suite only cares
 * that, while the callback runs, calls to load operations that need
 * that schema raise the registry-misconfig code.
 *
 * # Corpus seeding contract
 *
 * The factory is called *fresh* per test (no shared state across
 * `it(...)` cases). The factory is given a `seed` describing what
 * scenarios + fixtures to start with; every adapter must honour the
 * same seed shape so the same test bodies work everywhere.
 */

import { describe, test, expect } from 'vitest';
import type {
  Fixture,
  FixtureRef,
  Scenario,
  ScenarioRef,
  SeedCorpus,
} from '@atlas/ports';

/**
 * Adapter-side surface for the contract suite. Each `it(...)` calls the
 * factory once, gets back the live `corpus` plus mutation helpers, runs
 * its assertions, and is done.
 */
export interface SeedCorpusFactoryResult {
  corpus: SeedCorpus;
  /** Add a scenario AFTER construction. Used by snapshot-semantics tests. */
  addScenario(scenario: Scenario): void | Promise<void>;
  /** Add a fixture AFTER construction. */
  addFixture(fixture: Fixture): void | Promise<void>;
  /** Remove a scenario by id. Used by the delete-during-iteration test. */
  removeScenario(scenarioId: string): void | Promise<void>;
  /**
   * Run `fn` with the named AJV schema temporarily absent from this
   * adapter's validator registry. Used to exercise the
   * `SEED_VALIDATOR_NOT_REGISTERED` branch. Must restore the registry
   * even if `fn` throws.
   *
   * Adapters that cannot meaningfully simulate this (extremely rare —
   * every adapter validates somewhere) may omit it; the related tests
   * skip with a recorded reason.
   */
  simulateValidatorMissing?: (
    schemaId: 'seed.scenario.v1' | 'seed.fixture.v1',
    fn: () => Promise<void>,
  ) => Promise<void>;
}

export interface SeedCorpusFactoryArgs {
  scenarios: ReadonlyArray<Scenario>;
  fixtures: ReadonlyArray<Fixture>;
}

export type SeedCorpusFactory = (
  args: SeedCorpusFactoryArgs,
) => Promise<SeedCorpusFactoryResult> | SeedCorpusFactoryResult;

// ─── Worked-example fixture (specs/crosscut/seed-corpus.md §9) ──────
//
// The §9 example is materialised — `axisBindings: { region, tier }`
// flips origin to 'materialized' at the port surface. Two ScenarioSteps
// in the scenario + two ScenarioSteps in the applied fixture; the
// contract suite uses both so adapters get tested against realistic
// content.

const WORKED_FIXTURE: Fixture = {
  schemaVersion: 1,
  fixtureId: 'fixtures/tenants/single-basic',
  steps: [
    {
      stepId: 'register-admin-user',
      asTenant: 'team-onboard',
      asPrincipal: 'operator',
      intent: {
        eventId: 'evt-register-admin-user-0001',
        eventType: 'Identity.UserCreated',
        schemaId: 'identity.user.create.v1',
        schemaVersion: 1,
        occurredAt: '2026-05-10T11:59:58.000Z',
        tenantId: 't_team_onboard',
        correlationId: 'seed:fixtures/tenants/single-basic:0',
        idempotencyKey: 'seed-fixture-single-basic-0',
        payload: {
          actionId: 'Identity.User.Create',
          resourceType: 'user',
          email: 'admin@example.com',
          givenName: 'Team',
          familyName: 'Admin',
        },
      },
    },
    {
      stepId: 'grant-admin-membership',
      asTenant: 'team-onboard',
      asPrincipal: 'operator',
      intent: {
        eventId: 'evt-grant-admin-membership-0001',
        eventType: 'Identity.MembershipCreated',
        schemaId: 'identity.membership.create.v1',
        schemaVersion: 1,
        occurredAt: '2026-05-10T11:59:59.000Z',
        tenantId: 't_team_onboard',
        correlationId: 'seed:fixtures/tenants/single-basic:1',
        idempotencyKey: 'seed-fixture-single-basic-1',
        payload: {
          actionId: 'Identity.Membership.Create',
          resourceType: 'membership',
          userId: 'u_admin',
          roles: ['admin'],
        },
      },
    },
  ],
};

const WORKED_SCENARIO: Scenario = {
  schemaVersion: 1,
  scenarioId: 'team-onboard/region=us-east-1/tier=starter',
  description:
    'Onboards a small developer-team tenant via the worked example in seed-corpus.md §9.',
  tags: ['onboarding', 'identity', 'invite-flow'],
  axisBindings: {
    region: 'us-east-1',
    tier: 'starter',
  },
  steps: [
    {
      stepId: 'issue-editor-invite',
      asTenant: 'team-onboard',
      asPrincipal: 'admin',
      intent: {
        eventId: 'evt-issue-editor-invite-0001',
        eventType: 'Identity.InviteIssued',
        schemaId: 'identity.invite.issue.v1',
        schemaVersion: 1,
        occurredAt: '2026-05-10T12:00:00.000Z',
        tenantId: 't_team_onboard',
        correlationId: 'seed:team-onboard/region=us-east-1/tier=starter:0',
        idempotencyKey: 'seed-team-onboard-step-0',
        payload: {
          actionId: 'Identity.Invite.Issue',
          resourceType: 'invite',
          email: 'editor@example.com',
          rolesOnAccept: ['editor'],
        },
      },
    },
    {
      stepId: 'accept-editor-invite',
      asTenant: 'team-onboard',
      intent: {
        eventId: 'evt-accept-editor-invite-0001',
        eventType: 'Identity.InviteAccepted',
        schemaId: 'identity.invite.accept.v1',
        schemaVersion: 1,
        occurredAt: '2026-05-10T12:00:01.000Z',
        tenantId: 't_team_onboard',
        correlationId: 'seed:team-onboard/region=us-east-1/tier=starter:1',
        idempotencyKey: 'seed-team-onboard-step-1',
        payload: {
          actionId: 'Identity.Invite.Accept',
          resourceType: 'invite',
          presentedToken: 'inv-editor-0001-plaintext',
          acceptedEmail: 'editor@example.com',
        },
      },
      expect: { ok: true },
    },
  ],
};

// A simpler "fixed-origin" scenario (no axisBindings) so origin='fixed'
// vs 'materialized' can be asserted independently. Single step, tagged
// 'smoke' so prefix/tags filters have something to bite on.
const FIXED_SCENARIO: Scenario = {
  schemaVersion: 1,
  scenarioId: 'minimal-tenant-bootstrap',
  description: 'Seeds a single tenant with no fixtures.',
  tags: ['smoke'],
  steps: [
    {
      stepId: 'create-tenant',
      intent: {
        eventId: '00000000-0000-4000-8000-000000000001',
        eventType: 'tenant.create',
        schemaId: 'tenant.create.v1',
        schemaVersion: 1,
        occurredAt: '2026-05-10T00:00:00.000Z',
        tenantId: 't_seed',
        correlationId: 'seed:minimal-tenant-bootstrap:0',
        idempotencyKey: 'seed-minimal-0',
        payload: {
          actionId: 'tenant.create',
          resourceType: 'tenant',
          handle: 'seed-tenant',
        },
      },
      asPrincipal: 'operator',
    },
  ],
};

const ADMIN_FIXTURE: Fixture = {
  schemaVersion: 1,
  fixtureId: 'fixtures/admin-principal',
  steps: [
    {
      stepId: 'register-admin',
      intent: {
        eventId: '00000000-0000-4000-8000-000000000002',
        eventType: 'identity.principalCreate',
        schemaId: 'identity.principal.create.v1',
        schemaVersion: 1,
        occurredAt: '2026-05-10T00:00:00.000Z',
        tenantId: 't_seed',
        correlationId: 'seed:fixtures/admin-principal:0',
        idempotencyKey: 'seed-fixture-admin-0',
        payload: {
          actionId: 'identity.principal.create',
          resourceType: 'principal',
          handle: 'admin',
        },
      },
    },
  ],
};

// ─── Helpers ────────────────────────────────────────────────────────

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

function refFor(corpusResult: { corpus: SeedCorpus }, scenarioId: string) {
  return async (): Promise<ScenarioRef> => {
    for await (const ref of corpusResult.corpus.listScenarios()) {
      if (ref.scenarioId === scenarioId) return ref;
    }
    throw new Error(`test helper: scenario ${scenarioId} not in corpus`);
  };
}

// ─── Contract ───────────────────────────────────────────────────────

/**
 * Run the `SeedCorpus` contract against a factory. Every assertion here
 * is grounded in the port JSDoc (`ports/src/seed-corpus.ts`) or
 * `specs/crosscut/seed-corpus.md`. Do not enforce behavior that isn't
 * documented in one of those — adapters are free to vary beyond the
 * documented surface.
 */
export function seedCorpusContract(makeAdapter: SeedCorpusFactory): void {
  describe('SeedCorpus contract', () => {
    // ─── listScenarios — shape ────────────────────────────────────
    describe('listScenarios (shape)', () => {
      test('yields a ScenarioRef per stored scenario, contentHash is 64-char lowercase hex', async () => {
        const r = await makeAdapter({
          scenarios: [FIXED_SCENARIO],
          fixtures: [],
        });
        const refs = await collect(r.corpus.listScenarios());
        expect(refs).toHaveLength(1);
        const [ref] = refs;
        expect(ref!.scenarioId).toBe('minimal-tenant-bootstrap');
        expect(ref!.origin).toBe('fixed');
        expect(ref!.contentHash).toMatch(/^[0-9a-f]{64}$/);
      });

      test('is AsyncIterable (Symbol.asyncIterator), not Promise<Array>', async () => {
        // Pin the streaming shape declared by the port JSDoc — fuzz
        // expansions of large templates may produce 10K+ refs and
        // adapters MUST not pre-buffer into an array. We check the
        // iterator protocol explicitly rather than relying on
        // `for await` to paper over a Promise-shaped return.
        const r = await makeAdapter({
          scenarios: [FIXED_SCENARIO],
          fixtures: [],
        });
        const iterable = r.corpus.listScenarios();
        expect(typeof (iterable as AsyncIterable<ScenarioRef>)[Symbol.asyncIterator]).toBe(
          'function',
        );
        const it = iterable[Symbol.asyncIterator]();
        const first = await it.next();
        expect(first.done).toBe(false);
        expect((first.value as ScenarioRef).scenarioId).toBe('minimal-tenant-bootstrap');
        const second = await it.next();
        expect(second.done).toBe(true);
      });

      test('over an empty corpus completes without error', async () => {
        const r = await makeAdapter({ scenarios: [], fixtures: [] });
        const refs = await collect(r.corpus.listScenarios());
        expect(refs).toHaveLength(0);
      });

      test('sets origin=materialized when axisBindings present, fixed otherwise', async () => {
        const r = await makeAdapter({
          scenarios: [FIXED_SCENARIO, WORKED_SCENARIO],
          fixtures: [],
        });
        const refs = await collect(r.corpus.listScenarios());
        const byId = new Map(refs.map((ref) => [ref.scenarioId, ref]));
        expect(byId.get('minimal-tenant-bootstrap')!.origin).toBe('fixed');
        expect(byId.get(WORKED_SCENARIO.scenarioId)!.origin).toBe('materialized');
      });
    });

    // ─── listScenarios — filters ──────────────────────────────────
    describe('listScenarios (filters)', () => {
      test('prefix filter narrows correctly; non-matching prefix returns empty', async () => {
        const r = await makeAdapter({
          scenarios: [FIXED_SCENARIO, WORKED_SCENARIO],
          fixtures: [],
        });
        const matched = await collect(
          r.corpus.listScenarios({ prefix: 'minimal-' }),
        );
        expect(matched.map((x) => x.scenarioId)).toEqual([
          'minimal-tenant-bootstrap',
        ]);
        const empty = await collect(
          r.corpus.listScenarios({ prefix: 'no-match-' }),
        );
        expect(empty).toHaveLength(0);
      });

      test('tags filter ANDs across tags (all listed tags must match)', async () => {
        const r = await makeAdapter({
          scenarios: [FIXED_SCENARIO, WORKED_SCENARIO],
          fixtures: [],
        });
        const matched = await collect(
          r.corpus.listScenarios({ tags: ['smoke'] }),
        );
        expect(matched.map((x) => x.scenarioId)).toEqual([
          'minimal-tenant-bootstrap',
        ]);
        // 'smoke' exists on FIXED_SCENARIO; 'absent' does not exist
        // anywhere — AND requires both, so result is empty.
        const empty = await collect(
          r.corpus.listScenarios({ tags: ['smoke', 'absent'] }),
        );
        expect(empty).toHaveLength(0);

        // Two real tags present on WORKED_SCENARIO must both match.
        const both = await collect(
          r.corpus.listScenarios({ tags: ['onboarding', 'identity'] }),
        );
        expect(both.map((x) => x.scenarioId)).toEqual([WORKED_SCENARIO.scenarioId]);
      });

      test('axes filter narrows to materialised scenarios whose bindings match', async () => {
        const otherMaterialised: Scenario = {
          ...WORKED_SCENARIO,
          scenarioId: 'team-onboard/region=eu-west-1/tier=starter',
          axisBindings: { region: 'eu-west-1', tier: 'starter' },
        };
        const r = await makeAdapter({
          scenarios: [FIXED_SCENARIO, WORKED_SCENARIO, otherMaterialised],
          fixtures: [],
        });
        const ueast = await collect(
          r.corpus.listScenarios({ axes: { region: 'us-east-1' } }),
        );
        expect(ueast.map((x) => x.scenarioId)).toEqual([WORKED_SCENARIO.scenarioId]);

        const both = await collect(
          r.corpus.listScenarios({
            axes: { region: 'us-east-1', tier: 'starter' },
          }),
        );
        expect(both).toHaveLength(1);
        expect(both[0]!.scenarioId).toBe(WORKED_SCENARIO.scenarioId);

        const noMatch = await collect(
          r.corpus.listScenarios({ axes: { region: 'ap-south-1' } }),
        );
        expect(noMatch).toHaveLength(0);
      });
    });

    // ─── listScenarios — snapshot-at-iteration-start ─────────────
    //
    // Spec: `specs/crosscut/seed-corpus.md` §4.1 + port JSDoc. Pinned
    // here so the fs + sqlite adapters honour the same semantic when
    // they land (Phases 2 and 4). Without these tests an adapter
    // could legally surface concurrent edits mid-iteration and claim
    // spec compliance.
    describe('listScenarios (snapshot-at-iteration-start)', () => {
      test('post-start ADDs are NOT observed by the in-flight iterator', async () => {
        const r = await makeAdapter({
          scenarios: [FIXED_SCENARIO],
          fixtures: [],
        });
        const it = r.corpus.listScenarios()[Symbol.asyncIterator]();
        const first = await it.next();
        expect(first.done).toBe(false);
        // Mutate AFTER the iterator started.
        await r.addScenario({ ...FIXED_SCENARIO, scenarioId: 'late-add' });
        const next = await it.next();
        expect(next.done).toBe(true); // 'late-add' not seen
      });

      test('post-start DELETES of not-yet-yielded entries are NOT observed', async () => {
        const scenarios: Scenario[] = [];
        for (let i = 0; i < 3; i += 1) {
          scenarios.push({ ...FIXED_SCENARIO, scenarioId: `s-${i}` });
        }
        const r = await makeAdapter({ scenarios, fixtures: [] });
        const it = r.corpus.listScenarios()[Symbol.asyncIterator]();
        const first = await it.next();
        expect(first.done).toBe(false);
        // Remove an entry the iterator hasn't reached yet.
        await r.removeScenario('s-2');
        const second = await it.next();
        const third = await it.next();
        const fourth = await it.next();
        // All three originally-snapshotted scenarios must still yield.
        const seen = [
          first.value!.scenarioId,
          second.value!.scenarioId,
          third.value!.scenarioId,
        ].sort();
        expect(seen).toEqual(['s-0', 's-1', 's-2']);
        expect(fourth.done).toBe(true);
      });

      test('a NEW listScenarios() call AFTER a mutation DOES observe it (per-call snapshot)', async () => {
        const r = await makeAdapter({
          scenarios: [FIXED_SCENARIO],
          fixtures: [],
        });
        const before = (await collect(r.corpus.listScenarios())).map(
          (x) => x.scenarioId,
        );
        expect(before).toEqual([FIXED_SCENARIO.scenarioId]);

        await r.addScenario({ ...FIXED_SCENARIO, scenarioId: 'late-add' });

        const after = (await collect(r.corpus.listScenarios()))
          .map((x) => x.scenarioId)
          .sort();
        expect(after).toEqual([FIXED_SCENARIO.scenarioId, 'late-add'].sort());
      });

      test('early-break does not leak state — re-iterating yields the full list', async () => {
        const scenarios: Scenario[] = [];
        for (let i = 0; i < 3; i += 1) {
          scenarios.push({ ...FIXED_SCENARIO, scenarioId: `s-${i}` });
        }
        const r = await makeAdapter({ scenarios, fixtures: [] });
        // First iteration with early break.
        let count = 0;
        for await (const _ of r.corpus.listScenarios()) {
          count += 1;
          if (count === 1) break;
        }
        expect(count).toBe(1);
        // Second iteration should see all 3 again.
        const second = await collect(r.corpus.listScenarios());
        expect(second).toHaveLength(3);
      });
    });

    // ─── loadScenario / loadFixture ──────────────────────────────
    describe('loadScenario / loadFixture', () => {
      test('loadScenario returns a body that validates against seed.scenario.v1 (round-trip)', async () => {
        const r = await makeAdapter({
          scenarios: [WORKED_SCENARIO],
          fixtures: [],
        });
        const ref = await refFor(r, WORKED_SCENARIO.scenarioId)();
        const loaded = await r.corpus.loadScenario(ref);
        expect(loaded).toEqual(WORKED_SCENARIO);
        expect(loaded.schemaVersion).toBe(1);
        expect(loaded.steps).toHaveLength(2);
      });

      test('loadFixture returns a body that validates against seed.fixture.v1 (round-trip)', async () => {
        const r = await makeAdapter({
          scenarios: [],
          fixtures: [ADMIN_FIXTURE],
        });
        const loaded = await r.corpus.loadFixture({
          fixtureId: ADMIN_FIXTURE.fixtureId,
          // contentHash is opaque to the contract — the spec says the
          // hash "lets the caller verify integrity" but the port JSDoc
          // marks rejection on mismatch as MAY. Adapters that don't
          // verify must still accept a hash-shaped string.
          contentHash: '0'.repeat(64),
        });
        expect(loaded.fixtureId).toBe(ADMIN_FIXTURE.fixtureId);
        expect(loaded.schemaVersion).toBe(1);
      });

      test('loadScenario throws SEED_SCENARIO_NOT_FOUND for an unknown scenarioId', async () => {
        const r = await makeAdapter({ scenarios: [], fixtures: [] });
        await expect(
          r.corpus.loadScenario({
            scenarioId: 'does-not-exist',
            contentHash: '0'.repeat(64),
            origin: 'fixed',
          }),
        ).rejects.toThrow(/SEED_SCENARIO_NOT_FOUND/);
      });

      test('loadFixture throws SEED_FIXTURE_NOT_FOUND for unknown fixtureId; does NOT collapse into SEED_SCENARIO_NOT_FOUND', async () => {
        const r = await makeAdapter({ scenarios: [], fixtures: [] });
        await expect(
          r.corpus.loadFixture({
            fixtureId: 'ghost',
            contentHash: '0'.repeat(64),
          }),
        ).rejects.toThrow(/SEED_FIXTURE_NOT_FOUND/);
        await expect(
          r.corpus.loadFixture({
            fixtureId: 'ghost',
            contentHash: '0'.repeat(64),
          }),
        ).rejects.not.toThrow(/SEED_SCENARIO_NOT_FOUND/);
      });

      test('loadScenario throws SEED_VALIDATION_FAILED when the stored body violates the schema (bad schemaVersion)', async () => {
        // schemaVersion of 2 violates the const:1 constraint in
        // seed.scenario.v1. Validation MUST catch this on load.
        const bad = {
          ...FIXED_SCENARIO,
          schemaVersion: 2,
        } as unknown as Scenario;
        const r = await makeAdapter({ scenarios: [bad], fixtures: [] });
        await expect(
          r.corpus.loadScenario({
            scenarioId: bad.scenarioId,
            contentHash: '0'.repeat(64),
            origin: 'fixed',
          }),
        ).rejects.toThrow(/SEED_VALIDATION_FAILED/);
        // Pin the distinction in both directions so a future swap of
        // the two error branches would fail this assertion AND the
        // missing-validator one — not just one of them.
        await expect(
          r.corpus.loadScenario({
            scenarioId: bad.scenarioId,
            contentHash: '0'.repeat(64),
            origin: 'fixed',
          }),
        ).rejects.not.toThrow(/SEED_VALIDATOR_NOT_REGISTERED/);
      });

      test('loadScenario throws SEED_VALIDATION_FAILED on an unknown top-level field (additionalProperties:false)', async () => {
        const bad = {
          ...FIXED_SCENARIO,
          extraneous: 'nope',
        } as unknown as Scenario;
        const r = await makeAdapter({ scenarios: [bad], fixtures: [] });
        await expect(
          r.corpus.loadScenario({
            scenarioId: bad.scenarioId,
            contentHash: '0'.repeat(64),
            origin: 'fixed',
          }),
        ).rejects.toThrow(/SEED_VALIDATION_FAILED/);
      });
    });

    // ─── SEED_VALIDATOR_NOT_REGISTERED ───────────────────────────
    //
    // Distinct from SEED_VALIDATION_FAILED — this is a platform /
    // config fault (the AJV schema was never registered) and MUST
    // surface a dedicated code per `specs/crosscut/errors.md`. The
    // factory's `simulateValidatorMissing` hook scopes the missing
    // condition to the callback so each adapter restores its
    // registry cleanly. Adapters that don't expose the hook skip
    // these tests; the reason is recorded so it's visible in the run.
    describe('SEED_VALIDATOR_NOT_REGISTERED', () => {
      test('loadScenario surfaces SEED_VALIDATOR_NOT_REGISTERED when seed.scenario.v1 is missing; does NOT collapse into the body-invalid code; mentions the schemaId', async () => {
        const r = await makeAdapter({
          scenarios: [FIXED_SCENARIO],
          fixtures: [],
        });
        if (!r.simulateValidatorMissing) {
          // eslint-disable-next-line no-console
          console.warn(
            'adapter omitted simulateValidatorMissing — SEED_VALIDATOR_NOT_REGISTERED (scenario) skipped',
          );
          return;
        }
        await r.simulateValidatorMissing('seed.scenario.v1', async () => {
          const ref = await refFor(r, FIXED_SCENARIO.scenarioId)();
          await expect(r.corpus.loadScenario(ref)).rejects.toThrow(
            /SEED_VALIDATOR_NOT_REGISTERED/,
          );
          await expect(r.corpus.loadScenario(ref)).rejects.not.toThrow(
            /SEED_VALIDATION_FAILED/,
          );
          // Naming the schemaId in the message is load-bearing for
          // observability — without it, ops can't tell whether the
          // scenario or fixture branch tripped.
          await expect(r.corpus.loadScenario(ref)).rejects.toThrow(
            /seed\.scenario\.v1/,
          );
        });
      });

      test('loadFixture surfaces SEED_VALIDATOR_NOT_REGISTERED when seed.fixture.v1 is missing; does NOT collapse into the body-invalid code; mentions the schemaId', async () => {
        const r = await makeAdapter({
          scenarios: [],
          fixtures: [ADMIN_FIXTURE],
        });
        if (!r.simulateValidatorMissing) {
          // eslint-disable-next-line no-console
          console.warn(
            'adapter omitted simulateValidatorMissing — SEED_VALIDATOR_NOT_REGISTERED (fixture) skipped',
          );
          return;
        }
        await r.simulateValidatorMissing('seed.fixture.v1', async () => {
          const ref: FixtureRef = {
            fixtureId: ADMIN_FIXTURE.fixtureId,
            contentHash: '0'.repeat(64),
          };
          await expect(r.corpus.loadFixture(ref)).rejects.toThrow(
            /SEED_VALIDATOR_NOT_REGISTERED/,
          );
          await expect(r.corpus.loadFixture(ref)).rejects.not.toThrow(
            /SEED_VALIDATION_FAILED/,
          );
          await expect(r.corpus.loadFixture(ref)).rejects.toThrow(
            /seed\.fixture\.v1/,
          );
        });
      });
    });

    // ─── contentHash determinism ─────────────────────────────────
    describe('contentHash determinism', () => {
      test('same scenario body → same contentHash across two adapter instances', async () => {
        // The port doc and spec §4.1 fix contentHash as
        // sha256Hex(canonicalJsonStringify(body)). Two independent
        // adapter constructions over the same scenario MUST surface
        // the same hash, otherwise replays diverge between processes.
        const a = await makeAdapter({
          scenarios: [FIXED_SCENARIO],
          fixtures: [],
        });
        const b = await makeAdapter({
          scenarios: [FIXED_SCENARIO],
          fixtures: [],
        });
        const refA = (await collect(a.corpus.listScenarios()))[0]!;
        const refB = (await collect(b.corpus.listScenarios()))[0]!;
        expect(refA.contentHash).toBe(refB.contentHash);
        expect(refA.contentHash).toMatch(/^[0-9a-f]{64}$/);
      });

      test('PINNED vector: canonical FIXED_SCENARIO hashes to the byte-exact 64-char hex below', async () => {
        // sha256Hex(canonicalJsonStringify(FIXED_SCENARIO)) — pinned
        // by literal value so byte-drift in canonicalJsonStringify or
        // sha256Hex lights up loudly. A regex pin (only 64 hex chars)
        // would silently pass even if the helper changed casing,
        // padding semantics, or key ordering.
        //
        // To recompute (when FIXED_SCENARIO changes intentionally):
        //   require('crypto').createHash('sha256')
        //     .update(canonicalJsonStringify(FIXED_SCENARIO))
        //     .digest('hex')
        const r = await makeAdapter({
          scenarios: [FIXED_SCENARIO],
          fixtures: [],
        });
        const refs = await collect(r.corpus.listScenarios());
        expect(refs[0]!.contentHash).toBe(
          '52140527f2273d4163c2df17c76509106432e74a418e8ae1a179918638940972',
        );
      });

      test('contentHash is stable under shuffled top-level key insertion order (canonical key sort)', async () => {
        // The reordered scenario differs only in JS-property
        // insertion order; canonicalJsonStringify sorts keys
        // lexically so the hash MUST be identical to the
        // straight-insertion version.
        const reordered: Scenario = {
          tags: FIXED_SCENARIO.tags,
          steps: FIXED_SCENARIO.steps,
          schemaVersion: FIXED_SCENARIO.schemaVersion,
          description: FIXED_SCENARIO.description,
          scenarioId: FIXED_SCENARIO.scenarioId,
        } as Scenario;
        const a = await makeAdapter({
          scenarios: [FIXED_SCENARIO],
          fixtures: [],
        });
        const b = await makeAdapter({
          scenarios: [reordered],
          fixtures: [],
        });
        const refA = (await collect(a.corpus.listScenarios()))[0]!;
        const refB = (await collect(b.corpus.listScenarios()))[0]!;
        expect(refA.contentHash).toBe(refB.contentHash);
      });
    });
  });
}
