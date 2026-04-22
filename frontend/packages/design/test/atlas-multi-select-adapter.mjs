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
 *
 * Invoked via `pnpm --filter @atlas/design test:adapter`.
 */

import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

// ── DOM bootstrap ──────────────────────────────────────────────────

const dom = parseHTML('<!doctype html><html><head></head><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.document;
globalThis.HTMLElement = dom.HTMLElement;
globalThis.DocumentFragment = dom.DocumentFragment;
globalThis.customElements = dom.customElements;
globalThis.Node = dom.Node;
globalThis.Event = dom.Event ?? dom.window.Event;
globalThis.CustomEvent = dom.CustomEvent ?? dom.window.CustomEvent;
// linkedom doesn't expose ShadowRoot on the window; AtlasElement.surface
// uses `instanceof ShadowRoot` so provide a never-matches stub.
globalThis.ShadowRoot = dom.window.ShadowRoot ?? class ShadowRoot {};
if (!globalThis.structuredClone) {
  globalThis.structuredClone = (v) => JSON.parse(JSON.stringify(v));
}

// Import AFTER globals are installed so the element registers against
// our linkedom customElements registry.
await import('../src/atlas-multi-select.js');

// ── helpers ────────────────────────────────────────────────────────

let passed = 0, failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(err?.stack ?? err);
  }
}
function section(name, fn) {
  console.log(`\n${name}`);
  return fn();
}

function makeEl({ attrs = {}, options = [], value } = {}) {
  const el = document.createElement('atlas-multi-select');
  for (const [k, v] of Object.entries(attrs)) {
    if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, String(v));
  }
  el.options = options;
  if (Array.isArray(value)) el.value = value;
  document.body.appendChild(el);
  return el;
}

function dispatch(node, type, init = {}) {
  // linkedom's dispatchEvent is picky — use its own Event constructor
  // (the global Event from Node's globalThis doesn't interop cleanly).
  const WinEvent = dom.window.Event;
  const ev = new WinEvent(type, { bubbles: true, cancelable: true, ...init });
  node.dispatchEvent(ev);
  return ev;
}

function q(el, sel) { return el.shadowRoot.querySelector(sel); }
function qa(el, sel) { return Array.from(el.shadowRoot.querySelectorAll(sel)); }

const fruits = [
  { value: 'apple', label: 'Apple' },
  { value: 'banana', label: 'Banana' },
  { value: 'cherry', label: 'Cherry' },
];

// ── tests ──────────────────────────────────────────────────────────

await section('shell structure is built once on mount', async () => {
  await test('shadow DOM contains trigger, listbox, options, error row', () => {
    const el = makeEl({ attrs: { name: 't', label: 'Tags', searchable: true }, options: fruits });
    assert.ok(q(el, '.trigger'), 'trigger exists');
    assert.ok(q(el, '.listbox'), 'listbox exists');
    assert.ok(q(el, '.options'), 'options list exists');
    assert.ok(q(el, '.search'), 'search input exists when searchable');
    assert.ok(q(el, '.error'), 'error row exists (hidden)');
  });

  await test('options render with data-value / aria-selected / role=option', () => {
    const el = makeEl({ attrs: { name: 't' }, options: fruits });
    el.open();
    const opts = qa(el, '.option');
    assert.equal(opts.length, 3);
    assert.deepEqual(opts.map((o) => o.dataset.value), ['apple', 'banana', 'cherry']);
    for (const o of opts) {
      assert.equal(o.getAttribute('role'), 'option');
      assert.equal(o.getAttribute('aria-selected'), 'false');
    }
  });
});

