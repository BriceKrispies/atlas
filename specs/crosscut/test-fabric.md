# Test Fabric

**Status:** Designed (no implementation yet). Phased rollout per §8.
**Owners:** `sdet` (primary), `architect` (invariant-coverage gate).
**Source:** [`decisions/0004-platform-invariants-for-multi-tenant-fabric.md`](../decisions/0004-platform-invariants-for-multi-tenant-fabric.md). The 2026-05-08 multi-agent review surfaced "no harness asserts cross-cutting invariants under traffic" as the #1 testing gap; this spec is the answer.

## 1. Purpose

Atlas has four existing test harnesses — `packages/contract-tests/` (per-port parity), `tests/integration/` (real-server end-to-end flows), `tests/parity/` (sim+node dual-mode), `tests/bdd/` (Playwright + Gherkin journeys) — and they cover what they cover well. None of them assert at the **invariant** layer that the multi-tenant fabric depends on:

- A tenant cannot read, write, observe, or starve another tenant (REQ-ISO-001).
- Every emitted event carries `Tenant:${tenantId}` in `cacheInvalidationTags` (I10).
- Every accepted intent produces a complete `correlationId` chain ending in audit (I5, I6).
- Quota enforcement runs between authz and idempotency on every mutating handler (I13 / REQ-QUOTA-001).
- No log line cross-references two tenants (`crosscut/logging.md`).
- Every action in the registry is reachable through a single ingress (I1, I17 / REQ-INGRESS-002).
- Every UI surface exposes a machine-readable snapshot (I18 / REQ-AGENT-001).

The **test fabric** is a unified harness above the existing test infrastructure. It boots Atlas (in-process or out-of-process), provisions N synthetic tenants with named personas, drives intents through the real ingress pipeline, and asserts on logs / audit / event store / cache state / surface introspection. It runs in four modes (isolation, pump-and-watch, load, chaos) that share the same three primitives.

The fabric does **not** replace existing harnesses — it sits above them and asserts on cross-cutting invariants those harnesses don't reach.

## 2. Non-Goals

- **UI rendering / a11y testing.** BDD + Playwright own that surface.
- **Per-port parity.** `packages/contract-tests/` owns it.
- **Pure unit testing of pure functions.** Vitest unit suites in each module own it.
- **Cosmetic / visual-regression testing.** Out of scope for the fabric.
- **Replacing any existing harness.** Contract-tests, parity, integration, and BDD all stay.
- **Defining new platform invariants.** The fabric tests existing invariants; new invariants land via ADR.

## 3. Architectural Position

```
                    ┌────────────────────────────────────────────────┐
                    │  Test Fabric (this spec)                       │
                    │   • TenantFactory                              │
                    │   • IntentDriver  (Http | Sim)                 │
                    │   • AssertionHarness  (FAB-* assertion library)│
                    │   • Mode runners: isolate | pump | load | chaos│
                    └─────────────┬──────────────────────────────────┘
                                  │ uses
                                  ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ contract-    │  │ parity tests │  │ integration  │  │ BDD          │
│ tests (per-  │  │ (sim + node) │  │ tests (real  │  │ (Playwright  │
│ port parity) │  │              │  │ server)      │  │ + Gherkin)   │
└──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
                                  │
                                  ▼
                        ┌─────────────────┐
                        │ apps/server     │  (single ingress, I1)
                        └─────────────────┘
```

The fabric is a workspace package (`packages/test-fabric/`) imported by:

- Capability test files (`modules/<x>/test/`) that opt into named `FAB-*` assertions.
- Standalone fabric runs invoked via `pnpm fabric <mode>`.
- CI workflows that run Mode A on every PR.

It reads from the same observability surfaces an AI agent operating Atlas would read from: `MemoryRingBufferSink` for structured logs, `EventStore.readEvents(tenantId)` for the event store, `cache.invalidateByTags` instrumentation for cache-tag traces, and the surface registry at `/api/v1/surfaces` per [`frontend/surface-introspection.md`](../frontend/surface-introspection.md). This is intentional: if the fabric can read the system, agents can.

## 4. Three Primitives

The contract every implementation provides.

### 4.1 `TenantFactory`

Provisions N synthetic tenants with named personas. Personas are an open set; new modes add new ones.

| Persona | Behavior | Used by |
|---|---|---|
| `BasicTenant` | Vanilla tenant, default quotas, baseline traffic | All modes |
| `AdversarialTenant` | Pen-test persona; actively probes for cross-tenant data, escalation, sandbox escape | Mode A (Isolation) |
| `OverQuotaTenant` | Pre-positioned at quota ceiling for one or more dimensions | Mode A, Mode D (chaos rules) |
| `BurstTenant` | Fires intents at burst rate; tests neighbor-noise isolation (FAB-ISO-002) | Mode A, Mode C |
| `IdleTenant` | Provisioned but never acts; control population for invariant assertions | All modes |

