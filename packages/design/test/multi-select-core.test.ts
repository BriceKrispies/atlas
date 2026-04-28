/**
 * Pure-core tests for MultiSelectCore.
 *
 * No DOM, no custom elements, no web component machinery — the core is
 * the "unit" in the hexagonal sense: a state machine that takes actions
 * in and emits deltas + notifications out. The OptionsSource port is
 * the only boundary, and we exercise it with in-memory fakes covering
 * the real-world failure modes: empty data, nullish data, rejection,
 * and slow/racing responses.
 */

import { describe, it, expect } from 'vitest';
import {
  MultiSelectCore,
  LIFECYCLE,
  type Option,
  type OptionsSource,
} from '../src/multi-select-core.ts';

// ── helpers ────────────────────────────────────────────────────────

const fruits: Option[] = [
  { value: 'apple', label: 'Apple' },
  { value: 'banana', label: 'Banana' },
  { value: 'cherry', label: 'Cherry' },
];

/** In-memory OptionsSource that yields `data` after `load()` is awaited. */
function fixedSource(data: unknown): OptionsSource {
  return {
    load: async () => data as readonly Option[] | null | undefined,
  };
}

/** OptionsSource that always rejects. */
function throwingSource(message = 'boom'): OptionsSource {
  return {
    load: async () => {
      throw new Error(message);
    },
  };
}

/** OptionsSource whose `load()` resolves only when we call `release()`. */
function deferredSource(data: readonly Option[]): {
  src: OptionsSource;
  release: () => void;
} {
  let release: (() => void) | undefined;
  const src: OptionsSource = {
    load: () =>
      new Promise<readonly Option[]>((resolve) => {
        release = () => resolve(data);
      }),
  };
  return {
    src,
    release: () => {
      release?.();
    },
  };
}

// ── tests ──────────────────────────────────────────────────────────

describe('construction + initial state', () => {
  it('empty core reports status=empty with no port', () => {
    const c = new MultiSelectCore();
    expect(c.getState().status).toBe(LIFECYCLE.EMPTY);
    expect(c.getState().options).toEqual([]);
    expect(c.getState().selected).toEqual([]);
  });

  it('empty core with port reports status=idle (awaits explicit load)', () => {
    const c = new MultiSelectCore({ optionsSource: fixedSource([]) });
    expect(c.getState().status).toBe(LIFECYCLE.IDLE);
  });

  it('initial options yield status=ready', () => {
    const c = new MultiSelectCore({ options: fruits });
    expect(c.getState().status).toBe(LIFECYCLE.READY);
    expect(c.getState().options.length).toBe(3);
  });

  it('normalizes options: strings, {id}, and drops duplicates/nulls', () => {
    const c = new MultiSelectCore({
      options: ['a', { id: 'b', text: 'Bee' }, null, 'a', { value: '' }],
    });
    const opts = c.getState().options;
    expect(opts.map((o) => o.value)).toEqual(['a', 'b']);
    expect(opts[1]?.label).toBe('Bee');
  });

  it('initial selected values that do not match any option are dropped', () => {
    const c = new MultiSelectCore({
      options: fruits,
      selected: ['apple', 'durian'],
    });
    expect(c.getState().selected).toEqual(['apple']);
  });
});

describe('selectors: visibleOptions + selectedOptions sort alphabetically', () => {
  it('visibleOptions sorts by label case-insensitively', () => {
    const c = new MultiSelectCore({
      options: [
        { value: 'z', label: 'zebra' },
        { value: 'a', label: 'Apple' },
        { value: 'm', label: 'mango' },
      ],
    });
    expect(c.visibleOptions().map((o) => o.label)).toEqual([
      'Apple',
      'mango',
      'zebra',
    ]);
  });

  it('selectedOptions returns full objects, also sorted', () => {
    const c = new MultiSelectCore({
      options: fruits,
      selected: ['cherry', 'apple'],
    });
    expect(c.selectedOptions().map((o) => o.label)).toEqual([
      'Apple',
      'Cherry',
    ]);
  });

  it('query filter is case-insensitive substring', () => {
    const c = new MultiSelectCore({ options: fruits });
    c.setQuery('AN');
    expect(c.visibleOptions().map((o) => o.value)).toEqual(['banana']);
  });
});

