/**
 * Adapter-level tests for <atlas-multi-select>.
 *
 * These drive the real web component in a linkedom DOM, dispatching the
 * same click / input / keydown events the browser would. Where core
 * tests verify "given action X, state Y", these verify "when the user
 * clicks an option, state actually reflects the click." That's the
 * layer where the previous regression lived: the core was correct, but
 * the adapter was replacing the shadow-DOM innerHTML on every state
 * change, which detached the option between mousedown and click (so
 * clicks never landed) and destroyed the search input mid-typing.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { AtlasMultiSelect } from '../src/atlas-multi-select.ts';
import type { Option, OptionsSource } from '../src/multi-select-core.ts';
// DOM globals (document, HTMLElement, customElements, CSSStyleSheet,
// ElementInternals, FormData, ShadowRoot, adoptedStyleSheets patch) are
// installed by the global vitest setup — see
// `test-setup/linkedom-shims.ts`. That setup also reinstalls
// `globalThis.Event` / `CustomEvent` to linkedom's constructors so plain
// `new Event(type, init)` interops with `dispatchEvent`.
beforeAll(async function () {
    // Import AFTER globals are installed so the element registers against
    // our linkedom customElements registry.
    await import('../src/atlas-multi-select.ts');
});
// ── event detail shapes ────────────────────────────────────────────
interface ChangeDetail {
    value: string[];
    added: string[];
    removed: string[];
    selected: Option[];
}
interface SearchDetail {
    query: string;
}
interface UnselectDetail {
    option: Option | undefined;
}
interface CreateDetail {
    option: Option | undefined;
}
// ── helpers ────────────────────────────────────────────────────────
interface MakeElArgs {
    attrs?: Record<string, string | boolean | null | undefined>;
    options?: Option[];
    value?: string[];
}
function makeEl({ attrs = {}, options = [], value, }: MakeElArgs = {}): AtlasMultiSelect {
    const el = document.createElement('atlas-multi-select');
    for (const [k, v] of Object.entries(attrs)) {
        if (v === true)
            el.setAttribute(k, '');
        else if (v !== false && v != null)
            el.setAttribute(k, String(v));
    }
    el.options = options;
    if (Array.isArray(value))
        el.value = value;
    document.body.appendChild(el);
    return el;
}
function dispatch(node: Element, type: string, init: Record<string, unknown> = {}): Event {
    const ev = new Event(type, {
        bubbles: true,
        cancelable: true,
        ...init,
    });
    node.dispatchEvent(ev);
    return ev;
}
/** Required selector — throws if missing (replaces pervasive `!`). */
function q<E extends Element = HTMLElement>(el: AtlasMultiSelect, sel: string): E {
    const root = el.shadowRoot;
    if (!root)
        throw new Error(`no shadowRoot on host`);
    const found = root.querySelector<E>(sel);
    if (!found)
        throw new Error(`no match for selector: ${sel}`);
    return found;
}
/** Optional selector — null when missing, for the few sites that branch. */
function qOpt<E extends Element = HTMLElement>(el: AtlasMultiSelect, sel: string): E | null {
    return el.shadowRoot?.querySelector<E>(sel) ?? null;
}
function qa<E extends Element = HTMLElement>(el: AtlasMultiSelect, sel: string): E[] {
    const root = el.shadowRoot;
    if (!root)
        return [];
    return Array.from(root.querySelectorAll<E>(sel));
}
/** Narrow undefined out for `array[0]` / `Array.find` results. */
function must<T>(v: T | undefined | null): T {
    if (v == null)
        throw new Error('expected non-null value');
    return v;
}
/**
 * Add a typed listener for a CustomEvent that the component dispatches.
 * The DOM's standard `HTMLElementEventMap` does not declare
 * <atlas-multi-select>'s `change`/`search`/`unselect`/`create` custom
 * events, so the cast is bounded to this helper.
 */
