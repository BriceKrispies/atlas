/**
 * Architectural boundary checks for the Atlas monorepo.
 *
 * Complements .oxlintrc.json (per-file rules) by enforcing graph-level
 * structure: no module-to-module synchronous coupling, no cycles, no
 * adapter imports inside modules, no implementation imports inside ports.
 *
 * Cross-domain reads must go through events/projections (Invariant I12).
 * The escape hatch for unavoidable sync access is `modules/<x>/src/public/` —
 * everything else under `modules/<x>/src/` is forbidden to other modules.
 *
 * Run: `pnpm deps:check` (validate) / `pnpm deps:graph` (visualize).
 */
// Ring rules generated from architecture/rings.json by scripts/gen-arch-rules.ts
// (`pnpm arch:emit`). The package.json matrix gate (`pnpm arch:check`) is the
// authoritative per-edge check; these give dep-cruiser graph-level coverage of
// the same model. ADR 0016.
let generatedRingRules = [];
try {
  generatedRingRules = require('./architecture/generated/dep-cruiser-rules.cjs');
} catch {
  // arch:emit has not run yet; ring enforcement still holds via `pnpm arch:check`.
}

module.exports = {
  forbidden: [
    ...generatedRingRules,
    {
      name: 'no-cross-module-internals',
      severity: 'error',
      comment:
        'Cross-module reads must use events/projections (I12). If sync ' +
        'access is unavoidable, expose it via modules/<x>/src/public/ and ' +
        'import from there. See CLAUDE.md "Module boundaries".',
      from: { path: '^modules/([^/]+)/src/' },
      to: {
        path: '^modules/([^/]+)/src/',
        pathNot: [
          '^modules/$1/src/',
          '^modules/[^/]+/src/public/',
        ],
      },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies break tree-shaking and signal a layering bug.',
      from: {},
      to: { circular: true },
    },
    // NOTE: `modules-no-adapters` and `ports-no-impls` were removed here —
    // the generated ring rules (`ring-domain-no-outward`, `ring-ports-no-outward`,
    // spread in above from architecture/generated/dep-cruiser-rules.cjs) subsume
    // them exactly, with no stale exceptions. The single source of truth for
    // layer edges is architecture/rings.json (ADR 0016). Cross-module-internals,
    // cycles, and orphans remain hand-rules because they are NOT ring-edge checks.
    {
      name: 'no-orphans',
      severity: 'warn',
      comment:
        'Orphaned source files (no imports, not imported anywhere) are ' +
        'usually dead code. Config files and type declarations are exempt.',
      from: {
        orphan: true,
        pathNot: [
          '\\.d\\.ts$',
          '\\.config\\.(c|m)?(j|t)s$',
          '(^|/)index\\.ts$',
          '(^|/)tests?/',
          '(^|/)scripts/',
          // *.surface.ts files are loaded by AtlasSurface registration,
          // not by direct import — dep-cruiser can't see that edge.
          '\\.surface\\.ts$',
          // .mjs worker bootstraps loaded via new Worker(new URL(...))
          '\\.mjs$',
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: {
      path: [
        'node_modules',
        '\\.test\\.ts$',
        '\\.spec\\.ts$',
        '(^|/)test/',
        '(^|/)tests/',
        'dist/',
      ],
    },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
      mainFields: ['module', 'main', 'types'],
    },
    reporterOptions: {
      archi: {
        collapsePattern: '^(adapters|modules|packages|apps|ports)/[^/]+',
      },
      dot: {
        theme: { graph: { rankdir: 'LR' } },
      },
    },
  },
};
