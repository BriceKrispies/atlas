/**
 * Architectural boundary checks for the Atlas monorepo.
 *
 * Complements eslint.config.ts (per-file rules) by enforcing graph-level
 * structure: no module-to-module synchronous coupling, no cycles, no
 * adapter imports inside modules, no implementation imports inside ports.
 *
 * Cross-domain reads must go through events/projections (Invariant I12).
 * The escape hatch for unavoidable sync access is `modules/<x>/src/public/` —
 * everything else under `modules/<x>/src/` is forbidden to other modules.
 *
 * Run: `pnpm deps:check` (validate) / `pnpm deps:graph` (visualize).
 */
module.exports = {
  forbidden: [
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
    {
      name: 'modules-no-adapters',
      severity: 'error',
      comment:
        'Modules depend on ports, never on adapters. Mirrors the ESLint ' +
        'no-restricted-imports rule; defensive belt-and-suspenders.',
      from: {
        path: '^modules/',
        // role-packs.ts is a documented exception (see modules/CLAUDE.md):
        // identity builds Cedar role-pack bundles via a type-only import
        // from @atlas/adapter-policy-cedar. The right shape is a port,
        // and that refactor is tracked separately.
        pathNot: '^modules/identity/src/policies/role-packs\\.ts$',
      },
      to: { path: '^adapters/' },
    },
    {
      name: 'ports-no-impls',
      severity: 'error',
      comment:
        'Ports define interfaces only. Importing from modules, adapters, ' +
        'or apps would create a cycle.',
      from: { path: '^ports/' },
      to: { path: '^(modules|adapters|apps)/' },
    },
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
