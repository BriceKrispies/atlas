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

import type { Rule } from 'eslint';
import type {
  CallExpression,
  Identifier,
  ImportDeclaration,
  MemberExpression,
  Node as EstreeNode,
} from 'estree';

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

type NodeWithParent = EstreeNode & { parent?: EstreeNode };

const rule: Rule.RuleModule = {
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

  create(context: Rule.RuleContext): Rule.RuleListener {
    return {
      ImportDeclaration(node: ImportDeclaration): void {
        const src = node.source && node.source.value;
        if (isWidgetImport(src)) {
          context.report({
            node: node.source as unknown as Rule.Node,
            messageId: 'import',
            data: { source: String(src) },
          });
        }
      },

      Identifier(node: Identifier): void {
        if (!FORBIDDEN_GLOBALS.has(node.name)) return;
        // Skip the node when it's the NAME in a declaration or member
        // expression, not a reference to the global. We only want to
        // flag actual reads/writes through the identifier.
        const parent = (node as NodeWithParent).parent;
        if (!parent) return;
        if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return;
        if (parent.type === 'Property' && parent.key === node && !parent.computed) return;
        if (parent.type === 'VariableDeclarator' && parent.id === node) return;
        if (parent.type === 'FunctionDeclaration' && parent.id === node) return;
        if (parent.type === 'FunctionExpression' && parent.id === node) return;
        if (parent.type === 'ClassDeclaration' && parent.id === node) return;
        if (parent.type === 'ClassExpression' && parent.id === node) return;
        if (parent.type === 'MethodDefinition' && parent.key === node && !parent.computed) return;
        if (parent.type === 'ImportSpecifier' && parent.imported === node) return;
        if (parent.type === 'ImportDefaultSpecifier' && parent.local === node) return;
        if (parent.type === 'ImportSpecifier' && parent.local === node) return;
        if (parent.type === 'LabeledStatement' && parent.label === node) return;
        context.report({
          node: node as unknown as Rule.Node,
          messageId: 'globalRef',
          data: { name: node.name },
        });
      },

      // window.parent / window.top / window.opener / self.parent / globalThis.top
      MemberExpression(node: MemberExpression): void {
        const obj = node.object;
        const prop = node.property;
        const propName: string | false =
          !node.computed && prop && prop.type === 'Identifier' ? prop.name : false;

        const objName: string | null =
          obj && obj.type === 'Identifier'
            ? obj.name
            : obj && obj.type === 'ThisExpression'
              ? 'this'
              : null;

        if (
          (objName === 'window' || objName === 'self' || objName === 'globalThis') &&
          typeof propName === 'string' &&
          FORBIDDEN_WINDOW_PROPS.has(propName)
        ) {
          context.report({
            node: node as unknown as Rule.Node,
            messageId: 'windowProp',
            data: { name: propName },
          });
          return;
        }

        if (objName === 'document' && propName === 'cookie') {
          context.report({
            node: node as unknown as Rule.Node,
            messageId: 'documentCookie',
          });
          return;
        }
      },

      CallExpression(node: CallExpression): void {
        const callee = node.callee;
        if (!callee) return;

        // Direct call to postMessage(...) — identifier form.
        if (callee.type === 'Identifier' && callee.name === 'postMessage') {
          context.report({
            node: callee as unknown as Rule.Node,
            messageId: 'postMessage',
          });
          return;
        }

        if (callee.type === 'MemberExpression' && !callee.computed) {
          const propName =
            callee.property && callee.property.type === 'Identifier'
              ? callee.property.name
              : null;
          const obj = callee.object;
          const objName: string | null =
            obj && obj.type === 'Identifier' ? obj.name : null;

          // anything.postMessage(...) — but only flag when the receiver is
          // plausibly a window handle. Common cases: parent.postMessage,
          // window.parent.postMessage, iframe.contentWindow.postMessage.
          if (propName === 'postMessage') {
            context.report({
              node: callee as unknown as Rule.Node,
              messageId: 'postMessage',
            });
            return;
          }

          if (objName === 'document' && propName && FORBIDDEN_DOCUMENT_QUERIES.has(propName)) {
            context.report({
              node: callee as unknown as Rule.Node,
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
};

export default rule;
