/**
 * Flat ESLint config for the Atlas TypeScript workspace.
 *
 * Three layers of rules, in this order:
 *
 * 1. Type-safety baseline. Prevents agents from reaching for `any`,
 *    `Function`/`Object`/`{}` type annotations, `@ts-ignore`, `eval`,
 *    object-literal type assertions, and the `X as unknown as Y`
 *    double-cast escape hatch. Every rule is `error` — no warnings.
 *
 * 2. Widget isolation (`@atlas/eslint-plugin-widgets`) for files under
 *    `bundles/<name>/src/widgets/`. The framework (`packages/core`,
 *    `packages/widget-host`, `packages/design`) implements the APIs
 *    those rules ban and is exempt by scope.
 *
 * 3. Hexagonal-architecture import boundaries. Domain code
 *    (`modules/*`) and the ingress pipeline (`packages/ingress`) must
 *    depend only on `@atlas/ports` + `@atlas/platform-core` + siblings
 *    — never on a concrete adapter. Adapters confine third-party
 *    drivers (`postgres.js`, `nodemailer`). Ports may not import
 *    adapters or domain modules.
 *
 * `pnpm lint` runs eslint against this config.
 */

import atlasWidgets from '@atlas/eslint-plugin-widgets';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    // Stale `// eslint-disable-*` comments (for rules that aren't
    // configured anymore) become errors, not warnings — matching the
    // "every type-safety problem is an error" bar.
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.vite/**',
      '**/test-results/**',
      'packages/schemas/src/generated/**',
      // Stale agent worktrees (created by Claude Code's worktree isolation)
      // — gitignored but ESLint walks the filesystem regardless. They hold
      // pre-refactor copies of the codebase under different paths
      // (`packages/adapters-node/...`) that fail current rules.
      '.claude/**',
      // Generated BDD spec files (Playwright-BDD generator output).
      '.features-gen/**',
      // Out-of-tsconfig files that the type-aware rules can't see. The
      // type-safety baseline still applies via the non-type-aware rules;
      // type-aware unsafe-* checks are skipped for these by ignoring
      // them here. Consider adding to a tsconfig include if these grow
      // a typed surface worth checking.
      'tests/integration/**',
      'scripts/**',
      'test-setup/**',
      '**/vitest.config.ts',
      '**/playwright.bdd.config.ts',
      '**/playwright.bdd.server.config.ts',
      'adapters/policy-cedar/bin/**',
      'packages/openapi/scripts/**',
      // Per-app `test/` folders are intentionally outside the app's
      // tsconfig `include` (the per-app tsconfigs cover `src/` only;
      // vitest discovers them via the root vitest config). Type-aware
      // lint can't see them here. They're still lint-checked via the
      // non-type-aware rules through the root tsconfig.
      'apps/server/test/**',
      'apps/projection-worker/test/**',
      'apps/atlasctl/test/**',
    ],
  },

  // ── (1) Type-safety baseline ────────────────────────────────────────
  //
  // Applied to ALL .ts/.tsx files. Test files get the strictness too;
  // legitimate test-fixture casts (adversarial validators, etc.) must
  // carry a categorised `// eslint-disable-next-line <rule> --
  // <category>: <reason>` justification.
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: {
      '@typescript-eslint': tsPlugin,
      'atlas-widgets': atlasWidgets,
    },
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Stop `: any` annotations re-entering.
      '@typescript-eslint/no-explicit-any': [
        'error',
        { ignoreRestArgs: false, fixToUnknown: false },
      ],

      // `<Foo>x` is banned; only `x as Foo` is allowed. Object-literal
      // assertions (`{ foo: 1 } as Foo`) are banned outright — they
      // hide missing required fields. Use `satisfies Foo` instead.
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        { assertionStyle: 'as', objectLiteralTypeAssertions: 'never' },
      ],

      // @ts-* directives must carry a description; `ts-ignore` and
      // `ts-nocheck` are hard-banned.
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-expect-error': 'allow-with-description',
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-check': false,
          minimumDescriptionLength: 10,
        },
      ],

      // Forbid `Function`, `Object`, `{}` as type annotations.
      '@typescript-eslint/no-restricted-types': [
        'error',
        {
          types: {
            Function: {
              message:
                'Use a typed signature like `(arg: T) => R` instead of `Function`.',
            },
            Object: {
              message:
                'Use `Record<string, unknown>` or a concrete shape instead of `Object`.',
            },
            '{}': {
              message:
                'Use `Record<string, unknown>`, `object`, or a concrete shape instead of `{}`.',
            },
          },
        },
      ],

      // No eval, no implied-eval.
      'no-eval': 'error',
      '@typescript-eslint/no-implied-eval': 'error',

      // Custom rule: ban `X as unknown as Y` double-casts. Bypass with
      // `// eslint-disable-next-line atlas-widgets/no-double-cast --
      // boundary: <reason>` at known boundary sites (linkedom DOM shim,
      // cedar-wasm CJS module, postgres.js parameter widening,
      // adversarial test fixture).
      'atlas-widgets/no-double-cast': 'error',

      // Type-aware unsafe assertions and operations on `any`. All error.
      '@typescript-eslint/no-unsafe-type-assertion': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',

      // Non-null assertions in source code must be replaced with an
      // explicit narrow (`if (!x) throw …`) or a guarded access
      // (`x?.foo`). The few legitimate set-then-get / post-length-check
      // sites can suppress per-line with a justification comment OR use
      // a typed `must<T>(v, msg)` / `assertDefined<T>(v, msg)` helper.
      '@typescript-eslint/no-non-null-assertion': 'error',

      // `console.*` is banned platform-wide. The structured logger
      // (`ctx.logger.*` server-side, telemetry pipeline in
      // `packages/core/src/telemetry-pipeline.ts` for the frontend) is
      // the only sanctioned emit path — both per
      // specs/crosscut/logging.md and specs/frontend/observability.md.
      //
      // Legitimate exemption sites (telemetry sink contract, CLI stdout
      // output, dev mailer's product-behavior stdout JSON, harness
      // fixture diagnostic output) must carry a per-line
      // `// eslint-disable-next-line no-console -- <category>: <reason>`
      // comment. Categories so far in the codebase: `contract-exempt`,
      // `cli-stdout`, `dev-only`, `harness-diagnostic`. Add new ones
      // sparingly.
      //
      // Mirrored by `.semgrep/atlas-invariants.yml` ▸
      // `atlas-logging-no-console` for defense in depth (catches dynamic
      // `console['log']` shapes the AST rule misses on server paths).
      'no-console': 'error',

      // Arrow functions are banned platform-wide EXCEPT when:
      //   1. The body references lexical `this` — converting would
      //      silently rebind `this`, breaking event handlers, lifecycle
      //      wiring, and timer callbacks in our custom-element code.
      //   2. The arrow IS a class-field initialiser (`foo = () => …`)
      //      — class-field arrows auto-bind to the instance; converting
      //      to `function () {…}` would change binding semantics even
      //      when the body doesn't use `this` today.
      //
      // For everything else, use a named function declaration or a
      // function expression. TS function-type annotations
      // (`(x: number) => number`) are unaffected — this bans only the
      // runtime `ArrowFunctionExpression` AST node.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'ArrowFunctionExpression:not(:has(ThisExpression)):not(PropertyDefinition > ArrowFunctionExpression.value)',
          message:
            'Arrow functions are banned (except when they reference lexical `this` or are class-field initialisers). Use a named function declaration (`function foo() {}`) or a function expression (`function () {}`). TS function-type annotations like `(x: number) => number` are fine — only the runtime arrow form is banned.',
        },
      ],
    },
  },

  // ── (2) Widget isolation rules ─────────────────────────────────────
  {
    files: ['bundles/*/src/widgets/**/*.ts'],
    plugins: { 'atlas-widgets': atlasWidgets },
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      'atlas-widgets/no-cross-widget-reach': 'error',
      'atlas-widgets/no-direct-dom': 'error',
      'atlas-widgets/no-ui-blocking': 'error',
    },
  },

  // ── (3) Hexagonal-architecture import boundaries ───────────────────
  {
    files: ['modules/*/**/*.ts', 'packages/ingress/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@atlas/adapter-*'],
              message:
                'Domain modules and ingress must not import concrete adapters. Use ports from @atlas/ports instead. Apps wire adapters.',
            },
            {
              group: ['../*-*/**', '../../*-*/**', '../../../*-*/**'],
              message:
                'Cross-package relative imports are forbidden. Import via the @atlas/<pkg> alias.',
            },
          ],
        },
      ],
    },
  },
  {
    // postgres.js (the one allowed third-party runtime dep) must stay
    // confined to @atlas/adapter-node so swapping the storage backend
    // is a single-package change. Apps wire the adapter via the
    // `createNodeAdapters` factory in @atlas/adapter-node — they do
    // not import `postgres` directly. Tests + dev scripts may use it
    // freely. Anything else (modules, ports, packages, other adapters)
    // is a port-boundary leak.
    files: ['**/*.ts'],
    ignores: [
      'adapters/node/**',
      'apps/server/src/bootstrap.ts',
      'apps/projection-worker/**',
      'scripts/**',
      'tests/**',
      // Cedar bundle-loader still queries control_plane.policies directly
      // — the right architecture is for it to load bundles via a port
      // implemented in adapter-node. Allowlisted with a TODO until that
      // refactor lands.
      'adapters/policy-cedar/src/bundle-loader.ts',
    ],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['postgres'],
              message:
                'postgres.js is confined to @atlas/adapter-node. Use ports + the createNodeAdapters factory instead.',
            },
          ],
        },
      ],
    },
  },
  {
    // nodemailer is the SMTP transport for SmtpMailer; confined to
    // @atlas/adapter-node so swapping the mailer driver is a
    // single-package change. Modules and apps reach for it through
    // the Mailer port (constructed via createMailer in bootstrap).
    files: ['**/*.ts'],
    ignores: ['adapters/node/**', 'tests/**', 'scripts/**'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['nodemailer'],
              message:
                'nodemailer is confined to @atlas/adapter-node. Apps must reach SMTP through the Mailer port (constructed via createMailer in bootstrap).',
            },
          ],
        },
      ],
    },
  },
  // (Scoped no-console block removed — the rule is now repo-wide in
  // the type-safety baseline above. Sites that legitimately need
  // `console.*` carry per-line eslint-disable comments with a
  // categorised justification — see the `no-console` doc-comment in
  // the baseline block for the categories taxonomy.)
  {
    // Ports define the seam between domain modules and adapters; they MUST
    // depend only on `@atlas/platform-core` and themselves. Importing a
    // concrete adapter or a domain module from a port would create a cycle.
    files: ['ports/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@atlas/adapter-*',
                '@atlas/catalog',
                '@atlas/authz',
                '@atlas/content-pages',
              ],
              message:
                'Ports must not depend on concrete adapters or domain modules — that inverts the dependency arrow.',
            },
          ],
        },
      ],
    },
  },
];
