---
title: Expose apps/server bootId via /readyz so test harnesses can mechanically assert I20 zero-restart
status: done
type: refactor
owner: spine-owner
phase: 1
capability:
adr: specs/decisions/0008-atlas-on-atlas.md
vision: [atlas-on-atlas, agentic-first]
invariants: [I20]
blocks: [identity/tenant-admin-invites-user]
blocked_by: []
files_in_scope:
  - apps/server/src/bootstrap.ts
  - apps/server/src/routes/health.ts
  - apps/server/test/routes/health.test.ts
  - apps/server/test/lib/factories.ts
  - tickets/kernel-extraction/bootid-for-i20-probe.md
  - tickets/atlas-on-atlas/stage-9-operator-surface.md
acceptance:
  - bootstrap.ts generates a `bootId: string` (crypto-random UUID) at process start; held on AppState
  - GET /readyz response body includes `{ status, bootId, startedAt }` (startedAt is ISO-8601)
  - GET /healthz unchanged (liveness probe stays lightweight)
  - unit test asserts bootId stability across multiple /readyz calls within the same process
  - unit test asserts bootId changes across a fresh process boot (smallest possible test — instantiate two AppState objects)
  - **§11 retro filed in the SAME PR** at `tickets/kernel-extraction/bootid-for-i20-probe.md` with §11.2's five fields, extraction-plan field pointing at Stage 9 amendment (`tickets/atlas-on-atlas/stage-9-operator-surface.md`)
  - pnpm typecheck green; pnpm lint green
created: 2026-05-21
updated: 2026-05-21
---

<!--
  Note: the unit-test file was created at `apps/server/test/routes/health.test.ts`
  (not the originally-planned `apps/server/test/health.test.ts` path), so it
  sits alongside the existing route tests (`test/routes/intents.test.ts`,
  `test/routes/identity-a7.test.ts`, etc.) — the established convention for
  this app. The `test-routes/health.test.ts` placement is the one source of
  truth; the frontmatter `files_in_scope` reflects this.
-->


## Why

Identified by sdet during Phase-0 of `tickets/identity/tenant-admin-invites-user.md` (the first I20 zero-restart demonstration slice). To mechanically assert in BDD that `apps/server` was not restarted between the code-land step and the BDD-run step, the test needs a stable per-boot identity to compare. Today `/healthz` returns `{status:'ok'}` only — no boot identity, no startedAt, no PID.

Adding `bootId` is a one-line kernel touch (the smallest possible — a UUID generator in `bootstrap.ts`, a field on the route response). It IS a kernel touch by §11.1 row 1 (`apps/server` bootstrap behavior change), and it WILL fire the first §11 retrospective on landing. The retrospective's extraction-plan is to amend `tickets/atlas-on-atlas/stage-9-operator-surface.md` (the always-on §5 operator surface — `atlasctl kernel modules` etc.) so future kernel-identity introspection is data lookup against a standing surface, not new code.

This ticket is the smallest possible touch that unblocks the I20 mechanical probe on the identity slice. The slice cannot ship its I20 acceptance check until this lands.

## Scope

In scope:

- Add `bootId` to `AppState` in `apps/server/src/bootstrap.ts`. Generate via `crypto.randomUUID()` once at process start.
- Add `startedAt: Date` to the same state.
- Extend `GET /readyz` response in `apps/server/src/routes/health.ts` to include `{ bootId, startedAt }` alongside the existing readiness fields.
- Leave `/healthz` unchanged — liveness probes stay terse (just `{status:'ok'}`).
- Unit test: two AppState instances → two different bootIds.
- **File the §11 retro alongside in the same PR** at `tickets/kernel-extraction/bootid-for-i20-probe.md` per `always-on.md` §11.3 (architect-gated immediately on landing).

Out of scope:

- The full Stage 9 operator surface (`atlasctl kernel modules`, `/api/v1/kernel/modules`, etc.) — that's its own scoped ticket. This ticket only adds the data field; Stage 9 amendment adds the standing introspection contract.
- Threading `bootId` into every structured log line — defer to a separate observability ticket if useful later.
- Any change to `/healthz` semantics.

