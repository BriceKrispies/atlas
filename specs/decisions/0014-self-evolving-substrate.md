# 0014 — Self-evolving substrate: pattern promotion and declarative materialization

**Status:** Proposed (2026-05-20)
**Depends on:** [`0003-tenant-defined-data-model-pivot.md`](0003-tenant-defined-data-model-pivot.md) (agentic-first tenet, open public signup), [`0004-platform-invariants-for-multi-tenant-fabric.md`](0004-platform-invariants-for-multi-tenant-fabric.md) (I13 single ingress, I14 tenant-code isolation, I17 API/CLI/UI parity), [`0005-custom-schema-storage-strategy.md`](0005-custom-schema-storage-strategy.md) (db-per-tenant — revised 2026-05-20 — the storage target of materialization), [`0007-dsl-substrate-and-authoring-contract.md`](0007-dsl-substrate-and-authoring-contract.md) (DSL artifacts are one of the things materialization writes), [`0008-atlas-on-atlas.md`](0008-atlas-on-atlas.md) (recursive-kernel principle — Atlas is a tenant of itself).
**Touches invariants:** I1 (single ingress — materialization and promotion both flow through it), I12 (projection rebuildability — promotion and materialization events are first-class), I17 (API/CLI/UI parity for both loops).

## Context

[`vision.md`](../vision.md) commits Atlas to *continuous evolution through agents*. Two loops carry that load:

1. **The concentration loop (inward).** When the same pattern appears in N modules or packages — a handler shape, a projection topology, a surface composition, a query/cache wiring — it should be promoted to a shared substrate. Otherwise the codebase fragments: each agent that touches a module reinvents the local convention, and the "tiny core" tenet from [ADR 0003](0003-tenant-defined-data-model-pivot.md) erodes one duplication at a time.
2. **The materialization loop (outward).** When a human or agent wants to ship a feature, the path of least resistance must be a **declarative spec** that the platform materializes into the artifacts realizing the feature (`ObjectType` definitions, DSL artifacts, capability manifests, surface registrations, seed data, plan/quota entries). Otherwise every new feature is a code-change-and-deploy cycle, which contradicts the always-on kernel principle ([ADR 0008](0008-atlas-on-atlas.md) Stage 6) and the agentic-first tenet ([ADR 0003](0003-tenant-defined-data-model-pivot.md) §3).

Both loops exist *in the vision today*; neither has a specified mechanism. Without one, the failure modes are predictable:

- **Without a promotion contract:** agents identify duplication and either silently leave it (drift continues) or autonomously refactor (uncontrolled churn, broken invariants, no audit). Either way the platform stops getting more concentrated as it grows.
- **Without a materialization contract:** agents either commit code (the very anti-pattern the always-on kernel exists to remove) or invent ad-hoc side-door writers that bypass the ingress pipeline, breaking I1, audit, idempotency, and quota at once.

The two loops are different in direction (inward vs outward) but share an underlying principle this ADR formalizes: **code is the exception, data is the norm.** Promotion shrinks the code surface by extracting recurring shapes into shared substrate; materialization expands the feature surface without growing the code surface at all. They are the same lever pulled from opposite sides.

The 2026-05-20 user checkpoint chose to land the substrate decision now — before any concrete promotion or first materialization slice — so neither loop is improvised under deadline pressure.

A specific framing this ADR resolves: **the legacy CMS (`apps/cms/`, `modules/content-pages/`, `modules/catalog/`, `apps/authoring/`, `packages/page-templates/`, `bundles/standard/`) is the canonical first test of the materialization loop.** Per [ADR 0002](0002-developer-platform-domain-map.md) the CMS is a parked first-party app; per this ADR it becomes the first **seed bundle** — a declarative spec that the materializer turns into a working CMS for any tenant that installs it. The CMS proves the loop; subsequent first-party apps (issue tracker, CRM-shaped object stack, helpdesk) follow the same path.

## Decision

The two loops are specified together because they share one substrate (events, ingress, audit) and one principle (code is the exception). Each loop carries its own contract.

---

### Part A — The pattern-promotion loop

#### A.1 Promotions are detected, scoped, and committed by separate steps