describe('mutations + deltas', () => {
  it('select returns delta.added=[value]', () => {
    const c = new MultiSelectCore({ options: fruits });
    const delta = c.select('apple');
    expect(delta).toEqual({ changed: true, added: ['apple'], removed: [] });
    expect(c.getState().selected).toEqual(['apple']);
  });

  it('select on already-selected returns no-op delta', () => {
    const c = new MultiSelectCore({ options: fruits, selected: ['apple'] });
    const delta = c.select('apple');
    expect(delta.changed).toBe(false);
  });

  it('select on unknown value returns no-op delta', () => {
    const c = new MultiSelectCore({ options: fruits });
    const delta = c.select('durian');
    expect(delta.changed).toBe(false);
  });

  it('max=2 blocks the third selection', () => {
    const c = new MultiSelectCore({ options: fruits, max: 2 });
    c.select('apple');
    c.select('banana');
    const delta = c.select('cherry');
    expect(delta.changed).toBe(false);
    expect(c.getState().selected).toEqual(['apple', 'banana']);
  });

  it('disabled option cannot be selected', () => {
    const c = new MultiSelectCore({
      options: [
        ...fruits,
        { value: 'durian', label: 'Durian', disabled: true },
      ],
    });
    const delta = c.select('durian');
    expect(delta.changed).toBe(false);
  });

  it('disabled core rejects every mutation', () => {
    const c = new MultiSelectCore({ options: fruits, disabled: true });
    expect(c.select('apple').changed).toBe(false);
    expect(c.toggle('apple').changed).toBe(false);
    expect(c.clear().changed).toBe(false);
  });

  it('toggle alternates select/unselect', () => {
    const c = new MultiSelectCore({ options: fruits });
    expect(c.toggle('apple')).toEqual({
      changed: true,
      added: ['apple'],
      removed: [],
    });
    expect(c.toggle('apple')).toEqual({
      changed: true,
      added: [],
      removed: ['apple'],
    });
  });

  it('clear removes all and reports them in delta.removed', () => {
    const c = new MultiSelectCore({
      options: fruits,
      selected: ['apple', 'banana'],
    });
    const delta = c.clear();
    expect(delta.removed.sort()).toEqual(['apple', 'banana']);
    expect(c.getState().selected).toEqual([]);
  });

  it('unselectLast removes the most recently added', () => {
    const c = new MultiSelectCore({ options: fruits });
    c.select('apple');
    c.select('cherry');
    const delta = c.unselectLast();
    expect(delta.removed).toEqual(['cherry']);
  });

  it('setOptions drops selections that are no longer valid', () => {
    const c = new MultiSelectCore({
      options: fruits,
      selected: ['apple', 'banana'],
    });
    const delta = c.setOptions([{ value: 'apple', label: 'Apple' }]);
    expect(delta.removed).toEqual(['banana']);
    expect(c.getState().selected).toEqual(['apple']);
  });
});

describe('active index / keyboard coordination', () => {
  it('setQuery resets active to first visible option', () => {
    const c = new MultiSelectCore({ options: fruits });
    c.setQuery('a');
    expect(c.getState().activeIndex).toBe(0);
  });

  it('moveActive is clamped (no wrap)', () => {
    const c = new MultiSelectCore({ options: fruits });
    c.openListbox();
    c.setActive(0);
    c.moveActive(-5);
    expect(c.getState().activeIndex).toBe(0);
    c.moveActive(99);
    expect(c.getState().activeIndex).toBe(2);
  });

  it('toggleActive toggles the currently highlighted visible option', () => {
    const c = new MultiSelectCore({ options: fruits });
    c.openListbox();
    c.setActive(1); // visibleOptions sorted = [Apple, Banana, Cherry] → Banana
    const delta = c.toggleActive();
    expect(delta.added).toEqual(['banana']);
  });
});

describe('allowCreate + createFromQuery', () => {
  it('createFromQuery without allowCreate is a no-op', () => {
    const c = new MultiSelectCore({ options: fruits });
    c.setQuery('Durian');
    const delta = c.createFromQuery();
    expect(delta.changed).toBe(false);
  });

  it('createFromQuery appends option and selects it', () => {
    const c = new MultiSelectCore({ options: fruits, allowCreate: true });
    c.setQuery('Durian');
    const delta = c.createFromQuery();
    expect(delta.added).toEqual(['Durian']);
    expect(c.getState().options.some((o) => o.value === 'Durian')).toBe(true);
  });

  it('createFromQuery rejects when query matches an existing label', () => {
    const c = new MultiSelectCore({ options: fruits, allowCreate: true });
    c.setQuery('apple'); // case-insensitive match
    const delta = c.createFromQuery();
    expect(delta.changed).toBe(false);
  });
});

