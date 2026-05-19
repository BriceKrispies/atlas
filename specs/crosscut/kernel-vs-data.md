# Atlas Kernel vs Data — Architectural Inventory

Atlas is structured around a small, trusted **kernel** and a large, hot-changeable **data plane**. This spec is the architectural inventory: it names what each repo surface IS — kernel or data — and gives the decision rule that keeps the kernel small.

## §1 Preamble and relationship to other docs

This document is one of three that together describe Atlas-as-runtime. Each has a single job:

- **[`crosscut/atlas-runtime.md`](atlas-runtime.md)** — the concept paper. Why Atlas is a governed application runtime; what a tenant program is; how the kernel executes it.
- **[`crosscut/always-on.md`](always-on.md)** — the operational hot-reload contract. Names the kernel/data split as a *restart-required vs hot-changeable* dichotomy, defines the `HotReloadable<T>` lifecycle, the request-boundary atomicity rule, the adapter-swap protocol, and the operator surface for reloads.
- **This document** — the architectural inventory. Names what each repo surface IS without restating the hot-reload mechanics. Cross-refs `always-on.md` for the operator contract and [ADR 0008](../decisions/0008-atlas-on-atlas.md) for the recursive-kernel principle that produced the split in the first place.

These three are deliberately non-overlapping. If you are looking for "how do I reload a module," see `always-on.md` §4–§5. If you are looking for "why is the kernel/data split a thing at all," see [ADR 0008 §2](../decisions/0008-atlas-on-atlas.md). If you are looking for "is this new behavior I am adding kernel or data," you are in the right place — read on.

The split exists because Atlas is the recursive kernel described in [ADR 0008](../decisions/0008-atlas-on-atlas.md): Atlas's own admin / identity / authz / audit operations run through the same primitives any tenant uses, so the irreducible-code surface must stay small enough to trust uniformly. Everything that *can* be data *is* data; the kernel is what is left.

---

## §2 The kernel (trusted, restart-required)

The kernel is the set of repo surfaces whose change requires a process restart. The list is small by design — each entry justifies its presence by participating in a structural invariant whose substitution mid-request would violate I1, I2, I3, or I12.

- **[`packages/ingress/`](../../packages/ingress/)** — the fetch-decode-execute loop. `submit-intent.ts` runs the strict order authn → tenant → schema → idempotency → authz → quota → handler dispatch → event append → dispatcher chain. The pipeline shape is a structural invariant (I1, I2, I3, I13); reordering or removing a step is a security regression, not a configuration change. `evaluate-read.ts` is the read-path counterpart, gating cache + projection access through the same tenant/principal resolution. `fetch-interceptor.ts` is the kernel's hook into the runtime's outbound boundary. Together these files are the runtime's instruction-decode logic; the rest of Atlas is the data they operate on.

- **[`packages/platform-core/`](../../packages/platform-core/)** — the types every program speaks. `EventEnvelope`, `IntentEnvelope`, `Principal`, `LogEvent`, `ExecutionContext`, `CacheKey`, the error taxonomy, the `Logger` interface, the `Upcaster` chain, the `ControlPlaneDb` handle. These are the runtime's word size and instruction format. A shape change ripples through every consumer at compile time; tenant programs and platform code alike depend on these shapes holding still within a runtime version. Adding a field is generally additive; renaming or removing a field is a runtime-version event. The principal cache and platform-tenant lookup helpers also live here because they are kernel-wide invariants (one principal per request, one well-known platform tenant) rather than per-module concerns.

- **[`ports/`](../../ports/)** — the runtime's port surface. `EventStore`, `Cache`, `PolicyEngine`, `EntityTypeRegistry`, `Mailer`, `AuditEmitter`, `CryptoPort`, `SecretStore`, `ProjectionStore`, `SearchEngine`, `RelationStore`, `EntityStore`, `Dispatcher`, `HandlerRegistry`, `ControlPlaneRegistry`, `WorkerSource`, `WasmHost`, and the rest are the kernel's defined interfaces to the outside world. Adding a port is additive (no consumer recompiles); changing a port surface forces every adapter and every consumer to recompile. Per [`always-on.md` §8](always-on.md), port-surface hot-reload is explicitly out of scope — TypeScript is statically typed and a port-surface change is a runtime-version event by construction. The set of ports is the kernel's vocabulary for "what kinds of substrate the runtime can talk to."