The loop is a three-step state machine. **No step is auto-applied.** An agent is allowed to *propose* and to *implement under direction*; the user (or a designated platform-owner agent) is the only entity that can *accept* a promotion. This preserves the slice workflow ([`CLAUDE.md` § Slice Workflow](../../CLAUDE.md)) — promotion is a slice, not a side-channel.

| Step | Output | Who | Where |
|---|---|---|---|
| **Detect** | `tickets/promotions/<slug>.md` (`type: promotion-candidate`) | scheduled `overseer` job, or any agent that notices duplication mid-slice | `tickets/promotions/` |
| **Scope** | Capability spec at `specs/promotions/<slug>.md` (or fold into an existing capability spec if one applies) | `spec-keeper` + relevant platform owner | `specs/promotions/` |
| **Commit** | Code change extracting the pattern to its target, deleting the duplicates | `module-dev` / `port-adapter-dev` / `frontend-dev` | normal slice workflow |

The state machine has one terminal-but-non-acceptance state: **Rejected with rationale.** A candidate that fails the §A.2 criteria, or that surfaces duplication the platform-owner judges intentional, is closed with a written reason on the ticket. This is the anti-bikeshed guard — not every repetition is bad, and "we looked at it and chose to keep it" is a valid outcome.

#### A.2 Detection criteria — concrete, not vibes

A candidate ticket MUST cite all of the following. Detection that cannot cite them is not a promotion candidate; it is a code-review comment.

1. **≥ 3 occurrences.** Two is a coincidence; three is a pattern. Listed by file:line, with a textual or AST-shape match excerpt.
2. **Structural similarity, not lexical.** Renamed identifiers don't disqualify; differing control flow does. The candidate explicitly states what is shared (shape, type, dependency surface) and what differs (the irreducible per-site variation that the extracted substrate exposes as parameters).
3. **No module-specific knowledge in the shared shape.** If the extracted form references `catalog`-specific types or `tenancy`-specific events, it is not a substrate — it is a leaky abstraction. The candidate either generalizes the shape or rejects the promotion.
4. **A named target.** `packages/<name>` for shared infrastructure; `@atlas/dsl-substrate` for DSL plumbing; `ports/` for new abstractions; `bundles/<name>` for tenant-installable composition. "We should promote this but I'm not sure where" is a rejection.
5. **Cost estimate.** Lines deleted at call sites − lines added in the substrate. Net-negative is the bar; net-positive promotions need an explicit invariant or testability justification (e.g. consolidates a chokepoint enforcing I10).

#### A.3 The promotion event

When a promotion lands, the slice emits `Platform.Pattern.Promoted` with:

```
{
  promotionId,
  from: [{path, lineRange}, ...],    // call sites that fed the pattern
  to: {package, exportName},          // the substrate target
  candidateTicket: 'promotions/<slug>',
  acceptedBy: principalId,
  cacheInvalidationTags: ['Platform:codebase']
}
```

This is the audit-of-self trail ADR 0008 §3 requires for kernel mutations. The event is platform-scope (not tenant-scope) and lives in the control-plane event stream. `Platform:codebase` is the cache tag governing any tooling that materializes a "what code lives where?" view — e.g., the future agent-facing capability catalog.

#### A.4 The negation list — patterns that should NOT promote

Recorded here to make rejection a first-class outcome:

- **Test fixtures and acceptance-test scaffolding.** Repetition across tests is often clarifying, not muddling. The bar for promoting test code is higher; the extracted form must hide nothing relevant to the test's intent.
- **Adapter parity duplication.** When `adapter-node` and `adapter-idb` both implement the same port, the duplication is the entire point — it's what makes the port a port. Do not promote across adapters.
- **Domain-specific shapes that *happen* to look similar.** A `catalog.publish` handler and a `content-pages.publish` handler look alike at 30,000 feet and diverge at 1,000 feet. The candidate must show the shapes don't diverge in any of: dependency surface, failure modes, cache-invalidation tags, audit shape.
- **Patterns that exist precisely to support promotion later.** Three handlers using a deliberately-staged convention so a future promotion can extract them are not yet a promotion candidate — they are a planned slice.

---

### Part B — The declarative-materialization loop

#### B.1 The materializer is a host operation, not a new kernel instruction

