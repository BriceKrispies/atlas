# `/apps` — Runnable Units

Each app is a deployable artifact: a Hono server or a Vite SPA shell. Apps are
the only place that wires concrete adapters, registers HTTP routes, or boots a
UI shell.

## Inventory

| App | Type | Purpose | Dev port |
|-----|------|---------|----------|
| **`server/`** — `@atlas/server` | Node + Hono | Production HTTP ingress; intents, catalog, authz, content-pages, events. **Read [`server/CLAUDE.md`](server/CLAUDE.md).** | 3000 |
| **`projection-worker/`** — `@atlas/projection-worker` | Node | Polls event store, runs projections + cache invalidation | — |
| **`admin/`** — `@atlas/admin` | Vite SPA | Admin shell: pages list, authz policy editor | 5173 (or 5199 in `playwright.config.ts`) |
| **`authoring/`** — `@atlas/authoring` | Vite SPA | Page-template editor, block editor, layout editor, gallery | 5181 |
| **`sandbox/`** — `@atlas/sandbox` | Vite SPA | Specimen gallery + registry inspection for design / widgets | 5180 |
| **`sim/`** — `@atlas/sim` | Node | Closed-loop in-process sim for parity tests | — |

How to tell at a glance:
- **Server-side** apps have a Node entry in `package.json`'s `main`/`exports` and use Hono.
- **Frontend** apps ship a `vite.config.ts` and `index.html`, and register custom elements at boot.

## Server-side: `apps/server`

Brief — full detail in [`server/CLAUDE.md`](server/CLAUDE.md):

- HTTP framework: **Hono** (`@hono/node-server`)
- Entry: `src/main.ts`; long-lived state assembled in `src/bootstrap.ts`
- Routes: `src/routes/{intents,catalog,authz,content-pages,events,debug,health}.ts`
- Middleware: `src/middleware/{principal,errors,correlation,state}.ts`
- Auth: JWT (OIDC via `jose`) or `X-Debug-Principal` (gated by `TEST_AUTH_ENABLED=true`)
- DB: `postgres` (postgres.js); pools via `@atlas/adapter-node`'s `TenantDbProvider`
- Adapters wired: `node` (Postgres), `policy-cedar` or `policy-stub`

## Frontend Apps

All three Vite apps follow the same shape:

```
src/
  main.ts                 register design + widgets, import the shell
  <shell-name>.ts         the top-level <atlas-…> custom element
  features/ or pages/     route-level components (extend AtlasSurface)
  shared/                 utilities / helpers
index.html                <atlas-…> as the root
vite.config.ts
```

**Page-loading model.** Every shell extends `AtlasSurface` (or contains one).
Routes resolve to child custom elements; the shell mounts the active route.
Both design and widgets must be imported in `main.ts` so their
`customElements.define(...)` calls run before the shell is upgraded.

| App | Shell tag | Routing source |
|-----|-----------|----------------|
| admin | `<admin-shell>` (`shell/AdminShell.ts`) | hardcoded module list, `data-route` dispatch |
| authoring | `<atlas-authoring>` (`authoring-app.ts`) | `ROUTES[]` array + history pushState |
| sandbox | `<atlas-sandbox>` (`sandbox-app.ts`) | registry-driven sidebar + tab bar |

## Per-app Dependencies

| App | `@atlas/*` deps |
|-----|-----------------|
| **server** | `adapter-node`, `adapter-policy-cedar`, `adapter-policy-stub`, `ports`, `platform-core`, `schemas`, `metrics`, `wasm-host`, `ingress`, `authz`, `catalog`, `content-pages` |
| **admin** | `core`, `design`, `widgets`, `api-client`, `test-fixtures` |
| **authoring** | `core`, `design`, `widgets`, `widget-host`, `page-templates`, `test-state`, `test-fixtures` |
| **sandbox** | `core`, `design`, `widgets`, `widget-host`, `page-templates`, `test-fixtures` |

## Conventions

- **One job per app.** A single deployable concern (HTTP server, admin SPA, …). Don't pile features into one app to avoid creating a new one.
- **No domain logic in apps.** Apps wire modules and adapters; they should not host handler bodies, projection logic, or query construction.
- **Shells extend `AtlasSurface`.** This is what gives nested elements a stable `surfaceId` for test IDs.
- **Adapter wiring lives in `bootstrap.ts`** (server) or `main.ts` (frontend). Never inside a route or feature module.

## Adding a Frontend App

1. Copy the smallest existing shape (sandbox is the leanest).
2. Pick a port not in use; update root `playwright.config.ts` if you want it under E2E.
3. Import `@atlas/core`, `@atlas/design`, and any widgets you need in `main.ts`.
4. Define your shell as a custom element extending `AtlasSurface`.
5. Wire the shell in `index.html` as the root `<atlas-…>` element.

## Adding a Server App

Don't, unless the user has specifically asked. Invariant **I1** says all
requests go through the single ingress chokepoint — that is `apps/server`.
Adding another HTTP-exposing app violates I1.
