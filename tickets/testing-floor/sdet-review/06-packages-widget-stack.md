---
title: SDET review — packages/wasm-host + packages/widget-host + packages/widgets
status: open
type: drift-finding
owner: sdet
created: 2026-05-22
updated: 2026-05-22
---

# SDET review — packages/wasm-host + packages/widget-host + packages/widgets

## Summary

- Total files reviewed: 15
- Files clean: 13
- Files with findings: 2 (one is a contract-suite issue surfacing through 2 adapter test files)
- Critical: 0
- Moderate: 2
- Style: 0

Headline calls: the wasm-host stack is genuinely exercising the sandbox boundary — `browser-host.test.ts` and `node-host.test.ts` both run the contract suite against real hand-rolled WASM (`noopRenderWasm`, `withImportsWasm`, `noMemoryExportWasm`) so the "rejects host imports" and "rejects missing memory export" cases really go through `WebAssembly.instantiate()`. Not `sandbox-bypassed`. `node-host.test.ts` Chunk-12 tests further verify hard preemption with a real infinite-loop module, a memory-cap module, and event-loop responsiveness — these are the canonical sandbox assertions. The widget-host `CapabilityBridge` suite is solid on INV-WIDGET-03: it actively asserts denial codes (`WIDGET_CAPABILITY_DENIED`) for undeclared/no-handler/unknown-instance paths plus a grant-matrix scenario where a manifest restricted to `backend.query` is denied `backend.command`/`navigation.go`. No `capability-not-enforced` findings. The widget compute tests (sort/filter/selection/patch/data-table-core) verify **row order and ids**, not just `.length` — no `result-not-verified` findings. Two issues found: a misleading test on `filter-core.test.ts` (function-key column accessor) that actually verifies the *opposite* of its title, and a weak `timeoutMs` contract assertion that is re-used by both host adapter tests.

## Files reviewed

### packages/wasm-host (3)

1. `packages/wasm-host/test/browser-host.test.ts`
2. `packages/wasm-host/test/node-host.test.ts`
3. `packages/wasm-host/test/render-tree-validate.test.ts`

### packages/widget-host (3)

4. `packages/widget-host/test/capabilities.test.ts`
5. `packages/widget-host/test/manifest.test.ts`
6. `packages/widget-host/test/transport-postmessage.test.ts`

### packages/widgets (9)

7. `packages/widgets/test/data-normalize.test.ts`
8. `packages/widgets/test/data-source-array.test.ts`
9. `packages/widgets/test/data-source-query.test.ts`
10. `packages/widgets/test/data-table-core.test.ts`
11. `packages/widgets/test/filter-core.test.ts`
12. `packages/widgets/test/patch.test.ts`
13. `packages/widgets/test/scales.test.ts`
14. `packages/widgets/test/selection-core.test.ts`
15. `packages/widgets/test/sort-core.test.ts`

## Findings by file

### packages/widgets/test/filter-core.test.ts

- **L80–89 [MODERATE] mirror-implementation / passes-with-empty-impl** — Test titled `function column accessor is honoured` constructs a column with a function `key` (`function (r) { return r.title.toUpperCase(); }`) and a `text` filter, then filters with `{ upperTitle: 'WORLD' }`. The assertion is `expect(out.length).toBe(3)` — i.e., **no rows filtered**. The inline comment admits: *"Function keys aren't looked up by columnKey — ignored. Sanity: no filter applies."* So the test verifies the **opposite** of its title — function-key column accessors are NOT honored; they are silently ignored. A regression where someone *implemented* function-key lookup (legitimately routing the filter and returning 2 rows: "Hello world" and "Weekly HELLO" since both uppercase contain "WORLD") would FAIL this test, even though that's the behaviour the title implies the suite wants. The test currently locks in the absence of the feature. Either rename to `function column accessor is ignored` and document why, or implement the feature and assert the filtered ids. Today this is a load-bearing assertion that the feature does not exist, dressed up as if it does.

### packages/contract-tests/src/wasm-host.ts (re-used by both `browser-host.test.ts` and `node-host.test.ts`)

