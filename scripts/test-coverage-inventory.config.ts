/**
 * Classification config for `pnpm test-coverage:inventory`.
 *
 * Rules are evaluated in order; first match wins. Categories other than `gap`
 * are treated as legitimate "no test needed" outcomes. The only category that
 * gates CI is `gap` — anything that isn't matched here ends up there.
 *
 * Plan: ~/.claude/plans/i-would-like-for-sprightly-hartmanis.md
 * Sister report: tickets/testing-floor/colocated-test-inventory.md
 */

export type Category =
  | 'has-test'
  | 'barrel'
  | 'surface-contract'
  | 'port-interface'
  | 'port-helper'
  | 'test-infrastructure'
  | 'scaffolding'
  | 'static-asset'
  | 'wiring'
  | 'types'
  | 'explicit-no-test'
  | 'gap';

export type Requires = 'heuristic-barrel' | 'heuristic-types-only';

export interface Rule {
  glob: string;
  category: Exclude<Category, 'has-test' | 'gap' | 'explicit-no-test'>;
  requires?: Requires;
}

export interface ExplicitNoTestEntry {
  path: string;
  reason: string;
}

export interface InventoryConfig {
  rules: Rule[];
  explicitNoTest: ExplicitNoTestEntry[];
}

/**
 * Path globs use `**` for any-depth, `*` for single-segment. No braces — list
 * patterns separately if you need alternation. Paths are POSIX-style, repo-
 * relative.
 */
