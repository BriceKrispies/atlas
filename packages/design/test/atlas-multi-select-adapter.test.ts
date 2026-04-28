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

// DOM globals (document, HTMLElement, customElements, CSSStyleSheet,
// ElementInternals, FormData, ShadowRoot, adoptedStyleSheets patch) are
// installed by the global vitest setup — see
// `frontend/test-setup/linkedom-shims.ts`.

// Minimal aliases to the linkedom shapes we use in tests.
// Functional at runtime; we keep them as `any`-like via `unknown` where
// the linkedom shape doesn't line up with DOM lib types.
type AnyEl = any;

// Handy references to the globals the shim installed.
const dom = {
  document: globalThis.document,
  HTMLElement: globalThis.HTMLElement,
  customElements: globalThis.customElements,
  Event: globalThis.Event,
};

beforeAll(async () => {
  // Import AFTER globals are installed so the element registers against
  // our linkedom customElements registry.
  await import('../src/atlas-multi-select.ts');
});

// ── helpers ────────────────────────────────────────────────────────

interface MakeElArgs {
  attrs?: Record<string, string | boolean | null | undefined>;
  options?: Array<{ value: string; label: string; disabled?: boolean }>;
  value?: string[];
}

function makeEl({
  attrs = {},
  options = [],
  value,
}: MakeElArgs = {}): AnyEl {
  const el = (dom.document as AnyEl).createElement('atlas-multi-select');
  for (const [k, v] of Object.entries(attrs)) {
    if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, String(v));
  }
  el.options = options;
  if (Array.isArray(value)) el.value = value;
  (dom.document as AnyEl).body.appendChild(el);
  return el;
}

