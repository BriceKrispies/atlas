# Atlas Platform Lexicon (v2)

This file defines the platform’s canonical vocabulary: the nouns that exist, the verbs that may occur, and the invariant-bound pipelines that govern execution.

**v2 (2026-05-08):** Multi-tenant fabric vocabulary added (`Fabric`, `CustomSchema`, `TenantFunction`, `MachineReadableSurface`, `PublicSignup`, `Quota`, `provisionTenant`, `enforceQuota`). PIPE-CMD-001 gains `enforceQuota` between `authorize` and `checkIdempotency` per Invariant I13. CMS-shape entries (`Page`, `WidgetType`, `WidgetInstance`, `WidgetSettings`, `WidgetBoundary`, `INV-ISO-001`, `page.*` / `widget.*` ActionIds) marked **scope: parked first-party CMS app** per [ADR 0002](decisions/0002-developer-platform-domain-map.md) and [ADR 0003](decisions/0003-tenant-defined-data-model-pivot.md). They remain in the lexicon for historical continuity but are not active platform vocabulary.

## Invariants (non-negotiable)

- **INV-UI-001: UI thread cannot be blocked**
  - UI must never perform long synchronous work. All expensive work must be async and/or delegated (server, worker, background refresh).
- **INV-INGRESS-001: Single choke point**
  - All external requests MUST enter via **Ingress**. No alternate entry paths.
- **INV-CACHE-001: Cache-first**
  - Read paths must attempt cache first. Misses are expected and controlled (singleflight, SWR, background refresh).
- **INV-ISO-001: Widget isolation** *(scope: parked first-party CMS app)*
  - Widgets cannot reach directly into other widgets’ state or internals.
  - For the multi-tenant fabric the broader isolation tenet is **REQ-ISO-001** (mutual-distrust isolation between tenants on a shared instance) in [`normative_requirements.md`](normative_requirements.md), backed by Invariants **I7**, **I9**, **I14**, **I15**, **I16** in [`architecture.md`](architecture.md).
- **INV-DERIVED-001: State is always derived**
  - Persistent facts are events (and a minimal set of authoritative records where needed). Read state is projections/materializations.

---

## Canonical Pipelines (legal execution flows)

### PIPE-CMD-001: Command Pipeline (write path)
Order:
1. `resolveTenant`
2. `authenticate`
3. `validate`
4. `authorize`
5. `enforceQuota` *(added v2 per Invariant I13)*
6. `checkIdempotency`
7. `dispatchAction`
8. `handleCommand`
9. `emitEvent(s)`
10. `invalidateByTags`
11. `recordAudit`

Notes:
- Commands return acceptance/receipt, not computed UI state.
- Emitted events are the only durable “facts” produced by commands.
- `enforceQuota` runs after authz and before idempotency: an over-budget tenant is denied with `QUOTA_EXCEEDED` before any side effect. Quota dimensions are declared per action in the module manifest.

### PIPE-QRY-001: Query Pipeline (read path)
Order:
1. `resolveTenant`
2. `authenticate`
3. `authorize`
4. `cacheGet(Artifact)`
5. On miss: `materialize(Artifact)` (may read projections/search)
6. `cacheSet(Artifact)`
7. `recordAudit` (optional per sensitivity)

Notes:
- Materialization must be bounded and safe under load (singleflight, SWR policies).

### PIPE-PROJ-001: Projection Pipeline (derived state)
Order:
1. `consumeEvent(Envelope)`
2. `validateEventEnvelope`
3. `project(Event → ProjectionDelta)`
4. `applyProjectionDelta`
5. `invalidateByTags` (if projection updates affect cached artifacts)

Notes:
- Projections are rebuildable via event replay.

---

## Types

Each entry below is either a **Noun** (thing that exists) or **Verb** (allowed transformation).

Every entry includes:
- **Kind**: Noun | Verb
- **Meaning**: short definition
- **Shape**: canonical fields / signature
- **Touches**: which invariants or pipelines it participates in
- **Rules**: constraints, ordering, or forbidden usage

---

## Nouns

### Tenant
- **Kind**: Noun
- **Meaning**: Top-level isolation boundary for data, authz, and caching.
- **Shape**:
  - `TenantId`
  - attributes: `{ plan, region, ... }` (optional)
- **Touches**: INV-INGRESS-001, INV-CACHE-001
- **Rules**:
  - Must be present in all cache keys unless artifact is explicitly PUBLIC.

### Principal
- **Kind**: Noun
- **Meaning**: Normalized actor identity (user/service) with attributes for authorization.
- **Shape**:
  - `PrincipalId`
  - `subject`
  - `roles[]`
  - `attributes{...}`
- **Touches**: PIPE-CMD-001, PIPE-QRY-001
- **Rules**:
  - Principal is derived from authentication, not user-provided.

