---
title: Atlas-on-Atlas Stage 5 — extend HandlerRegistry + add DispatcherChainRegistry, ModuleRegistry, KernelHandle ports
status: scoped
type: refactor
owner: port-adapter-dev
phase: 0
capability:
adr: specs/decisions/0008-atlas-on-atlas.md
vision: [atlas-on-atlas, machine-readable-surfaces]
invariants: [I1, I12, I19]
blocks:
  - atlas-on-atlas/stage-6-kernel-package
blocked_by:
  - atlas-on-atlas/stage-4-kernel-observability-invariant
files_in_scope:
  - ports/src/handler-registry.ts
  - ports/src/dispatcher-chain-registry.ts
  - ports/src/module-registry.ts
  - ports/src/kernel-handle.ts
  - ports/src/index.ts
  - ports/CLAUDE.md
  - packages/contract-tests/src/handler-registry.ts
  - packages/contract-tests/src/dispatcher-chain-registry.ts
  - packages/contract-tests/src/module-registry.ts
  - packages/contract-tests/src/index.ts
acceptance:
  - "ports/src/handler-registry.ts: HandlerRegistry grows register(actionId, handler), unregister(actionId), and snapshot(): readonly {actionId, handlerIdentity}[]. get() retained. All new methods are required (no optional ?). Inline JSDoc cites I19."
  - "ports/src/dispatcher-chain-registry.ts (NEW): DispatcherChainRegistry interface with current(): ChainVersion, register(version, chain: EventDispatcher), snapshotAt(version): EventDispatcher | null. ChainVersion type is number | string (pin to one in the file's comment with a TODO referencing the decision)."
  - "ports/src/module-registry.ts (NEW): ModuleRegistry interface with list(): readonly ModuleManifest[], get(moduleId): ModuleManifest | undefined, register(manifest, instance): Promise<void>, unregister(moduleId): Promise<void>. ModuleManifest type imported from @atlas/platform-core (or declared here if it doesn't exist there — verify before writing)."
  - "ports/src/kernel-handle.ts (NEW): KernelHandle interface composes the three registries (handlers: HandlerRegistry; chains: DispatcherChainRegistry; modules: ModuleRegistry) plus snapshot(): KernelSnapshot. KernelSnapshot is a separate exported type. Only imports from @atlas/ports and @atlas/platform-core — NO adapter imports."
  - "ports/src/index.ts re-exports HandlerRegistry (extended), DispatcherChainRegistry, ModuleRegistry, KernelHandle, KernelSnapshot, ChainVersion."
  - "ports/CLAUDE.md port catalogue table updated: HandlerRegistry description notes mutation methods; 3 new rows for DispatcherChainRegistry, ModuleRegistry, KernelHandle with file refs and purposes."
  - "packages/contract-tests/src/handler-registry.ts (NEW): exports runHandlerRegistryContract(makeRegistry). Tests: register-then-get returns the new handler; unregister-then-get returns undefined; snapshot lists registered entries; register twice on same actionId is last-write-wins (or throws — pin one and document)."
  - "packages/contract-tests/src/dispatcher-chain-registry.ts (NEW): exports runDispatcherChainRegistryContract. Tests: register(v1, chain); current() == v1; register(v2, chain); current() == v2; snapshotAt(v1) returns the v1 chain instance; snapshotAt(unknownVersion) returns null."
  - "packages/contract-tests/src/module-registry.ts (NEW): exports runModuleRegistryContract. Tests: register a manifest; list() includes it; get(moduleId) returns it; unregister; list() excludes it."
  - "packages/contract-tests/src/index.ts re-exports the three new contract suites."
  - "pnpm safe typecheck clean — new ports compile; consumer changes are NOT required in this stage (existing composeRegistries-based wiring continues to satisfy the get-only methods)."
  - "pnpm safe test — contract suites are runnable but have no adapter under test yet; the suite skeletons compile and report as 0 tests / 0 failures when invoked without a fixture."
  - "pnpm safe deps:check 0 errors (no port imports an adapter)."
created: 2026-05-10
updated: 2026-05-10
---

## Why