`TenantFactory.provisionN(persona, n)` returns an array of `SyntheticTenant` records carrying `tenantId`, `principalId`, baseline plan / quotas, and credential material (`X-Debug-Principal` token in dev; real signup in modes that exercise public signup).

Tenant teardown is the factory's responsibility — between fabric runs, no synthetic tenant data persists in the control plane DB or any tenant DB.

### 4.2 `IntentDriver`

Submits intents through the real ingress. Two implementations behind a single interface:

- **`HttpIntentDriver`** — out-of-process. Talks to `apps/server` over HTTP at `INGRESS_BASE_URL`. Mirrors the existing pattern in `tests/integration/`. Most realistic; required for Modes C (Load) and D (Chaos).
- **`SimIntentDriver`** — in-process. Wraps the existing `makeSimIngress` from `tests/parity/`. IDB-backed, no network, fast iteration. Default for Mode A and B in CI.

Both implement:

```ts
interface IntentDriver {
  submit(envelope: EventEnvelope): Promise<IntentResult>;
  submitMany(envelopes: EventEnvelope[], opts: { concurrency: number; rate?: number }): Promise<IntentResult[]>;
}
```

Both submit `EventEnvelope` payloads via `POST /api/v1/intents` (or its in-process equivalent) with `X-Debug-Principal` authn. The driver does not invent a side door — every intent traverses the same authz / quota / idempotency / dispatch chain a human or agent would (Invariant I1).

### 4.3 `AssertionHarness`

Read accessors over Atlas's observability surfaces, plus a library of named invariant assertions (catalog in §5).

```ts
interface AssertionHarness {
  // Read accessors
  events(tenantId: TenantId): Promise<EventEnvelope[]>;
  logs(filter: LogFilter): Promise<LogEntry[]>;
  cacheInvalidations(filter: TagFilter): Promise<CacheInvalidationRecord[]>;
  surfaceRegistry(): Promise<SurfaceManifest[]>;
  surfaceSnapshot(surfaceId: string, principal: SyntheticTenant): Promise<SurfaceSnapshot>;

  // Named assertions (one per FAB-* ID)
  assertCrossTenantIsolation(victim: SyntheticTenant, attacker: SyntheticTenant): Promise<AssertionResult>;
  assertCorrelationIdChainComplete(correlationId: string): Promise<AssertionResult>;
  assertCacheTagsContainTenant(events: EventEnvelope[]): Promise<AssertionResult>;
  // ...one per FAB-* ID
}
```

Assertion results are structured (`{ id, passed, evidence?, violations? }`) so mode runners can aggregate them into reports.

## 5. Assertion Catalog

Each assertion has a stable ID and a defined source of truth. Capability specs reference these IDs from their **Acceptance** section to opt into fabric-level checks. The catalog is the contract; implementations may add fabric-private assertions but cannot remove or repurpose a published `FAB-*` ID.

