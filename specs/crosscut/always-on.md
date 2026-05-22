# Atlas Always-On Contract

Atlas is an **always-on kernel**. The runtime stays up; behaviour changes by editing data, not by restarting code. Restart is the exception, not the default.

This spec sets the bar [ADR 0008 §Stage 6](../decisions/0008-atlas-on-atlas.md) deferred: **what counts as restart-required, and what is reloadable while the system is serving traffic.** It is the operator's contract for "can I change this without a restart?" and the developer's contract for "if I add this, can I keep the kernel up?"

The spec is normative (RFC 2119). It interacts with invariants **I1, I2, I12, I14, I17** and is referenced by [`architecture.md`](../architecture.md), [`lifecycle.md`](../lifecycle.md), and [ADR 0010 §"Hot-reload of Atlas code"](../decisions/0010-control-plane-runtime-location.md).

## Why this is even possible

The Lisp-image property — "the running system is the data; change the data, the system changes" — is the agentic-first tenet's mechanical consequence. Three architectural choices already paid for it:

- **I12: projections are rebuildable from events.** State is durable independent of code; reload, then resume or replay.
- **Hexagonal layering.** Ports are the surface; adapters are interchangeable. Adapter swap is well-defined by construction.
- **Recursive kernel ([ADR 0008](../decisions/0008-atlas-on-atlas.md)).** Atlas's own behaviour is mostly data — Cedar policies, tenant schemas, tenant code, tenant declarations, log levels. The irreducible-code surface is small by design.

This spec names what's already true, what's reachable, and what cannot move.

---

## §1 The kernel/data split

**Kernel** — code whose change requires a process restart. Identified by exclusion: code that participates in the request lifecycle's structural invariants (I1, I2) or whose substitution mid-request would violate them.

**Data plane** — everything else. Changeable while the process is serving traffic, via mechanisms defined in §3.

A change asks: *"could this have been data?"* If yes, default to making it data. If no, the §2 carve must justify why.

---

## §2 What is restart-required (the kernel)

The following are **kernel** and a change requires a process restart:

| Surface | Why it's kernel |
|---|---|
| The ingress pipeline shape ([`packages/ingress`](../../packages/ingress/)) — the strict order of authn → tenant → schema → idempotency → authz → quota → handler dispatch | Reordering or removing a step violates I1, I2, I3, I13 atomically; the order is a structural invariant, not configuration |
| The event-store append path | The append is the durability boundary; substituting it mid-write risks an event written without being durable or read after being unwritten |
| The projection-rebuild loop in [`apps/projection-worker`](../../apps/projection-worker/) | I12's guarantee depends on a single deterministic rebuilder per cursor; hot-swapping the loop mid-rebuild risks divided-state |
| Port **definitions** under [`ports/`](../../ports/) | Ports are statically typed; a port-surface change without recompilation breaks every consumer |
| The Hono framework binding and the HTTP listener bootstrap in [`apps/server/src/main.ts`](../../apps/server/src/main.ts) | Below the routing layer; swap requires socket-level coordination outside this spec |
| Node.js runtime, OS, container image | Out of scope; restart in the operator's sense (rolling deploy) |

Everything not in this table is **not** kernel. If you find yourself proposing a code change outside this list, the first question is: *"can this be data?"*

---

## §3 What is data (hot-changeable today)

Already hot, no spec change needed:

| Surface | Mechanism | Bound by |
|---|---|---|
| Cedar policies (per tenant) | [`PostgresBundleLoader`](../../adapters/policy-cedar/) reloads on bundle version bump | I2, I4 |
| Tenant entity types and schemas | [ADR 0005](../decisions/0005-custom-schema-storage-strategy.md) — DDL allowlist applied at request time per tenant | I16 |
| Tenant functions | [ADR 0006](../decisions/0006-function-runtime-substrate.md) — `FunctionRuntime` adapter loads on invocation | I14, I15 |
| Tenant declarations (DSL) | [ADR 0007](../decisions/0007-dsl-substrate-and-authoring-contract.md) — evaluated in-process per request | I14 scope note |
| Log levels (global / module / tenant / correlation) | `LevelController` — see [`logging.md` §"Level overrides"](logging.md) | — |
| Custom-domain → tenant mapping | `customDomainCache` invalidated by tenancy events | I7 |
| Idempotency-key store | Per-tenant Postgres row, no code path | I3 |
| Cache contents (per-key) | Tag-based invalidation by event | I9, I10 |

