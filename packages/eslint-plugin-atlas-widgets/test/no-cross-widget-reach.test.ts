import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';
import rule from '../src/rules/no-cross-widget-reach.ts';

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
});

describe('no-cross-widget-reach', () => {
  it('enforces widget isolation', () => {
    tester.run('no-cross-widget-reach', rule, {
      valid: [
        "import { AtlasSurface, html, signal } from '@atlas/core';",
        "import '@atlas/design';",
        "const x = this.context.channel.publish('topic', { a: 1 });",
        "const y = this.context.request('backend.query', { path: '/x' });",
        // Mentioning the identifier as a class method name is allowed.
        'class Foo { indexedDB() {} }',
      ],
      invalid: [
        {
          code: "import { other } from '@atlas/bundle-standard/widgets/messaging';",
          errors: [{ messageId: 'import' }],
        },
        {
          code: "import x from '../../widgets/messaging/index.js';",
          errors: [{ messageId: 'import' }],
        },
        {
          code: 'const data = localStorage.getItem("foo");',
          errors: [{ messageId: 'globalRef' }],
        },
        {
          code: 'const c = new BroadcastChannel("atlas");',
          errors: [{ messageId: 'globalRef' }],
        },
        {
          code: 'const p = window.parent;',
          errors: [{ messageId: 'windowProp' }],
        },
        {
          // ESLint fires parent (CallExpression) enter handlers before
          // children (MemberExpression), so postMessage reports first.
          code: 'self.top.postMessage({}, "*");',
          errors: [{ messageId: 'postMessage' }, { messageId: 'windowProp' }],
        },
        {
          code: 'document.cookie = "session=abc";',
          errors: [{ messageId: 'documentCookie' }],
        },
        {
          code: 'const el = document.querySelector(".sibling");',
          errors: [{ messageId: 'documentQuery' }],
        },
        {
          code: 'parent.postMessage({ kind: "leak" }, "*");',
          errors: [{ messageId: 'postMessage' }],
        },
      ],
    });
  });
});
