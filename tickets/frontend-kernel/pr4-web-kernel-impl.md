---
title: Implement @atlas/web-kernel (registries + render chokepoint + query/mutate/channel) and wire core
status: in-flight
type: capability
owner: frontend-dev
phase: 1
adr: specs/decisions/0017-two-kernel-frontend-architecture.md
vision: []
invariants: [I5, I18]
blocks: [frontend-kernel/pr5-api-client-migration, frontend-kernel/pr6-web-bff-server]
blocked_by: []
files_in_scope: [packages/web-kernel/src, packages/core/src/component.ts, packages/core/src/index.ts, packages/core/package.json]
acceptance:
  - "pnpm exec atlas-test packages/core packages/web-kernel — 0 failures (core's existing component/signals/surface tests still pass)"
  - "pnpm exec tsgo --noEmit -p packages/web-kernel/tsconfig.json and -p packages/core/tsconfig.json — 0 SRC errors (ignore .test.ts 'never has no call signatures' pre-existing noise)"
  - "pnpm deps:check — 0 errors (core->web-kernel->web-abi is inward-legal; no new cycle)"
  - "pnpm arch:check — PASS, 0 waivers"
created: 2026-05-25
updated: 2026-05-25
---

## Why

ADR 0017 names `@atlas/web-kernel` as the in-browser frontend kernel: the chokepoint everything rendered passes through (down to components), and the home for the reactive `query()/mutate()/channel()` primitives the constitution (C14/C15) mandates but were never built. Contract spec: `specs/frontend/web-kernel.md`. Plan: `~/.claude/plans/i-want-to-go-quiet-tulip.md` PR4.

## Scope

Build out `packages/web-kernel/src` (signals moved from core; ElementRegistry + SurfaceRegistry; the `render()` append chokepoint; `query`/`mutate`/`channel` reactive primitives + transport, defaulting to same-origin/apps/server pre-BFF; a telemetry-injection seam so the kernel never imports core) and wire `@atlas/core`'s `AtlasElement` at three seams: `define`→`registerElement`, `connectedCallback`/`disconnectedCallback`→`mount`/`unmount` (surfaces always; leaf elements dev-gated), `_safeRender`→`webKernel.render`. **Keep the `effect(() => _safeRender())` wiring intact** — the kernel owns only the DOM-append body. Out of scope: migrating `@atlas/api-client` (PR5), the BFF server (PR6), repointing apps (PR7).

**STATE (2026-05-25): a draft implementation exists UNCOMMITTED in the working tree.** A `frontend-dev` dispatch created `packages/web-kernel/src/{signals,registry,render,transport,mutate,query,channel,telemetry,index}.ts` + `packages/web-kernel/test/*.test.ts`, moved `packages/core/src/signals.ts` out (core re-exports from web-kernel), modified `packages/core/src/{component.ts,index.ts,package.json}` and `packages/core/test/signals.test.ts`, and added `@atlas/web-abi` dep + `linkedom` devDep to web-kernel. The agent was cut off (rate limit) BEFORE running the acceptance checks. **The draft is unverified.** If the working tree was reset since 2026-05-25, the draft is gone — re-run the Resume prompt from scratch.

## Resume prompt

```
Finish PR4 of ADR 0017 (two-kernel frontend). A draft @atlas/web-kernel implementation may already exist uncommitted in the working tree (packages/web-kernel/src/*.ts + test/*.test.ts; core's signals.ts moved out; core/src/component.ts wired at define/connectedCallback/_safeRender). Read specs/frontend/web-kernel.md and ADR 0017 §1 first.

1. Inspect the working-tree draft (git status; read packages/web-kernel/src/*). If absent, implement per specs/frontend/web-kernel.md: signals.ts (moved from core, core re-exports), registry.ts (ElementRegistry idempotent/warn-once + SurfaceRegistry mount/unmount), render.ts (append body + Atlas.Render.Failed telemetry + dev off-kernel assertion; do NOT replace the effect wiring), transport.ts (swappable base, default same-origin), mutate.ts (stamp correlationId+idempotencyKey; pre-BFF wrap envelope client-side and POST /api/v1/intents — port wrapIntent/deriveSchemaId from packages/api-client/src/http/index.ts; seam to switch to BFF unwrapped mode in PR6), query.ts (signal-returning, cache+singleflight, tag-invalidation), channel.ts (EventSource pool, connected signal, backoff, invalidates queries, never touches DOM), telemetry.ts (core injects emitTelemetry), index.ts.
2. Verify core wiring in packages/core/src/component.ts: define→webKernel.registerElement, connectedCallback→mount (surfaces always; leaf dev-gated), disconnectedCallback→unmount, _safeRender→webKernel.render. KEEP the effect(() => _safeRender()) wiring and the surface body-slot load lifecycle unchanged.
3. Run the acceptance checks (atlas-test packages/core packages/web-kernel = 0 fail; per-package tsgo SRC-clean ignoring .test 'never' noise; deps:check 0 errors; arch:check 0 waivers). Fix any core test that broke ONLY if the break is a true behavior change you introduced; otherwise fix the kernel wiring.
4. Commit on main (LEFTHOOK=0 only if the pre-existing repo-wide markdownlint/typecheck hooks block — pre-commit oxlint should pass on clean .ts) and push. Then hand off PR5.
```

## Notes / log

- 2026-05-25: created. frontend-dev draft exists uncommitted in the working tree; cut off by rate limit before verification. Status in-flight pending verify + commit.