| ID | Asserts | Source invariant / req | Reads |
|---|---|---|---|
| **FAB-ISO-001** | Cross-tenant data is invisible — tenant A's writes are unreadable / unsearchable / uncacheable from tenant B's principal scope, parameterised over every port. | REQ-ISO-001, I7, I9 | EventStore, Cache, SearchEngine, EntityStore, ProjectionStore |
| **FAB-ISO-002** | Cross-tenant resource starvation — tenant A's burst behavior does not slow tenant B's quota-check hot path or response p95. | REQ-ISO-001 | latency telemetry per tenant |
| **FAB-CORR-001** | Every accepted intent produces a complete `correlationId` chain ending in an `Audit.*` event. | I5 | EventStore, MemoryRingBufferSink |
| **FAB-CORR-002** | Every emitted event has `causationId` linked to a prior event in the same chain. | I6 | EventStore |
| **FAB-CACHE-001** | Every emitted event includes `Tenant:${tenantId}` in `cacheInvalidationTags`. | I10 | EventStore via `readEvents` |
| **FAB-CACHE-002** | Every entry written to cache has `tenantId` in its key, unless explicitly PUBLIC. | I9 | Cache instrumentation |
| **FAB-QUOTA-001** | Over-budget tenant receives `QUOTA_EXCEEDED` before any side effect — no domain events emitted, `Audit.QuotaDenied` is the only output. | I13, REQ-QUOTA-001 | EventStore, MemoryRingBufferSink |
| **FAB-QUOTA-002** | When `QuotaService` is unreachable, the request fail-closes — no intent processed, `QUOTA_SERVICE_UNAVAILABLE` returned. | I13, `quota-handoff` capability | network-shim, MemoryRingBufferSink |
| **FAB-INGRESS-001** | Every action in the action registry is reachable via HTTP and has a matching `atlasctl` command. | I1, I17, REQ-INGRESS-002 | action registry, `atlasctl` command list |
| **FAB-LOG-001** | No log line references more than one `tenantId` per `crosscut/logging.md` cross-tenant non-leakage clause. | `logging.md` | MemoryRingBufferSink |
| **FAB-LOG-002** | Every request-scoped log line carries `correlationId`, `tenantId`, `principalId` per `crosscut/logging.md`. | `logging.md`, I5 | MemoryRingBufferSink |
| **FAB-SURFACE-001** | Every `AtlasSurface` has a registry manifest entry and a working `getSurfaceSnapshot()`. | I18, REQ-AGENT-001 | `/api/v1/surfaces` registry |
| **FAB-AUTHZ-001** | An unauthenticated or unauthorized request emits no domain events and no quota decrement. | I2, I4 | EventStore, quota ledger |
| **FAB-IDEMPOTENT-001** | Duplicate `idempotencyKey` does not double-execute the handler or double-emit events. | I3 | EventStore |
| **FAB-PROJECTION-001** | Replaying any tenant's event stream into a fresh projection store reproduces identical projections. | I12 | EventStore, ProjectionStore |
| **FAB-FUNCTIONS-001** *(future)* | Tenant-authored functions executing a corpus of malicious payloads cannot escape the sandbox. | I14 | function-runtime port, MemoryRingBufferSink |
| **FAB-EGRESS-001** *(future)* | Tenant code cannot reach the public internet without traversing the egress port. | I15 | egress-port instrumentation |
| **FAB-SCHEMA-001** *(future)* | Tenant-issued schema mutations are confined to the issuing tenant's schema. | I16 | tenant-DB inspection |

### Invariant coverage map

Every I1–I18 invariant has a `FAB-*` consumer except the following, which are out of fabric:

- **I8 (permission-filtered search)** — exercised by per-domain search tests; the fabric does not own permission-attribute coverage.
- **I11 (deterministic time bucketing)** — pure-function property; covered by analytics unit tests.

REQ-* coverage in `normative_requirements.md §3.12`:

- REQ-SIGNUP-001 — exercised via `tenancy/public-signup` integration test (consumes FAB-AUTHZ-001 and FAB-CORR-001).
- REQ-SIGNUP-002 — exercised via the `signup-rate-limit` capability test once it lands; consumes FAB-QUOTA-001.
- REQ-ISO-001 — FAB-ISO-001 and FAB-ISO-002.
- REQ-QUOTA-001 — FAB-QUOTA-001 and FAB-QUOTA-002.
- REQ-AGENT-001 — FAB-SURFACE-001.
- REQ-INGRESS-002 — FAB-INGRESS-001.

## 6. Four Operating Modes

Each mode dials the same three primitives differently. The spec lists each mode's required assertions and required dependency injections.

### Mode A — Isolation

The SDET-flagged #1 gap. Two or more synthetic tenants on a shared instance, with one `AdversarialTenant` actively probing for cross-tenant access.

- **Tenants:** ≥ 2 `BasicTenant` + 1 `AdversarialTenant`.
- **Workload:** the basic tenants run baseline traffic; the adversarial tenant attempts every probe in the assertion catalog (read sibling events, query sibling cache keys, search across tenants, read sibling secrets, induce starvation).
- **Required assertions:** the FAB-ISO-* family + FAB-AUTHZ-001 + FAB-CACHE-001 + FAB-IDEMPOTENT-001.
- **Run profile:** runs in CI on every PR. Must complete in < 60s on the default config (5 tenants, 60s duration). Default driver: `SimIntentDriver` (faster); pre-merge job runs `HttpIntentDriver` for realism.
- **Failure mode:** any FAB-ISO-* violation fails the build.

### Mode B — Pump-and-watch

N synthetic tenants firing baseline traffic; the fabric records every `correlationId` chain and asserts FAB-CORR-* / FAB-CACHE-* / FAB-LOG-* hold across the run. The "see everything flowing through the system" mode.

