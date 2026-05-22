---
title: admin SPA cross-origin reality — apps/server lacks CORS for the Vite-served admin
status: done
type: drift-finding
owner: architect
phase: 3
capability:
adr: specs/decisions/0008-atlas-on-atlas.md
vision: [atlas-on-atlas, tiny-core, agentic-first]
invariants: [I20]
blocks: []
blocked_by: []
files_in_scope:
  - apps/server/src/main.ts
  - apps/admin/vite.config.ts
created: 2026-05-21
updated: 2026-05-21
---

## 1. What category of change was this?

The first I20 zero-restart demonstration (`tickets/identity/tenant-admin-invites-user.md`) assumes the admin SPA (Vite-served) and apps/server (Hono on `:3000`) can talk to each other from the browser. They cannot — Vite serves the admin on a different port, the browser treats that as a different origin, and apps/server ships no CORS middleware. **Category: "the kernel assumes single-origin for the browser-side dev loop; deploying browser code separately from the server forces a kernel change."**

## 2. What forced it into the kernel?

Two structural couplings collide:

- **I1 — single ingress chokepoint.** `apps/server` is the only HTTP boundary, by invariant. The admin SPA cannot expose its own HTTP for the intent submission; it must POST cross-origin to `apps/server`.
- **Browser CORS policy.** Without `Access-Control-Allow-Origin` on the preflight + actual response, the browser blocks the cross-origin `fetch` before the request reaches the server.

The combination forces *some* server-side acknowledgment of the admin SPA's origin. That code lives in `apps/server/src/main.ts` (the boot wiring) — kernel surface per `always-on.md` §2.

## 3. What's the missing seam?

Two viable seams, pick one:

- **(a) Hono CORS middleware gated on `ATLAS_ENVIRONMENT=test` / `TEST_AUTH_ENABLED=true`.** Concrete location: `apps/server/src/main.ts` around the existing public-group mount, before any route. Add `app.use('/api/*', cors({ origin: allowedOrigins, credentials: true }))` with `allowedOrigins` reading from `ATLAS_DEV_ORIGINS` env var (defaulting to `['http://localhost:5180', 'http://acme.localhost:5180']`). One PR; the kernel learns "in dev/test the admin SPA's origin is allowed." This is a small kernel touch but the right shape for a dev-loop reality that won't go away.
- **(b) `serveStatic` of the admin SPA's build output from `apps/server`.** Concrete location: a new route group `apps/server/src/routes/admin-spa.ts` that mounts `serveStatic({ root: '../../apps/admin/dist' })` for any non-`/api/*` path. Eliminates the cross-origin reality entirely — admin SPA and apps/server become same-origin in prod. Still needs CORS for the Vite **dev** loop (HMR), but the prod path is structurally cleaner.

(b) is the structural fix; (a) is the smallest unblock. The extraction-plan ticket below picks (a) as the immediate move and tracks (b) as a follow-up.

## 4. What's the extraction plan?

Path: `chore/admin-spa-cors-middleware` (to be filed alongside the unblock PR).

Acceptance reads: "in test/dev mode, the admin SPA's Vite-served origin can POST `/api/v1/intents` and `GET /api/v1/queries/:queryId` against apps/server without browser CORS rejections; the BDD scenario at `tests/bdd/features/identity/tenant-admin-invites-user/admin-invites-user-and-user-logs-in.feature` completes end-to-end."

The extraction-plan ticket is `chore/admin-spa-cors-middleware`; not yet created — agent picking up this finding scopes it as the next move.

## 5. Confidence the category is now closed

**narrow** — the immediate CORS addition is still a kernel diff. The follow-up `serveStatic` move (option b above) would actually close the category by making admin SPA and apps/server same-origin in prod; until then this category resurfaces every time a new Vite app is added to the workspace (`apps/authoring`, `apps/sandbox`, …).

## Notes / log

- 2026-05-21: filed by frontend-dev as part of Phase 1 of `tickets/identity/tenant-admin-invites-user.md`. Discovered while wiring the I20 zero-restart BDD demonstration: `pnpm bdd:server` will not complete the cross-origin `Identity.Login.Password` POST without this seam. Slice STOPS the end-to-end BDD acceptance pending the unblock; the surfaces + step bindings + I20 probe wiring are in place.
- 2026-05-21: superseded by `tickets/kernel-extraction/admin-spa-serve-static.md` — module-dev shipped option (b) (`serveStatic` of the admin SPA from `apps/server`) per user choice, rather than option (a) (Hono CORS middleware). The structural fix this retro proposed AS the right move under §3 is what landed. The new retro carries the §11.2 five-field structure for the extraction that actually merged. Status flipped to `done`; architect verifies + archives at gate alongside the new retro. Confidence the category is now closed: this retro recorded `narrow`; the new retro records `closed` for the BDD-path / I20-witness layer with three named hedges (Vite HMR dev loop, missing build artefacts, route mount order) each carrying its own failsafe. Vite HMR cross-origin remains as a recorded sub-category but is not blocking.
