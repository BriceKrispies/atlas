# Atlas Platform

Multi-tenant **platform fabric**. A tenant signs up, defines their own data model, optionally provisions backend services, writes functions/workflows against their data, and gets identity / authz / audit / observability / search applied uniformly to every operation — for free, by virtue of being a tenant. Atlas is **software anyone can self-host**; the project author runs a public reference instance with open public signup as one example deployment. **TypeScript** (Node + browser). Hexagonal architecture: ports define the surface, adapters implement them, modules hold domain logic, packages are shared infrastructure, apps wire it all together. **Agentic from day one** — single ingress, structured logs, machine-readable surfaces are load-bearing tenets, not retrofits.

See [`specs/vision.md`](specs/vision.md) for the user-facing vision, [`specs/decisions/0002-developer-platform-domain-map.md`](specs/decisions/0002-developer-platform-domain-map.md) for the original CMS → developer-platform re-anchor (2026-05-08), [`specs/decisions/0003-tenant-defined-data-model-pivot.md`](specs/decisions/0003-tenant-defined-data-model-pivot.md) for the multi-tenant-fabric ambition (Salesforce-shaped data model + Vercel-shaped service provisioning + agentic-first + self-hostable software with public reference instance), and [`specs/decisions/0008-atlas-on-atlas.md`](specs/decisions/0008-atlas-on-atlas.md) for the recursive-kernel principle (Atlas itself is a tenant of itself; code change is the exception).

A previous Rust prototype under `/crates`, `/tools/cli`, `/apps/control-plane`, and `/tests/blackbox` has been removed. Some specs still reference Rust paths as historical context — treat those as legacy notes, not active code locations.

Strategy is to **wrap existing tools as adapters** (k3s, kaniko, Caddy, Hetzner Cloud, Gitea, MinIO, etc.) — Atlas's value-add is the developer UX + the multi-tenant glue + unified audit + a single CLI (`atlasctl`).

## Agent-Operability Law

Atlas is agentic-first. If a task becomes difficult because the system is hard to navigate, generate against, debug, observe, test, refactor, or explain, treat that friction as possible architecture feedback — not as something to silently brute-force through.

Before applying a workaround, stop and produce an **Agent-Operability Finding** when the friction suggests a structural issue.

A finding must name:

1. The task being attempted.
2. The friction type: navigation, contract, generation, debugging, observation, refactor, verification, or ownership.
3. The concrete evidence: files, missing specs, unclear boundaries, brittle tests, missing logs, hidden coupling, inconsistent patterns, or ambiguous ownership.
4. The tempting local workaround.
5. The structural fix that would make future agent work easier.
6. The smallest safe next step: spec update, test harness, logging improvement, boundary extraction, module split, manifest addition, or ticket.

Do not use this as an excuse to avoid normal implementation work. Use it when the difficulty comes from Atlas being insufficiently explicit, observable, bounded, or machine-readable.

If the friction touches an invariant, platform boundary, public API, repeated pattern, or agentic-first tenet, escalate through the slice workflow instead of patching locally.

## Test Pyramid Reconciliation

Atlas's discipline is **test-first by spec, BDD-verified by behavior**. The two test layers must agree: if every unit test passes and the BDD scenario for the same capability fails, something is structurally wrong with the unit-test coverage, the test configuration, or the architecture itself. This is **the most important workflow principle in Atlas** alongside the Agent-Operability Law — when it fires, treat it as load-bearing feedback.

### The canonical TDD loop

Every behavior change runs this cycle, no exceptions:

1. **Red** — write the failing unit test at the canonical path (per [`specs/crosscut/testing.md`](specs/crosscut/testing.md) §3). Run it. Confirm it fails for the *intended* reason — not a missing import, not a typo, but a real assertion mismatch on the behavior the spec describes.
2. **Green** — write the minimum code that makes the test pass. Touch no other test (except enabling `it.todo` → `it`, or fixing a typo). If you find yourself wanting to edit an existing passing test to keep it green, the spec is changing — stop and return to Phase 0.
3. **Witness** — run the BDD scenario for the capability (`pnpm bdd` or `pnpm bdd:server`). It MUST exercise the production code-path the unit tests just covered.
4. **Reconcile** — if the BDD passes, the slice is structurally honest. If the BDD fails, **the unit tests do not wrap the behavior**. Do NOT patch the BDD's symptom. Return to step 1 with the next-deeper failing unit test until the unit layer fully witnesses what the BDD asserts.

### The Reconciliation Rule

**When BDD fails while every unit test passes, treat it as architectural feedback — not as a BDD bug.** Concretely, one of the following is true:

