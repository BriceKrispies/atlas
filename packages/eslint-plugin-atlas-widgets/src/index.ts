/**
 * @atlas/eslint-plugin-widgets — mechanical enforcement of the widget
 * isolation contract. Apply only to widget source files; the framework
 * (packages/core, packages/widget-host, packages/design) is deliberately
 * excluded because it implements the APIs these rules forbid.
 *
 * The four rules compose into a tight first-party sandbox:
 *   - no-cross-widget-reach — mediator is the only cross-widget channel
 *   - no-direct-dom        — rendering must go through the html template
 *   - no-ui-blocking       — sync-blocking APIs can't stall the main thread
 *   - no-double-cast       — bans `X as unknown as Y` escape hatches
 *
 * None of the rules are bulletproof (JS has no types at lint time), but
 * together they flag every violation an attentive author wouldn't already
 * reject in review. Escape hatches use native ESLint disable comments.
 */

import type { TSESLint } from '@typescript-eslint/utils';
import noCrossWidgetReach from './rules/no-cross-widget-reach.ts';
import noDirectDom from './rules/no-direct-dom.ts';
import noDoubleCast from './rules/no-double-cast.ts';
import noUiBlocking from './rules/no-ui-blocking.ts';

// The rules are authored with @typescript-eslint/utils' `RuleCreator`, so
// they carry the `TSESLint.RuleModule` shape natively. `satisfies` checks
// that every entry conforms without widening the record — no casts.
const rules = {
  'no-cross-widget-reach': noCrossWidgetReach,
  'no-direct-dom': noDirectDom,
  'no-double-cast': noDoubleCast,
  'no-ui-blocking': noUiBlocking,
} satisfies Record<string, TSESLint.RuleModule<string, readonly unknown[]>>;

// `configs` is declared empty then populated after `plugin` exists so we
// can self-reference `plugin` inside the recommended config without an
// init-order cycle. Typed `TSESLint.FlatConfig.Config` so consumers get
// proper completions.
const configs: Record<string, TSESLint.FlatConfig.Config> = {};

const plugin: TSESLint.FlatConfig.Plugin = {
  meta: { name: '@atlas/eslint-plugin-widgets', version: '0.1.0' },
  rules,
  configs,
};

configs['recommended'] = {
  plugins: { 'atlas-widgets': plugin },
  rules: {
    'atlas-widgets/no-cross-widget-reach': 'error',
    'atlas-widgets/no-direct-dom': 'error',
    'atlas-widgets/no-double-cast': 'error',
    'atlas-widgets/no-ui-blocking': 'error',
  },
};

export default plugin;
