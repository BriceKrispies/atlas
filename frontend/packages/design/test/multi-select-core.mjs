/**
 * Pure-core tests for MultiSelectCore.
 *
 * No DOM, no custom elements, no web component machinery — the core is
 * the "unit" in the hexagonal sense: a state machine that takes actions
 * in and emits deltas + notifications out. The OptionsSource port is
 * the only boundary, and we exercise it with in-memory fakes covering
 * the real-world failure modes: empty data, nullish data, rejection,
 * and slow/racing responses.
 *
 * Invoked via `pnpm --filter @atlas/design test:core`.
 */

import assert from 'node:assert/strict';
import { MultiSelectCore, LIFECYCLE } from '../src/multi-select-core.js';

let passed = 0;
let failed = 0;

/** @param {string} name @param {() => void | Promise<void>} fn */
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

// ── helpers ────────────────────────────────────────────────────────

const fruits = [
  { value: 'apple', label: 'Apple' },
  { value: 'banana', label: 'Banana' },
  { value: 'cherry', label: 'Cherry' },
];

/** In-memory OptionsSource that yields `data` after `load()` is awaited. */
function fixedSource(data) {
  return { load: async () => data };
}

/** OptionsSource that always rejects. */
function throwingSource(message = 'boom') {
  return { load: async () => { throw new Error(message); } };
}

/** OptionsSource whose `load()` resolves only when we call `release()`. */
function deferredSource(data) {
  let release;
  const src = {
    load: () => new Promise((resolve) => { release = () => resolve(data); }),
  };
  return { src, release: () => release() };
}

/** Sequence of responses — pops one per call. Useful for races. */
function sequenceSource(sequence) {
  let i = 0;
  return {
    load: async (query) => {
      const entry = sequence[i++];
      if (typeof entry === 'function') return entry(query);
      return entry;
    },
  };
}

// ── tests ──────────────────────────────────────────────────────────

await section('construction + initial state', async () => {
  await test('empty core reports status=empty with no port', () => {
    const c = new MultiSelectCore();
    assert.equal(c.getState().status, LIFECYCLE.EMPTY);
    assert.deepEqual(c.getState().options, []);
    assert.deepEqual(c.getState().selected, []);
  });

  await test('empty core with port reports status=idle (awaits explicit load)', () => {
    const c = new MultiSelectCore({ optionsSource: fixedSource([]) });
    assert.equal(c.getState().status, LIFECYCLE.IDLE);
  });

  await test('initial options yield status=ready', () => {
    const c = new MultiSelectCore({ options: fruits });
    assert.equal(c.getState().status, LIFECYCLE.READY);
    assert.equal(c.getState().options.length, 3);
  });

  await test('normalizes options: strings, {id}, and drops duplicates/nulls', () => {
    const c = new MultiSelectCore({ options: ['a', { id: 'b', text: 'Bee' }, null, 'a', { value: '' }] });
    const opts = c.getState().options;
    assert.deepEqual(opts.map((o) => o.value), ['a', 'b']);
    assert.equal(opts[1].label, 'Bee');
  });

  await test('initial selected values that do not match any option are dropped', () => {
    const c = new MultiSelectCore({ options: fruits, selected: ['apple', 'durian'] });
    assert.deepEqual(c.getState().selected, ['apple']);
  });
});

await section('selectors: visibleOptions + selectedOptions sort alphabetically', async () => {
  await test('visibleOptions sorts by label case-insensitively', () => {
    const c = new MultiSelectCore({
      options: [
        { value: 'z', label: 'zebra' },
        { value: 'a', label: 'Apple' },
        { value: 'm', label: 'mango' },
      ],
    });
    assert.deepEqual(c.visibleOptions().map((o) => o.label), ['Apple', 'mango', 'zebra']);
  });

  await test('selectedOptions returns full objects, also sorted', () => {
    const c = new MultiSelectCore({ options: fruits, selected: ['cherry', 'apple'] });
    assert.deepEqual(c.selectedOptions().map((o) => o.label), ['Apple', 'Cherry']);
  });

  await test('query filter is case-insensitive substring', () => {
    const c = new MultiSelectCore({ options: fruits });
    c.setQuery('AN');
    assert.deepEqual(c.visibleOptions().map((o) => o.value), ['banana']);
  });
});

