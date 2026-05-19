import { afterAll, describe, it } from '@atlas/test';
import { RuleTester } from '@typescript-eslint/rule-tester';
import rule from '../src/rules/no-direct-dom.ts';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;
RuleTester.itSkip = it.skip;

const tester = new RuleTester({
    languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
});
// `@typescript-eslint/rule-tester` calls `describe`/`it` internally via the
// hooks wired above; do NOT wrap the `tester.run` call in our own describe/it
// or vitest rejects with "Calling the suite function inside test function".
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
