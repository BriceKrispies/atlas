# Surface Introspection

## Why This Spec Exists

[`surface-contract.md`](surface-contract.md) is the **design-time author contract** — it defines what an implementer writes down (test IDs, intents, telemetry events, acceptance scenarios). That contract is excellent for building surfaces, scaffolding tests, and giving authoring agents enough structure to scaffold code.

It is **not enough** for the agentic-first tenet codified in [ADR 0003](../decisions/0003-tenant-defined-data-model-pivot.md) §3 and made mechanically checkable as Invariant **I18** in [ADR 0004](../decisions/0004-platform-invariants-for-multi-tenant-fabric.md). An AI agent operating Atlas at runtime needs to answer four questions about any surface it encounters:

1. **Which surface am I looking at?** (surfaceId, kind, route)
2. **What state is it in?** (loading / empty / success / error / unauthorized)
3. **What data is currently displayed?** (the rendered model, with schema reference for tenant-defined types)
4. **What actions can I take?** (intents the surface can dispatch, with auth + parameter shape)

This spec defines the **runtime introspection API** that surfaces must expose to answer those questions, the **surface registry** that lets agents enumerate available surfaces without driving the UI, and the **dynamic-schema** field that makes the introspection contract safe for tenant-defined entity types ([ADR 0005](../decisions/0005-custom-schema-storage-strategy.md)).

This contract is **prod-safe and authz-gated** — not a dev-only test affordance like `@atlas/test-state`'s `window.__atlasTest`. Agents and tenants consuming the introspection surface see what their authz scope allows, never more.

## Relationship to `surface-contract.md`

| Concern | `surface-contract.md` | `surface-introspection.md` (this spec) |
|---------|----------------------|----------------------------------------|
| Audience | Implementers + authoring agents | Operating agents + automation + tests at runtime |
| Format | Static authored YAML/JSON contract per surface | Runtime API on `AtlasSurface` + HTTP registry endpoint |
| When read | Before / during implementation | During execution, by agent or test or operator |
| What it describes | Intended states, elements, intents, scenarios | Current state, current data, current available actions |
| Who enforces | Author + reviewer | Platform invariant **I18**, runtime CI check |

The author contract (`surface-contract.md`) is the source of truth for **what should exist**; the introspection contract (this file) is the source of truth for **what the surface is doing right now**.

## The Introspection API

Every `AtlasSurface` subclass MUST implement `getSurfaceSnapshot()` returning the structure below.

### Snapshot shape

```javascript
/**
 * @typedef {Object} SurfaceSnapshot
 * @property {string} surfaceId — Matches the authored contract's surfaceId
 * @property {"page"|"widget"|"dialog"} kind
 * @property {string} [route] — Pages only
 * @property {SnapshotState} state — Current rendered state
 * @property {DataSchemaRef} dataSchema — Static or tenant-defined
 * @property {unknown} data — The rendered model in its current shape (typed by dataSchema)
 * @property {AvailableAction[]} actions — Actions the surface can dispatch right now, post-authz
 * @property {string} principalScope — Hash/identifier of the principal scope this snapshot was filtered for
 * @property {string} snapshotAt — ISO 8601 timestamp
 */

/**
 * @typedef {Object} SnapshotState
 * @property {"loading"|"empty"|"success"|"validationError"|"backendError"|"unauthorized"} kind
 * @property {string} [message] — Human-readable detail (error states)
 * @property {string} [code] — Error code from error_taxonomy.json (error states)
 */

/**
 * @typedef {Object} DataSchemaRef
 * @property {"static"|"tenant-defined"} kind
 * @property {string} schemaRef — JSON Schema $id for static; "atlas_t_<tenantId>:<typeId>:<version>" for tenant-defined
 */

/**
 * @typedef {Object} AvailableAction
 * @property {string} actionId — Matches an entry in the platform action registry
 * @property {string} label — Human-readable label
 * @property {Object<string,unknown>} parameterShape — JSON Schema for action parameters
 * @property {boolean} authzAllowed — Whether the calling principal would be authorized to dispatch this action right now
 */
```

### Authz gating

Snapshots are filtered through the same authz pipeline as the surface itself:

- A principal who cannot read the surface receives `state: { kind: "unauthorized" }` and an empty `data` field.
- A principal who can read but cannot mutate sees `actions[].authzAllowed: false` for mutating actions.
- Cross-tenant introspection is impossible by construction: the principal's `tenantId` scopes the resolved surface and its data.

`principalScope` in the snapshot is a stable hash of the principal's identity + role packs at snapshot time. Two snapshots with different `principalScope` may legitimately differ; the field exists so an agent caching snapshots knows when to refetch.

### Where snapshots are emitted

| Caller | Path | Notes |
|--------|------|-------|
| **Browser UI** | In-process call: `surface.getSurfaceSnapshot()` | Used by tests and dev tools. No network round-trip. |
| **Agent / automation** | HTTP `GET /api/v1/surfaces/<surfaceId>/snapshot` | Server renders the surface in headless mode and returns the snapshot. Authz applied per the calling principal. |
| **Operator dashboard** | Same HTTP endpoint, operator scope | Operator principal can request a snapshot in any tenant's scope; the snapshot itself is still filtered through that tenant's authz. |