- **Tenants:** N `BasicTenant` (default 10).
- **Workload:** scripted intent stream covering every action in the registry (no adversarial behavior).
- **Required assertions:** FAB-CORR-001/002, FAB-CACHE-001/002, FAB-LOG-001/002, FAB-INGRESS-001, FAB-SURFACE-001, FAB-PROJECTION-001.
- **Output:** structured JSON report (every correlationId chain with its full causation trace) + human-readable summary. Default report path `./fabric-report.json`.
- **Run profile:** CI on every PR (Phase B+); on-demand via `pnpm fabric pump`.
- **Failure mode:** any FAB-CORR / FAB-CACHE / FAB-LOG / FAB-INGRESS / FAB-SURFACE / FAB-PROJECTION violation fails the run.

### Mode C — Load

Concurrent intent submission with rate ramps. Confirms quota / cache / projection behavior holds under sustained load.

- **Tenants:** N `BasicTenant` (default 100) + 1 `BurstTenant` (FAB-ISO-002 stressor).
- **Workload:** rate-ramp profile (`--rps 500 --ramp 30s --soak 5m`).
- **Required assertions:** all of Mode B's set + latency-SLO assertions (when SLOs are real, not the placeholders in `architecture.md` §"SLO Targets").
- **Run profile:** out-of-band. Not CI by default. Triggered manually or on schedule before Phase 1 sign-off.
- **Failure mode:** SLO breach, FAB-ISO-002 violation, or any other named assertion failure.

### Mode D — Chaos

Same intent stream as Mode B, with one or more dependencies failing or degraded. Asserts fail-closed behavior and degraded-mode invariants.

- **Tenants:** N `BasicTenant` (default 10) + 1 `OverQuotaTenant`.
- **Workload:** Mode B's intent stream + a `Fault` injected into the system. Faults available:
  - `quota-service-down` — `QuotaService.check` throws or hangs; asserts FAB-QUOTA-002 (fail-closed).
  - `event-store-slow` — `EventStore.append` latency injected; asserts projection lag is bounded.
  - `egress-blocked` *(Phase E)* — egress port refuses; tenant code cannot reach public internet.
  - `projection-worker-killed` — worker process terminated mid-run; asserts in-process dispatcher chain still serves reads.
  - `tenant-db-partitioned` — control plane to tenant DB connection severed; asserts ingress fail-closes for that tenant only.
- **Required assertions:** FAB-QUOTA-002 + FAB-CORR-001 (chains still terminate, even in failures) + FAB-LOG-001/002 (logs still structured during faults).
- **Run profile:** out-of-band. Manual or scheduled.
- **Failure mode:** any tenant continues past the failed dependency without fail-closing; any cross-tenant invariant violation during the fault window.

## 7. Capability-Spec Integration

Capability specs reference the fabric in two places.

### 7.1 Acceptance section

Capability authors list applicable `FAB-*` IDs. Example for `tenancy/quota-handoff`:

```markdown
## Acceptance

- **Handler test** — `modules/tenancy/test/signup-approve.test.ts` ▸ `emits Tenancy.TenantProvisioned with defaultQuotas`
- **Fabric assertions** (consumed when `packages/test-fabric/` Phase A lands):
  - **FAB-QUOTA-001** — over-budget tenant rejected before side effects
  - **FAB-QUOTA-002** — `QuotaService` unavailable → fail-closed
```

### 7.2 No fabric-only requirements

A capability cannot be acceptance-gated on fabric assertions alone — every capability must also have direct unit / handler / integration tests. The fabric is a backstop, not the only line of defense.

## 8. Phased Implementation

The spec contracts the entire fabric. Implementation lands phase-by-phase as separate slices owned by `sdet`.

| Phase | Deliverable | Gating? |
|---|---|---|
| **Phase A** | `packages/test-fabric/` package skeleton: `TenantFactory`, `IntentDriver` (Http + Sim impls), `AssertionHarness` core, FAB-ISO-001/002 + FAB-CORR-001/002 + FAB-CACHE-001/002 + FAB-AUTHZ-001 + FAB-IDEMPOTENT-001. **Mode A (Isolation) operational.** | Gates Phase 1 publication of any capability that depends on REQ-ISO-001 |
| **Phase B** | FAB-LOG-001/002 + FAB-SURFACE-001 + FAB-INGRESS-001 + FAB-QUOTA-001/002 + FAB-PROJECTION-001. **Mode B (Pump-and-watch) operational.** Pump-and-watch runs in CI. | Gates Phase 1 publication of any capability that depends on REQ-AGENT-001 |
| **Phase C** | Load runner CLI + rate-ramp config + latency-SLO assertions. **Mode C (Load) operational.** | Gates Phase 1 sign-off (real SLOs are a prerequisite for this phase) |
| **Phase D** | Chaos runner — fault-injection library, dependency kill-switches. **Mode D (Chaos) operational.** | Gates Phase 1 production-readiness |
| **Phase E (future)** | FAB-FUNCTIONS-001 + FAB-EGRESS-001 + FAB-SCHEMA-001 — Extensibility-platform-specific assertions. | Gates Phase 3–4 capabilities (`functions`, `custom-schema`) |