- **[`apps/server/`](../../apps/server/)** — the HTTP listener and Hono routing layer. This is the implementation of the I1 chokepoint: the only HTTP boundary in Atlas. `main.ts` boots the Node listener; `bootstrap.ts` wires adapters to ports; `middleware/state.ts` composes the dispatcher chain; `bootstrap-platform-admin.ts` seeds the well-known `_platform` tenant on startup per [ADR 0008](../decisions/0008-atlas-on-atlas.md). The listener bootstrap is socket-level coordination outside the hot-reload contract; the routing layer's structural shape is I1. The composition wiring is kernel today but `always-on.md` §6 stages the move to a runtime-mutable dispatcher registry — the *position* of the dispatcher chain stays kernel; the *contents* become data.

- **[`apps/projection-worker/`](../../apps/projection-worker/)** — the projection rebuild loop. Same instruction set as `apps/server` (it consumes the same `EventEnvelope` shapes against the same dispatcher chain), different driver: a single deterministic rebuilder per cursor (I12). `tenant-loop.ts` mirrors the dispatcher composition from `apps/server/src/middleware/state.ts` — the always-on contract names this mirror as load-bearing for I12, and the Atlas-on-Atlas Stage 5 work extracts the shared logic into `packages/dispatch-chain` to remove the duplication risk. `leader.ts` ensures exactly one process owns the rebuild cursor; `diff.ts` computes the per-event projection delta. The loop's transactional shape against the event cursor is what makes "rebuild from events alone" a guarantee rather than a hope.

- **The event-store append path** — implemented inside the `EventStore` port's node adapter. The durability boundary itself; substituting it mid-write risks an event written without being durable or read after being unwritten. Treated as kernel even though the adapter implementation lives under `adapters/node/` because the append's atomicity is what I12 rests on. The port surface (which lives in `ports/`, the kernel-proper) declares the contract; the adapter implements it; both halves are restart-required, but for different reasons — the port because it is the contract, the adapter because the durability guarantees depend on the specific implementation Atlas trusts at boot.

**What this implies: these surfaces change only by code edit + restart. The set is small by design — kernel code remains small, trusted, and restart-required.**

---

## §3 The data plane (hot-changeable runtime data)

The data plane is everything else. Categorized below by domain — *what kind of program element it is* — not by hot-reload phase. For the operational mechanics of *how* each is reloaded, see [`always-on.md` §3](always-on.md).

### §3.1 Tenant schemas

Per-tenant entity types and DDL — the `CustomSchema` instances tenants author to express their Salesforce-shaped data model. Each tenant gets a Postgres schema (`atlas_t_<tenantUuid>` per [ADR 0005](../decisions/0005-custom-schema-storage-strategy.md)); schema mutations route through the constrained DDL allowlist enforced by I16 (`CREATE TABLE`, `ADD COLUMN`, `CREATE INDEX`, safe `ALTER COLUMN`, `DROP COLUMN`, `DROP TABLE`; nothing else). The kernel-side surface is the `EntityTypeRegistry` port ([`ports/src/entity-type-registry.ts`](../../ports/src/entity-type-registry.ts)); the runtime data is the tenant's accumulated type declarations. Tenant schemas can change between any two requests; the kernel sees the new schema on the next read because the registry is queried per request, not captured at boot.

### §3.2 Policy bundles

Cedar policy bundles, one per tenant. Loaded via [`adapters/policy-cedar/src/bundle-loader.ts`](../../adapters/policy-cedar/src/bundle-loader.ts) (`PostgresBundleLoader`) and reloaded on bundle version bump. Authorization (I2) is data: the same kernel evaluates whatever bundle the tenant has authored, with the engine itself a kernel choice (see §5). A policy change takes effect on the next request — no restart, no deploy. This is the single biggest argument for the kernel/data split: security posture is the most-frequently-changed surface in the platform, and the runtime must accommodate it without ceremony.

### §3.3 Workflow definitions

Tenant-authored workflow graphs under the Workflow platform (`workflow/triggers`, `workflow/jobs`, `workflow/function-runner`, `workflow/scheduling`). Partly stub today — most Workflow domains are net-new per the domain map and capability specs land as Phase 1+ work begins. The shape is settled: workflow definitions are data; the workflow engine that executes them is kernel. When a tenant publishes a new version of a workflow, the next trigger fires the new graph; in-flight instances of the old version run to completion against the version they started under (mirror of the request-boundary atomicity rule in [`always-on.md` §4.2](always-on.md)).

