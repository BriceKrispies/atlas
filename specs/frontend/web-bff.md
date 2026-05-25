# `apps/web-bff` — the frontend kernel server (the EDGE)

**Status:** Normative. Established by [`../decisions/0017-two-kernel-frontend-architecture.md`](../decisions/0017-two-kernel-frontend-architecture.md).

The key words MUST, MUST NOT, SHALL, SHALL NOT, SHOULD, SHOULD NOT, and MAY are used as defined in RFC 2119.

## Purpose

`apps/web-bff` is the **always-on, trusted edge** between the browser and the domain. It is a separate Hono process — not a route tier inside `apps/server`, not a set of per-app BFFs. The browser talks **only** to `web-bff`; `web-bff` reaches the domain **exclusively** through `apps/server`'s existing HTTP ingress.

It is the server-side half of the two-kernel frontend: the in-browser [`@atlas/web-kernel`](web-kernel.md) owns rendering and client-side dispatch, and `web-bff` owns the browser-facing intent + query contract and the mediation of all browser↔backend traffic.

Under [ADR 0016](../decisions/0016-hard-layered-ring-architecture.md) it is assigned to the **`bff` ring in the frontend stack**. This placement is the I1 safeguard (see "I1 and the no-domain rule" below).

## I1 and the no-domain rule

[ADR 0017](../decisions/0017-two-kernel-frontend-architecture.md) §4 reinterprets Invariant I1 as **single _domain_ ingress = `apps/server`**. `web-bff` is a trusted edge in front of that ingress, never a second door into the domain. The following are normative and the basis of that guarantee:

- **R-BFF-1** `web-bff` MUST own no domain logic: no handlers, no projections, no queries, no event append, no DB client, no authz evaluation. Principal resolution stays in `apps/server`'s `middleware/principal.ts`.
- **R-BFF-2** Among `@atlas/*` packages, `web-bff` MUST import **only** `@atlas/web-abi`. It MUST NOT import any backend ring (`abi`, `ports`, `runtime`, `domain`, `adapter`, `apps`) — that is a cross-stack violation — nor any `ui-*` / `web-kernel` ring — that is a non-listed-ring violation. Both are caught by `arch:check`.
- **R-BFF-3** `web-bff`'s only door to the domain is the upstream HTTP URL (`UPSTREAM_INGRESS_URL`). It reaches the domain over the same `apps/server` ingress any external client uses; every domain operation still walks the full authn → tenant → schema → idempotency → authz → dispatch → append chain in `apps/server`. Nothing is bypassed.
- **R-BFF-4** A belt-and-suspenders arch test (`packages/arch-tests/test/web-bff-no-domain.test.ts`, reusing the existing `findImportViolations()` scanner) MUST assert that `apps/web-bff/src` imports nothing matching adapter / port / module / pg-driver patterns. This complements the ring matrix, not replaces it.

The no-domain property is therefore **provable, not asserted**: the graph forbids `web-bff` from holding a handler, a port, an adapter, or a DB client.

## Serving the SPA

- **R-BFF-5** `web-bff` MUST serve each frontend app's built artefacts **same-origin** to the browser, generalizing [`apps/server/src/routes/admin-spa.ts`](../../apps/server/src/routes/admin-spa.ts) into `apps/web-bff/src/routes/spa.ts`. It MUST replicate that route's contract: serve-static of `dist/<app>`, a hash-route SPA fallback rewriting misses to `index.html`, reserved-prefix skip for non-SPA paths, and a 503-with-clear-reason when the build artefact is absent.
- **R-BFF-6** Because the browser is same-origin to `web-bff` and the `web-bff → server` hop is server-to-server, there is **no browser CORS** in the request path. This is the same cross-origin elimination `admin-spa.ts`'s kernel-extraction retro records, generalized out of the domain process.

`admin-spa.ts` remains as a fallback during migration and is retired once all apps route through `web-bff` ([ADR 0017](../decisions/0017-two-kernel-frontend-architecture.md) Migration).

## Browser-facing contract

All DTOs are defined in `@atlas/web-abi` (see the shared-wire-contract section below). The browser ([`@atlas/web-kernel`](web-kernel.md)) speaks exactly these three surfaces:

