/**
 * Flat ESLint config for the Atlas frontend.
 *
 * The only project-specific rules right now are the widget isolation
 * rules from @atlas/eslint-plugin-widgets. They apply ONLY to widget
 * source files — the framework (packages/core, packages/widget-host,
 * packages/design) implements the APIs those rules ban and is exempt
 * by scope.
 *
 * `pnpm lint` runs eslint against this config.
 */

import atlasWidgets from '@atlas/eslint-plugin-widgets';

export default [
  {
    // Never lint build output, node_modules, or test harness fixtures.
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.vite/**',
      '**/test-results/**',
    ],
  },
  {
    files: ['bundles/*/src/widgets/**/*.js'],
    plugins: { 'atlas-widgets': atlasWidgets },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      'atlas-widgets/no-cross-widget-reach': 'error',
      'atlas-widgets/no-direct-dom': 'error',
      'atlas-widgets/no-ui-blocking': 'error',
    },
  },
];
