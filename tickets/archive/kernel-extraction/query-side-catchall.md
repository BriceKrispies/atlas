---
title: §11 retro — read-side HTTP routes were hand-mounted per-resource; this PR is the catch-all substrate that closes the category
status: done
type: drift-finding
owner: architect
phase: 3
capability:
adr: specs/decisions/0008-atlas-on-atlas.md
vision: [atlas-on-atlas, tiny-core, agentic-first]
invariants: [I1, I2, I20]
blocks: []
blocked_by: []
files_in_scope:
  - apps/server/src/routes/queries.ts
  - apps/server/src/main.ts
  - apps/server/src/middleware/state.ts
  - modules/identity/src/queries/registry.ts
  - modules/catalog/src/queries/registry.ts
  - modules/content-pages/src/queries/registry.ts
  - modules/authz/src/queries/registry.ts
acceptance:
  - five §11.2 body fields filled
  - extraction-plan ticket exists at the linked path with status >= scoped
  - architect gate verified the retro per §11.3 (retro exists, five fields filled, linked extraction-plan ticket exists)
created: 2026-05-21
updated: 2026-05-21
---

## 1. What category of change was this?

Read-side HTTP routes were hand-mounted per-resource in `apps/server/src/routes/*.ts` (`catalog.ts`, `content-pages.ts`, `authz.ts`, the seven identity routes, scim, oauth, saml) — every new tenant-facing read endpoint required an `apps/server` edit (route mount + handler body + ad-hoc authz call). The intent-side already had a catch-all (`POST /api/v1/intents` via `HandlerRegistry`); the query-side did not. Read endpoint = kernel touch is the category this retrospective documents and closes.

## 2. What forced it into the kernel?

- **`always-on.md` §11.1 row 2** (new HTTP route mount in `apps/server/src/main.ts`) — every per-resource read endpoint historically registered its own Hono route group via `app.route('/', <name>Routes(state))`. This was true even when the underlying query function (`listMemberships`, `getRenderTree`, `searchCatalog`, …) was already a clean module-level function.
- **`always-on.md` §2 row 5** (framework binding) — the Hono `app.route(...)` mounts live in `apps/server/src/main.ts`, which §2 names as kernel-by-construction (below the routing layer).
- **I1** (single ingress) — does NOT actually force hand-mounting; I1 is satisfied as long as `apps/server` is the only HTTP boundary. The hand-mount pattern was historical convenience, not invariant-required.

This PR **is the extraction itself for the category** — `tickets/atlas-on-atlas/query-catch-all-dispatcher.md` shipped the substrate (port + per-module registries + catch-all + example migration). The retrospective documents the touch that closes the category, which is the self-referential shape §11 permits when the extraction lands alongside the kernel touch that triggered it.

## 3. What's the missing seam?

The substrate this PR ships:

- **The port** — `ports/src/query-registry.ts` (`QueryRegistry`, `QueryContext`, `QueryDescriptor`, `QueryFn`, `createQueryRegistry`, `QUERY_ID_PATTERN`). Mirrors `HandlerRegistry` on the intent side.
- **The catch-all** — `apps/server/src/routes/queries.ts` (`GET/POST /api/v1/queries/:queryId`). Lookup → authz → cache → fn → cache writeback. Single dispatcher for all reads.
- **The contract** — `specs/crosscut/action-driven-routing.md` §4. Normative rules for queryId grammar, QueryContext unification (§4.2), authz-on-read order (§4.4), tenantId-literal cacheKey rule (§4.6), backward-compat with hand-mounts (§4.7).
- **Per-module registries** — `modules/<name>/src/queries/registry.ts`. Today: `identityQueryRegistry` (one real entry: `Identity.Memberships.List`), three stubs (`catalog`, `content-pages`, `authz`) ready for per-module follow-up migrations.

The seam is operationally complete. After this PR, adding a new read endpoint is a module-only edit: register a descriptor in the module's `*QueryRegistry`; no `apps/server` route mount, no `main.ts` change, no `state.ts` composition change.

## 4. What's the extraction plan?

**Path:** `atlas-on-atlas/query-catch-all-dispatcher` (this same ticket).

**Status at retro time:** in-flight (this PR's chain — port-adapter-dev landed Phase 1 port side; this retro files alongside module-dev's Phase 1 module side; sdet + architect still queued).

**Self-referential is honest here per §11.2 field 4 prose:** the retrospective is filed alongside the extraction it documents. The category-closure work and the kernel touch are the same PR. Future kernel touches whose extraction is *not* yet scoped link a separate plan ticket; this one's extraction IS the ticket.

**Follow-up master ticket (per §4.5 bulk-migration audit-volume rule):** the per-module migrations of existing hand-mounted reads land as separate slices, each with architect review for the new `evaluateRead` audit volume. This retro does not pre-scope every per-module follow-up — they file as separate `kernel-extraction/` retros if they trip §11.1 triggers, or as plain `chore/` tickets if they're substrate-already-clean and just need the registry registration.

## 5. Confidence the category is now closed

**`closed`** — the next change of the read-endpoint-mount category is a module-only edit:

```ts
// modules/<name>/src/queries/registry.ts
registry.register({
  queryId: 'Domain.Resource.Verb',
  actionId: 'Domain.Resource.Verb',
  resource: { type: 'Tenant', idFrom: () => '' },
  cacheKey: (ctx) => `Domain.Resource:${ctx.tenantId}`,
  fn: async (ctx, params) => { /* … */ },
});
```

No `apps/server` route file edit. No `main.ts` mount. No `state.ts` composition change. The catch-all already dispatches by queryId; the cacheKey, authz, and audit plumbing all flow from the descriptor.