### Session (optional)
- **Kind**: Noun
- **Meaning**: Continuity handle for repeated requests (not a domain authority).
- **Shape**: `SessionId`, `PrincipalId`, expiry metadata
- **Touches**: PIPE-CMD-001, PIPE-QRY-001
- **Rules**:
  - Must not be relied on for authorization decisions directly.

### Ingress
- **Kind**: Noun
- **Meaning**: Single choke point that enforces validation/auth/authz/idempotency/dispatch.
- **Shape**:
  - `Ingress::handle(Request) -> Response`
- **Touches**: INV-INGRESS-001, PIPE-CMD-001, PIPE-QRY-001
- **Rules**:
  - All external entry points must delegate to Ingress.

### Intent
- **Kind**: Noun
- **Meaning**: UI-originated user intent; the accepted shape of “what the user asked for.”
- **Shape**:
  - `IntentId`
  - `ActionId`
  - `payload`
  - `idempotencyKey?`
- **Touches**: INV-UI-001, PIPE-CMD-001
- **Rules**:
  - UI emits intents; it does not execute domain work directly.

### Action
- **Kind**: Noun
- **Meaning**: Registered capability the system can perform (closed set).
- **Shape**:
  - `ActionId` (stable string or enum)
  - metadata: authz resource mapping, idempotency requirement, invalidation tags, emitted events
- **Touches**: INV-INGRESS-001
- **Rules**:
  - All commands must map to exactly one ActionId.

### Resource
- **Kind**: Noun
- **Meaning**: Target of authorization (Page, WidgetInstance, etc.) with ABAC attributes.
- **Shape**:
  - `ResourceType`
  - `ResourceId`
  - `attributes{...}`
- **Touches**: PIPE-CMD-001, PIPE-QRY-001
- **Rules**:
  - AuthZ decisions reference resources, not routes.

### Policy
- **Kind**: Noun
- **Meaning**: Authorization rules (deny-overrides-allow).
- **Shape**:
  - `PolicyId`
  - `rules[]`
- **Touches**: PIPE-CMD-001, PIPE-QRY-001
- **Rules**:
  - Policy evaluation must be deterministic and side-effect free.

### Decision
- **Kind**: Noun
- **Meaning**: Result of authorization.
- **Shape**:
  - `allow|deny`
  - `reason`
  - `matchedRules[]` (optional)
- **Touches**: PIPE-CMD-001, PIPE-QRY-001
- **Rules**:
  - Deny must be explainable for audit/debug.

### IdempotencyKey
- **Kind**: Noun
- **Meaning**: Dedupe key to ensure repeat requests produce the same outcome.
- **Shape**:
  - stable string
  - scoped by `(TenantId, PrincipalId?, ActionId)`
- **Touches**: PIPE-CMD-001
- **Rules**:
  - Required for any command that can be retried.

### EventEnvelope
- **Kind**: Noun
- **Meaning**: Canonical wrapper for all events.
- **Shape**:
  - `eventId`
  - `tenantId`
  - `timestamp`
  - `correlationId`
  - `causationId`
  - `idempotencyKey?`
  - `eventType`
  - `payload`
- **Touches**: INV-DERIVED-001, PIPE-PROJ-001
- **Rules**:
  - Must be validated before acceptance into projection pipeline.

### DomainEvent
- **Kind**: Noun
- **Meaning**: Immutable fact emitted by commands.
- **Shape**:
  - `eventType`
  - `payload` (schema-validated)
- **Touches**: INV-DERIVED-001
- **Rules**:
  - Events are append-only.

### Projection
- **Kind**: Noun
- **Meaning**: Rebuildable read model derived from events.
- **Shape**:
  - `ProjectionName`
  - `state`
  - `version` (optional)
- **Touches**: INV-DERIVED-001, PIPE-PROJ-001
- **Rules**:
  - Must be reproducible via replay.

### RenderModel
- **Kind**: Noun
- **Meaning**: UI-ready materialization (what the UI consumes to paint fast).
- **Shape**:
  - `RenderModelName` (e.g., `RenderPageModel`)
  - payload JSON
- **Touches**: INV-UI-001, INV-CACHE-001, PIPE-QRY-001
- **Rules**:
  - Must be cacheable as a named artifact.

### CacheArtifact
- **Kind**: Noun
- **Meaning**: A named cacheable output of a query/materialization.
- **Shape**:
  - `ArtifactName`
  - `KeyShape`
  - `Tags[]`
  - `TTLPolicy`
  - `MissPolicy` (singleflight/SWR/etc.)
- **Touches**: INV-CACHE-001, PIPE-QRY-001
- **Rules**:
  - Every artifact must declare tags for invalidation.

### CacheKey
- **Kind**: Noun
- **Meaning**: Key used to store/retrieve a CacheArtifact.
- **Shape**:
  - `ArtifactName + TenantId + ParamsHash (+ Principal scope if needed)`