function onCustom<T>(target: EventTarget, type: string, fn: (e: CustomEvent<T>) => void): void {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/no-explicit-any -- linkedom-DOM-shape: CustomEvent listeners aren't in the standard HTMLElementEventMap; the cast is bounded to this helper
    target.addEventListener(type, fn as any);
}
const fruits: Option[] = [
    { value: 'apple', label: 'Apple' },
    { value: 'banana', label: 'Banana' },
    { value: 'cherry', label: 'Cherry' },
];
// ── tests ──────────────────────────────────────────────────────────
describe('shell structure is built once on mount', function () {
    it('shadow DOM contains trigger, listbox, options, error row', function () {
        const el = makeEl({
            attrs: { name: 't', label: 'Tags', searchable: true },
            options: fruits,
        });
        expect(q(el, '.trigger')).toBeTruthy();
        expect(q(el, '.listbox')).toBeTruthy();
        expect(q(el, '.options')).toBeTruthy();
        expect(q(el, '.search')).toBeTruthy();
        expect(q(el, '.error')).toBeTruthy();
    });
    it('options render with data-value / aria-selected / role=option', function () {
        const el = makeEl({ attrs: { name: 't' }, options: fruits });
        el.open();
        const opts = qa<HTMLElement>(el, '.option');
        expect(opts.length).toBe(3);
        expect(opts.map(function (o) {
            return o.dataset['value'];
        })).toEqual([
            'apple',
            'banana',
            'cherry',
        ]);
        for (const o of opts) {
            expect(o.getAttribute('role')).toBe('option');
            expect(o.getAttribute('aria-selected')).toBe('false');
        }
    });
});
describe('clicking an option toggles selection (the regression)', function () {
    it('click on first option selects it and el.value reflects', function () {
        const el = makeEl({ attrs: { name: 't' }, options: fruits });
        el.open();
        const first = must(qa<HTMLElement>(el, '.option').find(function (o) {
            return o.dataset['value'] === 'apple';
        }));
        dispatch(first, 'click');
        expect(el.value).toEqual(['apple']);
    });
    it('second click on same option unselects (toggle)', function () {
        const el = makeEl({ attrs: { name: 't' }, options: fruits });
        el.open();
        const first = function (): HTMLElement {
            return must(qa<HTMLElement>(el, '.option').find(function (o) {
                return o.dataset['value'] === 'apple';
            }));
        };
        dispatch(first(), 'click');
        dispatch(first(), 'click');
        expect(el.value).toEqual([]);
    });
    it('sequential clicks on different options accumulate', function () {
        const el = makeEl({ attrs: { name: 't' }, options: fruits });
        el.open();
        const by = function (v: string): HTMLElement {
            return must(qa<HTMLElement>(el, '.option').find(function (o) {
                return o.dataset['value'] === v;
            }));
        };
        dispatch(by('apple'), 'click');
        dispatch(by('cherry'), 'click');
        dispatch(by('banana'), 'click');
        expect([...el.value].sort()).toEqual(['apple', 'banana', 'cherry']);
    });
    it('selection persists: option DOM after click shows aria-selected=true', function () {
        const el = makeEl({ attrs: { name: 't' }, options: fruits });
        el.open();
        const apple = function (): HTMLElement {
            return must(qa<HTMLElement>(el, '.option').find(function (o) {
                return o.dataset['value'] === 'apple';
            }));
        };
        dispatch(apple(), 'click');
        // Find the (possibly re-rendered) apple li and check aria-selected.
        expect(apple().getAttribute('aria-selected')).toBe('true');
    });
    it('host mirrors selection in data-value attribute', function () {
        const el = makeEl({ attrs: { name: 't' }, options: fruits });
        el.open();
        dispatch(must(qa<HTMLElement>(el, '.option')[0]), 'click');
        expect(el.getAttribute('data-value')).toBe(JSON.stringify(el.value));
    });
    it('regression: mouseover BEFORE click does not detach the option', function () {
        // Real browsers fire mousedown → mouseup → click. If hover triggers
        // a state notification that replaces the option <li>, the element
        // under the mouse becomes a new node and the browser refuses to
        // synthesize `click`. Simulate the sequence and verify the clicked
        // <li> is still the same DOM node across mouseover → click.
        const el = makeEl({ attrs: { name: 't' }, options: fruits });
        el.open();
        const apple = must(qa<HTMLElement>(el, '.option').find(function (o) {
            return o.dataset['value'] === 'apple';
        }));
        dispatch(apple, 'mouseover');
        // If mouseover re-rendered the options list, `apple` is now a stale
        // reference and still in the pre-render DOM — click on it wouldn't
        // fire in a real browser. Assert identity before dispatching click.
        const appleAfterHover = must(qa<HTMLElement>(el, '.option').find(function (o) {
            return o.dataset['value'] === 'apple';
        }));
        expect(apple).toBe(appleAfterHover);
        dispatch(apple, 'click');
        expect(el.value).toEqual(['apple']);
    });
    it('change event fires with delta + selected in detail', function () {
        const el = makeEl({ attrs: { name: 't' }, options: fruits });
        el.open();
        const events: ChangeDetail[] = [];
        onCustom<ChangeDetail>(el, 'change', function (e) {
            return events.push(e.detail);
        });
        dispatch(must(qa<HTMLElement>(el, '.option').find(function (o) {
            return o.dataset['value'] === 'banana';
        })), 'click');
        expect(events.length).toBe(1);
        expect(must(events[0]).added).toEqual(['banana']);
        expect(must(events[0]).removed).toEqual([]);
        expect(must(events[0]).value).toEqual(['banana']);
    });
});
describe('search input: typing filters options and survives re-render', function () {
    it('typing "ch" filters options to Cherry only', function () {
        const el = makeEl({
            attrs: { name: 't', searchable: true },
            options: fruits,
        });
        el.open();
        const search = q<HTMLInputElement>(el, '.search');
        search.value = 'ch';
        dispatch(search, 'input');
        const visible = qa<HTMLElement>(el, '.option').map(function (o) {
            return o.dataset['value'];
        });
        expect(visible).toEqual(['cherry']);
    });
    it('search input element is preserved across typing (not destroyed)', function () {
        const el = makeEl({
            attrs: { name: 't', searchable: true },
            options: fruits,
        });
        el.open();
        const search1 = q<HTMLInputElement>(el, '.search');
        search1.value = 'a';
        dispatch(search1, 'input');
        const search2 = q<HTMLInputElement>(el, '.search');
        // Same node identity — the shell is not rebuilt on state changes.
        expect(search1).toBe(search2);
        expect(search2.value).toBe('a');
    });
    it('multi-char typing accumulates in the input', function () {
        const el = makeEl({
            attrs: { name: 't', searchable: true },
            options: fruits,
        });
        el.open();
        const search = q<HTMLInputElement>(el, '.search');
        for (const ch of ['b', 'a', 'n']) {
            search.value += ch;
            dispatch(search, 'input');
        }
        expect(q<HTMLInputElement>(el, '.search').value).toBe('ban');
        expect(qa<HTMLElement>(el, '.option').map(function (o) {
            return o.dataset['value'];
        })).toEqual(['banana']);
    });
    it('clicking a filtered option still selects it', function () {
        const el = makeEl({
            attrs: { name: 't', searchable: true },
            options: fruits,
        });
        el.open();
        const search = q<HTMLInputElement>(el, '.search');
        search.value = 'ch';
        dispatch(search, 'input');
        dispatch(must(qa<HTMLElement>(el, '.option')[0]), 'click');
        expect(el.value).toEqual(['cherry']);
    });
    it('search event fires with query detail', function () {
        const el = makeEl({
            attrs: { name: 't', searchable: true },
            options: fruits,
        });
        el.open();
        const events: SearchDetail[] = [];
        onCustom<SearchDetail>(el, 'search', function (e) {
            return events.push(e.detail);
        });
        const search = q<HTMLInputElement>(el, '.search');
        search.value = 'b';
        dispatch(search, 'input');
        expect(events).toEqual([{ query: 'b' }]);
    });
});
describe('chips: remove button unselects without closing', function () {
    it('click × on a chip unselects that value', function () {
        const el = makeEl({
            attrs: { name: 't' },
            options: fruits,
            value: ['apple', 'cherry'],
        });
        const rm = q(el, '.chip[data-value="apple"] .chip-remove');
        expect(rm).toBeTruthy();
        dispatch(rm, 'click');
        expect(el.value).toEqual(['cherry']);
    });
    it('removing fires unselect + change events', function () {
        const el = makeEl({
            attrs: { name: 't' },
            options: fruits,
            value: ['apple'],
        });
        const unsel: UnselectDetail[] = [];
        const chg: ChangeDetail[] = [];
        onCustom<UnselectDetail>(el, 'unselect', function (e) {
            return unsel.push(e.detail);
        });
        onCustom<ChangeDetail>(el, 'change', function (e) {
            return chg.push(e.detail);
        });
        dispatch(q(el, '.chip-remove'), 'click');
        expect(unsel.length).toBe(1);
        expect(must(unsel[0]).option?.value).toBe('apple');
        expect(chg.length).toBe(1);
        expect(must(chg[0]).removed).toEqual(['apple']);
    });
});
describe('lifecycle states render in the listbox', function () {
    it('empty options render "No options available"', function () {
        const el = makeEl({ attrs: { name: 't' }, options: [] });
        el.open();
        expect(q(el, '.status-row').textContent).toMatch(/No options available/);
    });
    it('status=loading shows spinner row', async function () {
        const el = makeEl({ attrs: { name: 't' } });
        el.open();
        // Port that never resolves until we say so.
        let release: ((v: readonly Option[]) => void) | undefined;
        const source: OptionsSource = {
            load: function () {
                return new Promise<readonly Option[]>(function (r) {
                    release = r;
                });
            },
        };
        el.optionsSource = source;
        // Wait a microtask so loadOptions has set status=loading.
        await Promise.resolve();
        const row = qOpt<HTMLElement>(el, '.status-row');
        expect(row?.dataset['kind']).toBe('loading');
        release?.(fruits);
    });
    it('status=error shows retry button; retry recovers', async function () {
        let first = true;
        const src: OptionsSource = {
            load: async function () {
                if (first) {
                    first = false;
                    throw new Error('nope');
                }
                return fruits;
            },
        };
        const el = makeEl({ attrs: { name: 't' } });
        el.open();
        el.optionsSource = src;
        await new Promise(function (r) {
            return setTimeout(r, 0);
        });
        expect(qOpt<HTMLElement>(el, '.status-row')?.dataset['kind']).toBe('error');
        const retry = q(el, '[data-action="retry"]');
        expect(retry).toBeTruthy();
        dispatch(retry, 'click');
        await new Promise(function (r) {
            return setTimeout(r, 0);
        });
        expect(el.status).toBe('ready');
        expect(qa(el, '.option').length).toBe(3);
    });
});
describe('allow-create', function () {
    it('create hint appears when query has no match', function () {
        const el = makeEl({
            attrs: { name: 't', searchable: true, 'allow-create': true },
            options: fruits,
        });
        el.open();
        const search = q<HTMLInputElement>(el, '.search');
        search.value = 'Durian';
        dispatch(search, 'input');
        const hint = q(el, '[data-action="create"]');
        expect(hint).toBeTruthy();
        expect(hint.textContent).toMatch(/Create "Durian"/);
    });
    it('clicking the hint creates + selects + fires create event', function () {
        const el = makeEl({
            attrs: { name: 't', searchable: true, 'allow-create': true },
            options: fruits,
        });
        el.open();
        const created: Array<Option | undefined> = [];
        onCustom<CreateDetail>(el, 'create', function (e) {
            return created.push(e.detail.option);
        });
        const search = q<HTMLInputElement>(el, '.search');
        search.value = 'Durian';
        dispatch(search, 'input');
        dispatch(q(el, '[data-action="create"]'), 'click');
        expect(el.value).toEqual(['Durian']);
        expect(created.length).toBe(1);
        expect(must(created[0]).label).toBe('Durian');
    });
});
