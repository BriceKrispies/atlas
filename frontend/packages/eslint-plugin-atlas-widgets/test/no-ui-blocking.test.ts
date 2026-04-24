import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';
import rule from '../src/rules/no-ui-blocking.ts';

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
});

describe('no-ui-blocking', () => {
  it('forbids main-thread blocking and uncapabilitied IO', () => {
    tester.run('no-ui-blocking', rule, {
      valid: [
        "const r = await this.context.request('backend.query', { path: '/x' });",
        'const parsed = JSON.parse(\'{"a":1}\');',
        // Named method called `fetch` on an object is fine — the rule only
        // catches bare `fetch(...)` as an identifier call.
        'this.context.request("backend.fetch", { id: 1 });',
      ],
      invalid: [
        {
          code: 'alert("hi");',
          errors: [{ messageId: 'syncPrompt' }],
        },
        {
          code: 'const ok = confirm("sure?");',
          errors: [{ messageId: 'syncPrompt' }],
        },
        {
          code: 'fetch("/api");',
          errors: [{ messageId: 'directIo' }],
        },
        {
          code: 'eval("1+1");',
          errors: [{ messageId: 'eval' }],
        },
        {
          code: 'const f = new Function("return 1");',
          errors: [{ messageId: 'newFn' }],
        },
        {
          code: 'const x = new XMLHttpRequest();',
          errors: [{ messageId: 'newIo' }],
        },
        {
          code: 'const w = new WebSocket("wss://x");',
          errors: [{ messageId: 'newIo' }],
        },
        {
          code: 'navigator.sendBeacon("/x", payload);',
          errors: [{ messageId: 'beacon' }],
        },
      ],
    });
  });
});