## 9. Tooling and CLI

The fabric ships as both a library (`packages/test-fabric/`) and a CLI exposed via `pnpm fabric <mode>`.

| Command | Mode | Default profile |
|---|---|---|
| `pnpm fabric isolate --tenants 5 --duration 60s` | A | Sim driver, CI-friendly |
| `pnpm fabric pump --tenants 10 --rps 50 --duration 5m --report=./fabric-report.json` | B | Sim driver, CI-friendly |
| `pnpm fabric load --tenants 100 --ramp 30s --rps 500 --soak 5m` | C | HTTP driver, out-of-band |
| `pnpm fabric chaos --tenants 10 --fault quota-service-down --duration 2m` | D | HTTP driver, out-of-band |

Every mode emits two artifacts:

- **`./fabric-report.json`** — structured machine-readable report (every assertion result, every correlationId chain, every fault injected). Stable schema for trend analysis.
- **`./fabric-summary.md`** — human-readable summary keyed by FAB-* ID.

CI integration (Phase A onward): every PR runs `pnpm fabric isolate` and (Phase B+) `pnpm fabric pump`. Modes C and D are scheduled or manual.

The CLI follows `crosscut/atlasctl.md` conventions for structured output, `correlationId` display, and error reporting.

## 10. Cross-References

- [`specs/architecture.md`](../architecture.md) — Invariants I1–I18 (the fabric is the test layer for them) + the "Tenant Runtime Isolation" section
- [`specs/normative_requirements.md`](../normative_requirements.md) — REQ-SIGNUP-001/002, REQ-ISO-001, REQ-QUOTA-001, REQ-AGENT-001, REQ-INGRESS-002
- [`specs/decisions/0004-platform-invariants-for-multi-tenant-fabric.md`](../decisions/0004-platform-invariants-for-multi-tenant-fabric.md) — source of the new invariants
- [`specs/crosscut/logging.md`](logging.md) — the contract whose assertions FAB-LOG-* check
- [`specs/crosscut/atlasctl.md`](atlasctl.md) — CLI conventions the fabric mirrors (structured output, correlationId display, error reporting)
- [`specs/crosscut/errors.md`](errors.md) — error vocabulary the fabric reports against
- [`specs/frontend/surface-introspection.md`](../frontend/surface-introspection.md) — the contract FAB-SURFACE-001 enforces
- [`specs/domains/tenancy/capabilities/quota-handoff/README.md`](../domains/tenancy/capabilities/quota-handoff/README.md) — the capability FAB-QUOTA-* consumes
- [`packages/contract-tests/`](../../packages/contract-tests/) — sibling test infrastructure; explicitly not replaced
- [`tests/parity/`](../../tests/parity/), [`tests/integration/`](../../tests/integration/), [`tests/bdd/`](../../tests/bdd/) — sibling harnesses
- [`packages/logging/src/sinks/`](../../packages/logging/src/sinks/) — `MemoryRingBufferSink` is a primary read surface for fabric assertions

## 11. Open Questions

To defer to the implementation phase:

- **Default boot mode in CI** — likely Sim for speed, HTTP for pre-merge confidence, but this is per-mode and worth measuring before fixing.
- **Chaos fault injection into out-of-process `apps/server`** — test-only env vars? a control endpoint gated by `TEST_AUTH_ENABLED`? process-kill via the test runner? Likely mode-dependent (env vars for fault toggling, process-kill for "worker dies" scenarios).
- **Persistence of fabric reports** — CI artifacts only, or a structured archive for trend analysis (latency drift, assertion-failure history)?
- **Whether the fabric should drive `atlasctl`** — the FAB-INGRESS-001 parity assertion implies yes, but only when atlasctl Phase B exists. Until then, FAB-INGRESS-001 covers HTTP API + action-registry diff only.
- **Specific load-SLO targets** — Phase C is gated on real SLOs replacing the placeholders in `architecture.md` §"SLO Targets". Until then, Phase C lands without latency assertions.
- **`FAB-FUNCTIONS-001` adversarial-payload corpus** — lives in this spec or in a sibling `crosscut/sandbox-corpus.md`? Decide when scoping the `extensibility/functions/function-runtime` capability.
- **Multi-instance fabric runs** — does Mode C ever run against more than one Atlas instance (e.g., to test cross-region behavior, long-deferred per `vision.md` §"What Atlas is not")? Phase C decision.
