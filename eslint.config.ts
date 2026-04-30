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
              group: ['@atlas/adapters-*'],
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
    // Ports define the seam between domain modules and adapters; they MUST
    // depend only on `@atlas/platform-core` and themselves. Importing a
    // concrete adapter or a domain module from a port would create a cycle.
    files: ['packages/ports/**/*.ts'],
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
                '@atlas/adapters-*',
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