Stage 4 (I19) names the kernel as a normative requirement. Stage 5 expresses it in TypeScript so stage 6 has typed surfaces to implement.

The HandlerRegistry mutation methods are the single most-load-bearing change. Today only `get(actionId)` exists — there is no public way to install a v(N+1) handler at runtime. This is why three rounds of SDET test review converged on "no real seam to test against." The same is true for the dispatcher chain (currently a per-request `composeDispatchers(...)` expression in `apps/server/src/middleware/state.ts` line 315) and the module set (currently a static `moduleManifests()` array). Stage 5 turns each into a first-class port.

`KernelHandle` is the surface a hot-loaded module's `register(kernel)` receives (always-on.md §4.1). Defining it here pins what's reachable from inside a hot-loaded bundle — and equally important, what's NOT reachable (no adapter concretes).

## Scope

**In:**

1. **Extend `ports/src/handler-registry.ts`.** Add `register`, `unregister`, `snapshot`. Methods are required (not optional). `IntentHandler` and `HandlerResult` types remain unchanged. Document the contract: `register` is last-write-wins (mutation, not append) — `snapshot` after `register(X, h2)` following `register(X, h1)` reflects only `h2`. JSDoc cites I19.

2. **Create `ports/src/dispatcher-chain-registry.ts`.** Interface only, no impl. ChainVersion type pinned to `number | string` for now with an inline TODO that stage 6 must pin one. The port's purpose: a versioned snapshot of the dispatcher composition, so when `WORKER_MODE=async` the worker can replay an old event's chain even after a reload.

3. **Create `ports/src/module-registry.ts`.** Interface only. ModuleManifest type — check if it already lives in `@atlas/platform-core`; if yes, import; if no, declare in the port file and re-export from `ports/src/index.ts`. The port's purpose: kernel knows which modules are loaded; reload mutates this set.

4. **Create `ports/src/kernel-handle.ts`.** KernelHandle is the composition surface. Constraints:
   - Imports ONLY from `@atlas/ports` (self-references) and `@atlas/platform-core`.
   - References NO concrete adapter type.
   - `snapshot()` returns a JSON-serializable shape (operator surfaces will serve it over HTTP in stage 9).

5. **Re-exports + CLAUDE.md update.** Standard port-addition flow.

6. **Contract suites in `packages/contract-tests/`.** One per new port. Follow the existing pattern (`packages/contract-tests/src/cache.ts` is the closest structural model). Suites take a `makeX()` factory and exercise the port behaviorally. No adapter is registered to run them yet — stage 6's reference impl will be the first.

**Out:**

- Implementing the ports. Stage 6 owns `packages/kernel/` which provides the reference impls.
- Touching `composeRegistries` in `modules/authz` or its callers — those continue to work because `get()` is preserved.
- Touching `apps/server/src/middleware/state.ts` or `apps/projection-worker/src/tenant-loop.ts` — stage 7 owns the migration.
- Adapter implementations (`adapter-node`, `adapter-idb`) — they don't implement these ports because the kernel is in-process; the kernel package IS the implementer.

## Resume prompt

