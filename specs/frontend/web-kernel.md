# `@atlas/web-kernel` — the in-browser frontend kernel

**Status:** Normative. Established by [`../decisions/0017-two-kernel-frontend-architecture.md`](../decisions/0017-two-kernel-frontend-architecture.md).

The key words MUST, MUST NOT, SHALL, SHALL NOT, SHOULD, SHOULD NOT, and MAY are used as defined in RFC 2119.

## Purpose

`@atlas/web-kernel` is the innermost frontend ring ([ADR 0016](../decisions/0016-hard-layered-ring-architecture.md) frontend stack; ring `web-kernel`, may import `web-abi` only). It is the **single chokepoint everything rendered in the browser passes through, down to individual components**, and the owner of the reactive data primitives the constitution mandates (C14 `query()`/`mutate()`, C15 `channel()`).

It depends only on [`@atlas/web-abi`](web-bff.md) for wire types and on `@atlas/logging` (the sanctioned cross-stack leaf, [ADR 0016](../decisions/0016-hard-layered-ring-architecture.md) §4). `@atlas/core` adds `@atlas/web-kernel` as a dependency; **`web-kernel` MUST NOT import `@atlas/core`, `@atlas/design`, or any `ui-*` ring** — the dependency points inward.

The kernel generalizes a pattern that already works in [`@atlas/widget-host`](../../packages/widget-host): a validate-at-register registry (`registry.ts`), a declared-topic mediator (`mediator.ts`), and a declared-capability bridge (`capabilities.ts`). `web-kernel` SHALL reuse that shape rather than invent a parallel one.

## The render chokepoint rule

**Nothing renders off-kernel.** Every DOM mutation that places authored content on the page MUST flow through the kernel's render path. Concretely:

- **R-WK-1** The single DOM-append in `AtlasElement._safeRender()` ([`packages/core/src/component.ts:183`](../../packages/core/src/component.ts)) MUST route through `webKernel.render(el, () => el.render())`. The kernel owns the append body, the surrounding try/catch, and the `Atlas.Render.Failed` telemetry emission.
- **R-WK-2** The kernel MUST NOT replace the `effect(() => this._safeRender())` wiring set up in `connectedCallback` ([`component.ts:166`](../../packages/core/src/component.ts)). Decentralized, signal-driven re-render stays as-is. The chokepoint owns *where content lands*, not *when render runs*. This boundary is deliberate (see [ADR 0017](../decisions/0017-two-kernel-frontend-architecture.md) Consequences) and exists to leave room for a future render scheduler without reworking re-render semantics across the component set.
- **R-WK-3** Authored frontend code (any `ui-*` ring) MUST NOT write to the DOM directly. `innerHTML =`, `appendChild`, `insertAdjacentHTML`, and equivalent direct DOM-write APIs are forbidden outside `@atlas/web-kernel` and `@atlas/core`'s `html.ts`. This restates constitution C12.3 as a kernel boundary.

### Enforcement

- **Static** — a lint rule (oxlint/semgrep) bans direct DOM-write APIs in `ui-*` source outside `web-kernel` and `core/html.ts`.
- **Runtime** — `webKernel.render(el, …)` MUST assert that `el` previously called `mount()` (see SurfaceRegistry). On a render from an unmounted element it emits `Atlas.Render.OffKernel` telemetry and, in dev mode, throws so Vitest fails loudly.
- **Spec-conformance** — `pnpm spec-conformance:surfaces` is extended to assert every `AtlasElement.define` tag is registry-reachable and every `AtlasSurface` subclass implements `getSurfaceSnapshot()`.

## The registries

### ElementRegistry (class-level)

- **R-WK-4** `AtlasElement.define(tag, ctor)` ([`component.ts:86`](../../packages/core/src/component.ts)) MUST call `webKernel.registerElement(tag, ctor)` **before** `customElements.define(tag, ctor)`. Every custom element is kernel-known at definition time. Because `define` is the only registration path in Atlas, this makes "every component is registered on the kernel" a statically provable property.
- **R-WK-5** Registration MUST preserve the existing idempotent / warn-once-on-conflict semantics: a re-register of the same tag to the same constructor is a no-op; a re-register to a *different* constructor warns once and is ignored.

### SurfaceRegistry (instance-level)