- The unit tests exercise the wrong layer (mocking the very thing that fails).
- The production code-path under BDD has a configuration / data shape / connection mode the unit tests do not reproduce.
- The bug lives in code that has no testable seam — a private callback, an inline lambda, a closure-captured helper only reachable through HTTP.
- The test infrastructure observes a different surface than production (queries the wrong DB, reads a different store, uses different envelope serialization).

For each of these, the response is the same: **find the unit-test level where the failing behavior CAN be asserted, write that test (Red), make it pass (Green), then re-run BDD.** Keep going until BDD is green via the unit-layer fix, not via a BDD-test hack.

If no such unit-test level exists because the code shape forbids it, **invoke [`architect`](.claude/agents/architect.md) for a testability gap review**. The architecture is not conducive to unit testing for this behavior, and that is a structural problem to fix, not a test problem to work around.

### Testability as a structural property

The Atlas architecture is **conducive to unit testing by construction**:

- **No inline anonymous callbacks for non-trivial behavior.** Route handlers, dispatcher wirings, and adapter integrations that do real work must be **named, exported functions** that take their dependencies as arguments. If you write `async function (x) { …10 lines… }` inline in a route, extract it before merging — anonymous closures are not unit-testable.
- **Tests match production configuration.** A test that uses `prepare: false` while production uses `prepare: true`, or a test that uses an in-memory port stub when the bug lives in the SQL binding, **does not count as wrapping the BDD behavior**. The Reconciliation Rule will reveal this — the architectural fix is to make the production configuration the default test configuration.
- **Test data layout matches production data layout.** Atlas's per-tenant database model ([ADR 0005](specs/decisions/0005-custom-schema-storage-strategy.md)) means tenant-event queries MUST go through per-tenant SQL pools, not control-plane connections. Test helpers that query the wrong store are an architectural smell — fix by extracting a tenant-aware helper rather than inlining the wrong assumption.
- **Every port has a contract suite at `packages/contract-tests/src/<port>.ts`** that runs against both the Postgres adapter and the IDB adapter. New ports without a contract suite fail the architect gate.
- **Every Hono route body is unit-testable.** Routes parse + validate + delegate; the delegation target is a named function a unit test can call directly with a `Partial<AppState>`. If the delegation target only exists as an inline closure, it is not unit-testable — and therefore must be extracted before the route can land.

### When to invoke architect for testability review

The [`architect`](.claude/agents/architect.md) agent has explicit responsibility for **testability gap review**. Invoke when:

1. A BDD scenario fails after every unit test for the same capability passes.
2. A bug surfaces in production behavior that no existing unit test could have caught at the right layer.
3. You catch yourself thinking "I can't write a unit test for this because it's wired in a route / it's only reachable via HTTP / it's a private callback" — that's the smell.
4. SDET's Phase 1.0 scaffold-coverage review reports a behavior the spec asserts but no canonical unit-test location exists for.

The architect's review identifies the **structural pattern** that prevents unit testing at the boundary that matters, and produces a refactor recommendation. **The user is the only override on a "this can't be made unit-testable" claim.**

**Anti-pattern:** declaring a test "integration only" to dodge unit-test coverage. If a BDD is the only place that can witness a behavior, the architecture has a testability gap. File the gap as a finding; do not paper over with BDD-only assertions.

## Agent Routing — Where to Go

Pick the closest match and read its CLAUDE.md before working in that area.

| Your task involves... | Read this |
|-----------------------|-----------|
| Kernel, runtime instructions, tenant declarations, FunctionRuntime, capability manifests, hot reload, Atlas-on-Atlas, or code-as-data | [`specs/crosscut/atlas-runtime.md`](specs/crosscut/atlas-runtime.md) + [`runtime-instruction-set.md`](specs/crosscut/runtime-instruction-set.md) + [`kernel-vs-data.md`](specs/crosscut/kernel-vs-data.md) |
| Implementing or wiring port interfaces (DBs, caches, search, policy) | [`adapters/CLAUDE.md`](adapters/CLAUDE.md) |
| Defining or changing a port (the abstraction itself) | [`ports/CLAUDE.md`](ports/CLAUDE.md) |
| Domain logic — handlers, projections, queries, events | [`modules/CLAUDE.md`](modules/CLAUDE.md) |
| Anything UI: components, surfaces, signals, design tokens | [`packages/CLAUDE.md`](packages/CLAUDE.md) |
| The base `AtlasElement` primitive, signals, html template | [`packages/core/CLAUDE.md`](packages/core/CLAUDE.md) |
| Adding or changing a custom web component | [`packages/design/CLAUDE.md`](packages/design/CLAUDE.md) |
| Server / frontends — routes, shells, dev wiring | [`apps/CLAUDE.md`](apps/CLAUDE.md) |
| HTTP server (Hono) — routes, middleware, bootstrap | [`apps/server/CLAUDE.md`](apps/server/CLAUDE.md) |
| BDD / Playwright e2e | [`tests/bdd/README.md`](tests/bdd/README.md) |
| Specifications — source of truth for behavior | [`specs/CLAUDE.md`](specs/CLAUDE.md) |
| Containers / compose / dev infrastructure | [`infra/CLAUDE.md`](infra/CLAUDE.md) |

