---
title: Atlas-on-Atlas Stage 7 — wire kernel into bootstrap/state/main; collapse 14 route mounts to one catch-all
status: scoped
type: refactor
owner: module-dev
phase: 0
capability:
adr: specs/decisions/0008-atlas-on-atlas.md
vision: [atlas-on-atlas, agentic-first]
invariants: [I1, I2, I3, I5, I12, I19]
blocks:
  - atlas-on-atlas/stage-9-operator-surface
blocked_by:
  - atlas-on-atlas/stage-6-kernel-package
files_in_scope:
  - apps/server/src/bootstrap.ts
  - apps/server/src/main.ts
  - apps/server/src/middleware/state.ts
  - apps/server/src/routes/intents.ts
  - apps/server/src/routes/catalog.ts
  - apps/server/src/routes/authz.ts
  - apps/server/src/routes/content-pages.ts
  - apps/server/src/routes/events.ts
  - apps/server/src/routes/identity.ts
  - apps/server/src/routes/identity-a7.ts
  - apps/server/src/routes/identity-idp.ts
  - apps/server/src/routes/mfa.ts
  - apps/server/src/routes/repositories.ts
  - apps/server/src/routes/admin-signups.ts
  - apps/server/src/routes/admin-logging.ts
  - apps/server/src/routes/docs.ts
  - apps/projection-worker/src/tenant-loop.ts
  - packages/dispatch-chain/                       # NEW package (extracts ADR 0008 Stage 5 deliverable)
  - apps/server/test/always-on/f2-event-envelope-chain-version.test.ts
  - apps/server/test/always-on/f4-handler-registry-swap.test.ts
acceptance:
  - "apps/server/src/bootstrap.ts: AppState gains `kernel: KernelHandle` and `handlers: HandlerRegistry` fields (handlers is `kernel.handlers` — same reference). bootstrap() constructs a Kernel via createKernel({ eventStore }), then registers each module's handlers into kernel.handlers (iterating catalogHandlerRegistry()/authzHandlerRegistry()/... entries — modules continue to expose factory fns)."
  - "apps/server/src/main.ts: buildApp collapses the 14 authed `app.route('/', xxxRoutes(state))` mounts into ONE catch-all that dispatches via state.kernel.handlers at request time. Health/metrics/auth-callback/signup/tenant-home/docs routes stay separate (per always-on §2 — those are public/auth-callback, not request-lifecycle)."
  - "apps/server/src/middleware/state.ts: composeRegistries() call removed (currently line 249). buildRequestBundle reads handlers from state.kernel.handlers; the Repository-injection wrapper at lines 263–275 stays but operates over state.kernel.handlers' result."
  - "packages/dispatch-chain/ (NEW): extracts the dispatcher chain composition currently duplicated across apps/server/src/middleware/state.ts (lines 315–340) and apps/projection-worker/src/tenant-loop.ts. Exports composeAtlasDispatcherChain(deps). Closes ADR 0008 Stage 5."
  - "apps/server/src/middleware/state.ts AND apps/projection-worker/src/tenant-loop.ts: both consume composeAtlasDispatcherChain. They register the composed chain into state.kernel.chains via chains.register(versionNumber, chain). Version increments on each kernel boot (or stays at 1 in v1 — pin)."
  - "Every appended event in the production path carries envelope.dispatcherChainVersion, sourced from state.kernel.eventStore (the StampingEventStore wrapper). Verified by an integration test that submits an intent and inspects the resulting event row."
  - "apps/server/test/always-on/f2-event-envelope-chain-version.test.ts REWRITTEN: imports buildTestKernel from @atlas/kernel; submits two intents at different ambient chain versions; asserts each appended event reflects its append-time version. Slot-pinning hack at `ingress.dispatcherChainVersion` is gone."
  - "apps/server/test/always-on/f4-handler-registry-swap.test.ts REWRITTEN: imports buildTestKernel; runs the two-request swap test (request 1 → v1 handler runs; kernel.handlers.register(action, v2); request 2 → v2 handler runs). The source-text regex check on main.ts is replaced with a behavioral assertion. The composeRegistries presence check is REMOVED (already enforced by stage-7's main acceptance below)."
  - "Every existing intents.test.ts, repositories.test.ts, identity-a7.test.ts, etc. continues to pass — the kernel migration is behavior-preserving for what those tests cover."
  - "grep -E '\\bcomposeRegistries\\s*\\(' apps/server/src/middleware/state.ts returns 0 hits."
  - "grep -cE \"authed\\.route\\('\\/',\\s*\\w+\\(state\\)\\)\" apps/server/src/main.ts returns ≤ 1 (the kernel catch-all)."
  - "pnpm safe typecheck clean."
  - "pnpm safe test passes."
  - "pnpm safe deps:check 0 errors."
  - "pnpm safe bdd passes (no surface regressions from the route collapse)."
