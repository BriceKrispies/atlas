# 0017 — Two-kernel frontend architecture (`web-kernel` + `web-bff`)

**Status:** Accepted (2026-05-24)
**Builds on:** [`0016-hard-layered-ring-architecture.md`](0016-hard-layered-ring-architecture.md) (concentric rings) and [`0008-atlas-on-atlas.md`](0008-atlas-on-atlas.md) (recursive kernel). References [`../crosscut/kernel-vs-data.md`](../crosscut/kernel-vs-data.md) (kernel/data inventory). This ADR **extends the ring discipline into the frontend** — it names two new trusted frontend chokepoints (one in-browser, one server-side) and the wire contract they share, and it **reinterprets Invariant I1** so the server-side chokepoint is provably *not* a second door into the domain. It does **not** contradict 0016: the new rings live in the frontend stack and obey the same inward-only rule.

## Context

[ADR 0016](0016-hard-layered-ring-architecture.md) made the backend's kernel/data split a provable graph property: dependencies point inward, `abi → ports → runtime → domain ∥ adapter → apps`, with a parallel frontend onion (`core → design → widgets → … → apps`). The backend now has one trusted, small, statically-enforced kernel; the frontend has rings but no *kernel* — no package owns the seams the way `@atlas/ingress` owns the request lifecycle.

Two facts make a frontend kernel both possible and overdue:

1. **The frontend already has the seams; nothing owns them.** Rendering is centralized by construction — `AtlasElement.define()` ([`packages/core/src/component.ts:86`](../../packages/core/src/component.ts)) is the only registration path, `connectedCallback` ([`component.ts:166`](../../packages/core/src/component.ts)) is the only mount path, and `_safeRender()` ([`component.ts:183`](../../packages/core/src/component.ts)) is the only DOM-append site. Intent dispatch converges on a single client chokepoint (`wrapIntent` → `POST /api/v1/intents`). [`@atlas/widget-host`](../../packages/widget-host) already proves a frontend isolation runtime (a validate-at-register `registry.ts`, a declared-topic `mediator.ts`, a declared-capability `capabilities.ts`). These are kernel seams with no kernel.

2. **The constitution mandates primitives that were never built.** [`../frontend/constitution.md`](../frontend/constitution.md) C14 (`query()`/`mutate()`) and C15 (`channel()`) are written as hard rules — "data fetching MUST go through `query()` or `mutate()`", "server-initiated updates MUST arrive via `channel()`". No package implements them. The rules point at an owner that does not exist. This is a live spec↔implementation gap.

Separately, the **edge tier** has a working precedent that is currently ad-hoc. [`apps/server/src/routes/admin-spa.ts`](../../apps/server/src/routes/admin-spa.ts) serves the admin SPA's built artefacts **same-origin** from `apps/server` — a structural extraction landed specifically to dodge cross-origin reality in both the I20 BDD path and prod (its kernel-extraction retro at `tickets/kernel-extraction/admin-spa-serve-static.md`). That is a frontend-serving + mediation responsibility that has been smuggled into the domain ingress because there was nowhere else to put it.

The decision below names the missing owners — an in-browser kernel and a server-side edge kernel — and reframes I1 so the edge kernel is provably trusted, never a second domain door.

## Decision

Atlas adopts a **two-kernel frontend architecture**: one in-browser kernel (`@atlas/web-kernel`), one always-on server process (`apps/web-bff`), sharing one wire contract (`@atlas/web-abi`). Both are new frontend-stack rings under [ADR 0016](0016-hard-layered-ring-architecture.md); neither imports the other.

```text
[ browser SPA — every rendered node is an AtlasElement registered on web-kernel ]
        │  query() / mutate() / channel()  (signals)        ▲ data + SSE
        ▼                                                    │
[ apps/web-bff ]  the frontend kernel — always-on, trusted EDGE
   • serves the SPA (generalizes admin-spa.ts)
   • owns the UI intent+query contract; builds the IntentEnvelope (wrapIntent moves here)
   • aggregates/shapes reads; pipes SSE; threads correlationId; forwards session
   • imports NO @atlas/* except @atlas/web-abi   ← provably not a domain door
        │  HTTP (trusted ingress client)
        ▼
[ apps/server ]  the single DOMAIN ingress (I1) — unchanged: authn, tenant,
                 schema, idempotency, authz, handler dispatch, event append
        ▼
[ modules / adapters / ports / abi ]
```

### 1. `@atlas/web-kernel` — the in-browser kernel (innermost frontend ring)

The chokepoint **everything rendered passes through, down to individual components** (e.g. `atlas-button`), plus the reactive data primitives the constitution mandates. Its contract is specified in [`../frontend/web-kernel.md`](../frontend/web-kernel.md). It owns:

