/**
 * F3 — KernelHandle surface test (deferred placeholder).
 *
 * Probes `specs/crosscut/always-on.md` §4.1 + architect finding F3.
 *
 * Claim: a hot-loaded module's `register(kernel: KernelHandle)` receives a
 * handle that exposes ONLY port interfaces from `@atlas/ports` and primitives
 * from `@atlas/platform-core`. Adapter concrete types are NOT reachable
 * through the handle, and a hot-loaded bundle MUST be refused if it imports
 * any `@atlas/adapter-*` package directly.
 *
 * BOTH F3 tests were structurally unsound in prior revisions:
 *   - Asserting `KernelHandle` exists as a runtime value via `import()` —
 *     wrong surface (TypeScript interfaces are erased; not enumerable
 *     at runtime).
 *   - Substring-matching `.d.ts` for adapter package names — brittle,
 *     dodged by aliased re-exports, depends on `dist/` being built.
 *
 * The correct mechanisms live outside vitest entirely:
 *   1. **Type contract**: `packages/kernel/test/types.test-d.ts` using
 *      `expectTypeOf<keyof KernelHandle>().toMatchTypeOf<keyof PortSurface>()`.
 *      Run via `pnpm typecheck` against the root tsconfig.
 *   2. **Import-graph contract**: a `pnpm deps:check` rule (dep-cruiser)
 *      that forbids any path under `packages/kernel` or any hot-loadable
 *      module bundle from importing `@atlas/adapter-*`.
 *
 * Both need surfaces that don't exist yet (no `@atlas/kernel` package;
 * no kernel-import rule in dep-cruiser). The todos below pin those
 * deliverables so the gap stays visible on every test run.
 *
 * Tickets (placeholder pins until tickets/atlas-on-atlas/ set lands):
 *   - tickets/atlas-on-atlas/kernel-package-and-types.md
 *   - tickets/atlas-on-atlas/deps-check-kernel-rule.md
 *
 * CI wiring requirement: both mechanisms MUST run in CI (`pnpm typecheck`
 * for the type contract; `pnpm deps:check` for the import-graph contract).
 * A type-d file or a dep-cruiser rule that nobody runs is the same as
 * no test.
 */

import { describe, test } from '@atlas/test';

describe('F3 — KernelHandle surface (always-on §4.1 / I1 corollary)', function () {
  test(
    'packages/kernel/test/types.test-d.ts asserts keyof KernelHandle ⊆ port-derived names ' +
      '(expectTypeOf, run via pnpm typecheck). ' +
      'Pin: tickets/atlas-on-atlas/kernel-package-and-types.md',
    function () {
      throw new Error('TODO: implement this test');
    },
  );

  test(
    'pnpm deps:check refuses imports of @atlas/adapter-* from packages/kernel and from ' +
      'hot-loadable module bundles (dep-cruiser rule, NOT a vitest probe). ' +
      'Pin: tickets/atlas-on-atlas/deps-check-kernel-rule.md',
    function () {
      throw new Error('TODO: implement this test');
    },
  );
});
