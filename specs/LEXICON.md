# Atlas Platform Lexicon (v1)

This file defines the platform’s canonical vocabulary: the nouns that exist, the verbs that may occur, and the invariant-bound pipelines that govern execution.

## Invariants (non-negotiable)

- **INV-UI-001: UI thread cannot be blocked**
  - UI must never perform long synchronous work. All expensive work must be async and/or delegated (server, worker, background refresh).
- **INV-INGRESS-001: Single choke point**
  - All external requests MUST enter via **Ingress**. No alternate entry paths.
- **INV-CACHE-001: Cache-first**
  - Read paths must attempt cache first. Misses are expected and controlled (singleflight, SWR, background refresh).
- **INV-ISO-001: Widget isolation**
  - Widgets cannot reach directly into other widgets’ state or internals.
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
5. `checkIdempotency`
6. `dispatchAction`
7. `handleCommand`
8. `emitEvent(s)`
9. `invalidateByTags`
10. `recordAudit`

Notes:
- Commands return acceptance/receipt, not computed UI state.
- Emitted events are the only durable “facts” produced by commands.

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

---

## UI Composition Nouns

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

---

## Closed-set UI Composition Verbs (ActionIds)

These are platform-recognized actions (examples; expand as needed):

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