- **L268–299 [MODERATE] weak-assertion + dead-setup** — `honors the timeout when the plugin runs longer than allowed` constructs a `slowLoader` (200 ms latent loader) then immediately discards it with `void slowLoader;` (dead-setup — `slowLoader` cannot affect the host, which uses the factory's loader). The actual assertion is `host.invoke({ ..., timeoutMs: 0 }).rejects.toBeDefined()` — a 0 ms timeout against an already-warmed noop plugin. `.rejects.toBeDefined()` is the weakest possible rejection assertion: any thrown value (including a `TypeError` from an unrelated bug, or a `RangeError` rejecting `timeoutMs: 0` as invalid input) satisfies it. The inline comment even acknowledges the gap: *"if the host ignored timeouts the test still passes, but a 0ms timeout MUST reject"* — i.e., the regression guard is reduced to "host rejects on `timeoutMs: 0`," not "host honors the configured timeout." Tighten: either build a deterministically-slow plugin (the file's preamble says this is hard, fair), OR assert `kind: 'Timeout'` (mirrors the `node-host.test.ts` Chunk-12 worker test at L66-68), OR exercise a non-zero timeout against a known-slow path. Because both adapter tests inherit this, a host that accepts `timeoutMs` but never enforces it would pass the parity suite. The Chunk-12 tests in `node-host.test.ts` DO assert this properly for the worker host — but `browser-host.test.ts` has no equivalent, so the browser-mode adapter has effectively zero real timeout coverage today.

## Notes on what's NOT a finding (so the next reviewer doesn't double-flag)

- `node-host.test.ts` L43-131 — Chunk-12 tests use **real** WASM (`infiniteLoopWasm`, `memoryGrowWasm` from `./loop-fixtures.ts`) and assert `WasmHostError` with specific `kind` values + elapsed-time bounds. Not `sandbox-bypassed`; these are textbook isolation tests.
- `browser-host.test.ts` is intentionally a 6-line delegate to `wasmHostContract` — that's correct port-parity usage, NOT `coverage-shape`. The contract suite is real. (The timeout finding above does apply, though.)
- `render-tree-validate.test.ts` is in red-phase per its preamble — every V1-V17 case includes a positive baseline + a negative case tagged with the precise `invariant: 'V*'` marker. The validator-doesn't-exist-yet preamble is honest test-first, not `skipped/todo`.
- `capabilities.test.ts` `register() throws TypeError when handler is not a function` (L150-163) uses `as unknown as () => unknown` casts — adversarial input on purpose. Not a finding; the comment names why.
- `transport-postmessage.test.ts` source-filter test (L139-153) is the trust boundary assertion the spec needs — verifies foreign `event.source` is rejected. Strong.
- `manifest.test.ts` rejects-extra-properties (L124-130) covers `additionalProperties: false`. Solid.
- All compute tests (sort/filter/data-table-core/selection/patch/scales/data-normalize) verify computed output (sorted row ids, filtered id sets, exact band offsets, exact tick values). No `result-not-verified` cases.

## Suggested fixes

1. **`filter-core.test.ts:80-89`** — Decision needed: do function-key column accessors get implemented or stay ignored? If ignored, rename test and add an inline `// regression guard: function keys are intentionally ignored — use accessor objects instead`. If implemented, change `expect(out.length).toBe(3)` to assert the two matching ids. As-is, the test is a tripwire against the very feature its title advertises.

2. **`contract-tests/src/wasm-host.ts:268-299`** — Delete the dead `slowLoader` block; replace the `.rejects.toBeDefined()` with `.rejects.toMatchObject({ kind: 'Timeout' })` so a host that throws an unrelated rejection on `timeoutMs: 0` fails the contract. Optionally, add a fixture WASM that busy-loops in `render` (or use `infiniteLoopWasm` if it can be exposed cross-package) so a non-zero `timeoutMs` is also exercised — that would close the gap for `BrowserWasmHost` which has no worker-thread escape hatch and no preemption suite today.
