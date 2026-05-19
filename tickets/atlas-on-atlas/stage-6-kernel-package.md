---
title: Atlas-on-Atlas Stage 6 — create packages/kernel/ with reference impl + event-append stamping seam + test fixtures
status: scoped
type: capability
owner: module-dev
phase: 0
capability:
adr: specs/decisions/0008-atlas-on-atlas.md
vision: [atlas-on-atlas, machine-readable-surfaces]
invariants: [I1, I12, I19]
blocks:
  - atlas-on-atlas/stage-7-kernel-migration
  - atlas-on-atlas/stage-8-manifests-and-drift-probe
  - atlas-on-atlas/stage-9-operator-surface
blocked_by:
  - atlas-on-atlas/stage-5-kernel-ports
files_in_scope:
  - packages/kernel/package.json
  - packages/kernel/tsconfig.json
  - packages/kernel/src/index.ts
  - packages/kernel/src/kernel.ts
  - packages/kernel/src/handler-registry.ts
  - packages/kernel/src/dispatcher-chain-registry.ts
  - packages/kernel/src/module-registry.ts
  - packages/kernel/src/stamping-event-store.ts
  - packages/kernel/test/kernel.test.ts
  - packages/kernel/test/handler-registry.contract.test.ts
  - packages/kernel/test/dispatcher-chain-registry.contract.test.ts
  - packages/kernel/test/module-registry.contract.test.ts
  - packages/kernel/test/stamping-event-store.test.ts
  - packages/kernel/test/fixtures.ts
  - packages/CLAUDE.md
  - apps/server/test/always-on/f3-kernel-handle.test.ts
acceptance:
  - "packages/kernel/ workspace exists with package.json, tsconfig.json (extends ../../tsconfig.base.json), src/, test/. Workspace name @atlas/kernel. Dependencies: @atlas/ports, @atlas/platform-core only. No adapter deps."
  - "@atlas/kernel src/index.ts exports: createKernel(deps): Kernel, Kernel class, MutableHandlerRegistry (impl of HandlerRegistry), VersionedDispatcherChainRegistry, InMemoryModuleRegistry (with AJV validation wired), StampingEventStore. Re-exports KernelHandle, KernelSnapshot from @atlas/ports."
  - "packages/kernel/src/kernel.ts: Kernel class implements KernelHandle. Constructor takes ({ eventStore, deps }); owns the three registries + the stamping wrapper. snapshot() composes {modules, handlers, chainVersion, dispatcherSummary} from each registry. Kernel.eventStore is the StampingEventStore wrapping the constructor-supplied eventStore."
  - "packages/kernel/src/handler-registry.ts: MutableHandlerRegistry implements the extended HandlerRegistry port (get/register/unregister/snapshot). Last-write-wins on register. Used by Kernel."
  - "packages/kernel/src/dispatcher-chain-registry.ts: VersionedDispatcherChainRegistry implements DispatcherChainRegistry. current() returns the highest registered version; snapshotAt(v) returns the chain registered at v or null. Pin ChainVersion to number (monotonic counter) — update the ChainVersion type alias in @atlas/ports if the port left it as union (per stage 5 TODO)."
  - "packages/kernel/src/module-registry.ts: InMemoryModuleRegistry implements ModuleRegistry. register() AJV-validates manifest against specs/schemas/contracts/module_manifest.schema.json (loaded via @atlas/schemas). Validation failure throws with a typed error code."
  - "packages/kernel/src/stamping-event-store.ts: StampingEventStore wraps any EventStore. append(envelope) sets envelope.dispatcherChainVersion = chainRegistry.current() if undefined, then delegates to the wrapped append. Re-stamping (envelope already has the field) is a no-op — verify this is idempotent in tests."
  - "packages/kernel/test/handler-registry.contract.test.ts imports runHandlerRegistryContract from @atlas/contract-tests and runs it against MutableHandlerRegistry. Same for the other two registry contract tests."
  - "packages/kernel/test/kernel.test.ts behavioral coverage: register handler → snapshot reflects it; mutate chain version (register new chain) → next event append stamps new version; snapshot composes correctly across registries; concurrent register calls last-write-wins."
  - "packages/kernel/test/stamping-event-store.test.ts: stamps a bare envelope; idempotent on a pre-stamped envelope; pulls version from chainRegistry at call time (test mutates between two appends)."
  - "packages/kernel/test/fixtures.ts: exports buildTestKernel(opts?: { initialChainVersion?, modules?, ... }) returning a Kernel with in-memory stores. Test files in OTHER packages (apps/server/test/always-on/, future stage-8 drift probe) import this."
  - "apps/server/test/always-on/f3-kernel-handle.test.ts REWRITTEN: removes both prior test.todo entries. Imports KernelHandle from @atlas/kernel (re-exported from @atlas/ports). Tests: type-level — KernelHandle has handlers, chains, modules, snapshot (uses vitest expectTypeOf). Runtime — buildTestKernel() returns a Kernel whose snapshot() returns the expected shape; type assertion that no field on the returned snapshot references an adapter concrete type."
  - "packages/CLAUDE.md primary-packages or supporting-packages table adds @atlas/kernel row. Dependency graph block updated: 'kernel ──► ports, platform-core, schemas'."
  - "pnpm safe typecheck clean."
  - "pnpm safe test passes — including the three new contract tests and the kernel-specific behavioral tests."
  - "pnpm safe deps:check 0 errors. The kernel package's import graph contains ONLY @atlas/ports, @atlas/platform-core, @atlas/schemas. No @atlas/adapter-* imports."
