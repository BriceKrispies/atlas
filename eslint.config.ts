/**
 * Flat ESLint config for the Atlas TypeScript workspace.
 *
 * Two rule sets live here:
 *
 * 1. Widget isolation rules (@atlas/eslint-plugin-widgets) for files under
 *    bundles/<name>/src/widgets/. The framework (packages/core,
 *    packages/widget-host, packages/design) implements the APIs those
 *    rules ban and is exempt by scope.
 *
 * 2. Port-boundary rule (Chunk 1 of the TS rewrite). Domain code
 *    (`modules/*`) and the ingress pipeline (`packages/ingress`)
 *    must depend only on `@atlas/ports` + `@atlas/platform-core` + their
 *    siblings — NEVER on a concrete adapter. Apps wire concrete adapters,
 *    so they are exempt.
 *
 * `pnpm lint` runs eslint against this config.
 */

import atlasWidgets from '@atlas/eslint-plugin-widgets';
import tsParser from '@typescript-eslint/parser';

export default [
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
    ],
  },
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
  {
    files: [
      'modules/*/**/*.ts',
      'packages/ingress/**/*.ts',
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
    ignores: [
      'adapters/node/**',
      'tests/**',
      'scripts/**',
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
              group: ['nodemailer'],
              message:
                'nodemailer is confined to @atlas/adapter-node. Apps must reach SMTP through the Mailer port (constructed via createMailer in bootstrap).',
            },
          ],
        },
      ],
    },
  },
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