- **Touches**: INV-CACHE-001
- **Rules**:
  - TenantId required unless PUBLIC.

### Tag
- **Kind**: Noun
- **Meaning**: Invalidation selector attached to cache entries.
- **Shape**: strings like `Tenant:{id}`, `Page:{id}`, `WidgetInstance:{id}`
- **Touches**: INV-CACHE-001
- **Rules**:
  - Tags must be stable and derivable from nouns.

### AuditEvent
- **Kind**: Noun
- **Meaning**: Immutable record of sensitive operations and decisions.
- **Shape**:
  - `timestamp`
  - `principal`
  - `action`
  - `resource`
  - `decision`
- **Touches**: PIPE-CMD-001, PIPE-QRY-001
- **Rules**:
  - Must not block command latency (async write acceptable).

### InviteToken
- **Kind**: Noun
- **Meaning**: A single-use bearer credential bound to a tenant + email, valid until expiry, redeemed via `Identity.Invite.Accept`. Owned by identity.
- **Shape**:
  - `tokenId`
  - `tenantId`
  - `email`
  - `expiresAt`
  - `consumedAt?`
- **Touches**: PIPE-CMD-001
- **Rules**:
  - Must be redeemable exactly once.

### MagicLink
- **Kind**: Noun
- **Meaning**: A URL embedding an `InviteToken` that, when visited, signs the user in. Constructed by the route layer; the magic-link is the authentication factor on `/signup/confirm`.
- **Shape**:
  - URL with embedded `InviteToken`
- **Touches**: PIPE-CMD-001
- **Rules**:
  - Authentication factor for `/signup/confirm`; not a long-lived session.

### Mailer
- **Kind**: Noun
- **Meaning**: Outbound email port (`ports/src/mailer.ts`). Adapters: `StdoutEventMailer` (dev/sim), `SmtpMailer` (smtp4dev / production SMTP).
- **Shape**:
  - `Mailer::send(Message) -> Result`
- **Touches**: PIPE-CMD-001
- **Rules**:
  - All adapters MUST persist `correlationId` and write to `control_plane.email_log` with the same column shape (see MAILER-001, MAILER-002).

### SignupRequest
- **Kind**: Noun
- **Meaning**: A public visitor's intent to provision a tenant; row in `control_plane.signup_requests`; states `pending | approved | denied`; uniquely keyed by `(email, tenantSlug)`. Owned by tenancy.
- **Shape**:
  - `signupRequestId`
  - `email`
  - `tenantSlug`
  - `state` (`pending | approved | denied`)
  - `createdAt`
- **Touches**: PIPE-CMD-001
- **Rules**:
  - `(email, tenantSlug)` is unique.

### Repository
- **Kind**: Noun
- **Meaning**: A tenant-scoped, named container for source revisions. Owned by code/repository.
- **Shape**:
  - `repoId` (UUID-shaped)
  - `repoSlug` (tenant-unique, kebab-case, e.g. `hello-world`)
  - `name`
  - `description?`
- **Touches**: PIPE-CMD-001, PIPE-QRY-001, INV-CACHE-001
- **Rules**:
  - Strictly tenant-scoped — no row spans tenants.
  - `repoSlug` is unique within a tenant.

### Revision
- **Kind**: Noun
- **Meaning**: An immutable snapshot of source bytes at a point in time. Each `Repository.Uploaded` event mints exactly one Revision. Owned by code/repository.
- **Shape**:
  - `revisionId`
  - `repoId`
  - `byteCount`
  - `contentHash` (sha256, hex)
  - `pushedAt`
  - `pushedBy`
  - `correlationId`
- **Touches**: INV-DERIVED-001, PIPE-CMD-001, PIPE-QRY-001
- **Rules**:
  - Append-only; revisions are never mutated or deleted in-place (Phase 1).
  - Bytes round-trip identically — `contentHash` must match the stored bytes.

### Tarball
- **Kind**: Noun
- **Meaning**: A gzipped tar archive (`application/gzip`) containing a source tree. The single ingest format Phase 1 of the code platform supports; Phase 3's git transport produces the same Revision entity from a different ingest path.
- **Shape**:
  - bytes (gzipped tar)
  - `byteCount` (compressed length, ≤ 10 MB in Phase 1)
  - `contentHash` (sha256, hex)
- **Touches**: PIPE-CMD-001
- **Rules**:
  - Hard cap of 10 MB compressed in Phase 1; over-cap uploads reject at schema validation with `UPLOAD_TOO_LARGE`.
  - Wire format is base64-in-JSON on the `Repository.Upload` intent; streaming/object-storage upload is a future slice.

---

## Multi-Tenant Fabric Nouns *(v2)*

These entries describe the multi-tenant-fabric vocabulary introduced by [ADR 0003](decisions/0003-tenant-defined-data-model-pivot.md) and made enforceable by [ADR 0004](decisions/0004-platform-invariants-for-multi-tenant-fabric.md).