created: 2026-05-10
updated: 2026-05-10
---

## Why

Stage 5 defined the port surfaces; stage 6 makes them real. The `packages/kernel/` artifact is what `apps/server` will hold a reference to in stage 7 — the *thing* the spec keeps calling "the kernel."

Two seams in particular only exist after this ticket lands:

1. **`StampingEventStore`** — the wrapper that puts `envelope.dispatcherChainVersion` on every appended event. SDET round 2 named this gap on F2: today no production code path stamps the field, so the test cannot probe it without coupling to test infrastructure. This stage creates the production seam.

2. **`buildTestKernel()`** — replaces the elaborate `FakeBundle` proxy harness the always-on tests currently use. Once tests can spin up a real kernel with known state, the SDET-flagged "test against proxies" problem evaporates.

Modeled structurally on `packages/wasm-host/` (newest infrastructure package; small but real public surface; in-process; cross-environment).

## Scope

**In:**

1. **New workspace `packages/kernel/`** with `package.json`, `tsconfig.json`, `src/`, `test/`. Standard pnpm-workspace shape; matches the layout of `packages/wasm-host/`.

2. **Reference implementations** of the three new ports + the extended `HandlerRegistry`:
   - `MutableHandlerRegistry` — Map-backed, last-write-wins, snapshot returns a fresh array each call.
   - `VersionedDispatcherChainRegistry` — Map keyed by version (number); `current()` returns the highest registered version.
   - `InMemoryModuleRegistry` — Map keyed by `moduleId`; `register()` AJV-validates the manifest first.

3. **`StampingEventStore`** — decorator over any `EventStore`. Stamps `envelope.dispatcherChainVersion` from `chainRegistry.current()` at `append` time; idempotent on re-stamp.

4. **`Kernel` class** implementing `KernelHandle`. Constructor wires the registries + the stamping wrapper; `snapshot()` composes the four-field view.

5. **Test fixtures** — `buildTestKernel(opts?)` returning a fully-wired in-memory kernel.

6. **Contract tests** — wire up the three suites from stage 5 against this package's implementations. They MUST pass.

7. **F3 test rewrite** — `apps/server/test/always-on/f3-kernel-handle.test.ts` becomes a real probe against `KernelHandle` exported from `@atlas/kernel`. Both prior `test.todo` entries replaced with concrete `expectTypeOf` + runtime snapshot-shape assertions.