- **R-WK-6** `AtlasElement.connectedCallback` MUST call `webKernel.mount(this)` and `disconnectedCallback` MUST call `webKernel.unmount(this)`. The SurfaceRegistry is the live set of currently-mounted surfaces and elements.
- **R-WK-7** The SurfaceRegistry is the **prod-safe runtime substrate** for `getSurfaceSnapshot()` and the `GET /api/v1/surfaces` registry (Invariant I18; see [`surface-introspection.md`](surface-introspection.md)). It is **not** a dev-only affordance: unlike `@atlas/test-state`'s `window.__atlasTest`, it is present in production and authz-gated at the introspection boundary.
- **R-WK-8** `@atlas/test-state` MUST become a thin dev-only *view* over the SurfaceRegistry, not a second store. Surface state has exactly one source of truth.
- **R-WK-9** `AtlasSurface` instances MUST register at mount. Leaf-element instance registration (e.g. every `atlas-button` connect) MAY be gated to dev/introspection mode to avoid a per-connect Map operation in the hot path; the `ElementRegistry` (one entry per tag) is always present regardless of this gate.

## The data primitives (constitution C14/C15)

`@atlas/web-kernel` is the implementation home for the reactive data primitives the constitution mandates but that were never built. All three return signals and talk to `apps/web-bff` (see [`web-bff.md`](web-bff.md)); they MUST NOT talk to `apps/server` directly except via a guarded migration path that is removed once all apps route through the BFF.

The signal primitives (`signal`, `computed`, `effect`, `batch`) themselves move from `@atlas/core` into `@atlas/web-kernel` (a zero-dependency inward move); `@atlas/core` re-exports them for back-compat.

### `query()`

- **R-WK-10** `query<T>(ref, params?)` MUST return `{ data, loading, error, refetch }` as signals. It MUST cache by key, single-flight concurrent identical requests, and invalidate matching cached queries when a `channel()` event with matching tags arrives.
- **R-WK-11** `query()` MUST issue reads against `apps/web-bff`'s `GET|POST /q/:ref` contract, never against the domain ingress directly. `AtlasSurface.load()` is reimplemented on top of `query()`.

### `mutate()`

- **R-WK-12** `mutate(actionId, payload)` MUST POST the **unwrapped** payload to `{BFF}/intents`. The `IntentEnvelope` is built server-side by `web-bff` (the moved `wrapIntent`); the kernel MUST NOT build the envelope.
- **R-WK-13** `mutate()` MUST stamp a client-generated `idempotencyKey` (I3) and `correlationId` (I5, constitution C6 — UUIDv4 generated at the point of user action) on the request, so the trace spans browser → bff → server.

### `channel()`

- **R-WK-14** `channel(opts?)` MUST connect to `{BFF}/events?tags=…`, default to SSE transport (constitution C15.2), expose `channel.connected: Signal<boolean>` (C15.5), and reconnect with exponential backoff.
- **R-WK-15** `channel()` MUST NOT mutate the DOM. Received events invalidate matching `query()` caches or update signals (C15.3); the reactive system handles re-render. Every received event is logged to telemetry with type + timestamp (C15.6). This generalizes the EventSource pool currently in `packages/api-client`. `AtlasSurface.bindBackend`/`subscribesTo` are reimplemented over `channel()`.

## Telemetry

Kernel render and dispatch events (`Atlas.Render.Failed`, `Atlas.Render.OffKernel`, query/mutate/channel timing) MUST emit through the existing `telemetry-pipeline.ts` in `@atlas/core`, not a parallel sink.

## What this spec does not cover

- **The wire shapes** of `query`/`mutate`/`channel` requests and results — those live in [`@atlas/web-abi`](web-bff.md) and are the contract `web-kernel` and `web-bff` share.
- **Server-side rendering / headless snapshots** — `web-kernel` is browser-only and render-bearing; SSR is `apps/server`'s future concern and the `bff` ring forbids importing `web-kernel` ([ADR 0017](../decisions/0017-two-kernel-frontend-architecture.md)).
- **Envelope construction** — owned by `web-bff` ([`web-bff.md`](web-bff.md)), not the in-browser kernel.

## Cross-references

- [`../decisions/0017-two-kernel-frontend-architecture.md`](../decisions/0017-two-kernel-frontend-architecture.md) — the ADR establishing this kernel.
- [`../decisions/0016-hard-layered-ring-architecture.md`](../decisions/0016-hard-layered-ring-architecture.md) — the ring discipline `web-kernel` is the innermost frontend member of.
- [`web-bff.md`](web-bff.md) — the server-side kernel `query`/`mutate`/`channel` talk to.
- [`constitution.md`](constitution.md) — C14/C15 (the primitives this kernel owns), C6 (correlationId), C12.3 (no direct `innerHTML`).
- [`surface-introspection.md`](surface-introspection.md) — `getSurfaceSnapshot()` / `GET /api/v1/surfaces` (I18), for which the SurfaceRegistry is the runtime substrate.
- [`../../packages/widget-host`](../../packages/widget-host) — the `registry.ts`/`mediator.ts`/`capabilities.ts` pattern this kernel generalizes.
