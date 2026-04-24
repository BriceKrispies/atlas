/**
 * no-direct-dom — widgets must render through the `html` tagged template
 * from @atlas/core. Touching DOM APIs directly bypasses the signal-driven
 * render path, makes behavior untestable via the surface contract, and
 * is the usual route for smuggling cross-widget side effects.
 *
 * The rule is receiver-agnostic for method names because in JS we can't
 * prove what a given identifier holds. We trade some false positives for
 * mechanical enforcement; ESLint disable comments provide the escape hatch.
 */

import type { Rule } from 'eslint';
import type {
  AssignmentExpression,
  CallExpression,
  MemberExpression,
  NewExpression,
} from 'estree';

// Property writes that clobber DOM content.
const FORBIDDEN_WRITE_PROPS = new Set<string>([
  'innerHTML',
  'outerHTML',
  'textContent',
  'innerText',
]);

// Method names that are DOM-only. If a widget has a local object with a
// `createElement` method, that's on them to disable the rule inline.
const FORBIDDEN_METHODS = new Set<string>([
  'createElement',
  'createTextNode',
  'createDocumentFragment',
  'appendChild',
  'removeChild',
  'replaceChild',
  'insertBefore',
  'insertAdjacentHTML',
  'insertAdjacentElement',
  'attachShadow',
  'cloneNode',
  'contains',
  'getRootNode',
]);

// Event listener management — widgets declare handlers in the html template
// via `@event=${fn}` bindings instead.
const EVENT_METHODS = new Set<string>(['addEventListener', 'removeEventListener']);

// Properties on `this` that expose the DOM surface.
const FORBIDDEN_THIS_PROPS = new Set<string>([
  'shadowRoot',
  'parentNode',
  'parentElement',
  'ownerDocument',
  'nextSibling',
  'previousSibling',
  'firstChild',
  'lastChild',
  'childNodes',
  'children',
]);

// Observers — widgets should derive state from signals, not DOM mutations.
const FORBIDDEN_CTORS = new Set<string>([
  'MutationObserver',
  'ResizeObserver',
  'IntersectionObserver',
]);

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Widgets must render through the html template from @atlas/core — no DOM APIs, no innerHTML, no direct event listeners.',
    },
    schema: [],
    messages: {
      write:
        "Widgets cannot write to '{{prop}}' — render through the html\\`...\\` template instead.",
      method:
        "Widgets cannot call '.{{name}}()' — DOM manipulation belongs in the framework, not widget code.",
      event:
        "Widgets cannot call '.{{name}}()' — use `@event=${'$'}{handler}` bindings in the html template.",
      thisDom:
        "Widgets cannot access 'this.{{prop}}' — it exposes the DOM surface. Derive state from signals.",
      docWindow:
        "Widgets cannot access '{{obj}}.{{prop}}' — the DOM is owned by the framework.",
      newObs:
        "Widgets cannot instantiate '{{name}}' — observe state via signals, not DOM mutations.",
    },
  },

  create(context: Rule.RuleContext): Rule.RuleListener {
    return {
      // Assignment to `x.innerHTML = ...` or similar.
      AssignmentExpression(node: AssignmentExpression): void {
        const left = node.left;
        if (
          left &&
          left.type === 'MemberExpression' &&
          !left.computed &&
          left.property &&
          left.property.type === 'Identifier' &&
          FORBIDDEN_WRITE_PROPS.has(left.property.name)
        ) {
          context.report({
            node: left as unknown as Rule.Node,
            messageId: 'write',
            data: { prop: left.property.name },
          });
        }
      },

      MemberExpression(node: MemberExpression): void {
        const obj = node.object;
        const prop = node.property;
        if (node.computed || !prop) return;
        if (prop.type !== 'Identifier') return;
        const propName = prop.name;

        // this.shadowRoot / this.parentNode / ...
        if (obj && obj.type === 'ThisExpression' && FORBIDDEN_THIS_PROPS.has(propName)) {
          context.report({
            node: node as unknown as Rule.Node,
            messageId: 'thisDom',
            data: { prop: propName },
          });
          return;
        }

        // document.<anything> / window.<anything> — banned except for the
        // handful of window props the other rules catch specifically.
        // We flag all reads of document.* and window.* to force widgets
        // off those roots entirely.
        if (obj && obj.type === 'Identifier' && (obj.name === 'document' || obj.name === 'window')) {
          context.report({
            node: node as unknown as Rule.Node,
            messageId: 'docWindow',
            data: { obj: obj.name, prop: propName },
          });
          return;
        }
      },

      CallExpression(node: CallExpression): void {
        const callee = node.callee;
        if (!callee || callee.type !== 'MemberExpression' || callee.computed) return;
        const prop = callee.property;
        if (!prop || prop.type !== 'Identifier') return;
        const name = prop.name;

        if (EVENT_METHODS.has(name)) {
          context.report({
            node: callee as unknown as Rule.Node,
            messageId: 'event',
            data: { name },
          });
          return;
        }

        if (FORBIDDEN_METHODS.has(name)) {
          context.report({
            node: callee as unknown as Rule.Node,
            messageId: 'method',
            data: { name },
          });
          return;
        }
      },

      NewExpression(node: NewExpression): void {
        const callee = node.callee;
        if (!callee || callee.type !== 'Identifier') return;
        if (FORBIDDEN_CTORS.has(callee.name)) {
          context.report({
            node: callee as unknown as Rule.Node,
            messageId: 'newObs',
            data: { name: callee.name },
          });
        }
      },
    };
  },
};

export default rule;