8. **`packages/CLAUDE.md` inventory update.**

**Out:**

- Wiring `Kernel` into `apps/server` (stage 7).
- Module-side changes — modules continue to export `xxxHandlerRegistry()` factories. Stage 7's `bootstrap.ts` rewrite calls those factories and passes their entries to `kernel.handlers.register()`.
- HTTP routes / operator surface (stage 9).
- Per-module manifest population (stage 8).

## Resume prompt

```
Atlas-on-Atlas Stage 6 — create the packages/kernel/ workspace with
reference implementations of the four ports from stage 5, plus the
StampingEventStore seam and test fixtures.

Blocked on stage 5; confirm @atlas/ports exports HandlerRegistry
(extended), DispatcherChainRegistry, ModuleRegistry, KernelHandle,
KernelSnapshot, ChainVersion before starting.

Step 1 — Scaffold the workspace.
  mkdir -p packages/kernel/{src,test}
  Copy packages/wasm-host/package.json → packages/kernel/package.json,
    rename "@atlas/wasm-host" → "@atlas/kernel". Strip dependencies
    down to:
      "@atlas/ports": "workspace:*",
      "@atlas/platform-core": "workspace:*",
      "@atlas/schemas": "workspace:*",
      "ajv": (whatever version @atlas/schemas uses)
    devDependencies: vitest (pnpm workspace catalog).
  Copy packages/wasm-host/tsconfig.json → packages/kernel/tsconfig.json
    unchanged.
  pnpm install at repo root.

Step 2 — Implement MutableHandlerRegistry (src/handler-registry.ts).
  Map<string, IntentHandler> backing store. register/unregister mutate
  the map; get reads it; snapshot returns
  [...map.entries()].map(([actionId, h]) => ({ actionId,
  handlerIdentity: h.identity ?? h.constructor.name })).
  handlerIdentity is a stable string for snapshot diffing. If
  IntentHandler doesn't have an identity field, fall back to a
  symbol-keyed registry counter.

Step 3 — Implement VersionedDispatcherChainRegistry
  (src/dispatcher-chain-registry.ts).
  Map<number, EventDispatcher> + a high-water-mark number.
  register(version, chain) sets the map entry and updates HWM.
  current() returns HWM. snapshotAt(v) returns map.get(v) ?? null.
  If stage 5 left ChainVersion as `number | string`, NARROW it to
  `number` here. Update @atlas/ports's ChainVersion type alias in
  ports/src/dispatcher-chain-registry.ts to `number` and remove the
  TODO comment — this is the in-lockstep narrowing stage 5 deferred.

Step 4 — Implement InMemoryModuleRegistry (src/module-registry.ts).
  Map<string, { manifest, instance }> backing store.
  Load module_manifest.schema.json via @atlas/schemas getSchemaValidator
  at constructor time (cache the validator).
  register(manifest, instance) validates manifest, throws KernelError
  (new local error class with code MANIFEST_INVALID) on validation fail,
  otherwise inserts.
  list/get/unregister are trivial Map operations.

Step 5 — Implement StampingEventStore (src/stamping-event-store.ts).
  class StampingEventStore implements EventStore {
    constructor(
      private inner: EventStore,
      private chains: DispatcherChainRegistry,
    ) {}
    async append(envelope: EventEnvelope): Promise<StoredEvent> {
      if (envelope.dispatcherChainVersion === undefined) {
        envelope.dispatcherChainVersion = this.chains.current();
      }
      return this.inner.append(envelope);
    }
    // Forward read methods (subscribe, fetchSince, etc.) unchanged.
  }
  Idempotent on re-stamp by construction (only sets if undefined).

Step 6 — Implement Kernel class (src/kernel.ts).
  export class Kernel implements KernelHandle {
    readonly handlers: MutableHandlerRegistry;
    readonly chains: VersionedDispatcherChainRegistry;
    readonly modules: InMemoryModuleRegistry;
    readonly eventStore: StampingEventStore;
    constructor(deps: { eventStore: EventStore }) {
      this.handlers = new MutableHandlerRegistry();
      this.chains = new VersionedDispatcherChainRegistry();
      this.modules = new InMemoryModuleRegistry();
      this.eventStore = new StampingEventStore(deps.eventStore, this.chains);
    }
    snapshot(): KernelSnapshot {
      return {
        modules: this.modules.list(),
        handlers: this.handlers.snapshot(),
        chainVersion: this.chains.current(),
        dispatcherSummary: [], // populated when caller registers chains with names; placeholder array for now
      };
    }
  }
  export function createKernel(deps): Kernel { return new Kernel(deps); }

Step 7 — Export public surface from src/index.ts.

Step 8 — Behavioral tests in test/kernel.test.ts. Cover:
  - register handler → snapshot reflects it
  - chain version monotonic; snapshot.chainVersion updates after
    chains.register(v+1, ...)
  - eventStore.append stamps version at call time, even if version
    mutates between two appends
  - snapshot returns a fresh object (mutating it doesn't affect the
    kernel)

Step 9 — Contract tests. Three files in test/:
  - handler-registry.contract.test.ts imports
    runHandlerRegistryContract from @atlas/contract-tests; invokes it
    with () => new MutableHandlerRegistry().
  - dispatcher-chain-registry.contract.test.ts ditto.
  - module-registry.contract.test.ts ditto (need a valid manifest
    fixture; reuse packages/schemas/src/generated/manifests/authz.manifest.json
    if shape matches, else inline a minimal one).

Step 10 — StampingEventStore tests in test/stamping-event-store.test.ts.
  Probe stamping, idempotence on re-stamp, version pulled at call time.

Step 11 — test/fixtures.ts:
  export function buildTestKernel(opts?: {
    initialChainVersion?: number;
    modules?: Array<{ manifest: ModuleManifest; instance: unknown }>;
  }): Kernel
  Wires an InMemoryEventStore (from @atlas/ports or
  packages/contract-tests). Used by tests in OTHER packages.

Step 12 — Rewrite apps/server/test/always-on/f3-kernel-handle.test.ts.
  Remove the two test.todo entries. Replace with:
    test 1 (type-level): expectTypeOf<KernelHandle>().toHaveProperty(
      'handlers').toBeObject(); same for chains, modules, snapshot.
    test 2 (runtime shape): const k = buildTestKernel();
      const snap = k.snapshot();
      expect(snap).toHaveProperty('modules');
      expect(snap).toHaveProperty('handlers');
      expect(snap).toHaveProperty('chainVersion');
      expect(snap).toHaveProperty('dispatcherSummary');
    test 3 (adapter-import refusal at the type level): Add a
      compile-time probe. The current substring-match hack on .d.ts is
      gone; the real probe is that KernelHandle imported from
      @atlas/kernel doesn't expose adapter concretes. If a clean type
      assertion is hard, leave a test.todo pointing at the deps:check
      rule that ultimately enforces this (referenced in stage 6
      acceptance — pnpm deps:check 0 errors guarantees no adapter
      imports leak).

Step 13 — Update packages/CLAUDE.md. Add @atlas/kernel row to the
appropriate inventory table (supporting-packages probably). Update
the dependency graph block: 'kernel ──► ports, platform-core, schemas'.

Done bar:
- pnpm safe typecheck clean
- pnpm safe test passes (new tests + existing tests still green)
- pnpm safe deps:check 0 errors
- f3-kernel-handle.test.ts has no test.todo entries; both prior todos
  replaced with real assertions

Update tickets/atlas-on-atlas/stage-6-kernel-package.md log on
completion. Set status: review and hand to sdet.
Update tickets/INDEX.md.
```

## Notes / log

- 2026-05-10: created. The kernel package is the lynchpin of the rewrite — once it exists, the always-on tests can probe real surfaces instead of source-text proxies. Reference impls are deliberately small and behaviour-focused; performance work belongs in a later ticket if profiling flags any.
