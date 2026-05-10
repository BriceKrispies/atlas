# Seed Corpus

**Status:** Designed (Phase 1 implementation in flight). Phased rollout per §8.
**Owners:** `sdet` (primary), `architect` (port-shape gate), `spec-keeper` (this spec).
**Source:** [`decisions/0008-atlas-on-atlas.md`](../decisions/0008-atlas-on-atlas.md). The Atlas-on-Atlas tenet requires that *legitimate* tenants — with realistic schemas, principals, and data — can be stood up reproducibly through the same chokepoint a real tenant would use. Ad-hoc fixture builders under `tests/parity/lib/` cannot scale to that.

## 1. Purpose

A `SeedCorpus` is a port-backed library of **scenarios** and **fixtures** the system can apply to a fresh instance to produce a known starting state. The corpus is the foundation on which axis-aware fuzzing ([`scenario-fuzzing.md`](scenario-fuzzing.md)) is layered.

A scenario is a stable-id'd, ordered list of `ScenarioStep`s — each step is an `Intent` plus optional acceptance expectations. A fixture is a reusable building block: the same shape as a scenario, but referenced by other scenarios via `apply: [fixtureRef]` to assemble realistic starting states without copy-paste.

The runner submits intents via `IntentDriver` from `packages/test-fabric/`, so scenarios inherit the Http/Sim transport split for free and dogfood the single-ingress invariant (I1). The seeder owns no side door — every scenario step traverses the same `authn → authz → quota → idempotency → dispatch` chain a human or agent would.

## 2. Non-Goals

- **Performance load generation.** Mode C of the test fabric ([`test-fabric.md`](test-fabric.md) §6) owns rate-ramp and SLO testing. The seeder produces deterministic starting states, not workloads.
- **Adversarial probing.** Mode A of the test fabric owns isolation/adversarial assertions. A future sibling spec (sandbox-corpus) may host adversarial-payload fixtures the fabric consumes — open question §11 in `test-fabric.md` resolves there.
- **Fault / chaos injection.** Out of scope. Mode D of the test fabric injects faults; the seeder runs against a healthy or already-faulted system.
- **Schema authoring.** Scenarios apply intents the platform already accepts. Tenant-defined schema mutations land via `domains/custom-schema/` capabilities and are applied by scenarios that submit those intents — they are not a new authoring surface.
- **Seed file authoring tools.** YAML files are hand-authored or generated. No GUI / scaffolder ships with the seeder.
- **Backwards compatibility for unstable scenarios.** A scenarioId is a contract. Changing a scenario's steps without changing its id is forbidden; bump the id (or, for fuzz templates, bump the template version).

## 3. Architectural Position

```
                    ┌────────────────────────────────────────────────┐
                    │  Seed Corpus (this spec)                       │
                    │   • SeedCorpus port (memory | fs | sqlite)     │
                    │   • Scenario / Fixture / ScenarioStep types    │
                    │   • runScenario(deps, ref) → RunResult         │
                    │   • Schemas: seed.scenario.v1, seed.fixture.v1,│
                    │     seed.template.v1, seed.axis_definition.v1  │
                    └─────────────┬──────────────────────────────────┘
                                  │ uses
                                  ▼
                        ┌─────────────────┐
                        │ IntentDriver    │  from @atlas/test-fabric
                        │ (Http | Sim)    │  — transport-agnostic
                        └────────┬────────┘
                                 ▼
                        ┌─────────────────┐
                        │ apps/server     │  single ingress (I1)
                        └─────────────────┘
```

The seeder is a **sibling** of the test fabric, not a child. The fabric owns invariant assertions under traffic; the seeder owns reproducible *starting states*. They compose: Phase 5 of this spec wires `SeededTenant({ scenarioRef })` into the fabric's `TenantFactory` (and closes the §11 open question in `test-fabric.md`).

The seeder is also a **direct consumer** of the same primitives a real tenant uses. There is no "seeder-private" intent kind, no test-only authn shortcut. `X-Debug-Principal` (gated by `TEST_AUTH_ENABLED`) is the only environmental affordance, and it is the same affordance integration / parity / BDD already use.

The corpus is a workspace package (`packages/seeder/`) imported by:
- Capability test files that want a known starting state
- `atlasctl seed list|apply` (Phase 2) and `atlasctl seed fuzz` (Phase 4)
- `packages/test-fabric/` Phase 5 — the `SeededTenant` persona

## 4. Primitives

The contract every implementation provides. Names, shapes, and method signatures are normative.

### 4.1 `SeedCorpus` port