### Fabric
- **Kind**: Noun
- **Meaning**: The multi-tenant chassis Atlas provides — identity, authorization, tenancy, audit, observability, search — applied uniformly to every operation. The "platform fabric" framing of [`vision.md`](vision.md): tenants get all of these for free by virtue of being a tenant on Atlas.
- **Shape**: not a runtime entity; a framing concept. Composed of the Spine domains.
- **Touches**: INV-INGRESS-001, all PIPE-* pipelines
- **Rules**:
  - Fabric capabilities apply to every tenant on every instance; opting out is not a tenant-side configuration.

### CustomSchema
- **Kind**: Noun
- **Meaning**: A tenant-defined data model — entity types, fields, relationships, and indexes declared by a tenant via Atlas API and stored in the tenant's per-tenant Postgres schema (`atlas_t_<tenantId>`) per [ADR 0005](decisions/0005-custom-schema-storage-strategy.md).
- **Shape**:
  - `tenantId`
  - `objectTypes[]` — entity type declarations (name, fields, relationships)
  - `version` — monotonically increasing per tenant
- **Touches**: PIPE-CMD-001, PIPE-PROJ-001, INV-DERIVED-001 (rebuildable from events)
- **Rules**:
  - Mutations confined to the issuing tenant's schema (Invariant **I16**).
  - DDL drawn from a constrained allowlist; no `DROP DATABASE`, no `CREATE EXTENSION`, no cross-schema references.
  - The unit of declaration is the `ObjectType`; see [`domains/custom-schema/capabilities/object-definition/README.md`](domains/custom-schema/capabilities/object-definition/README.md) for the seam.

### ObjectType
- **Kind**: Noun
- **Meaning**: A tenant-declared entity type within a `CustomSchema`. Backed by a native Postgres table inside the tenant's `atlas_t_<tenantUuid>` schema. Identified by `objectTypeId` (UUID-shaped) and a tenant-unique `apiName` (regex `^[A-Za-z][A-Za-z0-9_]{0,62}$`, max 63 chars). Each `ObjectType.Defined` event mints exactly one type.
- **Shape**:
  - `tenantId`
  - `objectTypeId`
  - `apiName` — tenant-unique stable identifier used in API routes and as the table-name seed
  - `label`, `pluralLabel`, `description`
  - `createdAt`, `createdBy`
- **Touches**: PIPE-CMD-001, INV-DERIVED-001, **I7**, **I16**
- **Rules**:
  - `apiName` is unique per `tenantId`; collision returns `OBJECT_TYPE_API_NAME_TAKEN`.
  - Only types defined in the issuing tenant's schema are addressable; cross-tenant access is impossible at the type level (`tenantId` flows through every read).
  - Field declarations are NOT part of this entity in v1 — see the `field-types` capability for adding columns.

### Field
- **Kind**: Noun
- **Meaning**: A column declaration on an `ObjectType`. Has a `fieldType` (string/number/date/boolean/lookup/etc — defined by the `field-types` capability), an `apiName`, a `label`, and per-type constraints. Backed by a native column on the object type's table.
- **Shape**:
  - `fieldId`, `objectTypeId`, `apiName`, `label`, `fieldType`, `constraints`
- **Touches**: PIPE-CMD-001, **I16**
- **Rules**:
  - Out of scope for `object-definition`; declared and frozen by the `field-types` capability.
  - System-minted audit columns (`id`, `created_at`, `updated_at`, `version`) are not Fields — they are platform infrastructure.

### Relation
- **Kind**: Noun
- **Meaning**: A typed reference from one `ObjectType` to another within the same tenant's `CustomSchema`. Backed by a foreign-key column per [ADR 0005](decisions/0005-custom-schema-storage-strategy.md) ("relationships become foreign keys"). Distinct from the existing `RelationStore` port, which is a generic platform-level adjacency store; `Relation` here is a tenant-defined first-class metadata declaration.
- **Shape**:
  - `relationId`, `tenantId`, `fromObjectTypeId`, `toObjectTypeId`, `apiName`, `cardinality` (`one-to-many` | `many-to-one` | `many-to-many`), `onDelete` (`restrict` | `cascade` | `set-null`)
- **Touches**: PIPE-CMD-001, **I7**, **I16**
- **Rules**:
  - Both endpoints MUST live in the same tenant's schema (Invariant **I16**); cross-tenant relations are forbidden.
  - Out of scope for `object-definition`; declared as a reference-typed field by the `field-types` capability — there is no separate `relations` capability.
  - Naming disambiguation: this entry refers to the *tenant-defined* relation metadata, not the platform-level `RelationStore` port at `ports/src/relation-store.ts`.