created: 2026-05-10
updated: 2026-05-10
---

## Why

Stage 6 created `@atlas/kernel`; stage 7 makes `apps/server` use it. Three structural changes happen here, all required by the always-on contract:

1. **`apps/server` holds a `Kernel`.** `AppState.kernel: KernelHandle` is what every downstream concern (routes, dispatcher, projection-worker) reads from. Today's `composeRegistries(...)` inside `buildRequestBundle` runs per-request from static module imports — replaced by a single kernel reference whose handlers were registered once at boot.

2. **The 14-mount collapse in `main.ts`.** Every authed business route becomes one catch-all `app.all('/api/v1/intents*', kernelDispatch)` plus the same for queries. The closure-capture anti-pattern (always-on §7) goes away because dispatch resolves through `state.kernel.handlers` at request time. This is the largest single change and the architect Phase 3 review will check I1, I2, I3 hold across it.

3. **The dispatcher chain extraction** (`packages/dispatch-chain/`) closes ADR 0008 Stage 5 — eliminates the duplication between `state.ts` and `tenant-loop.ts`. Both apps now register the same composition into the kernel's `DispatcherChainRegistry`. Event-append routes through the `StampingEventStore` wrapper that stage 6 created, so every event carries `dispatcherChainVersion`.

After this stage, two of the four always-on tests (F2 and F4) become real behavioral probes against the kernel, replacing today's source-text proxies.

## Scope

**In:**

1. **`bootstrap.ts` rewires.** AppState grows `kernel` and `handlers` (aliased). bootstrap() constructs the Kernel, then registers each module's factory output into `kernel.handlers`.

2. **`main.ts` route collapse.** The 14 authed `app.route('/', xxxRoutes(state))` calls become one catch-all (per always-on §6 phase 1). Public mounts (health, metrics, signup, oauth, saml, scim, tenant-home, docs, identity-invite) stay separate.