- **`ElementRegistry`** — `AtlasElement.define()` routes through `webKernel.registerElement(tag, ctor)` before `customElements.define`. Every component is kernel-known at definition time, statically provable (all `define` flows through the kernel).
- **`SurfaceRegistry`** — `connectedCallback`/`disconnectedCallback` call `webKernel.mount(this)`/`unmount(this)`. A prod-safe generalization of the dev-only `@atlas/test-state`; the runtime substrate for `getSurfaceSnapshot()` and `GET /api/v1/surfaces` (Invariant I18).
- **The render chokepoint** — the single DOM-append in `_safeRender()` routes through `webKernel.render(el, () => el.render())`. The kernel owns **only the append body + the existing try/catch + `Atlas.Render.Failed` telemetry** — it does **not** replace the `effect(() => this._safeRender())` wiring. Decentralized effect-render stays intact; "nothing renders off-kernel" becomes true; a future scheduler has a home.
- **`query()` / `mutate()` / `channel()`** — the signal-returning data primitives of constitution C14/C15, talking to `apps/web-bff`. This closes the spec↔implementation gap: C14/C15 now have a kernel owner.

### 2. `apps/web-bff` — the frontend kernel server (the EDGE)

A **separate always-on Hono process** (not a route tier inside `apps/server`, not per-app BFFs). Its contract is specified in [`../frontend/web-bff.md`](../frontend/web-bff.md). The browser talks **only** to it; it serves the SPA and mediates all browser↔backend traffic, reaching the domain **exclusively** through `apps/server`'s HTTP ingress. It:

- **Serves the SPA** — generalizes [`admin-spa.ts`](../../apps/server/src/routes/admin-spa.ts) (serve-static of `dist/<app>` + hash-route fallback + 503-when-unbuilt). The browser is same-origin to `web-bff`; the `web-bff → server` hop is server-to-server, so no browser CORS.
- **Owns the browser-facing contract** — `POST /intents` (builds the `IntentEnvelope` via the moved `wrapIntent`, forwards to the upstream ingress), `GET|POST /q/:ref` (map/aggregate over the upstream query API), `GET /events?tags=…` (pipes the upstream SSE through).
- **Is a trusted ingress client** — forwards the user's session/bearer as-is; the **principal is resolved by `apps/server`** (`middleware/principal.ts`), never by `web-bff`. It threads the kernel's `correlationId` onto every upstream call (I5).
- **Owns no handlers, no DB, no authz.** Among `@atlas/*` it imports `@atlas/web-abi` **only**. Its single door to the domain is the upstream HTTP URL.

### 3. `@atlas/web-abi` — the shared wire contract

A pure-types, zero-dependency package — the frontend twin of `@atlas/abi`. The single shared home for the wire shapes both kernels speak: the intent envelope wire shape, the `query`/`mutate`/`channel` request and result DTOs, and `SurfaceSnapshot` / `SurfaceManifest`. It is the **only** package both `web-kernel` and `web-bff` import, which is what keeps the two kernels from importing each other.

### 4. The load-bearing decision — reinterpreting I1

I1 today reads "all requests go through the single ingress chokepoint — no other module/package exposes HTTP," and [`apps/CLAUDE.md`](../../apps/CLAUDE.md) operationalizes it as "Adding another HTTP-exposing app violates I1." Taken literally, a separate `apps/web-bff` process *is* a second HTTP-exposing app.

**I1 is reinterpreted as: single domain ingress = `apps/server`.**

What I1 was always protecting is **the domain** — that no request reaches a handler, an event append, an authz decision, or a tenant database except through the one audited pipeline. `apps/web-bff` is a **trusted edge/proxy** in front of that ingress, not a second entrance to it:

- It owns **no handlers, no DB, no authz, no event append.** Principal resolution stays in `apps/server`. The edge forwards credentials; it does not mint or interpret them.
- It reaches the domain **only** over `apps/server`'s existing HTTP ingress — the same door any external client uses. Every domain operation still walks the full authn → tenant → schema → idempotency → authz → dispatch → append chain in `apps/server`. Nothing is bypassed.
- Its no-domain property is **provable, not asserted.** Under [ADR 0016](0016-hard-layered-ring-architecture.md), `web-bff` is assigned to a `bff` ring in the **frontend stack**. Any import of a backend ring (`abi`, `ports`, `runtime`, `domain`, `adapter`, `apps`) is a cross-stack violation; any import of a `ui-*`/`web-kernel` ring is a non-listed-ring violation. Both are caught by `arch:check`. The only `@atlas/*` it may import is `@atlas/web-abi`. The edge therefore *cannot* hold a handler, a port, an adapter, or a DB client — the graph forbids it.

This does **not** weaken I1. It names what I1 was protecting (the domain) and adds an edge tier in front of it, with the edge's harmlessness mechanically enforced. The precedent is already live: `admin-spa.ts` serves the SPA same-origin from `apps/server` and mediates browser↔backend reality (its I20 kernel-extraction retro records why). The BFF **generalizes that exact responsibility** out of the domain ingress and into a tier that the ring matrix proves is domain-free — which is strictly cleaner than the status quo, where SPA-serving lives inside the domain process. [`apps/CLAUDE.md`](../../apps/CLAUDE.md)'s "adding another HTTP-exposing app violates I1" rule is amended in a later PR to read "adding another *domain*-exposing app violates I1; an edge proxy in the `bff` ring that holds no domain code is the sanctioned exception."