[ADR 0004](0004-platform-invariants-for-multi-tenant-fabric.md) and `crosscut/runtime-instruction-set.md` fix the kernel at **ten instructions**. Materialization does not add an eleventh. The materializer is a **composition of `submitIntent` calls** — platform code that reads a declarative spec, produces a sequence of intents, and submits each through the standard ingress pipeline.

This is non-negotiable. A materializer that writes to the database directly, that bypasses authz/idempotency/quota/audit, or that emits events not preceded by an accepted intent, breaks I1, I2, I3, I5, I13 in a single move. The whole value of the loop is that **every materialized fact is indistinguishable, after the fact, from a human or agent having authored the same intent by hand** — which is what makes the recursive-kernel principle ([ADR 0008](0008-atlas-on-atlas.md)) hold.

#### B.2 The spec is data; the materializer is platform code

A **feature spec** is a structured declarative document — YAML, JSON, or any equivalent serialization — authored by a human or agent and stored in the platform (for first-party seed bundles) or in the tenant (for tenant-authored composition). Its schema is defined per-domain by the bundle's capability spec; this ADR commits the *contract*, not any specific spec format.

Every feature spec MUST conform to:

1. **Self-contained.** No external references resolved at materialize time other than the platform's stable surface (`@atlas/ports`, registered ObjectTypes, registered DSL artifacts of an explicitly-pinned version). No URL fetches, no file imports, no environment reads at materialize time.
2. **Declarative.** Describes the end state, not the steps to reach it. The materializer computes the step sequence; the spec author does not.
3. **Statically validatable.** A `Spec.<Kind>.Validate` action returns parse + structural-conformance errors without persisting. Same agentic-first iteration loop as the DSL `validate` endpoint ([ADR 0007](0007-dsl-substrate-and-authoring-contract.md) §8). No idempotency, no audit, separate quota dimension.
4. **Versioned.** Specs carry a `materializerVersion` (the platform contract version they were authored against) and a `specVersion` (monotonic per logical spec). The materializer rejects specs against an unsupported `materializerVersion`.

#### B.3 The materialization contract

Given an accepted spec, the materializer:

1. **Computes the desired-state diff.** Reads the current tenant (or platform) state for the resources the spec claims, computes the additions / mutations / removals required to reach the spec's end state.
2. **Synthesizes an ordered intent sequence.** Each step is a normal intent: `Schema.ObjectType.Create`, `Dsl.Template.Update`, `Plan.Create`, `Bundle.Component.Register`, etc. The materializer never invents intents that do not exist as first-class platform actions.
3. **Submits each intent through ingress.** One correlationId for the materialization run, propagated across every child intent. Each intent observes its own ingress pipeline (authz, idempotency, quota, dispatch, audit). A denied intent halts the run; the materializer either rolls back via the `Demolish` flow (§B.6) or surfaces the failure with the partial-state inventory.
4. **Emits `Bundle.Materialized` on success.** Payload: `{bundleId, specHash, intentSequenceIds, durationMs, cacheInvalidationTags: ['Tenant:${tenantId}', 'Bundle:${bundleId}']}`. The spec hash is the audit anchor that makes "this row came from this spec" reproducible.

#### B.4 The materializer is platform code, not tenant code

The materializer runs in `apps/server` (or a dedicated platform worker reusing the same pipeline) as platform-trusted code. It is not authored via the DSL substrate. It is not authored via the `functions` runtime. **No tenant ever supplies materializer code.** Tenants supply *feature specs*; the platform interprets them.

This carves the boundary tightly. The materializer is allowed to issue tenant-scoped intents because it issues them through the standard pipeline — the pipeline does the authz check, not the materializer. A tenant that submits a spec they're not authorized to materialize gets denied at the first intent that exceeds their privileges, with the partial-state inventory above.

I14 holds. A spec is a declaration of *what the tenant wants the platform to do on their behalf*; it is not tenant-executed code. The materializer running the spec is platform code with the same trust posture as any handler.

#### B.5 Spec storage