```ts
// ports/src/seed-corpus.ts
import type { Scenario, Fixture } from '@atlas/seeder/types';

export interface SeedCorpus {
  listScenarios(filter?: ScenarioFilter): AsyncIterable<ScenarioRef>;
  loadScenario(ref: ScenarioRef): Promise<Scenario>;
  loadFixture(ref: FixtureRef): Promise<Fixture>;
}

export interface ScenarioFilter {
  prefix?: string;
  tags?: ReadonlyArray<string>;
  axes?: Readonly<Record<string, string>>;
}

export interface ScenarioRef {
  scenarioId: string;       // stable; for materialized: <template>/<axis>=<v>/...
  contentHash: string;      // sha256 of canonicalJson(resolved Scenario)
  origin: 'fixed' | 'materialized';
  axisBindings?: Readonly<Record<string, string>>;
}

export interface FixtureRef {
  fixtureId: string;
  contentHash: string;
}
```

`listScenarios` is **always** an `AsyncIterable<ScenarioRef>` regardless of adapter — fuzz expansions of large templates produce 10K+ refs and uniform streaming avoids buffering. The streaming pattern mirrors `WorkerSubscription.events()` in `ports/src/worker-source.ts`.

`contentHash` is `sha256Hex(canonicalJsonStringify(resolvedScenario))` after `apply:` flattening but before idempotency-key derivation (so identical resolved content always hashes identically). Determinism rules live in [`scenario-fuzzing.md`](scenario-fuzzing.md) §5.

### 4.2 Types

```ts
// packages/seeder/src/types.ts
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
  apply?: ReadonlyArray<FixtureRef>;   // recursive composition
  steps: ReadonlyArray<ScenarioStep>;
}

export interface ScenarioStep {
  stepId: string;
  intent: IntentEnvelope;              // shape from @atlas/platform-core
  asTenant?: string;                   // resolves to a tenantId at runtime
  asPrincipal?: string;                // resolves to a principalId at runtime
  expect?: { ok?: boolean; errorCode?: string };
}
```

Fixture composition is a **directed acyclic graph**. Cycles are runtime-detected (depth limit 8, see §6); the schema does not enforce DAG-ness because validating that requires the whole corpus. Adapters are responsible for cycle detection during resolution.

See §9 ("Worked example") for a materialized scenario that exercises `apply:`, multi-step ordering, and `axisBindings` end-to-end.

### 4.3 Runner contract

```ts
// packages/seeder/src/runner.ts
export interface RunnerDeps {
  corpus: SeedCorpus;
  driver: IntentDriver;       // from @atlas/test-fabric (interface only; no runtime cycle)
  prng?: Prng;                // injected in Phase 3 for generator-axis evaluation
}

export interface RunResult {
  scenarioId: string;
  contentHash: string;
  steps: ReadonlyArray<{
    stepId: string;
    idempotencyKey: string;
    ok: boolean;
    errorCode?: string;
    resultRef?: string;
  }>;
}

export function runScenario(deps: RunnerDeps, ref: ScenarioRef): Promise<RunResult>;
```

**Idempotency key derivation.** For step at index `i`:

```
idempotencyKey = sha256Hex(scenarioId + '::' + i).slice(0, 32)
```

**CorrelationId derivation.** Per step:

```
correlationId = `seed:${scenarioId}:${i}`
```

These are stable across reruns — re-running an already-applied scenario is a no-op at the dispatch layer (idempotency keys deduplicate; reruns return prior results). This is a property the runner *exposes*, not one it enforces — enforcement is the platform's idempotency contract (I3).

## 5. Adapter Sketches

| Adapter | Phase | Backing | Notes |
|---|---|---|---|
| `@atlas/adapter-seed-memory` | 1 | `Map<string, Scenario>` + `Map<string, Fixture>` | Default for unit/contract tests. `addScenario`, `addFixture`, `addTemplate` (Phase 3) for setup. |
| `@atlas/adapter-seed-fs` | 2 | `<root>/scenarios/*.yaml`, `<root>/fixtures/<group>/*.yaml`, `<root>/templates/*.yaml` (Phase 3) | Walks directories with `fs.readdir` async generators. YAML parsed with `js-yaml` already in `apps/atlasctl`. AJV-validates after parse. |
| `@atlas/adapter-seed-sqlite` | 4 | `better-sqlite3` tables: `templates`, `axes`, `axis_values`, `materializations`, `fixtures` | Cross-product enumeration via recursive CTE; `iterate()` exposed as AsyncIterable. Lazy materialization — corpus of 1M scenarios fits without memory blow-up. |