### 5. The new rings

Three new frontend-stack rings, all obeying the inward-only rule:

| Ring | Stack | May import | Holds |
|------|-------|-----------|-------|
| `web-abi` | frontend | (nothing) | `@atlas/web-abi` — pure wire types |
| `web-kernel` | frontend | `web-abi` | `@atlas/web-kernel` — in-browser render + data kernel |
| `bff` | frontend | `web-abi` | `apps/web-bff` — the edge proxy |

`ui-core` / `ui-design` / `ui-composite` / `ui-template` / `ui-bundle` / `ui-app` gain `web-kernel` as an allowed inward import (and `ui-app` also gains `web-abi`). The [ADR 0016](0016-hard-layered-ring-architecture.md) cross-stack leaf allowance for `@atlas/logging` extends to `web-kernel`. The concrete `architecture/rings.json` edits land in a later PR; this ADR records the ring model.

## Consequences

**Positive:**

- **Closes the C14/C15 spec↔implementation gap.** The constitution's `query()`/`mutate()`/`channel()` rules have been unenforceable because nothing implemented them; `@atlas/web-kernel` is now their declared owner. The rules become checkable.
- **The frontend gets a provable kernel.** "Nothing renders off-kernel" becomes a graph + runtime property, mirroring how 0016 made the backend kernel/data split provable. The widget-host isolation pattern is generalized rather than re-invented.
- **The edge's harmlessness is mechanically enforced.** The `bff` ring's cross-stack rule proves `web-bff` holds no domain code — a stronger guarantee than the prose rule it replaces. SPA-serving and browser↔backend mediation move *out* of the domain process, shrinking what the domain ingress is responsible for.
- **One correlationId threads browser → bff → server (I5).** The kernel stamps `correlationId` at the point of user action (constitution C6); `web-bff` forwards it on every upstream call. A single trace spans the whole path, where today the browser→server hop is the trace origin.

**Negative:**

- **Dual SPA serving during transition.** `admin-spa.ts` and `web-bff/routes/spa.ts` both serve the SPA until migration completes. The plan keeps `admin-spa.ts` as the fallback during cut-over and retires it once all apps route through `web-bff`. Residual: two serving paths until cleanup.
- **The in-browser render chokepoint owns only the `_safeRender` append body** — explicitly **not** the `effect(() => this._safeRender())` signal-effect wiring. Replacing the effect would risk re-render semantics across 140+ components and the surface load lifecycle. The chokepoint enables a future scheduler; it does not introduce one now. This boundary is deliberate and load-bearing.
- **A `signals.ts` inward move.** The signal primitives move into `web-kernel` (a zero-dependency inward move; `@atlas/core` re-exports for back-compat). Broad in importer count, additive in shape — the same migration profile as 0016's `@atlas/abi` carve-out.

**Out of scope for this ADR:**

- **The `architecture/rings.json` edits, the generator run (`pnpm arch:emit`), and any code, `package.json`, or test changes** — this ADR is spec-only. Each lands as its own slice under the slice workflow per the plan's PR sequence.
- **Amending [`apps/CLAUDE.md`](../../apps/CLAUDE.md)'s I1 prose and [`packages/CLAUDE.md`](../../packages/CLAUDE.md)** — handled when the rings land, to avoid documenting a not-yet-enforced rule.
- **Promoting the two-kernel discipline to a numbered invariant (I-series)** — if the `bff`-ring no-domain rule warrants its own invariant ID, that is a separate architect decision.
- **SSR / headless `getSurfaceSnapshot()` server rendering** — that remains `apps/server`'s future job; the `bff` ring forbids importing `web-kernel`, so DOM code cannot leak into `web-bff`, and the edge stays render-free.

## Migration

This ADR is spec-only. Concretely:

1. **This PR:** ADR 0017 + [`../frontend/web-kernel.md`](../frontend/web-kernel.md) + [`../frontend/web-bff.md`](../frontend/web-bff.md); point [`../frontend/constitution.md`](../frontend/constitution.md) C14/C15 at `web-kernel`; name the `SurfaceRegistry` substrate in [`../frontend/surface-introspection.md`](../frontend/surface-introspection.md).
2. **Next:** edit `architecture/rings.json` (3 rings + assignments + transient waivers), `pnpm arch:emit`, scaffold empty `packages/web-abi/`, `packages/web-kernel/`, `apps/web-bff/`, add the `web-bff-no-domain` arch test. `arch:check` green on day one.
3. **Then, one slice each:** `@atlas/web-abi` wire types; `@atlas/web-kernel` (move `signals.ts`, implement registries + render chokepoint + `query`/`mutate`/`channel`); migrate `api-client` onto the kernel; stand up `apps/web-bff`; pilot `apps/admin` browser→bff→server; roll out authoring/sandbox and retire `admin-spa.ts`.

No code changes in this PR.
