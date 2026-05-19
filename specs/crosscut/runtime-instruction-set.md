# Atlas Runtime Instruction Set

## Preamble

Atlas is a governed application runtime. Tenant programs and platform code alike issue a closed set of ten **instructions** against the runtime; the kernel implements the dispatch and enforces invariants I1–I18 on every instruction. The set below is the runtime's complete public surface — every effect a tenant or a platform module can ask the runtime to perform reduces to one of these ten verbs. New instructions require an ADR ([§ Adding an instruction](#adding-an-instruction)); adding to the instruction set is a runtime-level change, not a capability-level change.

The instructions are read alongside [`LEXICON.md`](../LEXICON.md) §"Canonical Pipelines" (PIPE-CMD-001, PIPE-QRY-001, PIPE-PROJ-001), which orders the kernel's enforcement steps, and [`architecture.md`](../architecture.md), which defines the invariants those steps enforce. The split between this spec and the lexicon is intentional: the lexicon names *what verbs may occur*; this spec names *what instructions the runtime accepts*. The two converge — every instruction reduces to lexicon verbs; every lexicon verb appears inside some instruction.

---

## Instruction reference

### submitIntent

The primary write-path instruction. A program (tenant UI, `atlasctl`, agent, internal scheduler) submits an `IntentEnvelope`; the kernel runs PIPE-CMD-001 — `resolveTenant` → `authenticate` → `validate` → `authorize` → `enforceQuota` → `checkIdempotency` → `dispatchAction` — and the handler emits zero or more events via [`emitEvent`](#emitevent).

| | |
|---|---|
| **Inputs** | `IntentEnvelope` (`actionId`, `payload`, `correlationId`, `idempotencyKey`, `tenantId`, `principalId`) |
| **Outputs** | `IntentResponse` (`eventId`, `tenantId`, `principalId`) on accept; typed `IngressError` on reject |
| **Required invariants** | I1 (single ingress), I2 (authz before execution), I3 (idempotency before dispatch), I5 (correlation propagation), I9 (cache keys tenant-scoped), I13 (quota before dispatch), I17 (API / CLI / UI parity) |
| **Category** | kernel + adapter-backed |
| **Code anchor** | [`packages/ingress/src/submit-intent.ts`](../../packages/ingress/src/submit-intent.ts) `submitIntent` (function declaration at line 99); HTTP boundary [`apps/server/src/routes/intents.ts`](../../apps/server/src/routes/intents.ts) |
| **Spec anchor** | [`architecture.md`](../architecture.md) §"P1: Single Ingress Chokepoint" + §"I1: Single Ingress Enforcement"; [`LEXICON.md`](../LEXICON.md) §"PIPE-CMD-001: Command Pipeline" |

---

### emitEvent

The durability instruction. A handler (or the generic fall-through in `submitIntent`) emits a domain event by appending to the `EventStore`. The append is the system-of-record write; every projection, cache invalidation, audit record, and downstream dispatch reads from this append. Idempotency, correlation, and causation fields on the envelope are non-optional.

| | |
|---|---|
| **Inputs** | `EventEnvelope` (`eventType`, `payload`, `tenantId`, `correlationId`, `causationId?`, `idempotencyKey`, `cacheInvalidationTags?`) |
| **Outputs** | `StoredEvent` (`EventEnvelope & { seq: bigint }`); rejected on duplicate `(tenantId, idempotencyKey)` |
| **Required invariants** | I5 (correlation), I6 (causation), I9 (tenant-scoped envelope), I10 (event-driven cache invalidation; envelope carries `cacheInvalidationTags`), I12 (projections rebuildable from event history) |
| **Category** | kernel |
| **Code anchor** | [`ports/src/event-store.ts`](../../ports/src/event-store.ts) `EventStore.append` (line 21); adapter implementations in [`adapters/node/src/event-store.ts`](../../adapters/node/src/event-store.ts) and [`adapters/idb/src/`](../../adapters/idb/src/) |
| **Spec anchor** | [`architecture.md`](../architecture.md) §"P3: Event-Sourced Writes" + §"Event Model"; [`crosscut/events.md`](events.md) (event vocabulary) |

---

### projectEvent

The derived-state instruction. After an event is appended, the dispatcher chain runs — each module's per-tenant `EventDispatcher` factory consumes the envelope, updates its projections, invalidates its cache tags, and fires its downstream side effects. The same chain runs **inline** in `apps/server` (request-time) and **out-of-band** in `apps/projection-worker` (deferred); both compositions are deliberately mirrored.

| | |
|---|---|
| **Inputs** | `EventEnvelope` (already appended; `seq` populated) |
| **Outputs** | side effects: `ProjectionStore` writes, `Cache.invalidateByTags`, server-event broadcast, audit follow-up events |
| **Required invariants** | I10 (cache invalidation is event-driven, not TTL), I12 (projections rebuildable from event history) |
| **Category** | kernel + adapter-backed |
| **Code anchor** | Per-module factories at [`modules/catalog/src/dispatch.ts`](../../modules/catalog/src/dispatch.ts), [`modules/content-pages/src/dispatch.ts`](../../modules/content-pages/src/dispatch.ts), [`modules/identity/src/dispatch.ts`](../../modules/identity/src/dispatch.ts), [`modules/repository/src/dispatch.ts`](../../modules/repository/src/dispatch.ts); composer `composeDispatchers` in [`ports/src/dispatcher.ts`](../../ports/src/dispatcher.ts) (line 96); inline composition in [`apps/server/src/middleware/state.ts`](../../apps/server/src/middleware/state.ts) (`inlineDispatch` near line 334); deferred composition in [`apps/projection-worker/src/tenant-loop.ts`](../../apps/projection-worker/src/tenant-loop.ts) (`buildDispatcherChain` near line 341) |
| **Spec anchor** | [`architecture.md`](../architecture.md) §"P4: Reads from Projections" + §"I12: Projections Are Rebuildable"; [`LEXICON.md`](../LEXICON.md) §"PIPE-PROJ-001: Projection Pipeline" |

---

### materializeQuery

The read-path instruction. A program asks the runtime for a value: a single projection key, a list, a search hit set, an entity row. The kernel runs PIPE-QRY-001 — `resolveTenant` → `authenticate` → `authorize` → `cacheGet` → on-miss `materialize` → `cacheSet`. Reads never touch write models directly; only projections, the entity store, or the search index.

| | |
|---|---|
| **Inputs** | query descriptor (action / artifact name + parameters); per-request `IngressState` |
| **Outputs** | tenant-scoped result payload (projection row, search hits, entity row); or typed not-found |
| **Required invariants** | I7 (tenant isolation in search), I9 (cache keys include tenantId), I10 (cache invalidation is event-driven) |
| **Category** | kernel + adapter-backed |
| **Code anchor** | Per-module query modules at [`modules/identity/src/queries.ts`](../../modules/identity/src/queries.ts), [`modules/content-pages/src/queries.ts`](../../modules/content-pages/src/queries.ts); [`ports/src/projection-store.ts`](../../ports/src/projection-store.ts) `ProjectionStore.get` (line 2); [`ports/src/cache.ts`](../../ports/src/cache.ts) `Cache.get` (line 4) |
| **Spec anchor** | [`architecture.md`](../architecture.md) §"P4: Reads from Projections" + §"P5: Cache-First Design"; [`LEXICON.md`](../LEXICON.md) §"PIPE-QRY-001: Query Pipeline" |

---

### evaluatePolicy

The authorization instruction. Given a `(principal, action, resource, context)` request, the kernel asks the `PolicyEngine` for a `permit` / `deny` decision. Deny-overrides-allow combination lives inside the adapter; the kernel sees one decision plus reasons and matched-policy ids for traceability. Issued from `submitIntent` (mandatory, pre-dispatch) and from any read path that needs row-level authz.

| | |
|---|---|
| **Inputs** | `PolicyEvaluationRequest` (`principal`, `action`, `resource`, `context?`) |
| **Outputs** | `PolicyDecision` (`effect: 'permit' \| 'deny'`, `reasons?`, `matchedPolicies?`) |
| **Required invariants** | I2 (authorization precedes execution), I4 (deny-overrides-allow) |
| **Category** | kernel + adapter-backed |
| **Code anchor** | [`ports/src/policy-engine.ts`](../../ports/src/policy-engine.ts) `PolicyEngine.evaluate` (line 43); Cedar adapter at [`adapters/policy-cedar/src/cedar-policy-engine.ts`](../../adapters/policy-cedar/src/cedar-policy-engine.ts); stub at [`adapters/policy-stub/`](../../adapters/policy-stub/) |
| **Spec anchor** | [`architecture.md`](../architecture.md) §"P2: Policy-First Authorization" + §"I2" + §"I4"; [`LEXICON.md`](../LEXICON.md) verb `authorize` |

---

### checkQuota

The budget instruction. Between `authorize` and `checkIdempotency` in PIPE-CMD-001, the kernel asks the `QuotaService` to atomically decrement the named per-tenant budget; if over-budget, the request short-circuits with `QUOTA_EXCEEDED` before any side effect runs. Atomic decrement-or-reject — no TOCTOU window between check and consume; fail-closed when the service is unreachable (`QUOTA_SERVICE_UNAVAILABLE`).

| | |
|---|---|
| **Inputs** | `QuotaCheckRequest` (`tenantId`, `dimension`, `delta`, `correlationId`) |
| **Outputs** | `QuotaCheckResult` (`allowed`, `remainingBudget?`, `reason?`) |
| **Required invariants** | I13 (quota enforcement precedes execution) |
| **Category** | kernel + adapter-backed |
| **Code anchor** | port `QuotaService` — to-be-created at `ports/src/quota-service.ts` (Commerce-platform scope); lexicon entries `QuotaService` / `QuotaCheckRequest` / `QuotaCheckResult` in [`LEXICON.md`](../LEXICON.md) §"Multi-Tenant Fabric Nouns"; pipeline step 5 in [`LEXICON.md`](../LEXICON.md) §"PIPE-CMD-001" |
| **Spec anchor** | [`architecture.md`](../architecture.md) §"I13: Quota Enforcement Precedes Execution"; [`decisions/0004-platform-invariants-for-multi-tenant-fabric.md`](../decisions/0004-platform-invariants-for-multi-tenant-fabric.md) (REQ-QUOTA-001) |

---

### runFunction

The tenant-code instruction. A trigger (HTTP route function, schema-lifecycle hook, scheduled job, workflow step) asks the kernel to invoke a `TenantFunction`. Tenant code never executes in `apps/server`; the `FunctionRuntime` adapter runs it out-of-process, in a namespace-isolated, gVisor-confined pod (MVP per [ADR 0006](../decisions/0006-function-runtime-substrate.md)), with mediated egress through the egress port.

| | |
|---|---|
| **Inputs** | `(tenantId, functionId, version?, invocationPayload, ctx: { fetch, logger, kv, ... })` |
| **Outputs** | function return value or typed error (timeout, OOM, quota-exceeded, runtime fault) |
| **Required invariants** | I14 (tenant code isolation), I15 (egress mediation) |
| **Category** | adapter-backed (tenant code) |
| **Code anchor** | port `FunctionRuntime` — to-be-created (ADR 0006); lexicon entry `TenantFunction` in [`LEXICON.md`](../LEXICON.md) §"Multi-Tenant Fabric Nouns"; isolation contract in [`architecture.md`](../architecture.md) §"Tenant Runtime Isolation" §"Tenant code never executes in `apps/server`" |
| **Spec anchor** | [`decisions/0006-function-runtime-substrate.md`](../decisions/0006-function-runtime-substrate.md); [`architecture.md`](../architecture.md) §"I14: Tenant Code Isolation" + §"I15: Egress Mediation" |

---

### mutateSchema

The tenant-declaration instruction for the data model. A tenant declares an `ObjectType`, a `Field`, or a `Relation` against its own `CustomSchema`; the kernel translates the declaration into a constrained DDL set and applies it to the tenant's per-tenant Postgres schema (`atlas_t_<tenantId>`). Tenants do not issue raw SQL; the allowlist is mechanically enforced. Schema state is rebuildable from the tenant's event store — I12 holds for tenant-defined schemas too.

| | |
|---|---|
| **Inputs** | `ObjectType` / `Field` / `Relation` declaration (via `submitIntent` with a schema-mutation action) |
| **Outputs** | domain event (`CustomSchema.ObjectType.Defined`, etc.); DDL applied to tenant schema; registry updated |
| **Required invariants** | I12 (rebuildable from events), I16 (schema-mutation scope: own tenant, allowlist DDL) |
| **Category** | kernel + adapter-backed (tenant declaration) |
| **Code anchor** | [`ports/src/entity-type-registry.ts`](../../ports/src/entity-type-registry.ts) `EntityTypeRegistry` (read side; line 28); writes via dedicated operator surfaces — declaration spec under [`specs/domains/custom-schema/`](../domains/custom-schema/); migration applier port to-be-created (per [ADR 0005](../decisions/0005-custom-schema-storage-strategy.md)) |
| **Spec anchor** | [`decisions/0005-custom-schema-storage-strategy.md`](../decisions/0005-custom-schema-storage-strategy.md); [`architecture.md`](../architecture.md) §"I16: Schema-Mutation Scope"; lexicon entries `CustomSchema` / `ObjectType` / `Field` / `Relation` in [`LEXICON.md`](../LEXICON.md) §"Multi-Tenant Fabric Nouns" |

---

### provisionService

The deployment instruction. A tenant asks the runtime to bring up a service from a source revision: pull bytes, build an image, push to the registry, schedule into the tenant's namespace, bind DNS + ingress, attach storage / secrets. The flow composes the Compute platform domains (`cluster`, `runtime`, `image-build`, `ingress`, `dns`) and the Storage / Code platforms. Every step is authz-gated, quota-charged, and audited with the same `correlationId`.

| | |
|---|---|
| **Inputs** | service descriptor (source `Revision` ref, runtime config, env, secrets, resource limits) |
| **Outputs** | deployment events (`Compute.ImageBuilt`, `Compute.ServiceScheduled`, `Compute.IngressBound`, ...); URL / endpoint reachable |
| **Required invariants** | I2 (authz precedes execution at every step), I13 (quota enforced — `cpu-seconds`, `storage-bytes`, `egress-bytes`), I17 (API / CLI / UI parity — `atlasctl deploy` mirrors HTTP) |
| **Category** | kernel + adapter-backed |
| **Code anchor** | Compute / Storage / Code platform ports — to-be-created (ADR 0011); Compute platform domain stubs under [`specs/domains/compute/`](../domains/compute/); [`vision.md`](../vision.md) §"How a tenant's code reaches the internet" + §"Wrapped components" |
| **Spec anchor** | [`decisions/0011-cloud-adapter-seam.md`](../decisions/0011-cloud-adapter-seam.md); [`vision.md`](../vision.md) §"How a tenant's code reaches the internet"; [`architecture.md`](../architecture.md) §"Tenant Runtime Isolation" §"Compute-layer isolation" |

---

### renderSurface

The agent-and-UI introspection instruction. A caller — human browser, AI agent, BDD harness, operator dashboard — asks an `AtlasSurface` for its current state. The surface returns `{ surfaceId, state, schemaRef?, data, actions[] }` per the surface-contract introspection API; the registry at `/api/v1/surfaces` enumerates every surface so an agent can drive Atlas without DOM scraping. Exposure is prod-safe and authz-gated; an agent sees what its principal would see.

| | |
|---|---|
| **Inputs** | `surfaceId` (or registry enumeration); request `Principal` |
| **Outputs** | `SurfaceSnapshot { surfaceId, state, schemaRef?, data, actions[] }`; or `403` when authz denies |
| **Required invariants** | I2 (snapshot reads are authz-gated like any other read), I18 (surface state machine-readability) |
| **Category** | kernel + tenant-declaration |
| **Code anchor** | `AtlasSurface` in [`packages/core/src/component.ts`](../../packages/core/src/component.ts) (line 349); registry route lives in `apps/server` per surface-contract spec; lexicon entry `MachineReadableSurface` in [`LEXICON.md`](../LEXICON.md) §"Multi-Tenant Fabric Nouns" |
| **Spec anchor** | [`frontend/surface-introspection.md`](../frontend/surface-introspection.md); [`frontend/surface-contract.md`](../frontend/surface-contract.md); [`architecture.md`](../architecture.md) §"I18: Surface State Machine-Readability" |

---

## Invariants preserved

The instruction set is *what tenants can ask*; the invariants are *what the kernel enforces on every ask*. Every instruction above declares which subset of I1–I18 it must preserve; the kernel's correctness gate is that the union of those declarations spans every applicable invariant for every instruction. Canonical definitions live in [`architecture.md`](../architecture.md); the one-liners below are anchors, not redefinitions.

- **I1** — All external requests MUST pass through exactly one ingress chokepoint that enforces the full validation pipeline (see [architecture.md §I1](../architecture.md)).
- **I2** — Authorization MUST be enforced BEFORE any handler logic executes (see [architecture.md §I2](../architecture.md)).
- **I3** — Duplicate `idempotencyKey` MUST NOT cause re-execution of handlers or re-application of state changes (see [architecture.md §I3](../architecture.md)).
- **I4** — In policy evaluation, any matching DENY rule causes denial, regardless of ALLOW rules (see [architecture.md §I4](../architecture.md)).
- **I5** — `correlationId` MUST propagate through the entire request flow: UI intent → domain events → projections → jobs (see [architecture.md §I5](../architecture.md)).
- **I6** — Domain events MUST set `causationId` to the `eventId` of the causing event (see [architecture.md §I6](../architecture.md)).
- **I7** — Search queries MUST be scoped to `tenantId`; cross-tenant documents MUST NEVER appear in results (see [architecture.md §I7](../architecture.md)).
- **I8** — Search results MUST be filtered by `permissionAttributes` before returning to user (see [architecture.md §I8](../architecture.md)).
- **I9** — All cache keys MUST include `tenantId` unless the artifact is explicitly marked PUBLIC and verified tenant-safe (see [architecture.md §I9](../architecture.md)).
- **I10** — Cache invalidation MUST be triggered by domain events via tag matching (see [architecture.md §I10](../architecture.md)).
- **I11** — Analytics time buckets MUST be deterministically aligned to epoch + bucketSize (see [architecture.md §I11](../architecture.md)).
- **I12** — Projections (read models) MUST be rebuildable from event history alone (see [architecture.md §I12](../architecture.md)).
- **I13** — Quota check MUST run at ingress before handler dispatch; over-budget tenants MUST emit no events, run no handlers, and consume no compute (see [architecture.md §I13](../architecture.md)).
- **I14** — Tenant-authored code MUST execute only via the `FunctionRuntime` port; the runtime adapter MUST run out-of-process from `apps/server` (see [architecture.md §I14](../architecture.md)).
- **I15** — Tenant outbound HTTP / DNS / network traffic MUST flow through a tenant-scoped egress port that audits, quotas, and applies authz to every call (see [architecture.md §I15](../architecture.md)).
- **I16** — Tenant-defined schema mutations MUST affect only the issuing tenant's database and only operations on the constrained DDL allowlist (see [architecture.md §I16](../architecture.md)).
- **I17** — Every action exposed through `apps/server` MUST be reachable via the HTTP API, an `atlasctl` command, and a UI surface where user-facing (see [architecture.md §I17](../architecture.md)).
- **I18** — Every `AtlasSurface` MUST expose its state via the surface-contract introspection API; exposure is prod-safe and authz-gated (see [architecture.md §I18](../architecture.md)).

---

## Adding an instruction

The instruction set is closed. Capability specs extend an *existing* instruction without amending this list — a new event type extends [`emitEvent`](#emitevent); a new tenant-defined field type extends [`mutateSchema`](#mutateschema); a new query shape extends [`materializeQuery`](#materializequery); a new provisioning step composes into [`provisionService`](#provisionservice). Capability work follows the [slice workflow](../../CLAUDE.md#slice-workflow) and lands a `specs/domains/<domain>/capabilities/<name>/README.md` per the [spec-keeper contract](../CLAUDE.md).

Adding an **eleventh instruction**, by contrast, is a runtime-level change. The bar:

1. A decision record under [`specs/decisions/`](../decisions/) that motivates the instruction, names the invariants it preserves, names any new ones it requires, and identifies the port(s) it implies.
2. An update to this file's [§ Instruction reference](#instruction-reference) adding the new subsection in alphabetical position within its category.
3. Any new invariants land in [`architecture.md`](../architecture.md) under their own `I<N>` heading; this file's [§ Invariants preserved](#invariants-preserved) section gains the corresponding one-liner.
4. If a new port is implied, the port file lands under [`ports/`](../../ports/) per the [`ports/CLAUDE.md`](../../ports/CLAUDE.md) contract; the adapter parity bar in [`adapters/CLAUDE.md`](../../adapters/CLAUDE.md) applies.
5. The [`spec-keeper`](../../.claude/agents/spec-keeper.md) approves the addition; the [`architect`](../../.claude/agents/architect.md) gates against I1–I18 before merge.

A capability that cannot fit any existing instruction is the signal a new one is needed. Until the ADR lands and this list is amended, the kernel rejects the work — there is no path to "ship the capability and document the instruction later."