Achievably hot (work tracked in §6, currently kernel by accident):

| Surface | Today | Target |
|---|---|---|
| Action → route binding (intent + query sides) | Hardcoded `app.route(...)` for intents and hand-mounted `app.get(...)` / `app.post(...)` for reads in [`apps/server/src/main.ts`](../../apps/server/src/main.ts) and `apps/server/src/routes/*.ts` | Two catch-alls — `POST /api/v1/intents` dispatching via `controlPlaneRegistry` (a composed `HandlerRegistry`), and `GET/POST /api/v1/queries/:queryId` dispatching via a composed `QueryRegistry`; new intents and queries register in their module's `*HandlerRegistry` / `*QueryRegistry` and wire themselves. See [`action-driven-routing.md`](action-driven-routing.md). |
| Dispatcher chain composition | Mirrored across [`apps/server/src/middleware/state.ts`](../../apps/server/src/middleware/state.ts) and [`apps/projection-worker/src/tenant-loop.ts`](../../apps/projection-worker/src/tenant-loop.ts) | `packages/dispatch-chain` registry — runtime-mutable, audited |
| Module manifests | Bundled via `moduleManifests()` from [`@atlas/schemas`](../../packages/schemas/) | Loaded from `control_plane.module_manifests`; tenant-enabled subset cached per request |
| First-party module code (handlers, projections, queries) | TypeScript imported at boot | `register(kernel) / dispose()` lifecycle + dynamic `import()` with cache-busting |
| Adapter selection (mailer, policy engine, wasm host) | Switch statement in [`bootstrap.ts`](../../apps/server/src/bootstrap.ts) | Per-port `swap(newAdapter)` protocol — drain, close, replace |
| Frontend surface registration | One-shot `customElements.define` at app boot | Version-suffixed tag names or shadow registry; surface manifest reload |
| Event-type registry | Static schemas in `@atlas/schemas` | DB-backed registry with upcaster chain (the `UpcasterRegistry` half is already in place — see [`bootstrap.ts`](../../apps/server/src/bootstrap.ts)) |

---

## §4 Hot-reload contract

Any code path declared hot-reloadable in §3 MUST satisfy the following.

### §4.1 Lifecycle

Hot-reloadable units (modules, adapters, dispatchers) MUST expose:

```ts
interface HotReloadable<T> {
  /** Called when the unit is first loaded or reloaded. Returns the live instance. */
  register(kernel: KernelHandle): Promise<T>;
  /** Called before unload. MUST drain in-flight work and release resources. */
  dispose(instance: T): Promise<void>;
}
```

`dispose` MUST be idempotent and MUST return only after every operation it started has either completed or been handed off. A reload is `dispose(old)` then `register(new)`. The kernel MUST NOT route new work to a unit between these calls.

### §4.2 Request-boundary atomicity

A reload MUST NOT split a request across versions. A request resolved against version N runs every step (authn → … → dispatch → event append → dispatcher chain) on version N. The kernel routes the *next* request to version N+1.

Implementation note: handlers and dispatchers MUST be resolved at request-dispatch time, not captured in the request-handler closure. Today's `buildApp(state)` captures everything; that pattern is incompatible with hot-reload and is on §6's list.

### §4.3 Invariant preservation across reload

The following invariants MUST hold across a reload, not only within a version:

- **I1**: every request still traverses the single ingress chokepoint. A reload cannot expose a side-door endpoint.
- **I2**: authorization still runs before any side effect. A handler swapped to a version that emits before authz is a violation.
- **I3**: idempotency-key checks still precede dispatch. A reload cannot drop the check for "compatibility."
- **I12**: projections still rebuildable from event history. A reload that introduces a projection requiring non-event state is a violation, reload or not.
- **I17**: API / CLI / UI parity. A new action loaded via reload MUST be reachable from every surface; `atlasctl` parity checks run against the live registry, not the boot-time snapshot.