- **Platform-owned seed bundles** (CMS, future first-party apps): `bundles/<name>/spec.yaml` (or equivalent), versioned in the source tree, content-addressable, loaded into the control plane at boot, materialized per tenant on bundle install.
- **Tenant-authored compositions**: stored in `public._atlas_feature_specs` inside the tenant's database (`atlas_t_<tenantUuid>` is a database name per [ADR 0005](0005-custom-schema-storage-strategy.md)) — same platform-owned-table-in-tenant-DB pattern as `_atlas_dsl_<kind>` from [ADR 0007](0007-dsl-substrate-and-authoring-contract.md). Rows: `spec_id`, `kind`, `source` (text canonical), `parsed` (jsonb projection), `version`, `materializer_version`, timestamps. Lazy-bootstrapped on first spec of a given kind.

Both storage shapes feed the same materializer. The materializer does not care whether a spec came from the source tree or the tenant DB.

#### B.6 Idempotency and reversibility

- **Idempotent re-materialization.** Re-running the materializer over an unchanged spec is a no-op (the desired-state diff is empty). Re-running over an updated spec produces only the difference — the materializer does not re-author already-correct resources. This is required because seed-bundle install will run on every new tenant; non-idempotent materialization would mean tenants couldn't safely re-install or upgrade.
- **Demolish flow.** Every materialized bundle has a corresponding `Bundle.Demolish` action that issues the inverse intents (in reverse order, with the same correlation chain). Demolish is reversibility, not garbage collection — it removes only resources whose audit trail names the bundle as their origin. Tenant-authored data inside materialized ObjectTypes is preserved unless the demolish is explicit-destructive (an explicit flag, gated by an additional authz check). Default demolish is non-destructive; the tenant keeps their data even if the bundle shape goes away.

#### B.7 The first seed: CMS

The legacy CMS becomes the first concrete materialization target. Specifically:

- `bundles/cms-standard/spec.yaml` (placeholder path; finalized when the bundle lands) declares the `Article`, `Author`, `Section` ObjectTypes; the default page templates as DSL artifacts; the default queries; the surface registrations; the default plan entries (if Commerce is in-band by that point).
- A tenant installs the CMS via a single `Bundle.Install` intent referencing `cms-standard@v1`. The materializer realizes the bundle. The tenant has a working CMS without any code deploy on either side.
- The legacy CMS code under `modules/content-pages/`, `modules/catalog/`, `apps/authoring/`, `packages/page-templates/`, `bundles/standard/` either feeds this materialization (as platform components the bundle registers) or is retired in favor of materialized equivalents, decided per-module by the `first-party-apps-owner` agent as the seed bundle is scoped.

The CMS is the test of the loop. If the loop cannot ship the CMS, the loop is broken. If it can, every subsequent first-party app (and every tenant-authored composition) inherits the same path.

---

### Part C — Cross-cutting constraints both loops observe

1. **I1 holds for both.** Promotion candidates are tickets, not direct writes; the eventual code change goes through the slice workflow. Materialization issues intents; intents flow through ingress. Neither loop introduces a side-door write surface.
2. **I12 holds for both.** Both emit events (`Platform.Pattern.Promoted`, `Bundle.Materialized`, plus the per-intent events the materializer produces). Both are replayable; the platform state can be rebuilt from events alone.
3. **I17 holds for both.** Promotion candidates can be listed and accepted via `atlasctl`. Spec validation and materialization are CLI-accessible. Specifically:
   - `atlasctl promotions {list,show,accept,reject}` — promotion ticket management.
   - `atlasctl bundle {install,upgrade,demolish,materialize-dry-run}` — the materializer's operator surface.
4. **Quota.** Materialization debits two distinct dimensions: `bundle-installs-per-window` (the materializer-run count, mostly to backstop runaway loops) and the *constituent* quota for each intent the materializer issues (`object-types-per-tenant`, `dsl-artifacts-per-tenant`, etc.). The materializer does not bypass per-intent quotas. Dry-run debits a separate `materializer-dry-runs-per-window` dimension. Promotion has no per-tenant quota dimension because it is not a tenant-scoped action.
5. **Authz.** Materialization-as-tenant runs under the principal who submitted `Bundle.Install`. The principal needs *every* underlying permission the intent sequence requires; the materializer cannot privilege-escalate. Seed-bundle install for the platform tenant runs under the platform principal per [ADR 0008](0008-atlas-on-atlas.md).
6. **Source of truth.** A promoted pattern's authority is the substrate package's source; a materialized resource's authority is the spec it was materialized from, recorded by `specHash` in `Bundle.Materialized`. Subsequent edits to materialized resources are normal intents that update the resource without updating the spec — drift between spec and live state is expected and surfaced by `atlasctl bundle diff <bundleId>`.