await section('mutations + deltas', async () => {
  await test('select returns delta.added=[value]', () => {
    const c = new MultiSelectCore({ options: fruits });
    const delta = c.select('apple');
    assert.deepEqual(delta, { changed: true, added: ['apple'], removed: [] });
    assert.deepEqual(c.getState().selected, ['apple']);
  });

  await test('select on already-selected returns no-op delta', () => {
    const c = new MultiSelectCore({ options: fruits, selected: ['apple'] });
    const delta = c.select('apple');
    assert.equal(delta.changed, false);
  });

  await test('select on unknown value returns no-op delta', () => {
    const c = new MultiSelectCore({ options: fruits });
    const delta = c.select('durian');
    assert.equal(delta.changed, false);
  });

  await test('max=2 blocks the third selection', () => {
    const c = new MultiSelectCore({ options: fruits, max: 2 });
    c.select('apple');
    c.select('banana');
    const delta = c.select('cherry');
    assert.equal(delta.changed, false);
    assert.deepEqual(c.getState().selected, ['apple', 'banana']);
  });

  await test('disabled option cannot be selected', () => {
    const c = new MultiSelectCore({
      options: [...fruits, { value: 'durian', label: 'Durian', disabled: true }],
    });
    const delta = c.select('durian');
    assert.equal(delta.changed, false);
  });

  await test('disabled core rejects every mutation', () => {
    const c = new MultiSelectCore({ options: fruits, disabled: true });
    assert.equal(c.select('apple').changed, false);
    assert.equal(c.toggle('apple').changed, false);
    assert.equal(c.clear().changed, false);
  });

  await test('toggle alternates select/unselect', () => {
    const c = new MultiSelectCore({ options: fruits });
    assert.deepEqual(c.toggle('apple'), { changed: true, added: ['apple'], removed: [] });
    assert.deepEqual(c.toggle('apple'), { changed: true, added: [], removed: ['apple'] });
  });

  await test('clear removes all and reports them in delta.removed', () => {
    const c = new MultiSelectCore({ options: fruits, selected: ['apple', 'banana'] });
    const delta = c.clear();
    assert.deepEqual(delta.removed.sort(), ['apple', 'banana']);
    assert.deepEqual(c.getState().selected, []);
  });

  await test('unselectLast removes the most recently added', () => {
    const c = new MultiSelectCore({ options: fruits });
    c.select('apple');
    c.select('cherry');
    const delta = c.unselectLast();
    assert.deepEqual(delta.removed, ['cherry']);
  });

  await test('setOptions drops selections that are no longer valid', () => {
    const c = new MultiSelectCore({ options: fruits, selected: ['apple', 'banana'] });
    const delta = c.setOptions([{ value: 'apple', label: 'Apple' }]);
    assert.deepEqual(delta.removed, ['banana']);
    assert.deepEqual(c.getState().selected, ['apple']);
  });
});

await section('active index / keyboard coordination', async () => {
  await test('setQuery resets active to first visible option', () => {
    const c = new MultiSelectCore({ options: fruits });
    c.setQuery('a');
    assert.equal(c.getState().activeIndex, 0);
  });

  await test('moveActive is clamped (no wrap)', () => {
    const c = new MultiSelectCore({ options: fruits });
    c.openListbox();
    c.setActive(0);
    c.moveActive(-5);
    assert.equal(c.getState().activeIndex, 0);
    c.moveActive(99);
    assert.equal(c.getState().activeIndex, 2);
  });

  await test('toggleActive toggles the currently highlighted visible option', () => {
    const c = new MultiSelectCore({ options: fruits });
    c.openListbox();
    c.setActive(1); // visibleOptions sorted = [Apple, Banana, Cherry] → Banana
    const delta = c.toggleActive();
    assert.deepEqual(delta.added, ['banana']);
  });
});

await section('allowCreate + createFromQuery', async () => {
  await test('createFromQuery without allowCreate is a no-op', () => {
    const c = new MultiSelectCore({ options: fruits });
    c.setQuery('Durian');
    const delta = c.createFromQuery();
    assert.equal(delta.changed, false);
  });

  await test('createFromQuery appends option and selects it', () => {
    const c = new MultiSelectCore({ options: fruits, allowCreate: true });
    c.setQuery('Durian');
    const delta = c.createFromQuery();
    assert.deepEqual(delta.added, ['Durian']);
    assert.ok(c.getState().options.some((o) => o.value === 'Durian'));
  });

  await test('createFromQuery rejects when query matches an existing label', () => {
    const c = new MultiSelectCore({ options: fruits, allowCreate: true });
    c.setQuery('apple'); // case-insensitive match
    const delta = c.createFromQuery();
    assert.equal(delta.changed, false);
  });
});

