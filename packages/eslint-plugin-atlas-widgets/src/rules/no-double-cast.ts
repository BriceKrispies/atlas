/**
 * no-double-cast — bans the `X as unknown as Y` escape-hatch double-cast.
 *
 * The double-cast is TypeScript's "I give up, just trust me" pattern. Most
 * legitimate uses are at one of a small number of well-known boundaries
 * (linkedom DOM shim, cedar-wasm CJS module, postgres.js parameter
 * widening, adversarial test fixtures). Every other site is either an
 * untyped JSON parse that should run through a schema validator, a partial
 * test double that should use `satisfies T` + `Partial<T>`, or a typing
 * bug worth fixing properly.
 *
 * Escape hatch: add an `eslint-disable-next-line @atlas/no-double-cast`
 * comment with a short description naming the boundary category. Example:
 *
 *   // eslint-disable-next-line @atlas/no-double-cast -- boundary: linkedom DOM shim
 *   const win = dom.window as unknown as Window;
 *
 * Categories the convention recognises: `boundary:`, `library:`, `wasm:`,
 * `schema-validator:`, `test-fixture-malformed:`. The rule doesn't parse
 * the category — that's a reviewer's job — but using the prefix keeps the
 * codebase greppable.
 *
 * Detection is AST-only (no type-checker): the rule fires on
 * `TSAsExpression` whose inner expression is itself a `TSAsExpression`
 * with `TSUnknownKeyword` as the type. That is exactly the
 * `X as unknown as Y` shape, regardless of grouping parens.
 */

import { ESLintUtils, AST_NODE_TYPES } from '@typescript-eslint/utils';

const createRule = ESLintUtils.RuleCreator.withoutDocs;

export default createRule({
  name: 'no-double-cast',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow `X as unknown as Y` double-casts. These bypass the type system; narrow at the boundary with a validator or use `satisfies` instead.',
    },
    messages: {
      doubleCast:
        '`as unknown as <Type>` is a type-system escape hatch. Narrow the value through a validator/parser, use `satisfies T`, or add a typed factory. If this is a legitimate boundary (linkedom DOM shim, third-party library impedance, WASM, adversarial test fixture), suppress with `// eslint-disable-next-line @atlas/no-double-cast -- boundary: <reason>`.',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    return {
      TSAsExpression(node): void {
        // Outer `as <Type>`. Check whether the inner expression is itself
        // `as unknown`.
        const inner = node.expression;
        if (inner.type !== AST_NODE_TYPES.TSAsExpression) return;
        if (inner.typeAnnotation.type !== AST_NODE_TYPES.TSUnknownKeyword) return;
        context.report({
          node,
          messageId: 'doubleCast',
        });
      },
    };
  },
});