## Resume prompt

```text
Implement tickets/chore/expose-server-bootid-for-i20-probe.md per scope. Touch apps/server/src/bootstrap.ts (add bootId + startedAt to AppState via crypto.randomUUID()) and apps/server/src/routes/health.ts (extend /readyz to return them; leave /healthz alone). Add the smallest unit test that asserts bootId stability within a process and uniqueness across processes. Then FILE THE §11 RETROSPECTIVE in the same PR at tickets/kernel-extraction/bootid-for-i20-probe.md with all five §11.2 fields per the _template.md — extraction-plan field points at tickets/atlas-on-atlas/stage-9-operator-surface.md as the category-closure target (Stage 9 amendment makes future kernel-identity introspection a data lookup). Update both this ticket and identity/tenant-admin-invites-user (which blocks_by this one).
```

## Notes / log

- 2026-05-21: created (status=scoped). Surfaced by sdet's adversarial Phase-0 review of `tickets/identity/tenant-admin-invites-user.md` (agentId aaa01c15b25c509c9, 2026-05-21). User chose "self-improving path" to file the retros + chore tickets rather than soften the I20 acceptance check. Blocks `identity/tenant-admin-invites-user`.
- 2026-05-21: scoped → in-flight (module-dev, dispatched per the Resume prompt). Implementation: `bootId: string` + `startedAt: Date` added to `AppState` in `apps/server/src/bootstrap.ts`, generated via `globalThis.crypto.randomUUID()` and `new Date()` at the top of `bootstrap()`. `/readyz` in `apps/server/src/routes/health.ts` now returns `{ status, bootId, startedAt, checks }` (both `status: 'ok'` and `status: 'unavailable'` branches). `/healthz` untouched. `Server.Boot.Ready` log line emitted at end of bootstrap with `{ bootId, startedAt }` payload (no duplicate of any existing event). Unit test at `apps/server/test/routes/health.test.ts` covers both required assertions. `apps/server/test/lib/factories.ts` updated so `buildFakeAppState()` populates the two new fields per the same UUID + Date contract.
- 2026-05-21: in-flight → review. Implementation complete; pnpm safe --filter @atlas/server typecheck shows 145 pre-existing errors with zero deltas in `bootstrap.ts` / `routes/health.ts` / `routes/health.test.ts` / `lib/factories.ts` files; pnpm safe --filter @atlas/server test goes from 131-pass/10-fail baseline to 133-pass/8-fail with my changes (2 new health tests pass cleanly; remaining 8 failures are pre-existing kernel-migration / manifest-schema tests unrelated to this slice). §11 retrospective filed at `tickets/kernel-extraction/bootid-for-i20-probe.md` per ticket acceptance. Stage 9 scope amended to commit to including `bootId` + `startedAt` in the day-one operator-surface response (the seam-narrowing the retro asks for). Handing to sdet adversarial review, then architect invariant gate.
- 2026-05-21: sdet adversarial review (status stays `review`, handing to architect). Verdict: **PASS** with three minor non-blocking findings logged for follow-up. Run-of-show:
  - Re-ran `pnpm safe --filter @atlas/server test`: confirms 144 total / 133 pass / 8 fail; both `GET /readyz — boot identity surface` cases (`bootId is stable...`, `two AppState instances...`) pass cleanly in <34 ms. The 8 pre-existing failures spot-checked — `Authn.Failed` middleware logging, manifest-schema `cacheInvalidationTags` (F1), `EventEnvelope.dispatcherChainVersion` (F2), kernel-handler-registry hot-swap (F4) — none reference `bootId`, `startedAt`, `health`, `/readyz`, or AppState construction. "Pre-existing, unrelated" claim holds.
  - Verified `git diff -- tickets/atlas-on-atlas/stage-9-operator-surface.md`: amendment is purely additive (one new "0." bullet under **In:**); `acceptance:` list untouched. Stays in-lane for a chore ticket modifying a `scoped` upstream ticket. (F1 below notes one minor inconsistency between the retro's prose and the Stage 9 amendment.)
  - Verified `git diff -- apps/server/src/{bootstrap.ts,routes/health.ts} apps/server/test/lib/factories.ts`: no `@ts-expect-error`, no `@ts-ignore`, no `as any`. `globalThis.crypto.randomUUID()` types cleanly on Node 22+ via the global `Crypto` interface — no cast needed.
  - Acceptance items: bootId stamped pre-side-effect (line 260) ✓; `/readyz` returns `{ status, bootId, startedAt, checks }` on both ok and unavailable branches (lines 47, 49) ✓; `/healthz` untouched ✓; stability test ✓; uniqueness test ✓; §11 retro filed at the named path with all five fields ✓; extraction-plan ticket exists at `tickets/atlas-on-atlas/stage-9-operator-surface.md` with `status: scoped` ✓.
  - **F1 (non-blocking, defer):** the retro's §3 names the missing seam as `GET /api/v1/admin/kernel/info`, but Stage 9's amendment commits to `GET /api/v1/kernel/snapshot` / `GET /api/v1/kernel/modules` (no `/admin/`). Cosmetic — the seam still narrows to a standing handler — but a future agent grepping for "kernel/info" will miss it. Either rename the retro's §3 path to match Stage 9, or note the divergence. Architect to decide; safe to merge as-is since the extraction-plan ticket linkage is unambiguous.
  - **F2 (non-blocking, defer):** no negative test for `/healthz` (i.e. that the liveness probe does NOT include `bootId` / `startedAt`). Drift risk is low — `/healthz` was deliberately not edited — but a one-line test would mechanically lock in the "liveness stays terse" contract documented in `apps/server/src/routes/health.ts:41` and the §11 retro's §3. File as a chore follow-up if desired.
  - **F3 (non-blocking, defer):** the `unavailable` 503 branch (`apps/server/src/routes/health.ts:47`) carries `bootId` + `startedAt` but no test exercises it. The I20 probe primarily reads the 200 path, so this is not load-bearing, but the asymmetric coverage means a future regression in the 503 branch would not be caught. Architect to weigh.
  - **F4 (advisory only, no action needed):** `bootId` regex check (`/^[0-9a-f]{8}-...$/i`) lives only on the second test (cross-instance uniqueness). The first test asserts `body1.bootId === wired.bootId`, so syntactic UUID-shape is enforced transitively. Acceptable.
  - **Format-check verdict on `startedAt`:** the test asserts `body1.startedAt === wired.startedAt.toISOString()` — exact equality against a known ISO-8601 value, which IS a structural ISO-8601 check. Adequate.
  - **Caching probe (out of band):** /readyz is not behind any Caddy / CDN / Hono response-cache layer in this repo today (grep across `infra/` + `packages/ingress` confirms `/readyz` is hit live each request). No staleness risk to I20 probe. Architect should re-verify when Stage 9 lands operator-authed routes.
  - Both ticket statuses left at `review` — architect picks up next per `tickets/CLAUDE.md` lifecycle.
- 2026-05-21: review → **done** (architect invariant gate, agentId a9a90375d8c5b0c4f). **Verdict PASS.** I1/I9/I17/I12/hexagonal/worker-parity all clean — minimal kernel touch, no domain logic in routes, no adapter leak, dispatcher chains unaffected. sdet F1 resolved at close (retro Field 3 reconciled to `GET /api/v1/kernel/snapshot` matching Stage 9 authoritative URL). sdet F2 filed as `drift-2026-05/healthz-negative-test-for-bootid-contract`. sdet F3 filed as `drift-2026-05/readyz-503-branch-test-coverage`. Gate 3 decision: do NOT amend `always-on.md` §11 — the two-ticket shape (chore + separate retro) is already implicit in §11.3's "filed in the same PR" + `_template.md`'s placement under `tickets/kernel-extraction/`; calibration captured in retro log instead. Calibration note for the second §11 retro author: when Field 3's missing-seam path is a *forecast* (the surface doesn't exist yet), treat the same-PR extraction-plan ticket as the authoritative source for the URL; mismatch is a non-blocking gate finding the architect resolves at gate, not a merge block. Archiving via `mv` (untracked files) to `tickets/archive/chore/`.