### §3.4 Surface manifests

`AtlasSurface` manifests served from the `/api/v1/surfaces` registry. Per I18, every surface exposes its state machine-readably (`getSurfaceSnapshot(): { surfaceId, state, schemaRef?, data, actions[] }`); the registry is the catalog an agent enumerates without driving the UI. Surface registration is currently `customElements.define` at app boot — [`always-on.md` §3](always-on.md) tracks "achievably hot" via version-suffixed tag names or shadow registry. The data is the manifest; the introspection contract is kernel because the agentic-first tenet rests on every surface having a known, authz-gated readout shape.

### §3.5 Function bundles

Tenant-authored functions (`TenantFunction` per [`specs/LEXICON.md`](../LEXICON.md); substrate per [ADR 0006](../decisions/0006-function-runtime-substrate.md)). Loaded on invocation by the `FunctionRuntime` adapter — **port to-be-created** under `ports/src/function-runtime.ts`. Per I14, function bundles never execute in `apps/server`; the runtime adapter runs out-of-process (gVisor-backed k8s Jobs in the MVP, V8 isolates / Firecracker as future adapters behind the same port). Function code is the most-untrusted data in the system — the boundary is the strongest of any data category, structural rather than policy.

### §3.6 Quota plans

Per-tenant `Quota` assignments and limits (per [`specs/LEXICON.md`](../LEXICON.md)). Stored as the `defaultQuotas` payload field on tenant provisioning events; runtime-evaluated by the `QuotaService` (per the lexicon, port and concrete service still settling alongside `commerce/quotas`). The `commerce/plans` capability scope owns the durable plan catalog; provisioning copies the plan's `defaultQuotas` snapshot into the tenant's quota state. I13 enforces quota check at ingress — the *check* is kernel pipeline; the *limits* are data, which is why an operator can revise a plan or grant an emergency increase without code change.

### §3.7 Deployment specs

Tenant-declared service deployments per the Compute platform (`compute/cluster`, `compute/runtime`, `compute/image-build`, `compute/ingress`, `compute/dns`). Declarative — desired-state documents the kernel reconciles against k3s / Hetzner / Caddy adapters. Largely scoped; provisioning ports are **to-be-created** as each Compute domain's first capability lands (Phase 1 of the project plan starts with `compute/cluster`, `compute/image-build`, and `code/repository`). The strategy is to wrap existing tools as adapters — Atlas's value-add is the multi-tenant glue around them, not a reimplementation.

### §3.8 Log levels

Global / module / tenant / correlation log-level overrides. Mutated at runtime via the `LevelController` ([`crosscut/logging.md` §"Level overrides"](logging.md)). Diagnostic posture is data — every operator has flipped a log level mid-incident, and forcing that to be a deploy would be hostile. The structured-logging contract itself is kernel (every log line carries `tenantId`, `correlationId`, `principalId`, `moduleId`, `actionId`; the JSON envelope shape is non-negotiable per [`crosscut/logging.md`](logging.md)).

### §3.9 Custom-domain → tenant mapping

Per-tenant custom-domain claims, resolved on every request before authn. Cached in `customDomainCache` ([`apps/server/src/middleware/state.ts`](../../apps/server/src/middleware/state.ts)); invalidated by tenancy events via tag-based cache invalidation (I9, I10). The mapping is data; the cache contract (`Tenant:${tenantId}` tag presence per I10) is kernel. This is the only data category whose change must propagate to *every* replica synchronously — a tenant can't have requests routing to the wrong tenant scope even briefly, so the invalidation is event-driven and load-bearing for tenant isolation.

---

## §4 The "could this be data?" decision rule

Before reaching for a kernel code change, ask three questions in order:

1. **Could this be expressed as a tenant declaration?** Often yes for validation, routing, formatting, simple computation — bounded by [ADR 0007 §2](../decisions/0007-dsl-substrate-and-authoring-contract.md) (non-Turing-complete, pure, no ambient I/O, deterministic, bounded). Tenant declarations are evaluated in-process per request by the DSL substrate. A tenant adding a new validation rule does not need a deploy; the rule is data.