await section('clicking an option toggles selection (the regression)', async () => {
  await test('click on first option selects it and el.value reflects', () => {
    const el = makeEl({ attrs: { name: 't' }, options: fruits });
    el.open();
    const first = qa(el, '.option').find((o) => o.dataset.value === 'apple');
    dispatch(first, 'click');
    assert.deepEqual(el.value, ['apple']);
  });

  await test('second click on same option unselects (toggle)', () => {
    const el = makeEl({ attrs: { name: 't' }, options: fruits });
    el.open();
    const first = () => qa(el, '.option').find((o) => o.dataset.value === 'apple');
    dispatch(first(), 'click');
    dispatch(first(), 'click');
    assert.deepEqual(el.value, []);
  });

  await test('sequential clicks on different options accumulate', () => {
    const el = makeEl({ attrs: { name: 't' }, options: fruits });
    el.open();
    const by = (v) => qa(el, '.option').find((o) => o.dataset.value === v);
    dispatch(by('apple'), 'click');
    dispatch(by('cherry'), 'click');
    dispatch(by('banana'), 'click');
    assert.deepEqual(el.value.sort(), ['apple', 'banana', 'cherry']);
  });

  await test('selection persists: option DOM after click shows aria-selected=true', () => {
    const el = makeEl({ attrs: { name: 't' }, options: fruits });
    el.open();
    const apple = () => qa(el, '.option').find((o) => o.dataset.value === 'apple');
    dispatch(apple(), 'click');
    // Find the (possibly re-rendered) apple li and check aria-selected.
    assert.equal(apple().getAttribute('aria-selected'), 'true');
  });

  await test('host mirrors selection in data-value attribute', () => {
    const el = makeEl({ attrs: { name: 't' }, options: fruits });
    el.open();
    dispatch(qa(el, '.option')[0], 'click');
    assert.equal(el.getAttribute('data-value'), JSON.stringify(el.value));
  });

  await test('regression: mouseover BEFORE click does not detach the option', () => {
    // Real browsers fire mousedown → mouseup → click. If hover triggers
    // a state notification that replaces the option <li>, the element
    // under the mouse becomes a new node and the browser refuses to
    // synthesize `click`. Simulate the sequence and verify the clicked
    // <li> is still the same DOM node across mouseover → click.
    const el = makeEl({ attrs: { name: 't' }, options: fruits });
    el.open();
    const apple = qa(el, '.option').find((o) => o.dataset.value === 'apple');
    dispatch(apple, 'mouseover');
    // If mouseover re-rendered the options list, `apple` is now a stale
    // reference and still in the pre-render DOM — click on it wouldn't
    // fire in a real browser. Assert identity before dispatching click.
    const appleAfterHover = qa(el, '.option').find((o) => o.dataset.value === 'apple');
    assert.strictEqual(apple, appleAfterHover,
      'option <li> must not be replaced by a hover state change');
    dispatch(apple, 'click');
    assert.deepEqual(el.value, ['apple']);
  });

  await test('change event fires with delta + selected in detail', () => {
    const el = makeEl({ attrs: { name: 't' }, options: fruits });
    el.open();
    const events = [];
    el.addEventListener('change', (e) => events.push(e.detail));
    dispatch(qa(el, '.option').find((o) => o.dataset.value === 'banana'), 'click');
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].added, ['banana']);
    assert.deepEqual(events[0].removed, []);
    assert.deepEqual(events[0].value, ['banana']);
  });
});

await section('search input: typing filters options and survives re-render', async () => {
  await test('typing "ch" filters options to Cherry only', () => {
    const el = makeEl({ attrs: { name: 't', searchable: true }, options: fruits });
    el.open();
    const search = q(el, '.search');
    search.value = 'ch';
    dispatch(search, 'input');
    const visible = qa(el, '.option').map((o) => o.dataset.value);
    assert.deepEqual(visible, ['cherry']);
  });

  await test('search input element is preserved across typing (not destroyed)', () => {
    const el = makeEl({ attrs: { name: 't', searchable: true }, options: fruits });
    el.open();
    const search1 = q(el, '.search');
    search1.value = 'a';
    dispatch(search1, 'input');
    const search2 = q(el, '.search');
    // Same node identity — the shell is not rebuilt on state changes.
    assert.strictEqual(search1, search2, 'search input must not be destroyed on update');
    assert.equal(search2.value, 'a');
  });

  await test('multi-char typing accumulates in the input', () => {
    const el = makeEl({ attrs: { name: 't', searchable: true }, options: fruits });
    el.open();
    const search = q(el, '.search');
    for (const ch of ['b', 'a', 'n']) {
      search.value += ch;
      dispatch(search, 'input');
    }
    assert.equal(q(el, '.search').value, 'ban');
    assert.deepEqual(qa(el, '.option').map((o) => o.dataset.value), ['banana']);
  });

  await test('clicking a filtered option still selects it', () => {
    const el = makeEl({ attrs: { name: 't', searchable: true }, options: fruits });
    el.open();
    const search = q(el, '.search');
    search.value = 'ch';
    dispatch(search, 'input');
    dispatch(qa(el, '.option')[0], 'click');
    assert.deepEqual(el.value, ['cherry']);
  });

  await test('search event fires with query detail', () => {
    const el = makeEl({ attrs: { name: 't', searchable: true }, options: fruits });
    el.open();
    const events = [];
    el.addEventListener('search', (e) => events.push(e.detail));
    const search = q(el, '.search');
    search.value = 'b';
    dispatch(search, 'input');
    assert.deepEqual(events, [{ query: 'b' }]);
  });
});