export const config: InventoryConfig = {
  rules: [
    // ── Ports ────────────────────────────────────────────────────────────
    { glob: 'ports/src/index.ts', category: 'barrel' },
    { glob: 'ports/src/dispatcher.ts', category: 'port-helper' },
    { glob: 'ports/src/audit-emitter.ts', category: 'port-helper' },
    { glob: 'ports/src/query-registry.ts', category: 'port-helper' },
    { glob: 'ports/src/**/*.ts', category: 'port-interface' },

    // ── Surface contracts ───────────────────────────────────────────────
    { glob: '**/contracts/*.surface.ts', category: 'surface-contract' },
    { glob: '**/contracts/_contract-types.ts', category: 'surface-contract' },
    { glob: '**/contracts/*.widget.ts', category: 'surface-contract' },

    // ── Test-infrastructure packages (these packages EXIST to support
    //     tests elsewhere; their files are not production runtime).
    { glob: 'packages/arch-tests/src/**/*.ts', category: 'test-infrastructure' },
    { glob: 'packages/contract-tests/src/**/*.ts', category: 'test-infrastructure' },
    { glob: 'packages/chaos/src/**/*.ts', category: 'test-infrastructure' },
    { glob: 'packages/test/src/**/*.ts', category: 'test-infrastructure' },
    { glob: 'packages/test-fixtures/src/**/*.ts', category: 'test-infrastructure' },
    { glob: 'packages/test-state/src/**/*.ts', category: 'test-infrastructure' },

    // ── Sandbox specimens + harness exist to demonstrate/exercise other
    //     code; they are themselves fixtures, not production runtime.
    { glob: 'apps/sandbox/src/specimens/**/*.ts', category: 'scaffolding' },
    { glob: 'apps/sandbox/src/harness/**/*.ts', category: 'scaffolding' },
    { glob: 'apps/sandbox/src/registry/types.ts', category: 'types' },
    { glob: 'apps/sandbox/src/specimen-types.ts', category: 'types' },

    // ── Adapter seeds + SQL JSON helpers are fixture data.
    { glob: 'adapters/node/src/seeds/**/*.ts', category: 'scaffolding' },

    // ── Module conventions: entities are entity-store wrappers (pure I/O),
    //     events/intents/errors/ids/types are type-only. Handler/query
    //     registries are wiring (compose maps).
    { glob: 'modules/*/src/entities/contracts.ts', category: 'types' },
    { glob: 'modules/*/src/entities/relations.ts', category: 'wiring' },
    { glob: 'modules/*/src/entities/*.ts', category: 'wiring' },
    { glob: 'modules/*/src/events.ts', category: 'types' },
    { glob: 'modules/*/src/intents.ts', category: 'types' },
    { glob: 'modules/*/src/errors.ts', category: 'types' },
    { glob: 'modules/*/src/ids.ts', category: 'types' },
    { glob: 'modules/*/src/types.ts', category: 'types' },
    { glob: 'modules/*/src/handlers/registry.ts', category: 'wiring' },
    { glob: 'modules/*/src/handlers/index.ts', category: 'wiring' },
    { glob: 'modules/*/src/handlers/log-shape.ts', category: 'types' },
    { glob: 'modules/*/src/queries/registry.ts', category: 'wiring' },
    { glob: 'modules/*/src/query-router.ts', category: 'wiring' },
    { glob: 'modules/*/src/responses.ts', category: 'types' },
    { glob: 'modules/*/src/seed-types.ts', category: 'types' },
    { glob: 'modules/*/src/internal/assert.ts', category: 'wiring' },
    { glob: 'modules/*/src/internal/projection-read.ts', category: 'wiring' },
    { glob: 'modules/*/src/internal/seed-state.ts', category: 'wiring' },
    { glob: 'modules/*/src/crypto/runtime.ts', category: 'wiring' },

    // ── Design tokens, breakpoints, icon registry are static data.
    { glob: 'packages/design/src/icons.ts', category: 'static-asset' },
    { glob: 'packages/design/src/breakpoints.ts', category: 'static-asset' },
    { glob: 'packages/design/src/shared-styles.ts', category: 'static-asset' },
    { glob: 'packages/design/src/util.ts', category: 'wiring' },
    { glob: 'packages/design/src/internal/assert.ts', category: 'wiring' },
    { glob: 'packages/design/src/atlas-code-editor-types.ts', category: 'types' },

    // ── Widget contracts + spec types are type-only.
    { glob: 'packages/widgets/src/charts/contracts/*.ts', category: 'surface-contract' },
    { glob: 'packages/widgets/src/data-table/contracts/*.ts', category: 'surface-contract' },
    { glob: 'packages/widgets/src/data-source/types.ts', category: 'types' },
    { glob: 'packages/widgets/src/internal/assert.ts', category: 'wiring' },
    { glob: 'packages/widgets/src/shared-styles.ts', category: 'static-asset' },

    // ── Widget host + wasm host types/errors are type-only.
    { glob: 'packages/widget-host/src/types.ts', category: 'types' },
    { glob: 'packages/widget-host/src/errors.ts', category: 'types' },
    { glob: 'packages/wasm-host/src/errors.ts', category: 'types' },
    { glob: 'packages/page-templates/src/internal/assert.ts', category: 'wiring' },
    { glob: 'packages/page-templates/src/dnd/types.ts', category: 'types' },
    { glob: 'packages/page-templates/src/errors.ts', category: 'types' },

    // ── Platform-core type/error/log shape files.
    { glob: 'packages/platform-core/src/types.ts', category: 'types' },
    { glob: 'packages/platform-core/src/control-plane-db.ts', category: 'types' },
    { glob: 'packages/platform-core/src/errors.ts', category: 'types' },
    { glob: 'packages/platform-core/src/execution-context.ts', category: 'types' },
    { glob: 'packages/platform-core/src/log-event.ts', category: 'types' },
    { glob: 'packages/platform-core/src/logger.ts', category: 'types' },
    { glob: 'packages/platform-core/src/manifest.ts', category: 'types' },

    // ── Seeder schema id constants are data.
    { glob: 'packages/seeder/src/schema.ts', category: 'static-asset' },
    { glob: 'packages/seeder/src/types.ts', category: 'types' },

    // ── Schemas package: index + generated are barrels/static.
    { glob: 'packages/schemas/src/generated/index.ts', category: 'static-asset' },

    // ── Logging type+constant files.
    { glob: 'packages/logging/src/levels.ts', category: 'static-asset' },
    { glob: 'packages/logging/src/ids.ts', category: 'wiring' },
    { glob: 'packages/logging/src/sinks/sink.ts', category: 'types' },

    // ── Metrics type files.
    { glob: 'packages/metrics/src/types.ts', category: 'types' },
    { glob: 'packages/metrics/src/labels.ts', category: 'types' },

    // ── OpenAPI type files.
    { glob: 'packages/openapi/src/types.ts', category: 'types' },

    // ── DSL substrate type/error files (some have colocated tests already).
    { glob: 'packages/dsl-substrate/src/errors.ts', category: 'types' },
    { glob: 'packages/dsl-substrate/src/intent.ts', category: 'types' },
    { glob: 'packages/dsl-substrate/src/storage.ts', category: 'static-asset' },
    { glob: 'packages/dsl-substrate/src/result.ts', category: 'types' },
    { glob: 'packages/dsl-substrate/src/host-ops.ts', category: 'types' },

    // ── DSL expression: known-ops registry is data.
    { glob: 'packages/dsl-expression/src/known-ops.ts', category: 'static-asset' },
    { glob: 'packages/dsl-expression/src/ast.ts', category: 'types' },

    // ── api-client mock data is fixtures.
    { glob: 'packages/api-client/src/mock/data/**/*.ts', category: 'scaffolding' },

    // ── apps/server bootstrap + main are pure wiring per apps/server/CLAUDE.md.
    { glob: 'apps/server/src/main.ts', category: 'wiring' },
    { glob: 'apps/server/src/bootstrap.ts', category: 'wiring' },
    { glob: 'apps/server/src/bootstrap-platform-admin.ts', category: 'wiring' },

    // ── apps/projection-worker bootstrap + config + main are wiring.
    { glob: 'apps/projection-worker/src/main.ts', category: 'wiring' },
    { glob: 'apps/projection-worker/src/bootstrap.ts', category: 'wiring' },
    { glob: 'apps/projection-worker/src/config.ts', category: 'wiring' },

    // ── Frontend app entry points are wiring (Vite shells).
    { glob: 'apps/admin/src/main.ts', category: 'wiring' },
    { glob: 'apps/authoring/src/main.ts', category: 'wiring' },
    { glob: 'apps/sandbox/src/main.ts', category: 'wiring' },
    { glob: 'apps/sim/src/main.ts', category: 'wiring' },
    { glob: 'apps/sim/src/types.ts', category: 'types' },

    // ── Authoring + admin + sandbox: barrels, module-loader index files.
    { glob: 'apps/admin/src/main.ts', category: 'wiring' },

    // ── Atlasctl: envelope schema is data.
    { glob: 'apps/atlasctl/src/envelope-schema.ts', category: 'static-asset' },

    // ── Bundles directory uses standard /src layout.
    { glob: 'bundles/*/src/index.ts', category: 'barrel', requires: 'heuristic-barrel' },
    { glob: 'bundles/*/src/types.ts', category: 'types' },

    // ── Generic catch-alls (run last so they don't shadow specifics).
    // Any index.ts that is genuinely a pure re-export.
    { glob: '**/index.ts', category: 'barrel', requires: 'heuristic-barrel' },
    // Heuristic types-only fallthrough (files with zero runtime declarations).
    { glob: 'packages/*/src/**/*.ts', category: 'types', requires: 'heuristic-types-only' },
    { glob: 'modules/*/src/**/*.ts', category: 'types', requires: 'heuristic-types-only' },
    { glob: 'apps/*/src/**/*.ts', category: 'types', requires: 'heuristic-types-only' },
    { glob: 'adapters/*/src/**/*.ts', category: 'types', requires: 'heuristic-types-only' },
  ],

  /**
   * Explicit one-off exemptions. Path must be exact (repo-relative POSIX). Every
   * entry MUST carry a reason — adding files here without a reason is a code-
   * review failure. Prefer adding a path-rule above if the pattern recurs.
   */
  explicitNoTest: [
    // Seed corpus for testing isolation (not production runtime).
    { path: 'adapters/seed-memory/src/index.ts', reason: 'barrel re-export of seed-memory adapter' },
    // IDB stubs that throw — server-only ports unreachable in browser sim.
    { path: 'adapters/idb/src/repository-store.ts', reason: 'server-only stubs that throw — no IDB behavior to test' },
    // Pure transformation builder (PascalCase→snake_case) covered transitively in entity-type-registry.
    { path: 'adapters/node/src/action-schema-id.ts', reason: 'pure string transformer covered transitively by entity-type-registry tests' },
    // Cedar adapter entity-store: pure mapping from PolicyEvaluationRequest to Cedar request.
    { path: 'adapters/policy-cedar/src/entity-store.ts', reason: 'pure transformation; mapping exercised through Cedar engine tests' },
  ],
};
