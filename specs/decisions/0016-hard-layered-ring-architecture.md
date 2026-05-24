# 0016 — Hard-layered concentric-ring architecture

**Status:** Accepted (2026-05-24)
**Builds on:** [`0008-atlas-on-atlas.md`](0008-atlas-on-atlas.md) (recursive kernel) and [`../crosscut/kernel-vs-data.md`](../crosscut/kernel-vs-data.md) (kernel/data inventory). This ADR **formalizes and makes mechanically provable** what `kernel-vs-data.md` already describes conceptually — the inward shape of dependencies that keeps the kernel small and trusted. It does **not** contradict that document or the hexagonal model; it layers a static-analysis-enforced ring discipline *on top of* the existing ports/adapters/modules/apps structure.

## Context

Atlas is hexagonal: ports define the surface, adapters implement them, modules hold domain logic, apps wire it all together. That structure is real but, until now, only **partially** enforced and only at the edges — `pnpm deps:check` (dep-cruiser), `pnpm overseer:check`, `pnpm lint:semgrep`, the `oxlint` `no-restricted-imports` overrides, and the `arch-tests` package each police a slice of the dependency rules with overlapping, partially-contradictory configs. There is no single statement of "which package belongs to which layer," and no one gate that proves the whole graph points the right way.

[ADR 0008](0008-atlas-on-atlas.md) committed Atlas to a recursive kernel: the platform runs on the same primitives any tenant uses, so the irreducible trusted surface must stay small enough to trust uniformly. [`kernel-vs-data.md`](../crosscut/kernel-vs-data.md) §2 names that surface (ingress, platform-core types, ports, the append path) and §5 names the "could this be data?" rule. Both documents assume — but do not enforce — that dependencies flow **inward**: types depend on nothing, ports depend only on types, adapters depend on ports, apps depend on everything. When that assumption silently breaks, the kernel quietly grows: a type leaks an adapter import, a port reaches into a DSL package, an adapter imports a module's seed code. Each is a small inversion; collectively they erode the property [ADR 0008](0008-atlas-on-atlas.md) rests on.

A dependency audit (2026-05-24) found four such live inversions (enumerated in Consequences) and confirmed that the five overlapping enforcers neither agree on the rule set nor, between them, prove the graph is acyclic and inward-pointing. The decision below states the model precisely, picks one authoritative gate, and ratchets the known inversions to zero.

## Decision

Atlas adopts a **hard-layered concentric-ring architecture**, enforced by static analysis, layered on top of the existing hexagonal structure. Every workspace package is assigned to exactly one ring; dependencies may point only inward; cross-package imports go only through public surfaces. The rings restate the hexagon as a total order, so the kernel/data split becomes a provable graph property rather than a convention.

### 1. The backend stack — dependencies point inward only

Six concentric rings, numbered 0 (innermost, purest) to 5 (outermost, composition). A ring-N package may import only from rings ≤ N.

- **Ring 0 — `abi`.** Pure contracts and types. **Zero workspace dependencies.** A new package `@atlas/abi`, carved from the type-only modules currently living in `platform-core`: `EventEnvelope`, `IntentEnvelope`, `Principal`, `Logger`, `LogEvent`, `ExecutionContext`, the error-taxonomy types, the control-plane row types, the manifest types, plus the DSL artifact shapes. These are the runtime's word size and instruction format ([`kernel-vs-data.md`](../crosscut/kernel-vs-data.md) §2). They depend on nothing because everything depends on them.

- **Ring 1 — `ports`.** `@atlas/ports` — interface declarations only. Depends only on Ring 0. No runtime code, no adapter detail; the kernel's vocabulary for the kinds of substrate the runtime can talk to.

- **Ring 2 — `runtime`.** Runtime helpers and the request machinery: `@atlas/ingress`, `platform-core` (the runtime-helper remainder after the type-only carve-out to `abi`), `logging`, `metrics`, `schemas`, `wasm-host`, and the future `dispatch-chain` package ([ADR 0008](0008-atlas-on-atlas.md) Stage 5). Depends on Rings 0–1 only.

- **Ring 3 — `domain`.** `modules/*` — domain logic. Depends on Rings 0–2. **Never on each other** except through `modules/<x>/src/public/`. **Never on adapters or apps.**

- **Ring 4 — `adapter`.** `adapters/*` — port implementations. Depends on Rings 0–2. **Never on modules, never on apps, never on another adapter.**

- **Ring 5 — `apps`.** `apps/*` — the composition root. May depend on Rings 0–4. This is the only ring permitted to see adapters and modules at once, because wiring them together is its job.

### 2. The frontend stack — parallel concentric F-rings

The browser stack is a second onion, numbered F0–F5, with the same inward-only rule:

- **F0 — `core`** (`@atlas/core`: `AtlasElement`, signals, html template)
- **F1 — `design`** (components built on F0)
- **F2 — `widgets` / `widget-host`**
- **F3 — `page-templates`**
- **F4 — `bundles/*`**
- **F5 — frontend apps** (`admin`, `authoring`, `sandbox`) **+ `api-client`**

The frontend reaches the backend **only over HTTP**, through the single ingress chokepoint (I1). There is no compile-time edge from any F-ring into Rings 0–5 except the one sanctioned exception in §4.

### 3. The tooling tier

Test and tooling packages sit outside both onions: `test`, `test-state`, `test-fixtures`, `contract-tests`, `arch-tests`, `chaos`, `seeder`, `stryker-runner-*`, `openapi`.