function dispatch(
  node: AnyEl,
  type: string,
  init: Record<string, unknown> = {},
): AnyEl {
  // linkedom's dispatchEvent is picky — use its own Event constructor
  // (the global Event from Node's globalThis doesn't interop cleanly).
  const WinEvent = dom.Event as unknown as {
    new (type: string, init: Record<string, unknown>): AnyEl;
  };
  const ev = new WinEvent(type, {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  node.dispatchEvent(ev);
  return ev;
}

function q(el: AnyEl, sel: string): AnyEl {
  return el.shadowRoot.querySelector(sel);
}
function qa(el: AnyEl, sel: string): AnyEl[] {
  return Array.from(el.shadowRoot.querySelectorAll(sel));
}

const fruits = [
  { value: 'apple', label: 'Apple' },
  { value: 'banana', label: 'Banana' },
  { value: 'cherry', label: 'Cherry' },
];

// ── tests ──────────────────────────────────────────────────────────

describe('shell structure is built once on mount', () => {
  it('shadow DOM contains trigger, listbox, options, error row', () => {
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

  it('options render with data-value / aria-selected / role=option', () => {
    const el = makeEl({ attrs: { name: 't' }, options: fruits });
    el.open();
    const opts = qa(el, '.option');
    expect(opts.length).toBe(3);
    expect(opts.map((o) => o.dataset.value)).toEqual([
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

describe('clicking an option toggles selection (the regression)', () => {
  it('click on first option selects it and el.value reflects', () => {
    const el = makeEl({ attrs: { name: 't' }, options: fruits });
    el.open();
    const first = qa(el, '.option').find(
      (o) => o.dataset.value === 'apple',
    );
    dispatch(first, 'click');
    expect(el.value).toEqual(['apple']);
  });

  it('second click on same option unselects (toggle)', () => {
    const el = makeEl({ attrs: { name: 't' }, options: fruits });
    el.open();
    const first = (): AnyEl =>
      qa(el, '.option').find((o) => o.dataset.value === 'apple');
    dispatch(first(), 'click');
    dispatch(first(), 'click');
    expect(el.value).toEqual([]);
  });

  it('sequential clicks on different options accumulate', () => {
    const el = makeEl({ attrs: { name: 't' }, options: fruits });
    el.open();
    const by = (v: string): AnyEl =>
      qa(el, '.option').find((o) => o.dataset.value === v);
    dispatch(by('apple'), 'click');
    dispatch(by('cherry'), 'click');
    dispatch(by('banana'), 'click');
    expect([...el.value].sort()).toEqual(['apple', 'banana', 'cherry']);
  });

  it('selection persists: option DOM after click shows aria-selected=true', () => {
    const el = makeEl({ attrs: { name: 't' }, options: fruits });
    el.open();
    const apple = (): AnyEl =>
      qa(el, '.option').find((o) => o.dataset.value === 'apple');
    dispatch(apple(), 'click');
    // Find the (possibly re-rendered) apple li and check aria-selected.
    expect(apple().getAttribute('aria-selected')).toBe('true');
  });

  it('host mirrors selection in data-value attribute', () => {
    const el = makeEl({ attrs: { name: 't' }, options: fruits });
    el.open();
    dispatch(qa(el, '.option')[0], 'click');
    expect(el.getAttribute('data-value')).toBe(JSON.stringify(el.value));
  });

  it('regression: mouseover BEFORE click does not detach the option', () => {
    // Real browsers fire mousedown → mouseup → click. If hover triggers
    // a state notification that replaces the option <li>, the element
    // under the mouse becomes a new node and the browser refuses to
    // synthesize `click`. Simulate the sequence and verify the clicked
    // <li> is still the same DOM node across mouseover → click.
    const el = makeEl({ attrs: { name: 't' }, options: fruits });
    el.open();
    const apple = qa(el, '.option').find(
      (o) => o.dataset.value === 'apple',
    );
    dispatch(apple, 'mouseover');
    // If mouseover re-rendered the options list, `apple` is now a stale
    // reference and still in the pre-render DOM — click on it wouldn't
    // fire in a real browser. Assert identity before dispatching click.
    const appleAfterHover = qa(el, '.option').find(
      (o) => o.dataset.value === 'apple',
    );
    expect(apple).toBe(appleAfterHover);
    dispatch(apple, 'click');
    expect(el.value).toEqual(['apple']);
  });

  it('change event fires with delta + selected in detail', () => {
    const el = makeEl({ attrs: { name: 't' }, options: fruits });
    el.open();
    const events: AnyEl[] = [];
    el.addEventListener('change', (e: AnyEl) => events.push(e.detail));
    dispatch(
      qa(el, '.option').find((o) => o.dataset.value === 'banana'),
      'click',
    );
    expect(events.length).toBe(1);
    expect(events[0].added).toEqual(['banana']);
    expect(events[0].removed).toEqual([]);
    expect(events[0].value).toEqual(['banana']);
  });
});

describe('search input: typing filters options and survives re-render', () => {
  it('typing "ch" filters options to Cherry only', () => {
    const el = makeEl({
      attrs: { name: 't', searchable: true },
      options: fruits,
    });
    el.open();
    const search = q(el, '.search');
    search.value = 'ch';
    dispatch(search, 'input');
    const visible = qa(el, '.option').map((o) => o.dataset.value);
    expect(visible).toEqual(['cherry']);
  });

  it('search input element is preserved across typing (not destroyed)', () => {
    const el = makeEl({
      attrs: { name: 't', searchable: true },
      options: fruits,
    });
    el.open();
    const search1 = q(el, '.search');
    search1.value = 'a';
    dispatch(search1, 'input');
    const search2 = q(el, '.search');
    // Same node identity — the shell is not rebuilt on state changes.
    expect(search1).toBe(search2);
    expect(search2.value).toBe('a');
  });

  it('multi-char typing accumulates in the input', () => {
    const el = makeEl({
      attrs: { name: 't', searchable: true },
      options: fruits,
    });
    el.open();
    const search = q(el, '.search');
    for (const ch of ['b', 'a', 'n']) {
      search.value += ch;
      dispatch(search, 'input');
    }
    expect(q(el, '.search').value).toBe('ban');
    expect(qa(el, '.option').map((o) => o.dataset.value)).toEqual(['banana']);
  });

  it('clicking a filtered option still selects it', () => {
    const el = makeEl({
      attrs: { name: 't', searchable: true },
      options: fruits,
    });
    el.open();
    const search = q(el, '.search');
    search.value = 'ch';
    dispatch(search, 'input');
    dispatch(qa(el, '.option')[0], 'click');
    expect(el.value).toEqual(['cherry']);
  });

  it('search event fires with query detail', () => {
    const el = makeEl({
      attrs: { name: 't', searchable: true },
      options: fruits,
    });
    el.open();
    const events: AnyEl[] = [];
    el.addEventListener('search', (e: AnyEl) => events.push(e.detail));
    const search = q(el, '.search');
    search.value = 'b';
    dispatch(search, 'input');
    expect(events).toEqual([{ query: 'b' }]);
  });
});

describe('chips: remove button unselects without closing', () => {
  it('click × on a chip unselects that value', () => {
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

  it('removing fires unselect + change events', () => {
    const el = makeEl({
      attrs: { name: 't' },
      options: fruits,
      value: ['apple'],
    });
    const unsel: AnyEl[] = [];
    const chg: AnyEl[] = [];
    el.addEventListener('unselect', (e: AnyEl) => unsel.push(e.detail));
    el.addEventListener('change', (e: AnyEl) => chg.push(e.detail));
    dispatch(q(el, '.chip-remove'), 'click');
    expect(unsel.length).toBe(1);
    expect(unsel[0].option.value).toBe('apple');
    expect(chg.length).toBe(1);
    expect(chg[0].removed).toEqual(['apple']);
  });
});

describe('lifecycle states render in the listbox', () => {
  it('empty options render "No options available"', () => {
    const el = makeEl({ attrs: { name: 't' }, options: [] });
    el.open();
    expect(q(el, '.status-row').textContent).toMatch(/No options available/);
  });

  it('status=loading shows spinner row', async () => {
    const el = makeEl({ attrs: { name: 't' } });
    el.open();
    // Port that never resolves until we say so.
    let release: ((v: unknown) => void) | undefined;
    el.optionsSource = {
      load: () =>
        new Promise((r) => {
          release = r;
        }),
    };
    // Wait a microtask so loadOptions has set status=loading.
    await Promise.resolve();
    const row = q(el, '.status-row');
    expect(row?.dataset.kind).toBe('loading');
    release?.(fruits);
  });

  it('status=error shows retry button; retry recovers', async () => {
    let first = true;
    const src = {
      load: async () => {
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
    await new Promise((r) => setTimeout(r, 0));
    expect(q(el, '.status-row')?.dataset.kind).toBe('error');
    const retry = q(el, '[data-action="retry"]');
    expect(retry).toBeTruthy();
    dispatch(retry, 'click');
    await new Promise((r) => setTimeout(r, 0));
    expect(el.status).toBe('ready');
    expect(qa(el, '.option').length).toBe(3);
  });
});

describe('allow-create', () => {
  it('create hint appears when query has no match', () => {
    const el = makeEl({
      attrs: { name: 't', searchable: true, 'allow-create': true },
      options: fruits,
    });
    el.open();
    const search = q(el, '.search');
    search.value = 'Durian';
    dispatch(search, 'input');
    const hint = q(el, '[data-action="create"]');
    expect(hint).toBeTruthy();
    expect(hint.textContent).toMatch(/Create "Durian"/);
  });

  it('clicking the hint creates + selects + fires create event', () => {
    const el = makeEl({
      attrs: { name: 't', searchable: true, 'allow-create': true },
      options: fruits,
    });
    el.open();
    const created: AnyEl[] = [];
    el.addEventListener('create', (e: AnyEl) => created.push(e.detail.option));
    const search = q(el, '.search');
    search.value = 'Durian';
    dispatch(search, 'input');
    dispatch(q(el, '[data-action="create"]'), 'click');
    expect(el.value).toEqual(['Durian']);
    expect(created.length).toBe(1);
    expect(created[0].label).toBe('Durian');
  });
});