**Honesty hedges (recorded per §11.3 calibration):**

- The §4.6 `cacheKey` rule catches *static* tenantId-omission only — branching `cacheKey(ctx, params)` implementations that conditionally include `tenantId` pass registration but violate I9 at runtime. The architect gate at PR review is the failsafe; the substrate alone is not sufficient. If branching cacheKey violations recur across three future retros without an extraction, `vision-keeper` escalates and we revisit.
- The QueryContext unification (§4.2) is a normative contract, not yet a mechanical check. Per-module follow-up slices that retain a `*QueryDeps`-shaped helper alongside the registry are temporarily allowed (§4.7 backward-compat window) but must collapse on per-module bulk-migration. If a per-module migration ships *without* collapsing, the slice fails architect review.
- Bulk migration introduces new `evaluateRead` audit volume on reads that previously ran without policy-engine consultation. The bulk-migration tickets per §4.5 are the place that volume gets reviewed; the substrate ticket only ships one example migration where no audit-volume change occurs.

With those hedges named, the category is genuinely closed at the substrate level. The follow-up risk is in the bulk-migration tickets, which have their own architect-review gates.

## Notes / log

- 2026-05-21: filed alongside `tickets/atlas-on-atlas/query-catch-all-dispatcher.md` per §11.3 ("filed in the same PR as the kernel change"). Self-referential extraction (the substrate IS the closure) is the honest shape here per §11.2 field 4. module-dev wrote the implementation; main appended this retro after module-dev got stuck mid-test-run-verification (see chore ticket log). Pending architect §11.3 gate.
- 2026-05-21 (architect, §11.3 verification gate, agentId a13d5d93480bf7ef5 → **PASS**): (a) retro exists ✓; (b) five fields filled with substantive content ✓ — Field 1 names files + category boundary, Field 2 verified §11.1 row 2 + §2 row 5 cites against `always-on.md:245,41`, Field 3 names port + catch-all + contract + per-module registries (all four shipped), **Field 4 self-reference verified honest** (sdet's calibration rule applied: minimum-viable closure shipped — port + catch-all + contract + ONE worked migration + three stubs ready), **Field 5 hedges each pass sdet's three-test calibration** (cite specific clause: §4.6/§4.2/§4.5; name failsafe: architect-review-at-PR + three-recurrence escalation / architect-review-on-bulk-migration / per-migration architect review; if hedge fires, category remains closed); (c) linked extraction-plan ticket self-referential ✓ — substrate ticket was `in-flight` (>= scoped) at retro time. **Gate 4 calibration decision: do NOT amend `always-on.md` §11 or `_template.md` yet** — continue first retro's "wait for three recurrences" precedent; both sdet's calibration rules now preserved in this retro's log for future grep. **Calibration note for the THIRD §11 retro author**: grep `tickets/archive/kernel-extraction/**` + `tickets/kernel-extraction/**` for "Calibration rule" before writing Field 5. If a rule appears across three retros (this would be the third instance), the third retro MUST propose the §11 / `_template.md` amendment in its body and architect's gate applies it. The "wait for three" rule has been satisfied. Do not invent new rules unless the retro genuinely surfaces one — calibration inflation defeats the audit. **Status: scoped → done. Archiving to `tickets/archive/kernel-extraction/query-side-catchall.md`.** Second §11 retrospective in Atlas — archived.
- 2026-05-21 (sdet, Phase 2 adversarial review of retro alongside substrate ticket → **PASS** with calibration notes for the THIRD §11 retro author): reviewed all five §11.2 fields against the slice's actual mechanical shape. **Field 1 (category):** accurate — read-side hand-mount IS the category and it's now extinct after this PR. **Field 2 (what forced it into the kernel):** accurate — §11.1 row 2 + §2 row 5 are the named triggers; I1 correctly clarified as NOT requiring hand-mounts. **Field 3 (missing seam):** accurate — port + catch-all + per-module registries + contract spec are all in place; the seam IS operationally complete. **Field 4 (extraction plan, self-referential):** **PASS** — self-reference is honest here because the substrate's mechanical shape is minimum-viable closure for the category (port + 1 worked migration + 3 stubs ready for follow-ups); there is no separate-ticket abstraction to extract. **Calibration rule for future retros:** self-reference is honest ONLY when (i) the same PR ships the substrate that closes the category AND (ii) the substrate is minimum-viable closure (no further scoping needed for "closed" to be true). If a future retro cites itself but ships only partial closure (e.g., port but no catch-all, OR catch-all but no example migration), that's a §11 contract violation — field 4 must link a real follow-up ticket. **Field 5 (confidence: `closed` with three hedges):** **PASS** — each hedge cites a specific contract clause (a→§4.6, b→§4.2, c→§4.5) and names the failsafe (architect review for a/b, per-module slices for c). None of the three are escape hatches; all three are known-limits-of-the-substrate that the contract spec already names. **Calibration rule for future retros:** hedges are honest when (i) each cites a SPECIFIC contract clause that admits the limit AND (ii) the failsafe is named. Hedges that hand-wave without citing a clause OR without naming a failsafe → Field 5 should drop to `narrow` (or `open`). This retro meets both bars. **Witnessed:** independently re-ran queries.test.ts → 7/7 pass; identity regression → 17 failures all in pre-existing SAML/crypto RED-scaffold suites (commit `df14b4f`), zero touching `modules/identity/src/queries/`. The substrate is regression-clean. **Pending: architect §11.3 verification gate (architect verifies retro exists, five fields filled, linked extraction-plan ticket exists at the linked path with status >= scoped — all three are satisfied; this is now a perfunctory architect pass).** Status stays `scoped`; architect transitions to archive after §11.3 verification.