### TenantFunction
- **Kind**: Noun
- **Meaning**: Sandboxed tenant-authored code — written by a tenant, attached to schema lifecycle events / HTTP routes / schedules, executed via the `FunctionRuntime` port (gVisor-backed by default per [ADR 0006](decisions/0006-function-runtime-substrate.md)).
- **Shape**:
  - `tenantId`
  - `functionId`
  - `version`
  - `bundleRef` — pointer to the source/image
  - `runtime` — `"gvisor"` (MVP) or `"v8-isolate"` (Phase 4)
  - `triggers[]` — schema events, HTTP routes, schedules
- **Touches**: PIPE-CMD-001, INV-INGRESS-001 (HTTP-route functions submit through Ingress)
- **Rules**:
  - Executes only via `FunctionRuntime` port; never in `apps/server` process (Invariant **I14**).
  - Outbound network through the egress port only (Invariant **I15**).
  - Distinct from `function-runner` (Workflow internal infrastructure); see [`domains/functions/README.md`](domains/functions/README.md).

### MachineReadableSurface
- **Kind**: Noun
- **Meaning**: An `AtlasSurface` that exposes its current state via `getSurfaceSnapshot()` and a registry manifest at `/api/v1/surfaces`, per [`frontend/surface-introspection.md`](frontend/surface-introspection.md). Required for every surface (Invariant **I18**).
- **Shape**:
  - `surfaceId`
  - `state` — current snapshot kind (loading / empty / success / etc.)
  - `dataSchema` — static or tenant-defined
  - `data`
  - `actions[]` — available actions, post-authz
- **Touches**: INV-INGRESS-001 (snapshots flow through Ingress), INV-UI-001
- **Rules**:
  - Snapshots are authz-gated; agents see only what their principal scope allows.
  - Required for every `AtlasSurface` subclass; CI enforces.

### PublicSignup
- **Kind**: Noun
- **Meaning**: Open self-serve tenant provisioning — the signup configuration in which any visitor can become a tenant without operator intervention. The default for the project author's public reference instance, opt-out for self-hosters who want gated signup.
- **Shape**:
  - request flow: intent → email verify → tenant provisioned → admin user created
  - quota dimensions enforced: `signups-per-window` per IP and per email
- **Touches**: PIPE-CMD-001, REQ-SIGNUP-001, REQ-SIGNUP-002
- **Rules**:
  - Must function without operator intervention when enabled.
  - Rate-limited per source IP and per email; over-budget rejected with `QUOTA_EXCEEDED`.

### Quota
- **Kind**: Noun
- **Meaning**: A per-tenant resource budget enforced at ingress before any side effect. Quotas are load-bearing: an over-budget tenant cannot deploy, run functions, grow data, or accept new signups (Invariant **I13**, REQ-QUOTA-001).
- **Shape**:
  - `tenantId`
  - `dimension` — one of `signups-per-window`, `cpu-seconds`, `storage-bytes`, `function-invocations`, `egress-bytes`, plus future per-domain dimensions
  - `budget`
  - `usedSoFar`
  - `windowStart` (for time-bounded budgets)
- **Touches**: PIPE-CMD-001 (between `authorize` and `checkIdempotency`)
- **Rules**:
  - Per-tenant accounting; over-quota tenant must not block other tenants' quota-check hot path.
  - Quota dimensions declared per action in module manifest.

### QuotaService
- **Kind**: Noun (port)
- **Meaning**: The platform-level seam every mutating handler consults between `authorize` and `checkIdempotency` per Invariant **I13**. Single-method (`check`) port mirroring the `PolicyEngine` shape. Tenancy owns the contract; Commerce ships the real adapter (`QuotaLedger`-backed); a stub (`QuotaServiceStub`, always-allow) ships alongside this port for dev/sim.
- **Shape**:
  - `check(request: QuotaCheckRequest) -> Promise<QuotaCheckResult>`
- **Touches**: PIPE-CMD-001, INV-INGRESS-001
- **Rules**:
  - Atomic decrement-or-reject — when the result is `allowed: true`, the budget is already consumed (single round trip, no check-then-consume race).
  - Fail-closed — when the service is unreachable, callers refuse the intent (`QUOTA_SERVICE_UNAVAILABLE`); there is no degraded-mode passthrough.

### QuotaCheckRequest
- **Kind**: Noun (type)
- **Meaning**: The request shape passed to `QuotaService.check`. Tenant-scoped at the type level.
- **Shape**:
  - `tenantId`
  - `dimension` (a `QuotaDimension` value)
  - `delta` (amount to decrement)
  - `correlationId`
- **Touches**: PIPE-CMD-001, INV-DERIVED-001 (correlationId propagation)
- **Rules**:
  - Cross-tenant requests are impossible by signature.