await section('port: OptionsSource drives the lifecycle', async () => {
  await test('loadOptions transitions idle → loading → ready on success', async () => {
    const c = new MultiSelectCore({ optionsSource: fixedSource(fruits) });
    const status = await c.loadOptions();
    assert.equal(status, LIFECYCLE.READY);
    assert.equal(c.getState().options.length, 3);
  });

  await test('loadOptions returns empty array → status=empty', async () => {
    const c = new MultiSelectCore({ optionsSource: fixedSource([]) });
    const status = await c.loadOptions();
    assert.equal(status, LIFECYCLE.EMPTY);
  });

  await test('loadOptions returns null/undefined → treated as empty', async () => {
    for (const nullish of [null, undefined]) {
      const c = new MultiSelectCore({ optionsSource: fixedSource(nullish) });
      const status = await c.loadOptions();
      assert.equal(status, LIFECYCLE.EMPTY, `nullish=${nullish}`);
    }
  });

  await test('loadOptions returns non-array (e.g. {}) → treated as empty', async () => {
    const c = new MultiSelectCore({ optionsSource: fixedSource({ oops: true }) });
    const status = await c.loadOptions();
    assert.equal(status, LIFECYCLE.EMPTY);
  });

  await test('loadOptions → status=error with message when port throws', async () => {
    const c = new MultiSelectCore({ optionsSource: throwingSource('Network down') });
    const status = await c.loadOptions();
    assert.equal(status, LIFECYCLE.ERROR);
    assert.equal(c.getState().error, 'Network down');
  });

  await test('loadOptions surfaces non-Error rejections as strings', async () => {
    const c = new MultiSelectCore({ optionsSource: { load: async () => { throw 'nope'; } } });
    await c.loadOptions();
    assert.equal(c.getState().error, 'nope');
  });

  await test('listeners observe loading → ready transition in order', async () => {
    const c = new MultiSelectCore({ optionsSource: fixedSource(fruits) });
    const seen = [];
    c.subscribe((s) => seen.push(s.status));
    await c.loadOptions();
    assert.deepEqual(seen, [LIFECYCLE.LOADING, LIFECYCLE.READY]);
  });

  await test('late resolve from superseded load is ignored', async () => {
    const slow = deferredSource(fruits.slice(0, 1));
    const c = new MultiSelectCore({ optionsSource: slow.src });
    const firstPromise = c.loadOptions('a');
    // Second call replaces the port's behavior: we switch to a fresh source.
    c.setOptionsSource(fixedSource(fruits));
    const status = await c.loadOptions('b');
    assert.equal(status, LIFECYCLE.READY);
    assert.equal(c.getState().options.length, 3);
    // Now let the stale promise resolve — it must NOT overwrite state.
    slow.release();
    await firstPromise;
    assert.equal(c.getState().options.length, 3);
  });

  await test('retry after error transitions back to ready', async () => {
    // First call throws, second returns data.
    let first = true;
    const src = {
      load: async () => {
        if (first) { first = false; throw new Error('flaky'); }
        return fruits;
      },
    };
    const c = new MultiSelectCore({ optionsSource: src });
    await c.loadOptions();
    assert.equal(c.getState().status, LIFECYCLE.ERROR);
    await c.loadOptions();
    assert.equal(c.getState().status, LIFECYCLE.READY);
    assert.equal(c.getState().error, null);
  });

  await test('setting optionsSource=null while loading synthesizes terminal state', async () => {
    const slow = deferredSource(fruits);
    const c = new MultiSelectCore({ options: fruits, optionsSource: slow.src });
    const p = c.loadOptions();
    assert.equal(c.getState().status, LIFECYCLE.LOADING);
    c.setOptionsSource(null);
    assert.equal(c.getState().status, LIFECYCLE.READY);
    slow.release();
    await p;
    // Late resolve from detached source is discarded.
    assert.equal(c.getState().status, LIFECYCLE.READY);
  });
});

await section('subscribe', async () => {
  await test('listener fires on every mutation', () => {
    const c = new MultiSelectCore({ options: fruits });
    let count = 0;
    c.subscribe(() => { count++; });
    c.select('apple');
    c.setQuery('b');
    c.openListbox();
    assert.ok(count >= 3, `expected ≥3 notifications, got ${count}`);
  });

  await test('unsubscribe stops notifications', () => {
    const c = new MultiSelectCore({ options: fruits });
    let count = 0;
    const unsub = c.subscribe(() => { count++; });
    unsub();
    c.select('apple');
    assert.equal(count, 0);
  });

  await test('a throwing listener does not break the core', () => {
    const c = new MultiSelectCore({ options: fruits });
    c.subscribe(() => { throw new Error('observer blew up'); });
    const delta = c.select('apple');
    assert.equal(delta.changed, true);
  });
});

// ── summary ────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