## Agent Roster

Project agents live in [`.claude/agents/`](.claude/agents/) and are invoked via the Agent tool's `subagent_type`. Use the closest match; agents reference the relevant CLAUDE.md / spec rather than duplicating it.

**Governance / cross-cut**

| Agent | When to delegate |
|-------|------------------|
| [`architect`](.claude/agents/architect.md) | Design reviews; any change touching I1–I12, P1–P6, hexagonal layering, ingress, authz precedence, cache invalidation, or tenant scoping |
| [`overseer`](.claude/agents/overseer.md) | Periodic chokepoint sweep. Runs `pnpm overseer:check` over the fixed I1–I18 file:line surface (ingress, dispatcher mirror, cache-tag contract, AtlasElement-only, surface state) and reasons about ordering / threading invariants the script can't cover. Read-only; files drift tickets. Default cadence: weekly. |
| [`spec-keeper`](.claude/agents/spec-keeper.md) | Scoping new capabilities, adding normative rules, lexicon changes, migrating legacy spec content into `specs/domains/<x>/` |
| [`vision-keeper`](.claude/agents/vision-keeper.md) | CTO-altitude monthly drift audit. Read-only; finds capability scopes that don't trace to vision tenets, code rebuilding what should be wrapped, agentic-first violations, missing ADRs for directional changes. Findings cite `specs/vision.md` / ADRs. Default cadence: monthly, last 30 days. |
| [`anti-sycophant`](.claude/agents/anti-sycophant.md) | Read-only meta-reviewer. Manual invocation only. Calls out **agent sycophancy** (other reviewers softening), **user self-contradiction** (plans vs stated principles, ADR walk-backs without an ADR), **scope-vs-velocity dishonesty** (vision says X, git velocity says Y), and **vision-vs-architecture drift** (code becoming something different from what was promised). Advisory; user holds the pen. Maintains calibration ledger at `.claude/anti-sycophant/ledger.md`. |

**Platform owners (one per platform — spec/design authority, not implementer)**

| Agent | Owns |
|-------|------|
| [`spine-owner`](.claude/agents/spine-owner.md) | identity, authorization, tenancy, organization, audit, observability, search |
| [`compute-owner`](.claude/agents/compute-owner.md) | cluster, runtime, image-build, ingress, dns |
| [`storage-owner`](.claude/agents/storage-owner.md) | object-storage, block-storage, secrets |
| [`code-owner`](.claude/agents/code-owner.md) | repository, pipeline, artifact-registry |
| [`workflow-owner`](.claude/agents/workflow-owner.md) | triggers, scheduling, jobs, function-runner, approvals |
| [`commerce-owner`](.claude/agents/commerce-owner.md) | billing, quotas, metering, plans |
| [`extensibility-owner`](.claude/agents/extensibility-owner.md) | custom-schema, functions (DDL allowlist, `FunctionRuntime` contract, DSL substrate per ADRs 0005–0007) |
| [`first-party-apps-owner`](.claude/agents/first-party-apps-owner.md) | parked CMS (`apps/cms/`) and any future first-party tenant-installable apps |

**Implementation devs**

| Agent | When to delegate |
|-------|------------------|
| [`module-dev`](.claude/agents/module-dev.md) | New handlers/projections/queries/dispatchers in `/modules` + matching `apps/server` route wiring |
| [`port-adapter-dev`](.claude/agents/port-adapter-dev.md) | Adding/changing a port; implementing in `adapter-node`, `adapter-idb`, `adapter-policy-cedar`, `adapter-policy-stub`; migrations + parity |
| [`frontend-dev`](.claude/agents/frontend-dev.md) | Any UI work — components, surfaces, signals, design tokens, Vite app shells |

**Quality**