### QuotaCheckResult
- **Kind**: Noun (type)
- **Meaning**: The decision returned from `QuotaService.check`. `allowed: true` means the budget is already decremented; `allowed: false` carries a `reason` distinguishing over-budget from service-unavailable.
- **Shape**:
  - `allowed` (boolean)
  - `remainingBudget?` (number)
  - `reason?` — `'QUOTA_EXCEEDED'` (over-budget) or `'QUOTA_SERVICE_UNAVAILABLE'` (fail-closed)
- **Touches**: PIPE-CMD-001
- **Rules**:
  - `reason` is required whenever `allowed: false`; it shapes the audit event the handler subsequently emits (`Audit.QuotaDenied` vs. operator-side service-unavailable signal).

### defaultQuotas
- **Kind**: Noun (payload field)
- **Meaning**: A map of `QuotaDimension → { budget, windowSeconds? }` carried on `Tenancy.TenantProvisioned`. Commerce's future `QuotaLedger` projection consumes this to materialise per-tenant budget rows. Operator-tunable via the `commerce/plans` capability without touching tenancy or the events themselves.
- **Shape**:
  - `Record<QuotaDimension, { budget: number, windowSeconds?: number }>`
- **Touches**: PIPE-CMD-001, INV-DERIVED-001 (events as facts)
- **Rules**:
  - Ships with all five MVP-blocking dimensions populated; per-domain dimensions add themselves in their own capability specs.

---

## Seed Corpus Nouns

These entries describe the seed-corpus and scenario-fuzzing vocabulary introduced by [`crosscut/seed-corpus.md`](crosscut/seed-corpus.md) and [`crosscut/scenario-fuzzing.md`](crosscut/scenario-fuzzing.md). They cover the shared building blocks the seeder, atlasctl, and the test fabric all consume.

### SeedCorpus
- **Kind**: Noun (port). A port-backed library of `Scenario`s and `Fixture`s; methods `listScenarios`, `loadScenario`, `loadFixture`. Adapters: memory (Phase 1), fs (Phase 2), sqlite (Phase 4). See [`crosscut/seed-corpus.md`](crosscut/seed-corpus.md) §4.

### Scenario
- **Kind**: Noun. A stable-id'd, ordered list of `ScenarioStep`s plus optional `apply: [fixtureRef]` composition; defines a known starting state the runner produces by submitting each step's intent through `IntentDriver`. See [`crosscut/seed-corpus.md`](crosscut/seed-corpus.md) §4.2.

### Fixture
- **Kind**: Noun. A reusable bundle of `ScenarioStep`s referenced by other scenarios via `apply: [fixtureRef]`; recursive composition is depth-limited to 8 at runtime. See [`crosscut/seed-corpus.md`](crosscut/seed-corpus.md) §4.2.

### ScenarioStep
- **Kind**: Noun. One step in a scenario or fixture: a `stepId`, an `intent` (IntentEnvelope), optional `asTenant`/`asPrincipal` handles, and optional `expect: { ok?, errorCode? }` acceptance. See `seed.scenario.v1` schema.

### ScenarioRef
- **Kind**: Noun. A reference into a `SeedCorpus`: `{ scenarioId, contentHash, origin: 'fixed' | 'materialized', axisBindings? }`; `listScenarios` streams these. See [`crosscut/seed-corpus.md`](crosscut/seed-corpus.md) §4.1.

### FixtureRef
- **Kind**: Noun. A reference into a `SeedCorpus`: `{ fixtureId, contentHash }`; carried in `Scenario.apply[]` and `Fixture.apply[]`. See [`crosscut/seed-corpus.md`](crosscut/seed-corpus.md) §4.1.

### AxisDefinition
- **Kind**: Noun. One axis of a fuzz `Template`: `kind: enum | range | generator`, with `values` / `range: {from, to, step}` / `generatorRef` respectively. See [`crosscut/scenario-fuzzing.md`](crosscut/scenario-fuzzing.md) §4.

### axis-id
- **Kind**: Noun (grammar). The materialized-scenario id format `<templateId>/<axisName>=<value>/...`; axes lexically sorted by name, values percent-encoded outside `[A-Za-z0-9._-]`; round-trippable from a CI log line alone. See [`crosscut/scenario-fuzzing.md`](crosscut/scenario-fuzzing.md) §5.

### materialized scenario
- **Kind**: Noun. A `Scenario` produced by expanding a fuzz `Template` against a binding tuple; `ScenarioRef.origin === 'materialized'` and the scenarioId follows the axis-id grammar. See [`crosscut/scenario-fuzzing.md`](crosscut/scenario-fuzzing.md) §6.

### fixed scenario
- **Kind**: Noun. A `Scenario` authored directly (not produced from a template); `ScenarioRef.origin === 'fixed'`. The scenarioId is a hand-chosen kebab-case slug. See [`crosscut/seed-corpus.md`](crosscut/seed-corpus.md) §4.2.

---

## UI Composition Nouns *(scope: parked first-party CMS app)*