2. **Could this be expressed as a typed configuration loaded from the control plane?** Often yes for policies, limits, feature flags, plan definitions, retention policies, surface routing. The control plane stores it; the kernel reads it through a port; a version bump triggers reload per [`always-on.md` §3](always-on.md). The kernel sees the new value on the next request; in-flight requests run against the version they started under.

3. **Could the unsafe or hot-path part be extracted behind a port + adapter?** Often yes for I/O, external services, sandboxed execution, new substrate. The port surface stays minimal (kernel); the adapter implementation is swappable per [`always-on.md` §4.4](always-on.md). This is the answer when the *capability* is a kernel concern but the *implementation* should not bind the kernel to a specific technology.

Only after all three are no does a kernel code change become the answer. The audit trail at every architect-gate review should show the rule was asked; a proposal that reaches kernel-change status without arguing past §4.1–§4.3 is sent back for re-scoping.

---

## §5 When a kernel change IS the answer

The decision rule above will fail to find a data answer in legitimate cases. The carve-outs:

- **Structural invariants.** The pipeline order in [`packages/ingress/src/submit-intent.ts`](../../packages/ingress/src/submit-intent.ts) — authn → tenant → schema → idempotency → authz → quota → dispatch. Reordering is a security regression; the order *is* I1, I2, I3, I13 expressed in code. Making the order configurable would mean shipping a knob whose only valid setting is the current one — a knob is an attack surface.

- **Durability boundaries.** The event-store append path. The atomicity of the write is what I12 rests on; substituting it mid-write breaks the rebuildable-projections guarantee for every tenant. Even though the *implementation* is an adapter (and can be swapped under [`always-on.md` §4.4](always-on.md) with the drain-and-replace protocol), the *position* of the append in the pipeline and its transactional shape are kernel.

- **Runtime substrate.** Port surface definitions in [`ports/`](../../ports/). Adding a port is additive and counts as data-shaped change (no recompile of existing consumers); changing a port surface is a runtime-version event because every adapter and every module recompiles. The set of ports is the closed vocabulary the kernel uses to describe the outside world; adding a verb is cheap, redefining a verb is expensive.

- **Security primitives.** Cedar engine selection at boot. The kernel chooses *which* policy engine (`PolicyEngine` port adapter); tenants supply the policies the engine evaluates. The engine identity is kernel because mid-request substitution can violate I4 (deny-overrides-allow). Crypto primitive selection (`CryptoPort`) is similarly kernel: the algorithm is bootstrap-time; the key material is data.

These categories exist because not everything becomes data; these are deliberate kernel. A capability proposal that argues a structural invariant should be configurable is rejected at the architect gate — the invariant is the point. The kernel is small not because we ran out of ideas, but because every entry on the kernel list is a place where mid-request change would break a guarantee the rest of the platform makes.

---

## §6 The hexagonal escape valve

When the decision rule produces a kernel answer but the *implementation* of the new behavior is unsafe or hot-path-sensitive, the hexagon admits the new substrate without weakening the invariants: unsafe or hot-path behavior can be extracted behind ports/adapters.

Two mechanics, both already defined elsewhere:

- **Adapter swap is well-defined.** Per [`always-on.md` §4.4](always-on.md), an adapter swap drains in-flight ops on the old adapter, verifies the new adapter satisfies the port, atomically swaps, and audits the change. The kernel sees the port; the substrate behind it changes without restart. A `Mailer` swap from SMTP to a transactional-mail API, a `PolicyEngine` swap from one Cedar build to another, a `WasmHost` swap to a newer runtime — all go through the same protocol with the same guarantees.

- **Adding a port is additive.** A new port (e.g., `FunctionRuntime`, the Compute provisioning ports, a future `QuotaService` port, the Egress port that I15 will require) compiles against existing consumers without forcing recompiles. The kernel surface grows; existing kernel surfaces are unchanged. This is why new capability scopes that need new substrate can land without a coordinated rebuild of the whole platform.