All three adapters share the same contract suite at `packages/contract-tests/src/seed-corpus.ts`. A new adapter satisfies the spec when the contract suite passes against it. The pattern mirrors `event-store.ts` contract reuse (`adapters/node/test/event-store.test.ts`).

## 6. Runner Algorithm

```
runScenario(deps, ref):
  scenario = await deps.corpus.loadScenario(ref)
  validateScenario(scenario)            # AJV against seed.scenario.v1
  resolved = resolveApply(deps, scenario, depth=0, max=8)
  results = []
  for [i, step] of resolved.steps.entries():
    key = deriveIdempotencyKey(ref.scenarioId, i)
    corr = deriveCorrelationId(ref.scenarioId, i)
    envelope = buildEnvelope(step.intent, { idempotencyKey: key, correlationId: corr })
    r = await deps.driver.submit(envelope)
    matched = step.expect ? matchesExpect(r, step.expect) : r.ok
    results.push({ stepId: step.stepId, idempotencyKey: key, ok: matched, errorCode: r.errorCode, resultRef: r.resultRef })
    if (!matched && !opts.continueOnError) break
  return { scenarioId: ref.scenarioId, contentHash: ref.contentHash, steps: results }
```

`IntentDriver` is the dependency point — the runner does not import `submitIntent` or `@atlas/ingress` directly. The runner consumes `IntentDriver` as a TypeScript interface only (no runtime cycle); concrete drivers (`HttpIntentDriver`, `SimIntentDriver`) are produced by `packages/test-fabric/`.

Retries are opt-in (`--retry N`, default 0). Idempotency keys make retries safe. Default fail-fast surfaces real bugs.