| Agent | When to delegate |
|-------|------------------|
| [`sdet`](.claude/agents/sdet.md) | Adversarial test review — finds untested branches, cache-tag gaps, projection rebuild gaps, surface-state assertion holes; pushes back on hard-to-test designs |
| [`observability-architect`](.claude/agents/observability-architect.md) | Adversarial logging / instrumentation audit. Reads recent commits (default last 7 days), enforces [`specs/crosscut/logging.md`](specs/crosscut/logging.md), produces findings keyed to contract clauses. Read-only; doesn't fix. Invoke periodically or on-demand. |

**Typical flow for a new capability:** `spec-keeper` (scope) → relevant platform owner (design) → `module-dev` + `frontend-dev` + `port-adapter-dev` (implement) → `sdet` (adversarial review) → `architect` (invariant gate before merge). Every dispatch references a ticket id — see [Work Ticketing](#work-ticketing) below.

## Work Ticketing

Tickets are the unit-of-work layer between specs (durable *what*) and chat (ephemeral *how-it's-going*). Every agent dispatch references a ticket id; tickets carry the capability/ADR ref, acceptance bar, and resume prompt the agent needs to pick up cold.

See [`tickets/CLAUDE.md`](tickets/CLAUDE.md) for the full contract. Quick rules:

- **One ticket = one slice.** A single capability spec's worth of work, or a single refactor / drift fix / chore.
- **Tickets organized by *set* in [`tickets/`](tickets/).** A set is a stream of related work — one capability, one multi-stage refactor, one drift-audit run, or the catch-all `chore/`. Files live at `tickets/<set>/<slug>.md`. No global id counter — references between tickets use paths (e.g., `blocked_by: [chore/commit-untracked-deliverables]`).
- **A ticket cannot move to `in-flight` without `capability:` or `adr:` set.** A ticket cannot move to `done` without all `acceptance:` checks green. Same anti-slop principles as the slice workflow — just mechanically attached.
- **Drift findings → tickets.** When `vision-keeper`, `observability-architect`, or `sdet` find drift they aren't fixing in-turn, they file a `type: drift-finding` ticket so the backlog is visible.
- **The board:** [`tickets/INDEX.md`](tickets/INDEX.md) — open / scoped / in-flight / blocked / done at a glance.

If you start a session and don't know what to work on: read `tickets/INDEX.md`. If you're about to dispatch an agent and there's no ticket: scope one first.

## Slice Workflow

The protocol for using the agents above. **Slice = one capability** — exactly one `specs/domains/<domain>/capabilities/<name>/README.md`. Multiple capabilities = multiple slices.

```
Phase 0 — Scope
  spec-keeper + relevant platform-owner
  copy specs/_capability-template.md → specs/domains/<domain>/capabilities/<name>/README.md
  Gate: spec lists invariants touched, surfaces, lexicon hits, file-by-file plan
  ▸ User checkpoint: spec approved before any code

Phase 1.0 — Failing test scaffolds (parallel where applicable)
  module-dev        → handler / projection / query / dispatch test scaffolds
                      at canonical paths per specs/crosscut/testing.md §3
  port-adapter-dev  → port contract suite additions + adapter parity scaffolds
  frontend-dev      → surface state-machine + BDD scaffolds
                      (assert via getSurfaceSnapshot(), never DOM)
  Gate: pnpm typecheck green; pnpm test runs and the named tests FAIL with the
        expected not-implemented assertions; every test carries an @spec
        annotation; every normative spec clause has at least one failing test
        targeting it.

Phase 1.0 — SDET scaffold-coverage review (single pass)
  sdet → verifies scaffolds cover every spec assertion, every invariant the
         spec claims to touch (property tests for universally-quantified ones
         per testing.md §2.2), every surface state, every branch the spec
         names; files any missing scaffold as feedback, NOT implementation.
  Gate: SDET signs off "all tests fail, and the set of failing tests fully
        describes the spec." A slice cannot enter Phase 1.1 without this.

Phase 1.1 — Implementation
  module-dev / port-adapter-dev / frontend-dev → write code until pnpm test
         green; touch no test (except enabling it.todo → it, or fixing a typo).
         A test edit beyond that signals the spec changed — back to Phase 0.
  Gate: pnpm typecheck + pnpm test green; coverage thresholds met
        (testing.md §5.2); cache tags asserted; I12 dispatch test exists.

Phase 1.2 — Reconcile (Test Pyramid Reconciliation, see above)
  Whoever owns the slice → run `pnpm bdd` / `pnpm bdd:server` for the
         capability. If green, proceed to Phase 2. If RED while every Phase 1.1
         unit test was GREEN, do NOT patch the BDD's symptom. Apply the
         Reconciliation Rule: find the unit-test level where the failing
         behavior CAN be asserted, return to Phase 1.0 with a new failing
         unit test for that behavior. Iterate Red → Green → BDD-witness until
         BDD is green via the unit-layer fix.
  Architect invocation: if no unit-test level exists for the failing behavior
         because the code shape forbids it, invoke `architect` for a
         testability gap review BEFORE attempting another Red/Green cycle.
         The architect's recommendation defines the refactor that opens the
         testable seam.
  Gate: BDD green for every scenario the capability spec lists, and the
        Phase 1.1 unit-test suite is the proximate witness for every assertion
        the BDD made (no BDD-only behaviors).

Phase 2 — Invariant gate (single pass)
  architect → reviews against I1–I18, hexagonal layering, AtlasElement bar,
              worker parity, port-contract-suite parity; reports violations
              with invariant ID + file:line
  No override: invariant violation = back to Phase 1.1 or escalate to user

Phase 3 — Optional security review
  /security-review skill (when change touches authn/authz/tenant scope/secrets/PII)

Phase 4 — User checkpoint → merge
  Human breaks ties, decides edge cases, holds the merge button
```

### Anti-slop principles

1. **Spec-first hard gate.** No code without a capability README at the canonical path.
2. **Test-first hard gate.** No implementation in Phase 1.1 without failing scaffolds at canonical paths in Phase 1.0, signed off by SDET. See [`specs/crosscut/testing.md`](specs/crosscut/testing.md).
2a. **Test Pyramid Reconciliation hard gate.** If Phase 1.2's BDD run fails while Phase 1.1's unit tests are all green, the slice is NOT done — return to Phase 1.0 with a deeper failing unit test for the gap, never patch the BDD's symptom. The Reconciliation Rule (load-bearing principle above) names what to look for; the architect is invokable for testability-gap review when no unit-test level exists for the failing behavior.
3. **Slice = one capability.** The spec defines scope; the LOC follows. Multiple capabilities = multiple slices.
4. **Tool-checkable definition of done.** `pnpm typecheck` + `pnpm test` (with cache-tag and I12 assertions named in tests, coverage thresholds met) + `pnpm bdd` for surfaces + `pnpm lint:spec-links` for bidirectional spec↔test linkage. Every "done" claim is verified by these.
5. **Adversarial pass runs early and once.** SDET runs at Phase 1.0 to validate scaffold coverage against the spec, not at the end. After-the-fact "you forgot a test" is strictly worse than catching it before implementation. Not optional, not infinite.
6. **Invariant gate is non-negotiable.** Architect rejects on I1–I18 violation; user is the only override.
7. **User checkpoints at boundaries.** Spec approval before code; final approval before merge. Bypass and you're the one shipping the slop.
8. **Ticket-first dispatch.** Every agent dispatch references a ticket id — the ticket is the work order, carrying the capability/ADR ref, acceptance bar, and resume prompt. No ticket → scope one first. See [`tickets/CLAUDE.md`](tickets/CLAUDE.md).

### Mechanically-checked invariants every slice

- Every emitted event includes `cacheInvalidationTags` with `Tenant:${tenantId}` (I10)
- Every dispatcher has a `dispatch.ts` test rebuilding projections from synthetic events (I12)
- `apps/server/src/middleware/state.ts` and `apps/projection-worker/src/tenant-loop.ts` stay mirrored
- No adapter imports in `/modules`; no HTTP outside `apps/server` (I1, hexagonal)
- Every new component extends `AtlasElement`; no Lit/React/Vue/bare HTMLElement
- Every test carries an `@spec:` annotation pointing to the spec section it covers (`specs/crosscut/testing.md` §5.1)
- Every package meets its branch-coverage floor per `specs/crosscut/testing.md` §5.2
- Every universally-quantified invariant has a fast-check property test in `packages/contract-tests/src/properties/` (`specs/crosscut/testing.md` §2.2)
- Every port has a contract suite in `packages/contract-tests/src/<port>.ts`; every adapter imports and runs it

### Orchestration notes

- Main Claude orchestrates; subagents return one summary each — they don't talk peer-to-peer.
- Phase 1 agents run in parallel when the slice spans backend + frontend + new port (single message, multiple Agent calls).
- Phases 2 and 3 are single-pass. If feedback fires, the dev fixes once and re-runs Phase 1 gates. The user is the tiebreaker — no infinite review loops.

The capability template lives at [`specs/_capability-template.md`](specs/_capability-template.md). Modeled on [`specs/domains/tenancy/capabilities/custom-domains/README.md`](specs/domains/tenancy/capabilities/custom-domains/README.md) — read that as the worked example.

## Top-level Layout

```
adapters/   port implementations (idb, node, policy-cedar, policy-stub)
ports/      @atlas/ports — port interfaces only
modules/    domain logic (authz, catalog, content-pages, identity)
packages/   shared infra: core, design, widgets, ingress, schemas, …
apps/       runnable units: server (Hono), admin, authoring, sandbox, projection-worker, sim
tests/      bdd (Playwright + Gherkin)
specs/      RFC-style specs and lexicon — the source of truth
tickets/    unit-of-work — slice instances dispatched to agents (see tickets/CLAUDE.md)
infra/      compose files, container runtime
```

## Domain Map

Atlas is structured as **7 platforms + 1 parked-apps platform**, each containing several **domains**. Domains are the agent-ownership unit — one agent (or platform owner) owns a capability inside a domain end-to-end (spec → BDD → modules → adapters → UI). Platforms are a doc-level grouping for narrative; they are not a folder layer.

Each domain's spec home is `specs/domains/<domain>/`. BDD feature folders under `tests/bdd/features/<domain>/` are created lazily — only when a scenario exists.

This map was re-anchored on 2026-05-08 from a CMS / SaaS-framework shape to a developer-platform shape ([ADR 0002](specs/decisions/0002-developer-platform-domain-map.md)) and amended the same day to add the **Extensibility** platform (`custom-schema`, `functions`) so tenants can define their own data model and author their own code, alongside the developer-platform substrate ([ADR 0003](specs/decisions/0003-tenant-defined-data-model-pivot.md)).

| Platform | Domain | Spec home |
|----------|--------|-----------|
| **Spine** | identity | [`specs/domains/identity/`](specs/domains/identity/) |
| **Spine** | authorization | [`specs/domains/authorization/`](specs/domains/authorization/) |
| **Spine** | tenancy | [`specs/domains/tenancy/`](specs/domains/tenancy/) |
| **Spine** | organization | [`specs/domains/organization/`](specs/domains/organization/) |
| **Spine** | audit | [`specs/domains/audit/`](specs/domains/audit/) |
| **Spine** | observability | [`specs/domains/observability/`](specs/domains/observability/) |
| **Spine** | search | [`specs/domains/search/`](specs/domains/search/) |
| **Compute** | cluster | [`specs/domains/compute/cluster/`](specs/domains/compute/cluster/) |
| **Compute** | runtime | [`specs/domains/compute/runtime/`](specs/domains/compute/runtime/) *(stub, to be created)* |
| **Compute** | image-build | [`specs/domains/compute/image-build/`](specs/domains/compute/image-build/) *(stub, to be created)* |
| **Compute** | ingress | [`specs/domains/compute/ingress/`](specs/domains/compute/ingress/) *(stub, to be created)* |
| **Compute** | dns | [`specs/domains/compute/dns/`](specs/domains/compute/dns/) *(stub, to be created)* |
| **Storage** | object-storage | [`specs/domains/storage/object-storage/`](specs/domains/storage/object-storage/) *(stub, to be created)* |
| **Storage** | block-storage | [`specs/domains/storage/block-storage/`](specs/domains/storage/block-storage/) *(stub, to be created)* |
| **Storage** | secrets | [`specs/domains/storage/secrets/`](specs/domains/storage/secrets/) *(stub, to be created)* |
| **Code** | repository | [`specs/domains/code/repository/`](specs/domains/code/repository/) |
| **Code** | pipeline | [`specs/domains/code/pipeline/`](specs/domains/code/pipeline/) *(stub, to be created)* |
| **Code** | artifact-registry | [`specs/domains/code/artifact-registry/`](specs/domains/code/artifact-registry/) *(stub, to be created)* |
| **Workflow** | triggers | [`specs/domains/workflow/triggers/`](specs/domains/workflow/triggers/) *(stub, to be created)* |
| **Workflow** | scheduling | [`specs/domains/scheduling/`](specs/domains/scheduling/) |
| **Workflow** | jobs | [`specs/domains/workflow/jobs/`](specs/domains/workflow/jobs/) *(stub, to be created)* |
| **Workflow** | function-runner | [`specs/domains/workflow/function-runner/`](specs/domains/workflow/function-runner/) *(stub, to be created)* |
| **Workflow** | approvals | [`specs/domains/approvals/`](specs/domains/approvals/) |
| **Workflow** | import-export | [`specs/domains/import-export/`](specs/domains/import-export/) |
| **Commerce** | billing | [`specs/domains/billing/`](specs/domains/billing/) |
| **Commerce** | quotas | [`specs/domains/quotas/`](specs/domains/quotas/) |
| **Commerce** | metering | [`specs/domains/commerce/metering/`](specs/domains/commerce/metering/) *(stub, to be created)* |
| **Commerce** | plans | [`specs/domains/commerce/plans/`](specs/domains/commerce/plans/) *(stub, to be created)* |
| **Extensibility** | custom-schema | [`specs/domains/custom-schema/`](specs/domains/custom-schema/) *(active stub — capability specs Phase 3–4 per [ADR 0003](specs/decisions/0003-tenant-defined-data-model-pivot.md))* |
| **Extensibility** | functions | [`specs/domains/functions/`](specs/domains/functions/) *(active stub — capability specs Phase 3–4 per [ADR 0003](specs/decisions/0003-tenant-defined-data-model-pivot.md))* |
| **First-party apps** *(parked)* | cms | `apps/cms/` once moved (currently `modules/content-pages/`, `modules/catalog/`, `apps/authoring/`, `packages/page-templates/`, `packages/bundles/standard/`) |

The remaining Compute / Storage / Code platform stubs and the new Workflow domains are **net-new and currently unspecified** — capability specs land in subsequent PRs per the slice workflow. Phase 1 of the project plan starts with `compute/cluster` (stand up k3s on Hetzner), `compute/image-build` (kaniko in-cluster), and `code/repository` (the upload-tarball foundation Phase 1 depends on).

Domain stub directories under `specs/domains/` are created lazily as their first capability is scoped — no need to land empty `README.md` placeholders ahead of work.

The directory layout under `specs/domains/` will reorganise as new domains land — Compute / Storage / Code domains nest under their platform dir (e.g. `specs/domains/compute/cluster/`) for clarity, since they're newly carved.

## Capability Onboarding

If you've been told "work on capability X in domain Y," read these in order
before writing code. The whole stack converges on this list.

1. **The capability spec** — `specs/domains/<domain>/capabilities/<capability>/README.md` (purpose, scope, surfaces, invariants touched). If the file doesn't exist yet, the capability hasn't been scoped — escalate.
2. **The request lifecycle** — [`specs/lifecycle.md`](specs/lifecycle.md). 5-minute end-to-end trace of how an intent flows through the stack and how reads come back. **Mandatory** if you're touching anything backend.
3. **Module conventions** — [`modules/CLAUDE.md`](modules/CLAUDE.md). Handler / projection / dispatcher / query patterns + the cache-invalidation contract.
4. **Frontend conventions** — [`packages/core/CLAUDE.md`](packages/core/CLAUDE.md) for `AtlasElement` / `AtlasSurface` / signals; [`packages/design/CLAUDE.md`](packages/design/CLAUDE.md) when adding a new component.
5. **BDD contract** — [`tests/bdd/README.md`](tests/bdd/README.md) for the feature/step layout and surface-state assertions.
6. **Architecture invariants** — [`specs/architecture.md`](specs/architecture.md). Every capability must respect I1–I12.

## Quick Commands

| Task | Command |
|------|---------|
| Install | `pnpm install` |
| Frontend dev — admin | `pnpm dev` |
| Frontend dev — authoring | `pnpm authoring` |
| Frontend dev — sandbox | `pnpm sandbox` |
| Server (apps/server) | `pnpm --filter @atlas/server dev` |
| atlasctl (operator CLI) | `pnpm atlasctl <command> [flags]` |
| Typecheck | `pnpm typecheck` |
| Unit tests | `pnpm test` |
| E2E (Playwright) | `pnpm test:e2e` |
| BDD (Playwright + Gherkin) | `pnpm bdd` |
| Lint | `pnpm lint` |
| Dead code / unused exports | `pnpm lint:knip` |
| Workspace version drift | `pnpm lint:syncpack` |
| Markdown style | `pnpm lint:markdown` |
| JSON schema contracts (Spectral) | `pnpm lint:spectral` |
| Markdown link integrity (Lychee) | `pnpm lint:links` |
| Atlas invariant rules (Semgrep) | `pnpm lint:semgrep` |
| Format (write) | `pnpm format` |
| Format check (no writes) | `pnpm format:check` |
| Secret scan (Gitleaks) | `pnpm secrets:scan` |
| Vulnerability scan (osv-scanner) | `pnpm vuln:scan` |
| Test coverage (report) | `pnpm coverage` |
| Architectural deps (dep-cruiser) | `pnpm deps:check` |
| Layer ring gate (ADR 0016) | `pnpm arch:check` |
| Regenerate ring rules from manifest | `pnpm arch:emit` |
| Invariant scan (overseer) | `pnpm overseer:check` |
| DB up (Postgres) | `make db-up` |

> The full quality battery — knip, syncpack, gitleaks, osv-scanner, lychee, markdownlint, spectral, vitest coverage — runs on every PR via [`.github/workflows/quality.yml`](.github/workflows/quality.yml). Pre-commit hooks (lefthook) run the fast subset locally; install with `pnpm exec lefthook install` after `pnpm install`.

## Non-Negotiable Invariants

Architectural laws — violating any is a bug. Full definitions in `specs/architecture.md`.

> **Layer rings (ADR 0016).** On top of the hexagon, Atlas enforces a hard concentric **ring** model — backend `abi → ports → runtime → domain → adapter → apps` and a parallel frontend `ui-core → … → ui-app`, dependencies inward-only. The single source of truth is [`architecture/rings.json`](architecture/rings.json); `pnpm arch:check` validates every package.json edge (authoritative), and `pnpm arch:emit` generates the dep-cruiser + oxlint layer rules from it. Known exceptions are shrink-only waivers (currently **zero**). See [`specs/decisions/0016-hard-layered-ring-architecture.md`](specs/decisions/0016-hard-layered-ring-architecture.md).

- **I1**: All requests go through the single ingress chokepoint — no other module/package exposes HTTP
- **I2**: Authorization runs BEFORE execution — no side effects on denied requests
- **I3**: Idempotency checked before handler dispatch
- **I4**: Deny-overrides-allow in policy evaluation
- **I5**: `correlationId` propagates through the entire request flow
- **I7**: Tenant isolation in search — `tenantId` always in scope
- **I9**: Cache keys MUST include `tenantId` (unless explicitly PUBLIC)
- **I10**: Cache invalidation is event-driven via tag-based purging, not TTL
- **I12**: Projections must be rebuildable from event history alone
- **I20**: Tenant-visible feature changes ship as a tenant intent or platform-data change — never via a restart (operator-experience invariant; gate-enforced from `always-on.md` §6 Phase 7). Restart for a kernel-surface change triggers a [Kernel Touch Retrospective](specs/crosscut/always-on.md#§11-kernel-touch-retrospective).

## Core Concepts

- **Port** — an interface in `/ports`. Defines a capability (e.g., `EventStore`, `Cache`).
- **Adapter** — an implementation in `/adapters`. Each adapter satisfies one or more ports.
- **Module** — domain logic in `/modules`. Pure functions over ports — no I/O of its own.
- **AtlasElement** — base class for every UI element (`packages/core`). Extends `HTMLElement`. Components live in `packages/design`.
- **AtlasSurface** — top-level surface (page / widget / dialog) that owns load state and provides `surfaceId` for nested elements.

### Enforcement bars

These rules are non-negotiable. They show up in nearly every code review:

- **`AtlasElement` is the only base class for UI elements.** Bare `HTMLElement`, framework components (Lit/React/Vue), or wrapper classes are not allowed in Atlas frontend code. New components belong in [`packages/design/`](packages/design/CLAUDE.md).
- **`apps/server` is the only HTTP boundary.** Every other app (admin, authoring, sandbox) is a *client* of it. No other package or app may expose HTTP endpoints (Invariant **I1**). The full request flow is traced in [`specs/lifecycle.md`](specs/lifecycle.md).
- **Modules under `/modules` may not import each other directly.** Cross-domain reads use events/projections (Invariant **I12**). The escape hatch for unavoidable sync access is `modules/<x>/src/public/` — anything outside that path is forbidden by `pnpm deps:check`. Run `pnpm deps:graph` to render the current dependency graph as `deps.html`.

## Gotchas

- **Podman, not Docker.** Container runtime defaults to Podman. `CONTAINER_RUNTIME=docker` to override.
- **Module IDs are kebab-case.** Workspace names use `@atlas/<name>`; module dirs match.
- **DB connection** (server): `CONTROL_PLANE_DB_URL=postgres://atlas_platform:local_dev_password@localhost:15433/control_plane`. Host port `15433` is intentional — picked outside the standard 5432/5433 range to dodge native-Postgres collisions on dev machines. See [`PORTS.md`](PORTS.md).
- **`X-Debug-Principal`** header is gated by `TEST_AUTH_ENABLED=true` and only valid in non-prod.

## Key Reference Files

| File | What it contains |
|------|-----------------|
| `specs/architecture.md` | Principles P1–P6, Invariants I1–I12, full system design |
| `specs/LEXICON.md` | Canonical vocabulary — nouns, verbs, pipelines |
| `specs/normative_requirements.md` | RFC 2119 compliance rules |
| `SYSTEM_MAP.md` | Deep AI-agent exploration guide with request traces |
| `PROGRESS.md` | What's implemented vs. stubbed vs. missing |
| `features.md` | High-level feature list |