The reload mechanism MUST refuse a unit whose manifest declares a violation. The reload mechanism MUST NOT silently down-grade invariants.

### §4.4 Resource lifecycle on adapter swap

Adapter swap (`Mailer`, `PolicyEngine`, `WasmHost`, etc.) MUST follow:

1. Construct new adapter; verify it satisfies the port (smoke test).
2. Stop routing new operations to the old adapter; new operations queue against the new one.
3. Wait for the old adapter's in-flight operations to settle (bounded by a `drainTimeout` declared per port; default 30s).
4. Call old adapter's `close()` / `dispose()`.
5. Publish `Audit.AdapterSwapped` with `port`, `fromVersion`, `toVersion`, `principalId`, `correlationId`.

If drain exceeds `drainTimeout`, the kernel MUST log at `error`, abort the swap, and keep the old adapter live. A failed swap leaves the system in the pre-swap state.

### §4.5 Failure semantics

If `register(new)` throws, the kernel MUST keep `old` registered and surface the failure as a typed error to the operator. A reload is **all-or-nothing**: there is no half-loaded module state.

If `dispose(old)` throws, the kernel MUST log at `error` and proceed with `register(new)`. The system cannot be held hostage by a misbehaving dispose; the audit trail is the recourse.

### §4.6 Multi-replica coordination

Hot-reload across multiple `apps/server` replicas MUST coordinate via a leader-elected reloader OR a quiescent rolling-restart fallback. Until that coordinator lands (§6 phase 4), hot-reload is **single-replica only** and the operator surface MUST refuse a reload on a multi-replica deployment.

This restriction exists because [`bootstrap.ts`](../../apps/server/src/bootstrap.ts) self-acknowledges `serverEvents` is per-process; a reload on replica A that fires a `ServerEvent` subscribers on replica B are listening for produces inconsistent visibility.

---

## §5 Operator surface

Hot-reload is an operator action, governed by I17.

| Action | `atlasctl` | HTTP | Notes |
|---|---|---|---|
| List loaded modules + versions | `atlasctl kernel modules` | `GET /api/v1/kernel/modules` | Returns `{ moduleId, version, registeredAt }[]` |
| Reload a module | `atlasctl kernel reload <moduleId> [--version <v>]` | `POST /api/v1/kernel/modules/:id/reload` | Idempotent on `(moduleId, version)`; double-call is a no-op |
| Swap an adapter | `atlasctl kernel swap <port> --adapter <name>` | `POST /api/v1/kernel/ports/:port/swap` | Per-port `drainTimeout` honored |
| Dry-run a reload | `atlasctl kernel reload <id> --dry-run` | `POST /api/v1/kernel/modules/:id/reload?dryRun=true` | Validates manifest + invariant compatibility; no side effect |
| Stream reload audit | `atlasctl kernel events --follow` | SSE `/api/v1/kernel/events` | Tails `Audit.ModuleReloaded` / `Audit.AdapterSwapped` |

All reload operations:

- Require an operator-scoped principal. The `_platform` tenant ([ADR 0008](../decisions/0008-atlas-on-atlas.md)) is the resource owner; tenant principals never have authz.
- Emit `Audit.ModuleReloaded` / `Audit.AdapterSwapped` per [`logging.md`](logging.md) and [`crosscut/events.md`](events.md). Audit envelope carries `correlationId`, `principalId`, `fromVersion`, `toVersion`, `result`, `durationMs`.
- Are quota-checked (`kernel-reloads-per-window`) so a misbehaving operator script cannot brown out the system.

Reload is **never** a tenant-facing action; this is operator surface only.

---

## §6 Staged path

Builds on [ADR 0008](../decisions/0008-atlas-on-atlas.md) staging. Stages 1–3 are prerequisites (port leaks, `_platform` row, brittle tests); they unblock everything below.

