/**
 * @atlas/eslint-plugin-widgets — mechanical enforcement of the widget
 * isolation contract. Apply only to widget source files; the framework
 * (packages/core, packages/widget-host, packages/design) is deliberately
 * excluded because it implements the APIs these rules forbid.
 *
 * The three rules compose into a tight first-party sandbox:
 *   - no-cross-widget-reach — mediator is the only cross-widget channel
 *   - no-direct-dom        — rendering must go through the html template
 *   - no-ui-blocking       — sync-blocking APIs can't stall the main thread
 *
 * None of the rules are bulletproof (JS has no types at lint time), but
 * together they flag every violation an attentive author wouldn't already
 * reject in review. Escape hatches use native ESLint disable comments.
 */

import type { ESLint, Linter, Rule } from 'eslint';
import noCrossWidgetReach from './rules/no-cross-widget-reach.ts';
import noDirectDom from './rules/no-direct-dom.ts';
import noUiBlocking from './rules/no-ui-blocking.ts';

interface AtlasWidgetsPlugin extends ESLint.Plugin {
  meta: { name: string; version: string };
  rules: Record<string, Rule.RuleModule>;
  configs: Record<string, Linter.Config>;
}

const plugin: AtlasWidgetsPlugin = {
  meta: {
    name: '@atlas/eslint-plugin-widgets',
    version: '0.1.0',
  },
  rules: {
    'no-cross-widget-reach': noCrossWidgetReach,
    'no-direct-dom': noDirectDom,
    'no-ui-blocking': noUiBlocking,
  },
  configs: {},
};

plugin.configs = {
  recommended: {
    plugins: { 'atlas-widgets': plugin },
    rules: {
      'atlas-widgets/no-cross-widget-reach': 'error',
      'atlas-widgets/no-direct-dom': 'error',
      'atlas-widgets/no-ui-blocking': 'error',
    },
  },
};

export default plugin;
