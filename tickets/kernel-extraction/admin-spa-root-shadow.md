---
title: §11 retro #5 — apps/server's `GET /` legacy version-JSON handler shadowed the admin SPA serveStatic catch-all
status: scoped
type: drift-finding
owner: architect
phase: 3
capability:
adr: specs/decisions/0008-atlas-on-atlas.md
vision: [atlas-on-atlas, tiny-core]
invariants: [I1, I20]
blocks: []
blocked_by: []
files_in_scope:
  - apps/server/src/routes/health.ts
acceptance:
  - five §11.2 body fields filled
  - extraction-plan ticket exists at the linked path with status >= scoped
  - architect gate verified the retro per §11.3 (retro exists, five fields filled, linked extraction-plan ticket exists)
created: 2026-05-21
updated: 2026-05-21
---

## 1. What category of change was this?

The fourth §11 retro (`tickets/archive/kernel-extraction/admin-spa-serve-static.md`) shipped the admin SPA serveStatic catch-all and claimed Field 5 confidence: `closed`. Running the BDD against the substrate exposed a closure-claim error: the legacy `GET /` handler in `apps/server/src/routes/health.ts:15` (a Rust-prototype-mirror returning `{ok, name, version}`) was mounted FIRST in the public group, shadowing the SPA catch-all for the root path. Browser navigation to `acme.localhost:3000/#/login` (where the hash is stripped server-side) hit the legacy JSON response, not the SPA. **Category: "structural extractions that ship a catch-all must verify no earlier-mounted leaf route shadows the path the catch-all is meant to absorb."**

## 2. What forced it into the kernel?

The fix is removing the `app.get('/')` handler in `apps/server/src/routes/health.ts`. That's:

- **§11.1 row 1** — change to `apps/server` bootstrap behavior (the public route group mounts one fewer route).
- **always-on.md §2 row 5** — framework binding / route mount.

I1 (single ingress) is preserved — the SPA serveStatic is still mounted in `apps/server`, no new HTTP boundary opens. I20 is the operator-visible invariant the BDD demonstration depends on; this retro is a corrective sub-touch to make the prior I20 extraction actually achieve its claimed closure.

## 3. What's the missing seam?

The substrate this retro removes is the substrate. Concretely:

- `apps/server/src/routes/health.ts` no longer has `app.get('/', ...)`. The `{ok, name, version}` JSON shape is not load-bearing — grep across the repo finds no consumer (only BDD report artifacts that captured the shadowing as the diagnosis). `/healthz` and `/readyz` already provide structured probes; the version handshake is Phase B per `specs/crosscut/atlasctl.md`.
- The admin SPA catch-all at `apps/server/src/routes/admin-spa.ts` now correctly absorbs the root path. SPA hash-routing (`#/users`, `#/login`, …) resolves against the served `index.html`.

The missing seam at the **process** level is the architect-gate procedure: when a structural catch-all ships and claims `closed`, the gate MUST trace every earlier-mounted route group's path matchers to confirm none shadow the catch-all for the paths the catch-all is meant to absorb. The fourth retro's gate verified mount order (catch-all last) but did not enumerate leaf routes within earlier groups.

## 4. What's the extraction plan?

**Path:** this retro itself — same-PR self-referential extraction. The fix is the substrate; removing the shadow IS the closure. Identical structural shape to retros #2 and #4.

**Status at retro time:** scoped (this retro).

## 5. Confidence the category is now closed

**`closed`** for the SPA-root-path-shadowing case specifically. Hedges:

- (a) **Other earlier-mounted route groups may also have leaf collisions** (`/oauth/`, `/saml/`, `/scim/`, `/signup/`, `/docs/` — those are explicitly named in `RESERVED_PREFIXES` so they coexist by design, not by accident). Cites: `apps/server/src/routes/admin-spa.ts:60-70`. Failsafe: the `RESERVED_PREFIXES` guard in the catch-all rejects shadow paths defensively. Category remains closed if hedge fires — the SPA catch-all returns `notFound()` rather than serving a misleading `index.html`.
- (b) **Future route group additions could re-introduce a shadow** if a new feature mounts `app.get('/')` somewhere. Cites: §11.1 row 1. Failsafe: a Semgrep / overseer rule could pattern-match `app.get('/', …)` registrations in any file under `apps/server/src/routes/` and require explicit justification. Not added in this slice — out of scope. Category remains closed at substrate level; defense-in-depth deferred.
- (c) **The fourth retro's `closed` claim was wrong** about this category. Cites: architect gate calibration rule #2 from §11 retro #2. The gate trusted mount-order verification without leaf-path enumeration. Failsafe: gate procedure update suggested above (Field 3). Whether to amend `always-on.md` §11 with this rule is the architect's call this gate.

The third instance of the architect-calibration-rule-recurrence pattern: rules R1 (self-referential minimum-viable closure) and R2 (Field 5 hedges cite-clause + failsafe + closed-if-fires) have now appeared across retros #2, #4, and #5. **Per the second retro's calibration note ("if a rule appears across three retros, the third retro MUST propose the §11 / `_template.md` amendment in its body"), this retro is the third instance and proposes the following amendment for the architect to apply at gate:**

Add to `tickets/kernel-extraction/_template.md` between Field 5 and Notes/log:

```markdown
## Field 5 hedge checklist (per §11.3 architect-gate calibration)

For each hedge in Field 5, the retro author MUST verify:

1. **Cite-clause:** the hedge names a specific contract clause that admits the limit (e.g., `§4.6`, `§2 row 5`, `I20`).
2. **Failsafe:** the hedge names a concrete failsafe (architect-review-at-PR / per-module-architect-review / Semgrep rule / overseer probe / etc.).
3. **Closed-if-fires:** the hedge answers "if this hedge fires in practice, does the category remain closed?" If "no," Field 5 confidence drops from `closed` to `narrow` or `record`.

Self-referential extractions (Field 4 points at the same ticket) MUST demonstrate minimum-viable closure: port + at least one worked migration; the substrate IS the closure mechanism. Partial closure with self-reference is a §11 contract violation.
```

The amendment is mechanical — applying it requires architect to edit `_template.md` and append a corresponding §11.3 reference. No `always-on.md` change required.

## Notes / log

- 2026-05-21: filed alongside the small kernel touch in `apps/server/src/routes/health.ts` (removing `app.get('/', …)`). Surfaced by running `pnpm safe bdd:server` end-to-end after the atlas-doctor unblocker landed — Playwright's failure screenshot showed the JSON response shadowing the SPA at the root path. The fourth retro's `closed` claim was wrong about this specific shadowing case; this retro corrects it without retroactively amending the archived retro (per the calibration discipline: don't rewrite history; document the gap and link forward).
- 2026-05-21: proposes the §11.3 architect-gate calibration as a `_template.md` amendment per the second retro's "wait for three recurrences" rule, now satisfied.