`apply:` resolution flattens fixtures bottom-up, deduplicates by `fixtureId` (each fixture's steps appear at most once per scenario), and detects cycles by tracking the in-flight ref stack. Depth limit is 8 — exceeding it raises `SEED_FIXTURE_DEPTH_EXCEEDED`.

## 7. CLI Surface

| Command | Phase | Behavior |
|---|---|---|
| `atlasctl seed list [--prefix P] [--tag T]` | 2 | Streams `ScenarioRef`s from the configured corpus. Default corpus root `./seeds/`. |
| `atlasctl seed apply <scenarioId> [--debug-principal P] [--retry N] [--corpus DIR]` | 2 | Loads, validates, runs the scenario through HTTP. Returns structured run report. |
| `atlasctl seed fuzz <templateId> [--limit N] [--concurrency C] [--retry N]` | 4 | Streams materialized scenarios from the corpus, runs each through HTTP. See [`scenario-fuzzing.md`](scenario-fuzzing.md) §6. |

Per [`crosscut/atlasctl.md`](atlasctl.md) the CLI is HTTP-only and does NOT import `@atlas/seeder` at runtime. Shared logic (envelope-build, idempotency-key derivation) is exposed from `@atlas/platform-core`, which atlasctl is permitted to depend on.

CLI output follows `crosscut/atlasctl.md` conventions for structured output, `correlationId` display, and error reporting.

## 8. Phased Implementation

| Phase | Deliverable | Gating? |
|---|---|---|
| **Phase 1** | `SeedCorpus` port + types + memory adapter + runner skeleton + four JSON schemas + AJV registration + contract test. **No FS, no axes, no CLI.** | Mergeable as one slice. Spec-keeper + architect approve port shape. |
| **Phase 2** | `@atlas/adapter-seed-fs` + `js-yaml` loader + `apply:` resolver + `atlasctl seed list|apply` + 3–5 worked-example scenarios under `seeds/` + BDD scenario for the apply flow. | Gates any capability that needs realistic seed data in BDD. |
| **Phase 3** | Axis expander + scenario-id grammar + PRNG (`packages/platform-core/src/prng.ts`) + reproducibility round-trip test + `seeds/templates/blog-stress.yaml` worked example. Memory adapter learns `addTemplate`; FS adapter walks `templates/`. | See [`scenario-fuzzing.md`](scenario-fuzzing.md) §7. |
| **Phase 4** | `@atlas/adapter-seed-sqlite` + recursive-CTE cross-product + `atlasctl seed fuzz` CLI + 1000-scenario fuzz run benchmark. | Real fuzz capacity. |
| **Phase 5** | `SeededTenant({ scenarioRef })` persona in `packages/test-fabric/`; `provisionN` runs the scenario per tenant. Closes `test-fabric.md` §11 open question. | Closes the loop with the test fabric. |

Phase gates: Phase 1 acceptance is contract-test-green against memory adapter + AJV-validated example scenarios. Phase 3 acceptance is a 1000-iteration round-trip test (id → bindings → re-materialize → byte-identical contentHash) across two processes.

## 9. Worked example

A realistic Phase 2 scenario a tenant author would write: seed a small developer-team tenant with an admin already in place and one editor invited and accepted. The starting state (tenant + admin) is reusable, so it lives in a fixture (`fixtures/tenants/single-basic`) that other scenarios — invite flows, role-management flows, billing-onboarding flows — all share via `apply:`.

The scenario is **materialized** from a `region` × `tier` template, which is why `axisBindings` is set and `scenarioId` follows the axis-id grammar from [`scenario-fuzzing.md`](scenario-fuzzing.md) §5.

When `runScenario` is invoked, it:

1. Resolves `apply:` and prepends the fixture's two steps (`create-tenant`, `register-admin`) to the scenario's own two steps (`issue-editor-invite`, `accept-editor-invite`).
2. Derives per-step `idempotencyKey` and `correlationId` from `scenarioId + index` (§4.3) — the values embedded below are illustrative; the runner *overwrites* them at submit time so reruns dedupe.
3. Submits each resulting `IntentEnvelope` through `IntentDriver`, going `authn → authz → quota → idempotency → dispatch` like any real intent (I1).

`contentHash` values on the `apply:` ref below are placeholder lowercase-hex SHA256s; in a live corpus they are the canonical hash of the resolved fixture (§4.1).

### 9.1 Scenario

```json
{
  "schemaVersion": 1,
  "scenarioId": "team-onboard/region=us-east-1/tier=starter",
  "description": "Onboards a small developer-team tenant: provisions the tenant and admin via the fixtures/tenants/single-basic fixture, then issues and accepts an invite for a second user with the editor role.",
  "tags": ["onboarding", "identity", "invite-flow"],
  "axisBindings": {
    "region": "us-east-1",
    "tier": "starter"
  },
  "apply": [
    {
      "fixtureId": "fixtures/tenants/single-basic",
      "contentHash": "0000000000000000000000000000000000000000000000000000000000000000"
    }
  ],
  "steps": [
    {
      "stepId": "issue-editor-invite",
      "asTenant": "team-onboard",
      "asPrincipal": "admin",
      "intent": {
        "eventId": "evt-issue-editor-invite-0001",
        "eventType": "Identity.InviteIssued",
        "schemaId": "domain.identity.invite.issued.v1",
        "schemaVersion": 1,
        "occurredAt": "2026-05-10T12:00:00.000Z",
        "tenantId": "t_team_onboard",
        "principalId": "p_admin",
        "correlationId": "seed:team-onboard/region=us-east-1/tier=starter:0",
        "idempotencyKey": "seed-team-onboard-step-0",
        "payload": {
          "actionId": "identity.invite.issue",
          "resourceType": "invite",
          "email": "editor@example.com",
          "roles": ["editor"]
        }
      }
    },
    {
      "stepId": "accept-editor-invite",
      "asTenant": "team-onboard",
      "intent": {
        "eventId": "evt-accept-editor-invite-0001",
        "eventType": "Identity.InviteAccepted",
        "schemaId": "domain.identity.invite.accepted.v1",
        "schemaVersion": 1,
        "occurredAt": "2026-05-10T12:00:01.000Z",
        "tenantId": "t_team_onboard",
        "correlationId": "seed:team-onboard/region=us-east-1/tier=starter:1",
        "idempotencyKey": "seed-team-onboard-step-1",
        "payload": {
          "actionId": "identity.invite.accept",
          "resourceType": "invite",
          "tokenId": "inv_editor_0001",
          "handle": "editor"
        }
      },
      "expect": { "ok": true }
    }
  ]
}
```

### 9.2 Fixture (`fixtures/tenants/single-basic`)

```json
{
  "schemaVersion": 1,
  "fixtureId": "fixtures/tenants/single-basic",
  "description": "A single tenant with one admin principal. Reused as the starting state for invite-flow, role-management, and billing-onboarding scenarios.",
  "steps": [
    {
      "stepId": "create-tenant",
      "asPrincipal": "operator",
      "intent": {
        "eventId": "evt-create-tenant-0001",
        "eventType": "Tenancy.TenantCreated",
        "schemaId": "domain.tenancy.tenant.created.v1",
        "schemaVersion": 1,
        "occurredAt": "2026-05-10T11:59:58.000Z",
        "tenantId": "t_team_onboard",
        "correlationId": "seed:fixtures/tenants/single-basic:0",
        "idempotencyKey": "seed-fixture-single-basic-0",
        "payload": {
          "actionId": "tenancy.tenant.create",
          "resourceType": "tenant",
          "handle": "team-onboard"
        }
      }
    },
    {
      "stepId": "register-admin",
      "asTenant": "team-onboard",
      "asPrincipal": "operator",
      "intent": {
        "eventId": "evt-register-admin-0001",
        "eventType": "Identity.UserCreated",
        "schemaId": "domain.identity.user.created.v1",
        "schemaVersion": 1,
        "occurredAt": "2026-05-10T11:59:59.000Z",
        "tenantId": "t_team_onboard",
        "correlationId": "seed:fixtures/tenants/single-basic:1",
        "idempotencyKey": "seed-fixture-single-basic-1",
        "payload": {
          "actionId": "identity.user.create",
          "resourceType": "user",
          "handle": "admin",
          "email": "admin@example.com",
          "roles": ["admin"]
        }
      }
    }
  ]
}
```

### 9.3 What this example pins

- **Multi-step ordering.** Four steps in resolved order — `create-tenant`, `register-admin` (from the fixture), then `issue-editor-invite`, `accept-editor-invite` (from the scenario). The runner submits them sequentially; later steps may causally depend on earlier ones (the invite-accept step relies on the invite issued two steps prior).
- **`apply:` composition.** The fixture is referenced by id + `contentHash`; the runner verifies the hash matches the resolved fixture before flattening (§6). Reusing `fixtures/tenants/single-basic` across scenarios is how the corpus avoids copy-paste.
- **`axisBindings` materialised-scenario semantics.** The presence of `axisBindings` flips `origin` to `materialized` at the port surface (§4.1). The `scenarioId` encodes the bindings in lexical axis order per [`scenario-fuzzing.md`](scenario-fuzzing.md) §5 — round-trip parseable, reproducible across processes.
- **`asTenant` / `asPrincipal` resolution.** Logical handles (`team-onboard`, `admin`, `operator`) the runner resolves to concrete `tenantId` / `principalId` at submit time. The fixture's `create-tenant` step has no `asTenant` because the tenant doesn't exist yet — `asPrincipal: operator` (a platform-scoped principal) executes the create.
- **`expect` is opt-in.** Only `accept-editor-invite` declares an expectation. Other steps default to `r.ok` per §6.

## 10. Cross-References

- [`specs/crosscut/scenario-fuzzing.md`](scenario-fuzzing.md) — axis system layered on top of this spec; locks the scenario-id grammar
- [`specs/crosscut/test-fabric.md`](test-fabric.md) — sibling crosscut; Phase 5 wires `SeededTenant` into `TenantFactory`. The §11 open question about an adversarial-payload corpus may resolve into a future sibling spec, not this one.
- [`specs/decisions/0008-atlas-on-atlas.md`](../decisions/0008-atlas-on-atlas.md) — I1 dogfooding requirement: the seeder is a client of `@atlas/ingress`, same chokepoint as a real tenant
- [`specs/architecture.md`](../architecture.md) — Invariants I1 (single ingress), I3 (idempotency before dispatch), I5 (correlationId propagation), I12 (projections rebuildable from events)
- [`specs/normative_requirements.md`](../normative_requirements.md) — REQ-INGRESS-002, REQ-ISO-001
- [`specs/crosscut/atlasctl.md`](atlasctl.md) — CLI conventions and HTTP-only constraint (INV-CTL-01)
- [`specs/crosscut/errors.md`](errors.md) — error taxonomy: `SEED_FIXTURE_DEPTH_EXCEEDED`, `SEED_VALIDATION_FAILED`, `SEED_SCENARIO_NOT_FOUND`
- [`specs/schemas/contracts/seed.scenario.v1.schema.json`](../schemas/contracts/seed.scenario.v1.schema.json) — Scenario payload contract
- [`specs/schemas/contracts/seed.fixture.v1.schema.json`](../schemas/contracts/seed.fixture.v1.schema.json) — Fixture payload contract
- [`specs/schemas/contracts/seed.template.v1.schema.json`](../schemas/contracts/seed.template.v1.schema.json) — Template (fuzz) payload contract
- [`specs/schemas/contracts/seed.axis_definition.v1.schema.json`](../schemas/contracts/seed.axis_definition.v1.schema.json) — Axis definition contract
- [`ports/src/worker-source.ts`](../../ports/src/worker-source.ts) — streaming-port shape this port mirrors
- [`packages/test-fabric/`](../../packages/test-fabric/) — `IntentDriver` source; the runner's only transport
- [`packages/contract-tests/src/event-store.ts`](../../packages/contract-tests/src/event-store.ts) — contract-suite-reuse pattern this spec mirrors
- [`packages/schemas/src/loader.ts`](../../packages/schemas/src/loader.ts) — AJV registry; the four seed schemas register here in Phase 1