describe('port: OptionsSource drives the lifecycle', () => {
  it('loadOptions transitions idle → loading → ready on success', async () => {
    const c = new MultiSelectCore({ optionsSource: fixedSource(fruits) });
    const status = await c.loadOptions();
    expect(status).toBe(LIFECYCLE.READY);
    expect(c.getState().options.length).toBe(3);
  });

  it('loadOptions returns empty array → status=empty', async () => {
    const c = new MultiSelectCore({ optionsSource: fixedSource([]) });
    const status = await c.loadOptions();
    expect(status).toBe(LIFECYCLE.EMPTY);
  });

  it('loadOptions returns null/undefined → treated as empty', async () => {
    for (const nullish of [null, undefined]) {
      const c = new MultiSelectCore({ optionsSource: fixedSource(nullish) });
      const status = await c.loadOptions();
      expect(status).toBe(LIFECYCLE.EMPTY);
    }
  });

  it('loadOptions returns non-array (e.g. {}) → treated as empty', async () => {
    const c = new MultiSelectCore({
      optionsSource: fixedSource({ oops: true }),
    });
    const status = await c.loadOptions();
    expect(status).toBe(LIFECYCLE.EMPTY);
  });

  it('loadOptions → status=error with message when port throws', async () => {
    const c = new MultiSelectCore({
      optionsSource: throwingSource('Network down'),
    });
    const status = await c.loadOptions();
    expect(status).toBe(LIFECYCLE.ERROR);
    expect(c.getState().error).toBe('Network down');
  });

  it('loadOptions surfaces non-Error rejections as strings', async () => {
    const c = new MultiSelectCore({
      optionsSource: {
        load: async () => {
          throw 'nope';
        },
      },
    });
    await c.loadOptions();
    expect(c.getState().error).toBe('nope');
  });

  it('listeners observe loading → ready transition in order', async () => {
    const c = new MultiSelectCore({ optionsSource: fixedSource(fruits) });
    const seen: string[] = [];
    c.subscribe((s) => seen.push(s.status));
    await c.loadOptions();
    expect(seen).toEqual([LIFECYCLE.LOADING, LIFECYCLE.READY]);
  });

  it('late resolve from superseded load is ignored', async () => {
    const slow = deferredSource(fruits.slice(0, 1));
    const c = new MultiSelectCore({ optionsSource: slow.src });
    const firstPromise = c.loadOptions('a');
    // Second call replaces the port's behavior: we switch to a fresh source.
    c.setOptionsSource(fixedSource(fruits));
    const status = await c.loadOptions('b');
    expect(status).toBe(LIFECYCLE.READY);
    expect(c.getState().options.length).toBe(3);
    // Now let the stale promise resolve — it must NOT overwrite state.
    slow.release();
    await firstPromise;
    expect(c.getState().options.length).toBe(3);
  });

  it('retry after error transitions back to ready', async () => {
    // First call throws, second returns data.
    let first = true;
    const src: OptionsSource = {
      load: async () => {
        if (first) {
          first = false;
          throw new Error('flaky');
        }
        return fruits;
      },
    };
    const c = new MultiSelectCore({ optionsSource: src });
    await c.loadOptions();
    expect(c.getState().status).toBe(LIFECYCLE.ERROR);
    await c.loadOptions();
    expect(c.getState().status).toBe(LIFECYCLE.READY);
    expect(c.getState().error).toBe(null);
  });

  it('setting optionsSource=null while loading synthesizes terminal state', async () => {
    const slow = deferredSource(fruits);
    const c = new MultiSelectCore({
      options: fruits,
      optionsSource: slow.src,
    });
    const p = c.loadOptions();
    expect(c.getState().status).toBe(LIFECYCLE.LOADING);
    c.setOptionsSource(null);
    expect(c.getState().status).toBe(LIFECYCLE.READY);
    slow.release();
    await p;
    // Late resolve from detached source is discarded.
    expect(c.getState().status).toBe(LIFECYCLE.READY);
  });
});

describe('subscribe', () => {
  it('listener fires on every mutation', () => {
    const c = new MultiSelectCore({ options: fruits });
    let count = 0;
    c.subscribe(() => {
      count++;
    });
    c.select('apple');
    c.setQuery('b');
    c.openListbox();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  it('unsubscribe stops notifications', () => {
    const c = new MultiSelectCore({ options: fruits });
    let count = 0;
    const unsub = c.subscribe(() => {
      count++;
    });
    unsub();
    c.select('apple');
    expect(count).toBe(0);
  });

  it('a throwing listener does not break the core', () => {
    const c = new MultiSelectCore({ options: fruits });
    c.subscribe(() => {
      throw new Error('observer blew up');
    });
    const delta = c.select('apple');
    expect(delta.changed).toBe(true);
  });
});
