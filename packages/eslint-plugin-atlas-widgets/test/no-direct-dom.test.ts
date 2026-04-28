import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';
import rule from '../src/rules/no-direct-dom.ts';

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
});

describe('no-direct-dom', () => {
  it('forbids direct DOM access in widgets', () => {
    tester.run('no-direct-dom', rule, {
      valid: [
        // Reading config/context is fine.
        'const mode = this.config?.mode;',
        'const principal = this.context.principal;',
        // Calling signal.set / signal.value / channel.publish — common,
        // arbitrary method names not on the forbidden list.
        'this._loading.set(true); const v = this._loading.value;',
        'this.context.channel.publish("t", { a: 1 });',
        // Using setAttribute on `this` is allowed — it's the widget's own
        // element — the rule targets method names that only make sense
        // when reaching into external DOM nodes.
        'this.setAttribute("data-x", "1");',
      ],
      invalid: [
        {
          // CallExpression (enter) fires before MemberExpression (enter).
          code: 'const el = document.createElement("div");',
          errors: [{ messageId: 'method' }, { messageId: 'docWindow' }],
        },
        {
          code: 'this.innerHTML = "<b>hi</b>";',
          errors: [{ messageId: 'write' }],
        },
        {
          code: 'host.appendChild(el);',
          errors: [{ messageId: 'method' }],
        },
        {
          code: 'this.addEventListener("click", () => {});',
          errors: [{ messageId: 'event' }],
        },
        {
          code: 'const r = this.shadowRoot;',
          errors: [{ messageId: 'thisDom' }],
        },
        {
          code: 'new MutationObserver(() => {});',
          errors: [{ messageId: 'newObs' }],
        },
        {
          code: 'const w = window.innerWidth;',
          errors: [{ messageId: 'docWindow' }],
        },
        {
          code: 'el.insertAdjacentHTML("beforeend", "<b/>");',
          errors: [{ messageId: 'method' }],
        },
      ],
    });
  });
});