| Phase | Work | Owner | Gates |
|---|---|---|---|
| 0 | Stage 5 — extract [`packages/dispatch-chain`](../../packages/) consolidating `state.ts` ↔ `tenant-loop.ts` duplication | spine-owner + port-adapter-dev | I12 dispatch test rebuilds projections against extracted chain |
| 1 | **Action-driven routing — both intent and query sides.** Replace hand-wired `app.route(...)` for intents AND hand-mounted `app.get(...)` / `app.post(...)` read routes with two catch-alls: `POST /api/v1/intents` (already in place — dispatches via `controlPlaneRegistry` to a composed `HandlerRegistry`) and `GET/POST /api/v1/queries/:queryId` (new — dispatches via a composed `QueryRegistry` to per-module-registered query functions). Both catch-alls run the same per-request bundle build, the same authz step (`submitIntent` for intents; `evaluateRead` for queries), and the same audit pathway. After this phase, adding a new intent OR a new query is a module-only edit (register in the module's `*HandlerRegistry` or `*QueryRegistry`); no kernel touch in `apps/server/src/main.ts` or `routes/*.ts`. The query-side contract (descriptor shape, `queryId` naming, authz-on-read, cache-key descriptor) is normative in [`action-driven-routing.md`](action-driven-routing.md). | spine-owner + module-dev | Existing intent route tests pass; existing read route tests pass against the migrated route (one example per the substrate ticket); I1 enforced by the two catch-alls being the only mounts; I2 enforced by authz running before dispatch on both sides; integration test asserts a synthetic query registered in a module registry is reachable via `GET /api/v1/queries/<id>` without an `apps/server` edit |
| 2 | Dispatcher-chain registry — runtime-mutable `register/unregister` with operator authz + audit | spine-owner | I12 holds across `register/unregister`; SDET adversarial pass |
| 3 | Module lifecycle (§4.1) + dynamic loader — `HotReloadable<T>` contract; first-party modules opt in one at a time; identity last (largest blast radius) | module-dev | Reload of `catalog` works under load without dropping a request |
| 4 | Multi-replica reload coordinator | spine-owner + compute-owner | Two-replica BDD scenario: reload completes; both replicas serve N+1 |
| 5 | Frontend surface bundle reload — version-suffix or shadow registry | frontend-dev | Admin shell hot-reloads a surface without full reload |
| 6 | AppState → typed mutable registry with port-swap protocol (§4.4) — last because it touches the most | spine-owner + port-adapter-dev | Mailer / PolicyEngine / WasmHost swap covered by contract tests in [`packages/contract-tests`](../../packages/contract-tests/) |
| 7 | **Kernel-extraction backlog drained — [I20](../architecture.md#i20-operator-feature-delivery-is-an-intent) becomes merge-blocking.** Phases 0–6 have shipped; the open `tickets/kernel-extraction/` extraction-plan tickets accumulated during phases 0–6 have all merged or been dropped with a written justification. From this point forward, a kernel touch without an accompanying §11 retrospective and a linked extraction-plan ticket fails the architect gate. | spine-owner + vision-keeper | `tickets/kernel-extraction/` has no `scoped`/`in-flight` extraction-plan tickets older than 90 days; vision-keeper attests in its monthly audit that the kernel-touch rate is trending toward zero; architect gate enforces I20 as merge-blocking on every PR |

Each phase lands as its own slice under the [slice workflow](../../CLAUDE.md#slice-workflow), referenced from `tickets/atlas-on-atlas/`.

---

## §7 Anti-patterns

The following defeat always-on and are forbidden:

- **Restart-as-shortcut.** "We'll just bounce the process" is not a substitute for a hot path. If a change demands a restart, it either belongs in the §2 kernel list or it is a bug in the §3 hot mechanism.
- **Captured state in closures.** Capturing `state` in `buildApp(state)` and threading it into every closure forces a restart to change any of it. Routes MUST resolve handlers / dispatchers / adapters through the kernel handle at use time, not at wiring time.
- **`globalThis` / module-level mutable singletons.** A reload that imports the module again gets a fresh module-level binding; the old binding survives in any closure that captured it. Module-level `let` is restart-required by construction.
- **Side effects in `register()` that are not idempotent.** A retry of a failed reload must not double-emit boot events, double-bind sockets, or double-seed control-plane rows.
- **"Compatibility-mode" reloads.** A reload that "skips authz checks because the new version has them in a different place" violates I2 and is rejected by §4.3, full stop.

---

## §8 Out of scope

- **Hot-reload of the Hono framework, the Node runtime, the OS, or the container image.** These are rolling-restart concerns; rolling restart in a multi-replica deployment is the operator's continuity story, not the kernel's.
- **Hot-reload of port surface definitions.** TypeScript is statically typed; a port-surface change requires recompile of every consumer. Ports change rarely; modules change often.
- **Hot-reload of `apps/projection-worker` rebuild loop while a rebuild is in progress.** A rebuild is a transactional unit against an event cursor; reload waits for the cursor to settle.
- **Tenant-driven reload of platform code.** Tenants get hot for *their* data ([§3](#§3-what-is-data-hot-changeable-today)). Platform code is operator-only.
- **State preservation across process death.** Crash recovery is I12's domain (replay from events); always-on assumes a graceful lifecycle.

---

## §9 Worked example: reloading the `catalog` module

The reference flow once Phase 3 ships:

1. Operator runs `atlasctl kernel reload catalog --version 1.4.2 --dry-run`.
2. Kernel resolves `1.4.2` against the module registry, validates the manifest, checks declared actions against the action registry for I17 parity. Returns `{ ok: true, would: { register: [...], dispose: [...] } }`.
3. Operator runs `atlasctl kernel reload catalog --version 1.4.2`.
4. Kernel emits `Audit.ModuleReloadStarted { moduleId: 'catalog', fromVersion: '1.4.1', toVersion: '1.4.2', correlationId, principalId }`.
5. Kernel stops routing new `Catalog.*` actions to the old instance; new requests queue against the new one's pre-`register` buffer (bounded).
6. Kernel calls `register(kernel)` on v1.4.2. Module wires its handlers, projections, dispatchers, cache artifacts against the kernel handle.
7. Kernel atomically swaps the registry pointer; queued requests dispatch against v1.4.2.
8. Kernel awaits `drainTimeout` for v1.4.1's in-flight work, then calls `dispose()`.
9. Kernel emits `Audit.ModuleReloaded { result: 'success', durationMs: 312 }`.

During steps 5–7, requests for actions in modules other than `catalog` are unaffected — they continue on their own versions, oblivious. This is the always-on promise: continuity is the default; restarts are the unusual case.

---

## §10 Conformance

The always-on contract is checked by:

- **SDET adversarial pass** on every slice that touches the kernel boundary or adds a hot-reloadable unit. The bar: an attempt to swap a unit must not split a request across versions ([§4.2](#§42-request-boundary-atomicity)).
- **Architect invariant gate** verifying [§4.3](#§43-invariant-preservation-across-reload) — I1, I2, I3, I12, I17 hold across reload, not just within a version.
- **BDD scenario** under `tests/bdd/features/always-on/` covering: dry-run, successful reload under load, failed `register()` rolling back, exceeded `drainTimeout`, multi-replica refusal until Phase 4 ships.
- **`atlasctl kernel verify`** — operator-runnable invariant scan against the live registry. Flags routes not in the action registry, handlers not registered, dispatchers not in the chain, surfaces missing from the surface registry.

Drift findings here become `type: drift-finding` tickets per [`tickets/CLAUDE.md`](../../tickets/CLAUDE.md).

---

## §11 Kernel Touch Retrospective

`always-on.md` §2 names what is structurally kernel; [I20](../architecture.md#i20-operator-feature-delivery-is-an-intent) names the operator-visible contract that follows from it: *Atlas does not restart to ship a feature.* §11 is the self-improvement loop that closes between the two — every time the kernel is touched, a structured retrospective asks "what category of thing did we just decide was kernel, and how do we make the next change of that category data?"

The retrospective is the mechanism that prevents kernel creep. Without it, every individual restart looks defensible in isolation; with it, each restart is recorded, categorised, and paired with an extraction plan.

### §11.1 When the retrospective fires

A retrospective MUST be filed when **any** of the following lands on `main`:

1. A change to any file path in [`always-on.md` §2](#§2-what-is-restart-required-the-kernel)'s kernel-surface table (ingress pipeline order, event-store append path, projection-rebuild loop, `ports/` definitions, framework binding, listener bootstrap) — **except** type-only changes that touch no behavior and no order.
2. A new HTTP route mounted in `apps/server/src/main.ts` outside the catch-all dispatcher (once [§6 Phase 1](#§6-staged-path) lands, the catch-all *is* the only legal mount; new mounts outside it are explicitly retrospective-triggering).
3. A new field added to the event envelope, the request envelope, or any port surface in `ports/` — these propagate through every adapter and consumer at build time, not at request time.
4. An adapter selection whose decision lives in a `switch`/`if` chain rather than a registry (until [§6 Phase 6](#§6-staged-path) ships, adapter selection is kernel by accident; each addition is a retro trigger).
5. Any change the operator notices as "I need to restart Atlas for this to take effect."

A retrospective is **not** required for:

- Type-only edits, comment/doc edits, dependency upgrades, formatting, test-only edits inside the kernel surface.
- Restart for Node / OS / container / TLS-cert / framework-binding upgrades (per [§8](#§8-out-of-scope)).
- Bug fixes that restore previously-shipped behavior without introducing a new category (these still restart, but the category is already in the table — log the touch in the existing extraction ticket if one is open).

### §11.2 What the retrospective contains

A kernel-touch retrospective is a markdown file at `tickets/kernel-extraction/<slug>.md` with the [template frontmatter](../../tickets/kernel-extraction/_template.md) and five required body fields:

1. **What category of change was this?** Name the category in a sentence the next agent can grep for. Bad: "added a field." Good: "added a new field to the event envelope that every consumer must understand at build time." The category is the thing the extraction plan will make hot.
2. **What forced it into the kernel?** Cite the structural invariant or coupling that made this impossible to express as data today. Reference I1–I18 by id and `always-on.md` §2 by row.
3. **What's the missing seam?** Name the port, registry, manifest field, or instruction-set entry that would have made this category hot. Use the concrete file path even if the file does not exist yet (`ports/src/event-envelope-registry.ts`, `packages/kernel/src/route-registry.ts`, etc.). Vague ("we need a registry somewhere") fails the retrospective.
4. **What's the extraction plan?** Link to a `scoped` follow-up ticket whose `acceptance:` bar reads literally: *"a change of category X lands as data, not as a kernel diff."* The follow-up ticket can be in any set; the retrospective just needs its path. A retrospective without a linked extraction ticket fails the architect gate.
5. **Confidence the category is now closed.** Self-honest assessment: did this retro close the category (the next change of this shape will be hot), narrow it (the next change is still kernel but the *next-next* is hot), or just record it (no extraction plan converges; recording is the whole point this round)? "Narrow" and "record" are both valid — silently claiming "closed" without an extraction plan that actually closes it is not.

### §11.3 Process

- **Author**: the agent (or user) shipping the kernel touch files the retrospective in the same PR as the kernel change. Not "in a follow-up PR."
- **Architect gate**: the architect agent's invariant review verifies (a) the retrospective exists for any §11.1 trigger, (b) the five fields are filled, (c) the extraction-plan ticket exists at the linked path with `status: scoped` or stronger.
- **Vision-keeper audit**: monthly drift audit treats `tickets/kernel-extraction/` as a backlog lane. Categories recurring three times *without* an extraction-plan ticket merging get escalated as drift in the vision-keeper report.
- **Effective gate**: from publication of §11, the retrospective is required for every kernel touch (architect-gated). [I20](../architecture.md#i20-operator-feature-delivery-is-an-intent) becomes a merge-blocking invariant once [§6 Phase 7](#§6-staged-path) ships — until then, an unavoidable kernel touch with a complete retrospective passes; an avoidable one (where the extraction would have been small) does not.

### §11.4 What the loop produces

Over time the retrospective lane should produce a steadily shrinking list of categories the kernel still owns. Each merged extraction ticket removes one category from the list. The list is visible as the set of open `tickets/kernel-extraction/*.md` plus the cross-references from each retro into its extraction ticket — no separate index needed.

The directional claim, audited by `vision-keeper`: *the rate at which new categories enter the kernel should trend toward zero, and the rate at which existing categories leave the kernel should be visible in the merged tickets.* If both rates are zero for an extended window, that is either victory (the kernel is genuinely irreducible at the current scope) or stagnation (no one is doing the extraction work) — `vision-keeper` is responsible for distinguishing the two and flagging the latter.