The entries below are CMS-flavored vocabulary from before the developer-platform re-anchor ([ADR 0002](decisions/0002-developer-platform-domain-map.md)) and the multi-tenant-fabric pivot ([ADR 0003](decisions/0003-tenant-defined-data-model-pivot.md)). They remain here for historical continuity and because the parked CMS app at `apps/cms/` may revive on top of `custom-schema` + `functions` later (or may not — see ADR 0003 §"Out of scope"). Active platform vocabulary lives above; these terms are not active for new work.

### Page
- **Kind**: Noun
- **Meaning**: User-defined container composed of widget instances + layout metadata.
- **Shape**:
  - `PageId`
  - `title`
  - `layout`
  - `widgetInstances[]`
- **Touches**: INV-DERIVED-001, INV-CACHE-001
- **Rules**:
  - RenderModel for a page must be cacheable.

### WidgetType
- **Kind**: Noun
- **Meaning**: Widget blueprint (code + settings schema + declared capabilities).
- **Shape**:
  - `WidgetTypeId`
  - `settingsSchema`
  - `capabilities`
- **Touches**: INV-ISO-001
- **Rules**:
  - WidgetType declares what actions it can request.

### WidgetInstance
- **Kind**: Noun
- **Meaning**: A concrete placement of a WidgetType on a Page.
- **Shape**:
  - `WidgetInstanceId`
  - `WidgetTypeId`
  - `PageId`
  - `settings`
  - `visibilityPolicy`
  - `interactionPolicy`
- **Touches**: INV-ISO-001, INV-DERIVED-001
- **Rules**:
  - Must not reference other widget instances directly.

### WidgetSettings
- **Kind**: Noun
- **Meaning**: Instance configuration validated against WidgetType schema.
- **Shape**: JSON payload
- **Touches**: PIPE-CMD-001
- **Rules**:
  - Must be schema-validated at ingress.

### WidgetBoundary
- **Kind**: Noun
- **Meaning**: The enforced rule that widgets are isolated “applets.”
- **Shape**: platform rule, not data
- **Touches**: INV-ISO-001
- **Rules**:
  - Widgets communicate only through platform actions/events, never direct calls.

---

## Verbs

### resolveTenant
- **Kind**: Verb
- **Meaning**: Determine tenant context for a request.
- **Signature**: `Request -> (TenantId, Request)`
- **Touches**: INV-INGRESS-001
- **Rules**:
  - Must occur before any cache key computation.

### authenticate
- **Kind**: Verb
- **Meaning**: Validate credentials and produce a Principal.
- **Signature**: `Request -> Principal`
- **Touches**: PIPE-CMD-001, PIPE-QRY-001
- **Rules**:
  - Must precede authorize.

### validate
- **Kind**: Verb
- **Meaning**: Validate request schema/envelope and required fields.
- **Signature**: `(ActionId, payload) -> ValidatedPayload`
- **Touches**: PIPE-CMD-001, PIPE-QRY-001
- **Rules**:
  - Must run before dispatch/handle.

### authorize
- **Kind**: Verb
- **Meaning**: Evaluate policy for principal+action+resource.
- **Signature**: `(Principal, ActionId, Resource) -> Decision`
- **Touches**: INV-INGRESS-001
- **Rules**:
  - Deny-overrides-allow.

### checkIdempotency
- **Kind**: Verb
- **Meaning**: Dedupe command requests by IdempotencyKey.
- **Signature**: `(TenantId, ActionId, IdempotencyKey) -> {seen?, priorResult?}`
- **Touches**: PIPE-CMD-001
- **Rules**:
  - If seen, must return prior outcome.

### dispatchAction
- **Kind**: Verb
- **Meaning**: Route a validated, authorized request to a handler.
- **Signature**: `(ActionId, ValidatedPayload) -> Handler`
- **Touches**: INV-INGRESS-001
- **Rules**:
  - Only registered actions may be dispatched.

### handleCommand
- **Kind**: Verb
- **Meaning**: Execute domain logic and produce events (not UI state).
- **Signature**: `Command -> DomainEvent[]`
- **Touches**: INV-DERIVED-001
- **Rules**:
  - Side effects occur only via event emission (and approved ports).

### emitEvent
- **Kind**: Verb
- **Meaning**: Wrap and append events to the event stream.
- **Signature**: `DomainEvent -> EventEnvelope -> append`
- **Touches**: PIPE-CMD-001
- **Rules**:
  - Must be durable before success is reported.

### project
- **Kind**: Verb
- **Meaning**: Apply an event to a projection.
- **Signature**: `(Projection, EventEnvelope) -> ProjectionDelta`
- **Touches**: PIPE-PROJ-001
- **Rules**:
  - Must be deterministic.

### materialize
- **Kind**: Verb
- **Meaning**: Build a cache artifact payload from projections/search/state.
- **Signature**: `(ArtifactName, params) -> payload`
- **Touches**: INV-UI-001, INV-CACHE-001
- **Rules**:
  - Must be bounded, safe, and singleflight-protected where needed.