- **Test/tooling packages may import anything** — they exercise the whole graph by design.
- **Non-test packages may never import a tooling package.** A production dependency on a tooling package is a layering violation regardless of ring.

### 4. The two rules

- **R1 — inward-only (the onion rule).** A package in ring N may import only from rings ≤ N. This holds within each stack (backend 0–5, frontend F0–F5).

- **R2 — public-surface-only.** Cross-package imports go through the package's `src/index.ts` (or, for a module, through `modules/<x>/src/public/`). No deep imports into a package's internals.

**One explicit cross-stack allowance:** `@atlas/core` (F0) may import `@atlas/logging` (a Ring-2 backend package that is a zero-runtime-dependency leaf). This is the **single sanctioned exception** to stack separation; it exists so the frontend can emit structured logs in the canonical shape without duplicating the logger. Any other backend→frontend or frontend→backend compile-time edge is a violation.

### 5. Enforcement — one manifest, one authoritative gate

A single source of truth, [`architecture/rings.json`](../../architecture/rings.json), holds the package→ring assignments and the time-boxed waiver list. It drives three generated artifacts:

1. **dep-cruiser rules** (graph: cycles + edges) — **the authoritative gate.** dep-cruiser sees the full module graph and is the only tool that can prove acyclicity and inward-only edges across transitive imports.
2. **oxlint `no-restricted-imports` overrides** (editor-speed) — catches **direct import statements only**, for fast in-editor feedback. Not authoritative; it cannot see the transitive graph.
3. **A `package.json` dependency validator** (pre-compile) — rejects a declared dependency that crosses a ring boundary before a build is even attempted.

Known violations are recorded as **time-boxed waivers that can only shrink** — CI ratchets the waiver count downward and fails if it grows. The whole battery runs via `pnpm arch:check`.

## Consequences

**Positive:**

- **The kernel/data split becomes provable, not conventional.** [`kernel-vs-data.md`](../crosscut/kernel-vs-data.md) §2's "small trusted kernel" is now a graph invariant: Rings 0–2 *are* the kernel surface, and R1 mechanically forbids the inward growth that would erode it.
- **One gate, one manifest.** This consolidates five overlapping enforcers down to one manifest-driven gate. dep-cruiser becomes the single authoritative layering check; `overseer` keeps only the ordering/threading judgment checks a static graph cannot express (dispatcher mirror, request-boundary atomicity); `semgrep` keeps its non-layering rules (sentinel strings, forbidden patterns). The oxlint overrides and the package.json validator are now *generated* from `rings.json`, not hand-maintained.
- **A new package's ring is a one-line declaration.** Adding `@atlas/abi` or any future package is a single `rings.json` edit; the three artifacts regenerate from it.

**Negative — the four known inversions this drives out (each a migration step):**

1. **`ports` ↔ `platform-core` cycle.** Ring 1 must not depend on Ring 2. Resolved by carving the type-only modules out of `platform-core` into Ring 0 `@atlas/abi`; `ports` then depends only on `abi`, breaking the cycle.
2. **`ports` → `dsl-substrate`.** Ring 1 reaching a higher ring for DSL artifact shapes. Resolved by relocating those shapes into Ring 0 `@atlas/abi` (the DSL artifact shapes are listed in §1's carve-out).
3. **`adapter-node` → `@atlas/authz`.** A Ring-4 adapter importing a Ring-3 module — the mis-homed `PolicyStore` interface lives in the `authz` module. Resolved by **promoting `PolicyStore` to a port** (Ring 1), where an interface that adapters implement belongs.
4. **`adapter-node` → `identity` / `content-pages` seed imports.** A Ring-4 adapter importing Ring-3 modules for seed data. Resolved by **de-inverting through the composition root** (Ring 5): seeds are wired in `apps/server`, not pulled into the adapter.

**Other negative:**

- **Up-front carve-out cost.** Splitting `platform-core` into `@atlas/abi` (types) + the runtime-helper remainder touches every importer of those types at compile time. Additive in shape (re-exports can bridge during migration) but broad.
- **Waiver discipline is now load-bearing.** A green build with a non-zero waiver count means known debt; the ratchet only prevents growth, it does not pay the debt down on its own.

**Out of scope for this ADR:**

- **The `git mv` carve-out of `@atlas/abi` and the four de-inversions** — each lands as its own slice under the slice workflow; this ADR records the model and the order.
- **Cross-reference edits to [`architecture.md`](../architecture.md) and [`kernel-vs-data.md`](../crosscut/kernel-vs-data.md)** — handled in a later step to avoid edit conflicts.
- **Promoting any ring rule to a numbered invariant (I-series)** — if the ring discipline warrants an invariant ID alongside I1–I20, that is a separate architect decision.

## Migration

This ADR is spec-only. Concretely:

1. **This PR:** ADR 0016.
2. **Next:** land `architecture/rings.json` + the generator for the three artifacts (dep-cruiser rules, oxlint overrides, package.json validator) + the `pnpm arch:check` script, with every current inversion recorded as a time-boxed waiver so the build is green on day one.
3. **Then, one slice each:** carve `@atlas/abi` out of `platform-core` (breaks inversions 1 and 2); promote `PolicyStore` to a port (inversion 3); de-invert the `adapter-node` seed imports through the composition root (inversion 4). Each slice shrinks the waiver list; the ratchet enforces it.
4. **Cleanup:** retire the hand-maintained oxlint/dep-cruiser layering configs once they are fully generated from `rings.json`; narrow `overseer` and `semgrep` to their non-layering responsibilities.

No code changes in this PR.
