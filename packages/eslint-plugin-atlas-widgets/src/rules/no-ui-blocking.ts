/**
 * no-ui-blocking — widgets cannot stall the main thread or bypass the
 * capability bridge. The bans here compose with no-cross-widget-reach
 * and no-direct-dom to leave only these legal surfaces:
 *   - context.request(capability, args) — all IO
 *   - context.channel.* — all cross-widget coordination
 *   - @atlas/core signals + html template — all rendering
 *
 * The rule is intentionally narrow: only APIs that are *always* bad in
 * widget code. Loop-based heuristics are excluded to keep the false-
 * positive rate near zero.
 */

import type { Rule } from 'eslint';
import type { CallExpression, NewExpression, Node as EstreeNode } from 'estree';

// Freestanding functions/constructors that either block the main thread
// or let a widget do IO without declaring a capability.
const FORBIDDEN_IDENTIFIERS_CALL = new Set<string>([
  'alert',
  'confirm',
  'prompt',
  'fetch',
  'eval',
]);

const FORBIDDEN_NEW = new Set<string>([
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'Worker',
  'SharedWorker',
  'ServiceWorker',
  'Function',
]);

// navigator.sendBeacon slips IO past the capability bridge.
function isNavigatorSendBeacon(callee: EstreeNode | null | undefined): boolean {
  if (!callee || callee.type !== 'MemberExpression' || callee.computed) return false;
  const obj = callee.object;
  const prop = callee.property;
  return (
    obj != null &&
    obj.type === 'Identifier' &&
    obj.name === 'navigator' &&
    prop != null &&
    prop.type === 'Identifier' &&
    prop.name === 'sendBeacon'
  );
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Widgets cannot use sync-blocking APIs or do IO outside the capability bridge.',
    },
    schema: [],
    messages: {
      syncPrompt:
        "'{{name}}()' blocks the main thread. Render confirmation UI in the widget body instead.",
      directIo:
        "'{{name}}' performs IO outside the capability bridge. Call context.request('<capability>', args) so the host can authorize and cancel it.",
      eval:
        "'{{name}}' can block the thread and defeats the isolation model.",
      newFn:
        "'new Function' is equivalent to eval and is forbidden in widget code.",
      newIo:
        "'new {{name}}' performs IO outside the capability bridge. Declare a capability and call context.request().",
      beacon:
        "'navigator.sendBeacon' bypasses the capability bridge. Use context.request().",
    },
  },

  create(context: Rule.RuleContext): Rule.RuleListener {
    return {
      CallExpression(node: CallExpression): void {
        const callee = node.callee;
        if (!callee) return;

        if (callee.type === 'Identifier' && FORBIDDEN_IDENTIFIERS_CALL.has(callee.name)) {
          const name = callee.name;
          if (name === 'alert' || name === 'confirm' || name === 'prompt') {
            context.report({
              node: callee as unknown as Rule.Node,
              messageId: 'syncPrompt',
              data: { name },
            });
          } else if (name === 'eval') {
            context.report({
              node: callee as unknown as Rule.Node,
              messageId: 'eval',
              data: { name },
            });
          } else {
            context.report({
              node: callee as unknown as Rule.Node,
              messageId: 'directIo',
              data: { name },
            });
          }
          return;
        }

        if (isNavigatorSendBeacon(callee)) {
          context.report({
            node: callee as unknown as Rule.Node,
            messageId: 'beacon',
          });
          return;
        }
      },

      NewExpression(node: NewExpression): void {
        const callee = node.callee;
        if (!callee || callee.type !== 'Identifier') return;
        if (!FORBIDDEN_NEW.has(callee.name)) return;
        if (callee.name === 'Function') {
          context.report({
            node: callee as unknown as Rule.Node,
            messageId: 'newFn',
          });
        } else {
          context.report({
            node: callee as unknown as Rule.Node,
            messageId: 'newIo',
            data: { name: callee.name },
          });
        }
      },
    };
  },
};

export default rule;