---

## Constraints this imposes

The choice carries forward into capability specs and tooling:

1. **`tickets/promotions/` is a first-class ticket set.** [`tickets/CLAUDE.md`](../../tickets/CLAUDE.md) gains the `promotion-candidate` ticket type as part of this ADR's migration.
2. **`overseer` extends to duplication detection.** A new check (deferred to a follow-up slice) scans for the §A.2 detection criteria and files promotion-candidate tickets when thresholds trip. Until that exists, promotion is human-or-agent-noticed.
3. **`Spec.<Kind>.Validate` and `Bundle.{Install,Demolish,Upgrade}` actions are added to the registered action set.** Each lands in a capability spec under the bundle's owner platform (`first-party-apps-owner` for CMS; equivalent for future bundles).
4. **`@atlas/materializer` is a platform package.** Naming finalized when the first seed bundle lands. It owns: spec parsing, desired-state diff, intent-sequence synthesis, demolish-inverse computation, and the dry-run renderer.
5. **The CMS revival is reframed as a materialization slice.** The `first-party-apps-owner` agent scopes `bundles/cms-standard` as the first concrete materialization target; the existing `modules/content-pages/` etc. are evaluated for what becomes platform component (registered, called by the bundle) vs. what is retired in favor of declarative equivalents.
6. **Promotion and materialization both flow through audit.** No silent restructuring of the codebase; no silent appearance of tenant resources. Every act of the self-evolution loop is traceable.

## Consequences

**Positive:**

- The platform gets more concentrated as it grows. The "tiny core" tenet from [ADR 0003](0003-tenant-defined-data-model-pivot.md) becomes a mechanically enforced trajectory, not aspirational language.
- New first-party apps (CMS, then the next ones) ship as data, not code. The deploy-per-feature cycle is broken for everything that fits the substrate.
- The agentic-first tenet gets two new load-bearing surfaces: agents propose promotions (and learn from accepted/rejected dispositions), and agents author feature specs (with a validate-without-commit loop already mandated by the §B.2 contract).
- The CMS revival is no longer "rebuild the CMS"; it is "prove the materialization loop on a known shape." Strictly cheaper if the loop works; a useful negative result if it doesn't.
- Atlas-on-Atlas ([ADR 0008](0008-atlas-on-atlas.md)) gets its strongest manifestation: a materialized bundle for the platform tenant is indistinguishable from a materialized bundle for any other tenant. The recursion is mechanical.

**Negative:**

- **Governance overhead.** Promotion tickets, capability specs, candidate-rejection rationales — all of this is process. A small team will feel the weight; the alternative (uncontrolled agent-driven refactor) is worse.
- **Materializer complexity.** Desired-state diff over a heterogeneous platform surface is non-trivial. The first materializer will be opinionated about the resource kinds it supports; expanding the kind set is itself a slice each time. Mitigation: start with a minimal kind set sufficient for the CMS bundle.
- **Spec/state drift is real.** Once a resource is materialized, subsequent edits diverge from the spec. `atlasctl bundle diff` exposes the divergence; reconciling it is a per-bundle policy question this ADR does not settle.
- **The "third execution category" temptation.** Authors will be tempted to add expressive features to specs that nudge them toward Turing completeness. The §B.2 *declarative* constraint is the guard; the architect agent enforces it on spec capability reviews.
- **Promotion fatigue.** A productive detector will produce more candidates than the team accepts. The promotion ticket set will accumulate rejected candidates; that is acceptable so long as the rejection rationales are written. An infinite-loop "agent files candidate → reviewer rejects → agent re-files" is a real risk and is addressed by ticket dedup (existing rejected candidate with the same shape blocks re-filing for N days).

**Out of scope:**