The strongest form of this escape valve is I14: **tenant code never runs in apps/server**. Tenant-authored functions go through the `FunctionRuntime` port whose adapter runs out-of-process (gVisor-backed k8s Jobs per [ADR 0006](../decisions/0006-function-runtime-substrate.md)). The kernel never imports tenant code, never `eval`s tenant code, never spawns tenant code as a child of the server process. The boundary is structural, not policy — there is no flag that turns it off, no debug mode that loosens it. Tenant code is the most-untrusted data in the system; the port is the way the kernel admits it without becoming responsible for it.

This is why the kernel can stay small: every new substrate (a new event store, a new mailer, a new function runner, a new policy engine, a new search index, a new secret store) is a port-and-adapter, not a kernel edit. The hexagon is the mechanism that lets the runtime grow without the trust surface growing with it. Atlas's bet is that the closed set of ports is small enough to audit and stable enough to trust, even as the open set of adapters and the open set of tenant programs grow indefinitely.

---

## §7 Invariants preserved

The kernel/data split exists to enforce these invariants; every one stands across both planes.

- **I1 — Single Ingress Enforcement** (see [architecture.md §I1](../architecture.md)). Lives in `packages/ingress` (kernel); no data-plane reload can expose a side-door endpoint.
- **I2 — Authorization Precedes Execution** (see [architecture.md §I2](../architecture.md)). Pipeline step in `packages/ingress` (kernel); evaluated against policy bundles (§3.2 data).
- **I3 — Idempotency Before Execution** (see [architecture.md §I3](../architecture.md)). Pipeline step in `packages/ingress` (kernel); idempotency-key store is per-tenant data.
- **I4 — Deny-Overrides-Allow Authorization** (see [architecture.md §I4](../architecture.md)). Cedar engine choice is kernel (§5); policy bundles are data (§3.2).
- **I5 — Correlation Propagation** (see [architecture.md §I5](../architecture.md)). `ExecutionContext` shape is kernel (`packages/platform-core`); propagation happens in every kernel pipeline step.
- **I6 — Causation Linkage** (see [architecture.md §I6](../architecture.md)). `EventEnvelope` shape is kernel (`packages/platform-core`); causation chains are data emitted by handlers.
- **I7 — Tenant Isolation in Search** (see [architecture.md §I7](../architecture.md)). `SearchEngine` port is kernel (`ports/`); search indexes are tenant data.
- **I8 — Permission-Filtered Search** (see [architecture.md §I8](../architecture.md)). Filter logic lives in module handlers (kernel-trusted code); `permissionAttributes` are document data.
- **I9 — Cache Keys Include TenantId** (see [architecture.md §I9](../architecture.md)). `Cache` port + `CacheKey` shape are kernel; cache contents are per-tenant data.
- **I10 — Event-Driven Cache Invalidation** (see [architecture.md §I10](../architecture.md)). Tag-based invalidation is a kernel contract (`Tenant:${tenantId}` tag); events that fire it are data emitted by handlers.
- **I11 — Deterministic Time Bucketing** (see [architecture.md §I11](../architecture.md)). Bucket math is kernel (analytics handler code); bucket boundaries are derived per query.
- **I12 — Projections Are Rebuildable** (see [architecture.md §I12](../architecture.md)). Rebuild loop in `apps/projection-worker` is kernel; projection state is rebuildable data.
- **I13 — Quota Enforcement Precedes Execution** (see [architecture.md §I13](../architecture.md)). Quota check is a kernel pipeline step in `packages/ingress`; quota plans (§3.6) are data.
- **I14 — Tenant Code Isolation** (see [architecture.md §I14](../architecture.md)). `FunctionRuntime` port is kernel (to-be-created); function bundles (§3.5) are data. Tenant code never executes in `apps/server`.
- **I15 — Egress Mediation** (see [architecture.md §I15](../architecture.md)). Egress port is kernel (to-be-created); per-tenant allowlists / denylists are data.
- **I16 — Schema-Mutation Scope** (see [architecture.md §I16](../architecture.md)). DDL allowlist is kernel; tenant schemas (§3.1) are data.
- **I17 — API / CLI / UI Parity** (see [architecture.md §I17](../architecture.md)). Action registry is kernel (`controlPlaneRegistry`); registered actions are data populated at boot and (per `always-on.md`) at reload.
- **I18 — Surface State Machine-Readability** (see [architecture.md §I18](../architecture.md)). Introspection contract is kernel (`getSurfaceSnapshot`); surface manifests (§3.4) are data served from `/api/v1/surfaces`.