```
Atlas-on-Atlas Stage 5 — extend HandlerRegistry and add three new ports
(DispatcherChainRegistry, ModuleRegistry, KernelHandle) plus contract
test suites. Driving ADR: specs/decisions/0008-atlas-on-atlas.md.
Blocked on stage 4 (I19); confirm I19 exists in architecture.md before
starting.

This is a pure interface-definition slice. No implementations; no
consumer rewires. Stages 6 and 7 own those.

Step 1 — Read I19 (specs/architecture.md, after I18) and
specs/crosscut/always-on.md §4.1, §4.2, §4.3, §11.

Step 2 — Extend ports/src/handler-registry.ts.
  Add three methods to the HandlerRegistry interface:
    register(actionId: string, handler: IntentHandler): void;
    unregister(actionId: string): void;
    snapshot(): readonly { actionId: string; handlerIdentity: string }[];
  Methods required, not optional. JSDoc above the interface notes
  this implements I19; mutation is last-write-wins; snapshot returns
  the live set at call time.

Step 3 — Create ports/src/dispatcher-chain-registry.ts.
  export type ChainVersion = number | string;
  export interface DispatcherChainRegistry {
    current(): ChainVersion;
    register(version: ChainVersion, chain: EventDispatcher): void;
    snapshotAt(version: ChainVersion): EventDispatcher | null;
  }
  ChainVersion union has a TODO comment: stage 6 pins to one type.
  Import EventDispatcher from ./dispatcher.ts.

Step 4 — Create ports/src/module-registry.ts.
  Check @atlas/platform-core for an existing ModuleManifest type.
    grep -rE "export (interface|type) ModuleManifest"
      packages/platform-core/src packages/schemas/src
    If found, import it. If not, declare a minimal one in this file
    based on packages/schemas/src/generated/manifests/*.json shape.
  export interface ModuleRegistry {
    list(): readonly ModuleManifest[];
    get(moduleId: string): ModuleManifest | undefined;
    register(manifest: ModuleManifest, instance: unknown): Promise<void>;
    unregister(moduleId: string): Promise<void>;
  }
  JSDoc: register MUST AJV-validate the manifest; stage 6's impl owns
  validation logic.

Step 5 — Create ports/src/kernel-handle.ts.
  Imports only from ./handler-registry.ts, ./dispatcher-chain-registry.ts,
  ./module-registry.ts, and @atlas/platform-core. ABSOLUTELY NO
  @atlas/adapter-* imports.
    export interface KernelSnapshot {
      modules: readonly ModuleManifest[];
      handlers: readonly { actionId: string; handlerIdentity: string }[];
      chainVersion: ChainVersion;
      dispatcherSummary: readonly string[];   // dispatcher names in chain order
    }
    export interface KernelHandle {
      readonly handlers: HandlerRegistry;
      readonly chains: DispatcherChainRegistry;
      readonly modules: ModuleRegistry;
      snapshot(): KernelSnapshot;
    }

Step 6 — Re-export from ports/src/index.ts:
  HandlerRegistry (already there; no change)
  DispatcherChainRegistry, ChainVersion (new)
  ModuleRegistry, ModuleManifest (new — re-export only if declared in
    module-registry.ts; otherwise it's already re-exported from
    platform-core)
  KernelHandle, KernelSnapshot (new)

Step 7 — Update ports/CLAUDE.md port catalogue table. Add three rows
for the new ports. Update HandlerRegistry row's purpose to mention
"mutable (register/unregister/snapshot) — Invariant I19".

Step 8 — Contract test suites.
  packages/contract-tests/src/handler-registry.ts (NEW):
    export function runHandlerRegistryContract(
      makeRegistry: () => HandlerRegistry,
      makeHandler: (id: string) => IntentHandler,
    ): void { describe(...) { ... } }
    Tests:
      - register(A, h1); get(A) === h1
      - register(A, h2); get(A) === h2  (last-write-wins)
      - unregister(A); get(A) === undefined
      - snapshot() reflects current registered set
      - snapshot() returns a new array each call (no shared mutation)
  packages/contract-tests/src/dispatcher-chain-registry.ts (NEW):
    runDispatcherChainRegistryContract(makeRegistry). Tests per the
    acceptance list.
  packages/contract-tests/src/module-registry.ts (NEW):
    runModuleRegistryContract(makeRegistry, makeManifest). Tests per
    the acceptance list.

Step 9 — Re-export the three suites from packages/contract-tests/src/index.ts.

Done bar:
- pnpm safe typecheck clean
- pnpm safe deps:check 0 errors
- pnpm safe test passes (contract suites have no adapter to test
  against yet, so they're declared but not invoked)
- Files listed in files_in_scope are the only files touched

Update tickets/atlas-on-atlas/stage-5-kernel-ports.md log on completion.
Set status: review and hand to sdet.
Update tickets/INDEX.md.
```

## Notes / log

- 2026-05-10: created. Stage 5 of the kernel rewrite. Pure interface-definition slice; depends on I19 spec (stage 4) landing. The contract-test suites are the first acceptance gate stage 6's reference impls must pass.
