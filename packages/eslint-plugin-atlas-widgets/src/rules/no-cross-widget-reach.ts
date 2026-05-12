/**
 * no-cross-widget-reach — widgets communicate only via the mediator
 * (context.channel) and capability bridge (context.request). Anything
 * that lets one widget observe or influence another bypasses those
 * gates and gets flagged here.
 *
 * The rule is name-based; it can't prove a given identifier refers to
 * the real `window` or `document`, so authors who really need one of
 * the flagged APIs can silence a line with `// eslint-disable-next-line
 * atlas-widgets/no-cross-widget-reach -- <reason>` — the reason
 * becomes visible in review.
 */

import { AST_NODE_TYPES, ESLintUtils, type TSESTree } from '@typescript-eslint/utils';

const createRule = ESLintUtils.RuleCreator.withoutDocs;

const FORBIDDEN_GLOBALS = new Set<string>([
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'BroadcastChannel',
  'SharedWorker',
  'MessageChannel',
]);

const FORBIDDEN_WINDOW_PROPS = new Set<string>(['parent', 'top', 'opener']);

const FORBIDDEN_DOCUMENT_QUERIES = new Set<string>([
  'querySelector',
  'querySelectorAll',
  'getElementById',
  'getElementsByTagName',
  'getElementsByClassName',
  'getElementsByName',
]);

function isWidgetImport(source: unknown): boolean {
  if (typeof source !== 'string') return false;
  // Bare specifiers referring to bundle packages or subpaths.
  if (/^@atlas\/bundle-/.test(source)) return true;
  // Relative imports that walk across widget directories.
  if (/\/widgets\/[^/]+\/(widget\.element|index)\.js$/.test(source)) return true;
  // Any path containing ../widgets/<sibling>/... where sibling differs.
  if (/\.\.\/widgets\/[^/]+\//.test(source)) return true;
  return false;
}

export default createRule({
  name: 'no-cross-widget-reach',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Widgets must communicate only via context.channel and context.request — no globals, no sibling imports, no shared storage.',
    },
    schema: [],
    messages: {
      import:
        'Widget source cannot import from another widget or bundle ({{source}}). Use context.channel topics to talk across widgets.',
      globalRef:
        "Widgets cannot use '{{name}}' — it shares state across widgets and tabs. Route through a declared capability instead.",
      windowProp:
        "Widgets cannot reach window.{{name}} — it escapes widget isolation. Use context.channel to coordinate.",
      documentQuery:
        "Widgets cannot call document.{{name}} — it reaches into sibling widgets' DOM. Render through the html template.",
      postMessage:
        'Widgets cannot call postMessage directly — the iframe transport already does this. Use context.channel.publish.',
      documentCookie:
        'Widgets cannot read or write document.cookie — it is a shared side channel. Use a declared capability.',
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      ImportDeclaration(node: TSESTree.ImportDeclaration): void {
        const src = node.source.value;
        if (isWidgetImport(src)) {
          context.report({
            node: node.source,
            messageId: 'import',
            data: { source: String(src) },
          });
        }
      },

      Identifier(node: TSESTree.Identifier): void {
        if (!FORBIDDEN_GLOBALS.has(node.name)) return;
        // Skip the node when it's the NAME in a declaration or member
        // expression, not a reference to the global. We only want to
        // flag actual reads/writes through the identifier.
        const parent = node.parent;
        if (!parent) return;
        if (parent.type === AST_NODE_TYPES.MemberExpression && parent.property === node && !parent.computed) return;
        if (parent.type === AST_NODE_TYPES.Property && parent.key === node && !parent.computed) return;
        if (parent.type === AST_NODE_TYPES.VariableDeclarator && parent.id === node) return;
        if (parent.type === AST_NODE_TYPES.FunctionDeclaration && parent.id === node) return;
        if (parent.type === AST_NODE_TYPES.FunctionExpression && parent.id === node) return;
        if (parent.type === AST_NODE_TYPES.ClassDeclaration && parent.id === node) return;
        if (parent.type === AST_NODE_TYPES.ClassExpression && parent.id === node) return;
        if (parent.type === AST_NODE_TYPES.MethodDefinition && parent.key === node && !parent.computed) return;
        if (parent.type === AST_NODE_TYPES.ImportSpecifier && parent.imported === node) return;
        if (parent.type === AST_NODE_TYPES.ImportDefaultSpecifier && parent.local === node) return;
        if (parent.type === AST_NODE_TYPES.ImportSpecifier && parent.local === node) return;
        if (parent.type === AST_NODE_TYPES.LabeledStatement && parent.label === node) return;
        context.report({
          node,
          messageId: 'globalRef',
          data: { name: node.name },
        });
      },

      // window.parent / window.top / window.opener / self.parent / globalThis.top
      MemberExpression(node: TSESTree.MemberExpression): void {
        const obj = node.object;
        const prop = node.property;
        const propName: string | false =
          !node.computed && prop.type === AST_NODE_TYPES.Identifier ? prop.name : false;

        const objName: string | null =
          obj.type === AST_NODE_TYPES.Identifier
            ? obj.name
            : obj.type === AST_NODE_TYPES.ThisExpression
              ? 'this'
              : null;

        if (
          (objName === 'window' || objName === 'self' || objName === 'globalThis') &&
          typeof propName === 'string' &&
          FORBIDDEN_WINDOW_PROPS.has(propName)
        ) {
          context.report({
            node,
            messageId: 'windowProp',
            data: { name: propName },
          });
          return;
        }

        if (objName === 'document' && propName === 'cookie') {
          context.report({
            node,
            messageId: 'documentCookie',
          });
          return;
        }
      },

      CallExpression(node: TSESTree.CallExpression): void {
        const callee = node.callee;

        // Direct call to postMessage(...) — identifier form.
        if (callee.type === AST_NODE_TYPES.Identifier && callee.name === 'postMessage') {
          context.report({
            node: callee,
            messageId: 'postMessage',
          });
          return;
        }

        if (callee.type === AST_NODE_TYPES.MemberExpression && !callee.computed) {
          const propName =
            callee.property.type === AST_NODE_TYPES.Identifier ? callee.property.name : null;
          const obj = callee.object;
          const objName: string | null =
            obj.type === AST_NODE_TYPES.Identifier ? obj.name : null;

          // anything.postMessage(...) — but only flag when the receiver is
          // plausibly a window handle. Common cases: parent.postMessage,
          // window.parent.postMessage, iframe.contentWindow.postMessage.
          if (propName === 'postMessage') {
            context.report({
              node: callee,
              messageId: 'postMessage',
            });
            return;
          }

          if (objName === 'document' && propName !== null && FORBIDDEN_DOCUMENT_QUERIES.has(propName)) {
            context.report({
              node: callee,
              messageId: 'documentQuery',
              data: { name: propName },
            });
            return;
          }
        }
      },

      // NOTE: `new BroadcastChannel(...)` is caught by the Identifier
      // handler above — no separate NewExpression handler needed.
    };
  },
});
