---
title: §11 retro — admin SPA cross-origin reality forced a kernel touch; this PR serves the SPA same-origin from apps/server and closes the category for the BDD path
status: scoped
type: drift-finding
owner: architect
phase: 3
capability:
adr: specs/decisions/0008-atlas-on-atlas.md
vision: [atlas-on-atlas, tiny-core, agentic-first]
invariants: [I1, I20]
blocks: []
blocked_by: []
files_in_scope:
  - apps/server/src/routes/admin-spa.ts
  - apps/server/src/main.ts
  - playwright.bdd.server.config.ts
  - tests/bdd/support/bdd-server-global-setup.ts
acceptance:
  - five §11.2 body fields filled
  - extraction-plan ticket exists at the linked path with status >= scoped
  - architect gate verified the retro per §11.3 (retro exists, five fields filled, linked extraction-plan ticket exists)
created: 2026-05-21
updated: 2026-05-21
---

## 1. What category of change was this?

The admin SPA was served by a separate Vite dev server (different port, therefore a different browser origin), creating a same-origin requirement that the BDD harness could not satisfy without either (a) a CORS middleware kernel touch in `apps/server/src/main.ts` or (b) a `serveStatic` kernel touch mounting a new route group. The category is: **"a new browser app added to the workspace forces a same-origin question that the kernel must answer."** Predecessor CORS retro (`tickets/archive/kernel-extraction/admin-spa-cors-for-i20-bdd.md`, archived after this slice's gate) named the same category but proposed option (a) as the unblock and option (b) as the structural fix. This PR ships option (b).

## 2. What forced it into the kernel?

Two structural couplings collide:

- **`always-on.md` §11.1 row 2** (new HTTP route mount in `apps/server/src/main.ts`). The `app.route('/', adminSpaRoutes(state))` line at the bottom of `buildApp` is a new mount, triggering the retrospective by §11.1's letter. The mount is unavoidable because the Hono listener bootstrap (`apps/server/src/main.ts`) is in the §2 kernel-surface table (row 5, framework binding).
- **I1 (single ingress).** The admin SPA cannot expose its own HTTP for intent submission; it must POST cross-origin to `apps/server`, OR the SPA must be served from `apps/server` so the cross-origin reality vanishes. I1 forces the SPA-to-API direction (SPA talks to apps/server, never the reverse) and forbids the SPA from being a separate HTTP boundary. The choice between (a) CORS and (b) serveStatic is therefore a choice between *acknowledging* cross-origin (a) and *eliminating* it (b). I1 is not loosened by either path.

The change is kernel by §11.1 row 2 + §2 row 5 — same constellation as retro #2 (query-side catch-all). Category novelty is that this is the first time a *frontend artefact* (built SPA bundle) had to be served by the kernel; prior reads were all JSON over `/api/*`.

## 3. What's the missing seam?

The seam this PR ships:

- **`apps/server/src/routes/admin-spa.ts`** — a new route group exporting `adminSpaRoutes(state)`. Mounts `serveStatic({ root: '../../dist/admin' })` for `/assets/*` and an SPA-fallback catch-all for any non-API GET that the earlier route groups didn't claim. Reserved-prefix guard (`/api/`, `/oauth/`, `/saml/`, `/scim/`, `/healthz`, `/readyz`, `/metrics`, `/signup`, `/docs`) is defensive against route-order mistakes.
- **`apps/server/src/main.ts`** — single line at the bottom of `buildApp`: `app.route('/', adminSpaRoutes(state))`. Mounted last so every authed + public API route takes precedence.
- **`tests/bdd/support/bdd-server-global-setup.ts`** — Playwright `globalSetup` script that runs `vite build` for `@atlas/admin` before any `webServer` entry boots, with `VITE_BACKEND=http` and `VITE_API_URL=''` so the built SPA issues relative `/api/v1/...` fetches against whatever origin served `index.html`.
- **`playwright.bdd.server.config.ts`** — wired `globalSetup: './tests/bdd/support/bdd-server-global-setup.ts'`.

The seam is operationally complete for the BDD path: the admin SPA and the API are same-origin on `http://acme.localhost:3000` (and any `<slug>.localhost:3000`), so the cross-origin reality the predecessor retro called out no longer exists in the witness flow.

The Vite HMR dev loop (`pnpm dev` → `vite serve` on a separate port, hitting apps/server on `:3000`) is still cross-origin — that's the hedge captured in Field 5 below and is *not* in scope for this slice.

## 4. What's the extraction plan?

**Path:** `kernel-extraction/admin-spa-serve-static` (this same ticket).

**Status at retro time:** `scoped` (filed alongside the kernel touch per §11.3).

**Self-referential is honest here per sdet's calibration rule from retro #2** ("Self-referential extraction is honest only at minimum-viable closure"): the BDD path — the user's feature-shipping witness for I20 — is closed by this PR. The minimum-viable closure for the named category ("a new browser app added to the workspace forces a same-origin question that the kernel must answer") is the substrate ([`adminSpaRoutes`](../../apps/server/src/routes/admin-spa.ts)) + the build-then-serve wiring ([`globalSetup`](../../tests/bdd/support/bdd-server-global-setup.ts)). Future admin-app surfaces (more routes, more assets) are now data-plane additions: edit `apps/admin/index.html` + add a feature surface; no kernel touch.

**This counts as the second instance of self-referential extraction** (the first was retro #2 / query-side catch-all). Not yet the three-recurrence escalation threshold from architect's gate-4 calibration. See log entry below for the explicit grep result.

**Follow-up extraction ticket (for the Vite-dev-loop hedge):** if the hedge fires (the team needs CORS for the dev HMR loop without rebuilding the SPA on every change), the follow-up is a small CORS middleware gated on `ATLAS_ENVIRONMENT=test`. That follow-up does NOT need its own §11 retro because the *category* — "browser app same-origin question" — is already named and closed at the BDD-path level; a dev-HMR CORS hatch is a known sub-category, not a new one.

## 5. Confidence the category is now closed

**`closed`** — the next change of the named category (a new browser app added to the workspace, or a new admin-shell route, or a new asset bundle) is data-plane: the SPA is rebuilt, the new asset lands under `dist/admin/`, and the existing `adminSpaRoutes` serves it. No `apps/server` route file edit. No `main.ts` mount. No CORS middleware.

**Honesty hedges, applied per sdet's calibration rule from retro #2 (cite clause + name failsafe + does category remain closed if hedge fires):**

- **Hedge (a) — Vite HMR dev loop is still cross-origin.** *Clause cited:* the predecessor retro §3 explicitly named this as a follow-up after option (b) lands. *Failsafe:* `tickets/identity/tenant-admin-invites-user.md` exercises the same-origin path via the build-then-serve flow, which is the I20-witness path; the HMR loop is a developer-UX path, not a feature-delivery path, so its cross-origin reality does not regress I20 acceptance. *Does category remain closed if hedge fires?* **Yes** — the named category ("kernel must answer the same-origin question") is closed by the build-then-serve path; the Vite HMR cross-origin path falls under a known sub-category that is recorded but not blocking.
- **Hedge (b) — `serveStatic` may 404 in production if the build artefacts go missing.** *Clause cited:* `always-on.md` §3 ("data" definition — cache contents and similar are data). The `dist/admin/` artefacts are deployable data, not code. *Failsafe:* `adminSpaRoutes` returns a structured 503 with `{ status: 'unavailable', reason: 'admin SPA build not found', expected: <path> }` so the operator sees the failure category at glance. *Does category remain closed if hedge fires?* **Yes** — a missing build is an operator hygiene issue, not a kernel-shape mismatch; the seam itself is intact, the data is absent.
- **Hedge (c) — route mount order.** *Clause cited:* §11.1 row 2 (new HTTP route mount). *Failsafe:* explicit `RESERVED_PREFIXES` guard in `adminSpaRoutes` so a future refactor that accidentally moves this mount above `/api/*` still doesn't shadow the API. *Does category remain closed if hedge fires?* **Yes** — defense-in-depth keeps the seam safe across refactors.

With those three hedges named and each carrying its own failsafe, the category is closed at the BDD-path / I20-witness level. The Vite-HMR hatch is a recorded sub-category for later; not a re-open.

## Notes / log

- 2026-05-21: filed alongside the `apps/server/src/routes/admin-spa.ts` + `apps/server/src/main.ts` + `playwright.bdd.server.config.ts` + `tests/bdd/support/bdd-server-global-setup.ts` kernel touch by module-dev. Third §11 retrospective in Atlas. Predecessor retro at `tickets/kernel-extraction/admin-spa-cors-for-i20-bdd.md` will be archived by architect at gate (its option (b) is what this PR ships).
- 2026-05-21 (module-dev, calibration-rule recurrence check per architect's gate-4 instruction at retro #2):

  Grepped `tickets/archive/kernel-extraction/**` + `tickets/kernel-extraction/**` for "Calibration rule" / "Calibration note":

  **Rule R1 — "Self-referential extraction is honest only at minimum-viable closure"** (filed by sdet in retro #2, `tickets/archive/kernel-extraction/query-side-catchall.md`):
    - First applied: retro #2 (query-side catch-all — substrate + 1 worked migration + 3 stubs).
    - Second application: this retro (admin SPA — substrate route + build-then-serve wiring + BDD path closes).
    - Count: **2 of 3**. Not yet at the three-recurrence amendment threshold.

  **Rule R2 — "Field 5 hedges must (a) cite a specific clause, (b) name a failsafe, (c) answer 'does category remain closed if hedge fires?'"** (filed by sdet in retro #2):
    - First applied: retro #2 (three hedges, each citing §4.6/§4.2/§4.5).
    - Second application: this retro (three hedges, each citing predecessor §3 / `always-on.md` §3 / §11.1 row 2 with failsafes).
    - Count: **2 of 3**. Not yet at the three-recurrence amendment threshold.

  **Decision:** do NOT propose a §11 / `_template.md` amendment in this retro's body. Continue the "wait for three" precedent. If a fourth retro (the next kernel touch — whatever it is) again applies either rule, that retro's author MUST propose the amendment. The architect gate at this retro's PR can confirm this count if it disagrees with mine.

  **Calibration note for the FOURTH §11 retro author:** if your retro also (i) is self-referential at minimum-viable closure OR (ii) applies the three-part hedge contract, you are the third recurrence — propose the §11 / `_template.md` amendment in your body. Both rules' counts are now 2; either can be the one that hits 3 first. Grep `kernel-extraction/**` for "Rule R1" / "Rule R2" before writing your Field 5 — your retro's log entry should update the count and trigger the amendment if you tip it to 3.