3. **`state.ts:buildRequestBundle` cleanup.** Remove `composeRegistries(...)`. Read handlers from `state.kernel.handlers`. Keep the Repository-injection wrapper at lines 263–275 (it's a per-request context concern, not a registry concern) — operate it over `state.kernel.handlers.get(actionId)`'s result.

4. **Extract `packages/dispatch-chain/`.** Move the composition from `state.ts:315–340` and `tenant-loop.ts` into one factory. Both call sites import + register into `state.kernel.chains`.

5. **Event-append stamping.** Every append in apps/server goes through `state.kernel.eventStore` (the StampingEventStore wrapper). Integration test verifies this end-to-end (submit intent → inspect event row).

6. **F2 + F4 test rewrites.** Both become real behavioral tests against `buildTestKernel()` + real `submitIntent`. The proxy/regex hacks go away.

**Out:**

- Module-side changes. Modules continue to export `xxxHandlerRegistry()` factories; bootstrap iterates them.
- Per-module manifest population (stage 8 owns that).
- Operator HTTP surface (stage 9 owns that).
- Per-route file changes beyond what the catch-all forces. If a route file has unique business logic (e.g., `signup.ts` has the magic-link flow), the catch-all might not absorb it — case-by-case decision: stays mounted separately like the other public routes.

**Architect gate (Phase 3):** I1 (single ingress chokepoint), I2 (authz before execution), I3 (idempotency before dispatch) MUST hold across the catch-all collapse. If any route currently bypasses or reorders these in subtle ways, the architect call is whether to preserve the legacy behaviour or fail the route loudly.

## Resume prompt

```
Atlas-on-Atlas Stage 7 — wire @atlas/kernel into apps/server; collapse
the 14 authed route mounts into one catch-all; extract the dispatcher
chain into packages/dispatch-chain (closes ADR 0008 Stage 5).

Blocked on stage 6. Confirm @atlas/kernel exports createKernel, Kernel,
KernelHandle, buildTestKernel before starting. This is the largest
single ticket in the rewrite — expect ~2 days of focused work plus an
architect review for the catch-all collapse.

Step 1 — Read always-on.md §4.2 (request-boundary atomicity), §6 phase 1
(action-driven routing), §7 (anti-patterns). Read the existing 14-mount
list in apps/server/src/main.ts:96-117.

Step 2 — bootstrap.ts rewire.
  Add to AppState (top of file):
    readonly kernel: KernelHandle;
    readonly handlers: HandlerRegistry;  // = kernel.handlers
  In bootstrap() (after eventStore is constructed; before the return):
    const kernel = createKernel({ eventStore });
    // Register each module's factory output.
    for (const [id, h] of Object.entries(catalogHandlerRegistry().entries())) {
      kernel.handlers.register(id, h);
    }
    // ... same for authzHandlerRegistry(policyStore), contentPagesHandlerRegistry(entities),
    // identityHandlerRegistry(entities), repositoryHandlerRegistry().
  (catalogHandlerRegistry() currently doesn't expose `entries()`; the
  cleanest path is to extend each module's registry factory to return a
  Map<actionId, IntentHandler> OR keep returning HandlerRegistry and add
  an iterator method. Pin: add `entries(): IterableIterator<[string, IntentHandler]>`
  to HandlerRegistry in stage 5's port — if this gap surfaces, file a
  fast follow-up ticket rather than block stage 7.)

Step 3 — main.ts route collapse.
  Currently lines 96-117 mount 14 authed routes via app.route('/', X(state)).
  Replace with ONE catch-all on the authed sub-app:
    authed.all('*', async (c) => {
      const principal = c.var.principal;
      const actionId = inferActionFromRequest(c);  // helper below
      const handler = state.kernel.handlers.get(actionId);
      if (!handler) return c.json({ error: { code: 'UNKNOWN_ACTION' } }, 404);
      return runHandler(c, state, handler);
    });
  inferActionFromRequest reads the HTTP method + path + JSON body
  (for POST /api/v1/intents) and returns the actionId. The existing
  intents route logic moves into runHandler.
  Routes that DON'T fit the action-driven shape today (admin-logging,
  events SSE, debug, repository file streams):
    For each, decide — either rewrite as an action (preferred) or keep
    mounted separately like public routes (acceptable as escape hatch).
    Log the decision in this ticket's Notes section.

Step 4 — state.ts:buildRequestBundle cleanup.
  Delete the composeRegistries(...) call at line 249.
  Replace the `const handlers = ...` block (lines 263-275) with:
    const handlers: HandlerRegistry = {
      get(actionId: string) {
        const inner = state.kernel.handlers.get(actionId);
        if (!inner || !actionId.startsWith('Repository.')) return inner;
        // Preserve Repository-context injection (per-request).
        return {
          async handle(ctx, envelope) {
            const extended = { ...ctx, repositories, revisions, crypto: state.crypto };
            return inner.handle(extended, envelope);
          },
        };
      },
      // register/unregister/snapshot delegate to kernel.handlers — but
      // per-request bundle shouldn't expose mutation; consider returning
      // a read-only view. Pin and document.
    };

Step 5 — Extract packages/dispatch-chain/.
  mkdir -p packages/dispatch-chain/{src,test}
  Move state.ts:315-340 (the composeDispatchers call wiring catalog,
  content-pages, identity, repository, cache-tag, policy-cache,
  server-events) into packages/dispatch-chain/src/index.ts as:
    export function composeAtlasDispatcherChain(deps: {
      catalogState, projections, search, cache, entities, relations,
      wasmHost?, policyBundle?, repositories, revisions, serverEvents,
    }): EventDispatcher
  state.ts now calls composeAtlasDispatcherChain({...}) and registers
  the returned chain into state.kernel.chains:
    const chain = composeAtlasDispatcherChain(deps);
    state.kernel.chains.register(1, chain);
    // v1 is the initial; future kernel reloads bump this.
  apps/projection-worker/src/tenant-loop.ts does the same — reads from
  state.kernel.chains.current() OR composes its own copy and registers
  at boot (same version semantics as the server).

Step 6 — Event-append stamping verification.
  bootstrap.ts already constructs Kernel with a StampingEventStore
  wrapping the real EventStore (per stage 6). Anywhere code currently
  reads `state.eventStore` or similar to do an append, switch to
  `state.kernel.eventStore`. The submitIntent ingress reads from the
  per-request bundle's eventStore — make sure that field threads through
  to kernel.eventStore in buildRequestBundle.

Step 7 — Rewrite apps/server/test/always-on/f2-event-envelope-chain-version.test.ts.
  Remove the slot-pinning hack on ingress.dispatcherChainVersion.
  Replace with:
    test('two requests at different chain versions stamp accordingly', async () => {
      const k1 = buildTestKernel({ initialChainVersion: 1 });
      // submit intent through real submitIntent using k1's pieces
      // assert k1.eventStore's appended events have dispatcherChainVersion === 1
      k1.chains.register(2, /* dummy chain */);
      // submit another intent
      // assert the second appended event has dispatcherChainVersion === 2
    });

Step 8 — Rewrite apps/server/test/always-on/f4-handler-registry-swap.test.ts.
  Remove the source-text regex check on main.ts (no longer the right
  surface — main.ts has one catch-all). Remove the source-scan on
  bootstrap.ts (AppState has handlers now; that test passes trivially).
  Add the two-request behavioural swap:
    test('register(action, v2) takes effect on next request', async () => {
      const kernel = buildTestKernel();
      const v1 = vi.fn(...); const v2 = vi.fn(...);
      kernel.handlers.register('Test.Action.Do', v1);
      await runIntent('Test.Action.Do', { /* payload */ });
      expect(v1).toHaveBeenCalledOnce(); expect(v2).not.toHaveBeenCalled();
      kernel.handlers.register('Test.Action.Do', v2);
      await runIntent('Test.Action.Do', { /* payload */ });
      expect(v1).toHaveBeenCalledOnce(); expect(v2).toHaveBeenCalledOnce();
    });
  Keep the type-level check that HandlerRegistry has register
  (now an inferred from the import, no longer probed via Object.keys).

Step 9 — Run the full test matrix.
  pnpm safe typecheck
  pnpm safe test
  pnpm safe deps:check
  pnpm safe bdd
  Fix any regressions. Existing intents.test.ts and route tests SHOULD
  continue to pass — if they fail, it's a behaviour-divergence the
  catch-all introduced. Fix the catch-all, not the test.

Done bar (hand to sdet, then architect):
- pnpm safe typecheck clean
- pnpm safe test passes
- pnpm safe deps:check 0 errors
- pnpm safe bdd passes
- grep '\bcomposeRegistries\s*\(' apps/server/src/middleware/state.ts → 0 hits
- grep -c "authed\.route" apps/server/src/main.ts → ≤ 1 (the catch-all)
- f2 + f4 test files have no source-text proxies, no slot-pinning hacks

Architect gate (Phase 3): the architect will verify
  - I1: every request still passes through one chokepoint (the catch-all)
  - I2: authz still runs before dispatch (in the catch-all)
  - I3: idempotency still runs before dispatch
  - I5: correlationId still propagates
  - I12: projections still rebuildable from event history (no new
    non-event state introduced)
  - I19: kernel surfaces operate as the spec describes

Update tickets/atlas-on-atlas/stage-7-kernel-migration.md log on
completion. Set status: review and hand to sdet. After architect signs
off, set status: done and archive.
Update tickets/INDEX.md.
```

## Notes / log

- 2026-05-10: created. Largest single ticket in the kernel rewrite. Bundled (vs. split per route) because the catch-all collapse is atomic — partial mounts violate I1. Architect Phase 3 review is mandatory. The dispatcher-chain extract closes ADR 0008 Stage 5 as a side-effect.