await section('chips: remove button unselects without closing', async () => {
  await test('click × on a chip unselects that value', () => {
    const el = makeEl({ attrs: { name: 't' }, options: fruits, value: ['apple', 'cherry'] });
    const rm = q(el, '.chip[data-value="apple"] .chip-remove');
    assert.ok(rm, 'remove button exists');
    dispatch(rm, 'click');
    assert.deepEqual(el.value, ['cherry']);
  });

  await test('removing fires unselect + change events', () => {
    const el = makeEl({ attrs: { name: 't' }, options: fruits, value: ['apple'] });
    const unsel = [];
    const chg = [];
    el.addEventListener('unselect', (e) => unsel.push(e.detail));
    el.addEventListener('change', (e) => chg.push(e.detail));
    dispatch(q(el, '.chip-remove'), 'click');
    assert.equal(unsel.length, 1);
    assert.equal(unsel[0].option.value, 'apple');
    assert.equal(chg.length, 1);
    assert.deepEqual(chg[0].removed, ['apple']);
  });
});

await section('lifecycle states render in the listbox', async () => {
  await test('empty options render "No options available"', () => {
    const el = makeEl({ attrs: { name: 't' }, options: [] });
    el.open();
    assert.match(q(el, '.status-row').textContent, /No options available/);
  });

  await test('status=loading shows spinner row', async () => {
    const el = makeEl({ attrs: { name: 't' } });
    el.open();
    // Port that never resolves until we say so.
    let release;
    el.optionsSource = { load: () => new Promise((r) => { release = r; }) };
    // Wait a microtask so loadOptions has set status=loading.
    await Promise.resolve();
    const row = q(el, '.status-row');
    assert.equal(row?.dataset.kind, 'loading');
    release(fruits);
  });

  await test('status=error shows retry button; retry recovers', async () => {
    let first = true;
    const src = {
      load: async () => {
        if (first) { first = false; throw new Error('nope'); }
        return fruits;
      },
    };
    const el = makeEl({ attrs: { name: 't' } });
    el.open();
    el.optionsSource = src;
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(q(el, '.status-row')?.dataset.kind, 'error');
    const retry = q(el, '[data-action="retry"]');
    assert.ok(retry, 'retry button renders');
    dispatch(retry, 'click');
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(el.status, 'ready');
    assert.equal(qa(el, '.option').length, 3);
  });
});

await section('allow-create', async () => {
  await test('create hint appears when query has no match', () => {
    const el = makeEl({
      attrs: { name: 't', searchable: true, 'allow-create': true },
      options: fruits,
    });
    el.open();
    const search = q(el, '.search');
    search.value = 'Durian';
    dispatch(search, 'input');
    const hint = q(el, '[data-action="create"]');
    assert.ok(hint, 'create hint present');
    assert.match(hint.textContent, /Create "Durian"/);
  });

  await test('clicking the hint creates + selects + fires create event', () => {
    const el = makeEl({
      attrs: { name: 't', searchable: true, 'allow-create': true },
      options: fruits,
    });
    el.open();
    const created = [];
    el.addEventListener('create', (e) => created.push(e.detail.option));
    const search = q(el, '.search');
    search.value = 'Durian';
    dispatch(search, 'input');
    dispatch(q(el, '[data-action="create"]'), 'click');
    assert.deepEqual(el.value, ['Durian']);
    assert.equal(created.length, 1);
    assert.equal(created[0].label, 'Durian');
  });
});

// ── summary ────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