## The Surface Registry

Agents need to enumerate available surfaces without driving the UI. The registry is the single source of truth.

### Endpoint

```
GET /api/v1/surfaces
GET /api/v1/surfaces?kind=page|widget|dialog
GET /api/v1/surfaces/<surfaceId>
```

Returns one `SurfaceManifest` per surface visible to the calling principal.

### Manifest shape

```javascript
/**
 * @typedef {Object} SurfaceManifest
 * @property {string} surfaceId
 * @property {"page"|"widget"|"dialog"} kind
 * @property {string} [route]
 * @property {string} purpose
 * @property {AuthSpec} auth — Same shape as surface-contract.md's AuthSpec
 * @property {string[]} states — The state.kind values this surface can be in
 * @property {string[]} actionIds — Actions this surface can dispatch (action registry IDs)
 * @property {DataSchemaRef} dataSchema
 * @property {string} [introspectionPath] — HTTP path to fetch a live snapshot
 * @property {string} contractRef — Path to the authored surface-contract entry (e.g., "specs/frontend/surfaces/admin.tenancy.signups-list.yaml")
 */
```

### Source of truth

The registry is **derived from the authored surface contracts** at build time. Surfaces declared in `surface-contract.md` author files materialize into registry entries; surfaces without an author entry fail spec-conformance and never reach the registry. This makes the registry a closed set: an agent can trust that "what's in the registry is the full set of surfaces."

### Tenant-defined surfaces

When [`custom-schema`](../domains/custom-schema/) lands and tenants render entity types they themselves defined, those surfaces are still registered, but `dataSchema.kind` is `"tenant-defined"` and `schemaRef` points to the tenant's schema entry (`atlas_t_<tenantId>:<typeId>:<version>`). The registry remains tenant-scoped: a tenant only sees their own tenant-defined surfaces, never another tenant's.

## Dynamic schema support

Surfaces rendering tenant-defined entity types must:

1. Declare `dataSchema: { kind: "tenant-defined", schemaRef }` in both the authored contract and the runtime snapshot.
2. Resolve `schemaRef` against the tenant's schema definition store at snapshot time. Stale schema references are an error: the snapshot returns `state: { kind: "backendError", code: "SCHEMA_VERSION_MISMATCH" }`.
3. Carry a `data` field whose shape matches the resolved schema, validated against it before serialization. Agents reading the snapshot can fetch the schema separately to type-check the data.

`schemaRef` resolution is **always tenant-scoped**. A surface in tenant A cannot reference tenant B's schema even if a tenant ID is supplied — the resolver short-circuits on cross-tenant lookups.

## Conformance

Per Invariant **I18** ([ADR 0004](../decisions/0004-platform-invariants-for-multi-tenant-fabric.md)) and REQ-AGENT-001 in [`normative_requirements.md`](../normative_requirements.md):

- Every `AtlasSurface` subclass MUST implement `getSurfaceSnapshot()` returning the documented shape.
- Every surface MUST have an entry in the surface registry, derived from its authored `surface-contract.md` entry.
- A CI check (`pnpm spec-conformance:surfaces`) enumerates `AtlasSurface` subclasses; any without a registry manifest entry or a working `getSurfaceSnapshot()` fails the build.

## What this spec does not cover

- **Action invocation.** Agents dispatch actions through the same HTTP API and CLI as humans (Invariant **I17**); this spec is about *reading* surface state, not *acting* on it.
- **Live updates.** Snapshots are point-in-time. Streaming updates (SSE/WS) are governed by the existing `ChannelSubscription` model in [`surface-contract.md`](surface-contract.md). An agent that needs liveness polls or subscribes via that surface, not via `getSurfaceSnapshot()`.
- **Visual layout.** This contract exposes state and data, not pixel positions. An agent that needs visual reasoning (e.g., screenshot QA) uses `surface-contract.md`'s `elements[]` (test IDs / DOM selectors) plus a real browser. The introspection API is not a render replacement.
- **Cross-surface composition.** A page that embeds widgets exposes its own snapshot; embedded widgets expose their own snapshots independently. There is no parent-child snapshot tree — agents enumerate via the registry and fetch each surface separately.

## Cross-references

- [`surface-contract.md`](surface-contract.md) — The design-time author contract this spec extends.
- [`architecture.md`](../architecture.md) — Invariants I17 (API/CLI/UI parity) and I18 (surface state machine-readability).
- [`decisions/0003-tenant-defined-data-model-pivot.md`](../decisions/0003-tenant-defined-data-model-pivot.md) — The agentic-first tenet that motivates this spec.
- [`decisions/0004-platform-invariants-for-multi-tenant-fabric.md`](../decisions/0004-platform-invariants-for-multi-tenant-fabric.md) — The ADR that promoted machine-readable surfaces to a platform invariant.
- [`decisions/0005-custom-schema-storage-strategy.md`](../decisions/0005-custom-schema-storage-strategy.md) — The storage decision that gives tenant-defined `dataSchema.schemaRef` its concrete form.
- [`normative_requirements.md`](../normative_requirements.md) — REQ-AGENT-001 (this spec is its enforcement target).