### cacheGet
- **Kind**: Verb
- **Meaning**: Lookup a cache artifact by key.
- **Signature**: `(CacheKey) -> hit(payload)|miss`
- **Touches**: INV-CACHE-001
- **Rules**:
  - First step of all read paths.

### cacheSet
- **Kind**: Verb
- **Meaning**: Store a cache artifact with tags and policy metadata.
- **Signature**: `(CacheKey, payload, Tags, TTLPolicy) -> ok`
- **Touches**: INV-CACHE-001
- **Rules**:
  - Must attach tags.

### invalidateByTags
- **Kind**: Verb
- **Meaning**: Invalidate all cache entries matching tag(s).
- **Signature**: `(Tag[]) -> count`
- **Touches**: INV-CACHE-001
- **Rules**:
  - Triggered by events; avoid manual calls.

### recordAudit
- **Kind**: Verb
- **Meaning**: Record an auditable summary of operation/decision.
- **Signature**: `(Principal, ActionId, Resource, Decision, metadata) -> ok`
- **Touches**: PIPE-CMD-001, PIPE-QRY-001
- **Rules**:
  - Must not block critical latency (async permitted).

### approveSignup
- **Kind**: Verb
- **Meaning**: Admin-driven transition of a `SignupRequest` from `pending` to `approved`, choreographing tenant-create + custom-domain register + tenant-DB provision + invite-issue + mail-send.
- **Signature**: `(SignupRequestId, Principal) -> DomainEvent[]`
- **Touches**: PIPE-CMD-001
- **Rules**:
  - Only allowed from state `pending`; idempotent on repeat invocation.

### issueInvite
- **Kind**: Verb
- **Meaning**: Mint a fresh `InviteToken` in a tenant's per-tenant DB and dispatch the `Identity.InviteIssued` event.
- **Signature**: `(TenantId, email) -> InviteToken`
- **Touches**: PIPE-CMD-001
- **Rules**:
  - Token must be single-use and time-bound.

### enforceQuota *(v2)*
- **Kind**: Verb
- **Meaning**: Atomic decrement-or-reject against the named quota dimension for the tenant. Runs in PIPE-CMD-001 between `authorize` and `checkIdempotency`. Per Invariant **I13**.
- **Signature**: `(TenantId, QuotaDimension, delta) -> { ok } | { rejected: 'QUOTA_EXCEEDED' }`
- **Touches**: PIPE-CMD-001
- **Rules**:
  - Atomic — no TOCTOU window between check and consume for fungible budgets.
  - Rejection emits `Audit.QuotaDenied` and short-circuits the pipeline; no domain events emitted.
  - Hot-path safe: per-tenant accounting must not block other tenants on contention.

### provisionTenant *(v2)*
- **Kind**: Verb
- **Meaning**: Atomically create a new tenant — control-plane row, per-tenant DB, per-tenant Postgres schema (`atlas_t_<tenantId>`), default quota ledger entries, admin user, ingress hostname binding. Triggered by `Tenancy.Signup.Approved` (private) or `PublicSignup.EmailVerified` (open).
- **Signature**: `(SignupRequest) -> DomainEvent[]` (`Tenancy.TenantProvisioned`, `Identity.AdminUserCreated`, `Commerce.QuotaLedgerInitialized`, etc.)
- **Touches**: PIPE-CMD-001, REQ-SIGNUP-001
- **Rules**:
  - Idempotent on the same `signupRequestId` — replay must not create duplicate tenants.
  - Fail-closed: if any step (DB provision, quota init, admin create) fails, the whole transition rolls back; no half-provisioned tenants.
  - Must function without operator intervention when public signup is enabled.

---

## Closed-set UI Composition Verbs (ActionIds) *(scope: parked first-party CMS app)*

These ActionIds were defined for the CMS-shaped platform that preceded the developer-platform re-anchor. They are retained for historical continuity; new work uses the action vocabulary defined per-domain under `specs/domains/<x>/`.

- `page.create`
- `page.update`
- `page.delete`
- `widget.addInstance`
- `widget.moveInstance`
- `widget.removeInstance`
- `widget.updateSettings`
- `widget.setVisibilityPolicy`
- `widget.setInteractionPolicy`

Rules:
- All must be routed via Ingress and follow PIPE-CMD-001.

---

## “Forbidden Moves” (explicit non-goals)

- Any external endpoint that bypasses Ingress.
- Any widget directly reading/modifying another widget’s internal state.
- Any read path that computes without attempting cache first.
- Any persistent “truth” that is not an event (unless explicitly declared authoritative record).

---

## Change Control

- This lexicon is versioned.
- Adding nouns/verbs is allowed.
- Removing or changing meaning requires a version bump and migration plan.
