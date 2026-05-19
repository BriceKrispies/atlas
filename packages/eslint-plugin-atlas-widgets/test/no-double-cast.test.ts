import { afterAll, describe, it } from '@atlas/test';
import { RuleTester } from '@typescript-eslint/rule-tester';
import tsParser from '@typescript-eslint/parser';
import rule from '../src/rules/no-double-cast.ts';

// `@typescript-eslint/rule-tester` resolves its test framework hooks via
// the static `TestFramework` properties — defaulting to globalThis. Vitest
// keeps `describe` / `it` / `afterAll` off the global scope (`globals: true`
// is not set in the root config), so wire vitest's versions in explicitly.
RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;
RuleTester.itSkip = it.skip;

const tester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2023,
    sourceType: 'module',
  },
});

tester.run('no-double-cast', rule, {
  valid: [
    // Single cast — allowed (other rules govern whether the target is safe).
    'const x = JSON.parse(s) as MyType;',
    // `as unknown` alone — allowed; it's the narrowing direction.
    'const u = value as unknown;',
    // `satisfies` — the correct replacement for object-literal double-casts.
    'const fake = { get: async () => null, set: async () => {} } satisfies Cache;',
    // No assertion at all.
    'const n = 1 + 2;',
  ],
  invalid: [
    {
      code: 'const c = thing as unknown as Cache;',
      errors: [{ messageId: 'doubleCast' }],
    },
    {
      code: 'const tags = arr as unknown as string[] | null;',
      errors: [{ messageId: 'doubleCast' }],
    },
    {
      code: 'const g = (globalThis as unknown as Record<string, unknown>);',
      errors: [{ messageId: 'doubleCast' }],
    },
    {
      // Parenthesised inner — the AST collapses parens so the rule
      // still sees TSAsExpression > TSAsExpression.
      code: 'const e = (value as unknown) as Element;',
      errors: [{ messageId: 'doubleCast' }],
    },
    {
      // Object-literal escape hatch — exactly the test-double pattern.
      code:
        'const fake = ({ get: async () => null }) as unknown as Cache;',
      errors: [{ messageId: 'doubleCast' }],
    },
  ],
});