- **R-BFF-7 — `POST /intents`.** Accepts the **unwrapped** action payload from the kernel's `mutate()`. `web-bff` builds the `IntentEnvelope` via the moved `wrapIntent` (`apps/web-bff/src/envelope.ts`) and forwards it to `{UPSTREAM}/api/v1/intents`. The envelope builder is the canonical copy; the wire types are shared via `web-abi`. The kernel MUST NOT build the envelope (see [`web-kernel.md`](web-kernel.md) R-WK-12).
- **R-BFF-8 — `GET|POST /q/:ref`.** Maps and aggregates reads over `{UPSTREAM}/api/v1/queries/:id` and dedicated read endpoints. `web-bff` MAY shape / fan-in / aggregate the upstream responses into the DTO the surface needs; it MUST NOT add authorization or tenant scoping of its own (that is the upstream's job).
- **R-BFF-9 — `GET /events?tags=…`.** Pipes the upstream SSE stream through to the browser. `web-bff` MUST NOT buffer the whole stream; it relays events as they arrive (consistent with [`../crosscut/streaming-io.md`](../crosscut/streaming-io.md)).

## Trusted ingress client

- **R-BFF-10** `web-bff` MUST forward the user's session / bearer credential to the upstream ingress **as-is**. It MUST NOT mint, decode, or interpret credentials — the principal is resolved by `apps/server`.
- **R-BFF-11** `web-bff` MUST thread the kernel-supplied `correlationId` (the `X-Correlation-Id` header, constitution C6) onto every upstream call (Invariant I5), so a single trace spans browser telemetry → `web-bff` log → `apps/server` log. If a request arrives without one, `web-bff` MUST generate one and propagate it consistently.
- **R-BFF-12** `web-bff` SHOULD emit structured logs in the canonical shape ([`../crosscut/logging.md`](../crosscut/logging.md)) for every browser-facing request and every upstream call, keyed by `correlationId`.

## `@atlas/web-abi` — the shared wire contract

`@atlas/web-abi` is a pure-types, zero-dependency package (ring `web-abi`, may import nothing) — the frontend twin of `@atlas/abi`. It is the single shared home for the wire shapes both kernels speak:

- The `IntentEnvelope` wire shape.
- The `query` / `mutate` / `channel` request and result DTOs.
- `SurfaceSnapshot` / `SurfaceManifest` (see [`surface-introspection.md`](surface-introspection.md)).

It is the **only** `@atlas/*` package both `@atlas/web-kernel` and `apps/web-bff` import — which is what structurally prevents the two kernels from importing each other.

## Process shape

`apps/web-bff` mirrors `apps/server`'s shape: `src/{main,config,upstream,envelope}.ts` plus `routes/{spa,intents,queries,events}.ts`. It uses Hono + a fetch client. It holds no `AppState`-style adapter wiring because it has no adapters to wire — its only outbound dependency is the upstream HTTP URL.

`apps/sim` is exempt: it is the IndexedDB closed-loop in-browser harness and keeps its direct/in-browser mode — it does not route through `web-bff`.

## What this spec does not cover

- **Rendering** — `web-bff` is render-free. The `bff` ring forbids importing `web-kernel`, so DOM code cannot leak in. Headless `getSurfaceSnapshot()` server rendering is `apps/server`'s future job, not `web-bff`'s.
- **The in-browser primitives** — `query`/`mutate`/`channel` semantics live in [`web-kernel.md`](web-kernel.md).
- **Domain behavior** — every handler, projection, query, authz decision, and event append stays in the domain reached via `apps/server`.

## Cross-references

- [`../decisions/0017-two-kernel-frontend-architecture.md`](../decisions/0017-two-kernel-frontend-architecture.md) — the ADR establishing this edge and the I1 reinterpretation.
- [`../decisions/0016-hard-layered-ring-architecture.md`](../decisions/0016-hard-layered-ring-architecture.md) — the ring discipline; the `bff` ring's cross-stack rule is the no-domain safeguard.
- [`web-kernel.md`](web-kernel.md) — the in-browser kernel whose `query`/`mutate`/`channel` this edge serves.
- [`../../apps/server/src/routes/admin-spa.ts`](../../apps/server/src/routes/admin-spa.ts) — the same-origin SPA-serving precedent this edge generalizes.
- [`../crosscut/streaming-io.md`](../crosscut/streaming-io.md) — the streaming substrate for the SSE pipe.
- [`../crosscut/logging.md`](../crosscut/logging.md) — the structured-log shape for edge requests.