- **Pattern-detection algorithm.** Whether the detector is AST-shape-match, embedding-similarity, or a curated heuristic set is a tooling question, not an ADR question. Start simple (textual + AST shape over file boundaries); upgrade later.
- **Cross-tenant pattern promotion.** A tenant's repeated composition pattern across their own DSL artifacts is not yet a promotion candidate to the platform substrate — that question conceptually parallels ADR 0005 §"Out of scope" item 2 on cross-tenant data sharing and is deferred.
- **Auto-merge.** Neither loop ever auto-applies. This is settled, not deferred.
- **The full feature-spec schema.** Per-bundle; lands with each bundle's capability spec. This ADR commits the contract, not the schema.
- **Promotion of port abstractions.** Promoting a recurring pattern *into* a new port (vs. into a `packages/` substrate) is a strictly larger move because it touches I1's hexagonal layering. Treated as a normal port-change slice through `port-adapter-dev` + `architect`, not as a routine promotion.
- **Quota dimensions** — owned by Commerce, scoped when their first consumer lands; this ADR names them but doesn't size them.
- **The materializer's dry-run renderer output format.** Per-bundle decision; the contract is "shows the intent sequence and the projected end state," not "this exact JSON shape."

## Migration

1. **This ADR (spec-only):** records the decision. No code in this PR.
2. **Tickets contract patch:** [`tickets/CLAUDE.md`](../../tickets/CLAUDE.md) gains `promotion-candidate` as a ticket type; `tickets/promotions/` is created lazily on first candidate.
3. **Lexicon patch:** [`specs/LEXICON.md`](../LEXICON.md) adds entries for `PromotionCandidate`, `FeatureSpec`, `Bundle`, `Materializer`, `DesiredStateDiff`. Lands with the first promotion ticket or the CMS seed-bundle scope, whichever ships first.
4. **First promotion candidate (suggested):** `packages/dispatch-chain` extraction — already identified by the kernel-bring-up gap analysis. Filed as `tickets/promotions/dispatch-chain-extraction.md` once this ADR is accepted.
5. **First materialization slice (suggested):** `bundles/cms-standard` — scoped by `first-party-apps-owner` once Compute Phase 1 has stabilized enough that the seed bundle has a place to land. The CMS shape is well-understood from the parked code, which makes it the cheapest test of the loop.
6. **Overseer extension** (deferred): pattern-duplication detector lands as a follow-up slice; until it exists, promotion-candidate tickets are filed by humans or by agents mid-slice when they notice duplication.
7. **`@atlas/materializer` package** (deferred): scoped under the first seed-bundle slice, not pre-emptively.

## Cross-references

- Vision tenet this operationalizes: [`vision.md`](../vision.md) §"What Atlas is" (Salesforce-shaped data + agentic-first + tiny-core trajectory).
- Tenet on Atlas as a recursive kernel: [`0008-atlas-on-atlas.md`](0008-atlas-on-atlas.md) — the platform tenant materializing its own bundles is this ADR's strongest case.
- Authoring contract reused by spec validation: [`0007-dsl-substrate-and-authoring-contract.md`](0007-dsl-substrate-and-authoring-contract.md) §8 (`validate` endpoint shape, source-map / errors structure).
- Storage pattern reused for per-tenant feature specs: [`0005-custom-schema-storage-strategy.md`](0005-custom-schema-storage-strategy.md) §Constraints items 2–3 (per-tenant migration ledger inside the tenant's DB; two-role topology).
- Tenant-code boundary this does not weaken: [`0004-platform-invariants-for-multi-tenant-fabric.md`](0004-platform-invariants-for-multi-tenant-fabric.md) I14 (materializer is platform code; specs are declarations, not tenant code).
- Single-ingress invariant both loops observe: [`architecture.md`](../architecture.md) I1, plus [`0004-platform-invariants-for-multi-tenant-fabric.md`](0004-platform-invariants-for-multi-tenant-fabric.md) REQ-INGRESS-002.
- Cache-invalidation contract the emitted events observe: [`architecture.md`](../architecture.md) I9, I10.
- Slice workflow that promotions follow: [`CLAUDE.md`](../../CLAUDE.md) §"Slice Workflow".
- Pre-existing parked-CMS framing this reframes as the first seed bundle: [`0002-developer-platform-domain-map.md`](0002-developer-platform-domain-map.md) and the "First-party apps (parked)" platform row in [`CLAUDE.md`](../../CLAUDE.md).
