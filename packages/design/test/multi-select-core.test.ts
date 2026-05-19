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
import { describe, it, expect } from '@atlas/test';
import { MultiSelectCore, LIFECYCLE, type Option, type OptionsSource, } from '../src/multi-select-core.ts';
// ── helpers ────────────────────────────────────────────────────────
const fruits: Option[] = [
    { value: 'apple', label: 'Apple' },
    { value: 'banana', label: 'Banana' },
    { value: 'cherry', label: 'Cherry' },
];
/** In-memory OptionsSource that yields `data` after `load()` is awaited.
 * Accepts `unknown` so tests can verify the core copes with non-array
 * payloads that escape from a flaky port — the explicit cast IS the
 * escape hatch the tests need. */
function fixedSource(data: unknown): OptionsSource {
    return {
        load: async function () {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- contract-exempt: this fake exists to feed runtime-malformed payloads (non-array, nullish) into MultiSelectCore so the LIFECYCLE.EMPTY path can be exercised. The widened `unknown` parameter + narrow cast IS the test surface.
            return data as readonly Option[] | null | undefined;
        },
    };
}
/** OptionsSource that always rejects. */
function throwingSource(message = 'boom'): OptionsSource {
    return {
        load: async function () {
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
        load: function () {
            return new Promise<readonly Option[]>(function (resolve) {
                release = function () {
                    return resolve(data);
                };
            });
        },
    };
    return {
        src,
        release: function () {
            release?.();
        },
    };
}
// ── tests ──────────────────────────────────────────────────────────
describe('construction + initial state', function () {
    it('empty core reports status=empty with no port', function () {
        const c = new MultiSelectCore();
        expect(c.getState().status).toBe(LIFECYCLE.EMPTY);
        expect(c.getState().options).toEqual([]);
        expect(c.getState().selected).toEqual([]);
    });
    it('empty core with port reports status=idle (awaits explicit load)', function () {
        const c = new MultiSelectCore({ optionsSource: fixedSource([]) });
        expect(c.getState().status).toBe(LIFECYCLE.IDLE);
    });
    it('initial options yield status=ready', function () {
        const c = new MultiSelectCore({ options: fruits });
        expect(c.getState().status).toBe(LIFECYCLE.READY);
        expect(c.getState().options.length).toBe(3);
    });
    it('normalizes options: strings, {id}, and drops duplicates/nulls', function () {
        const c = new MultiSelectCore({
            options: ['a', { id: 'b', text: 'Bee' }, null, 'a', { value: '' }],
        });
        const opts = c.getState().options;
        expect(opts.map(function (o) {
            return o.value;
        })).toEqual(['a', 'b']);
        expect(opts[1]?.label).toBe('Bee');
    });
    it('initial selected values that do not match any option are dropped', function () {
        const c = new MultiSelectCore({
            options: fruits,
            selected: ['apple', 'durian'],
        });
        expect(c.getState().selected).toEqual(['apple']);
    });
});
describe('selectors: visibleOptions + selectedOptions sort alphabetically', function () {
    it('visibleOptions sorts by label case-insensitively', function () {
        const c = new MultiSelectCore({
            options: [
                { value: 'z', label: 'zebra' },
                { value: 'a', label: 'Apple' },
                { value: 'm', label: 'mango' },
            ],
        });
        expect(c.visibleOptions().map(function (o) {
            return o.label;
        })).toEqual([
            'Apple',
            'mango',
            'zebra',
        ]);
    });
    it('selectedOptions returns full objects, also sorted', function () {
        const c = new MultiSelectCore({
            options: fruits,
            selected: ['cherry', 'apple'],
        });
        expect(c.selectedOptions().map(function (o) {
            return o.label;
        })).toEqual([
            'Apple',
            'Cherry',
        ]);
    });
    it('query filter is case-insensitive substring', function () {
        const c = new MultiSelectCore({ options: fruits });
        c.setQuery('AN');
        expect(c.visibleOptions().map(function (o) {
            return o.value;
        })).toEqual(['banana']);
    });
});
describe('mutations + deltas', function () {
    it('select returns delta.added=[value]', function () {
        const c = new MultiSelectCore({ options: fruits });
        const delta = c.select('apple');
        expect(delta).toEqual({ changed: true, added: ['apple'], removed: [] });
        expect(c.getState().selected).toEqual(['apple']);
    });
    it('select on already-selected returns no-op delta', function () {
        const c = new MultiSelectCore({ options: fruits, selected: ['apple'] });
        const delta = c.select('apple');
        expect(delta.changed).toBe(false);
    });
    it('select on unknown value returns no-op delta', function () {
        const c = new MultiSelectCore({ options: fruits });
        const delta = c.select('durian');
        expect(delta.changed).toBe(false);
    });
    it('max=2 blocks the third selection', function () {
        const c = new MultiSelectCore({ options: fruits, max: 2 });
        c.select('apple');
        c.select('banana');
        const delta = c.select('cherry');
        expect(delta.changed).toBe(false);
        expect(c.getState().selected).toEqual(['apple', 'banana']);
    });
    it('disabled option cannot be selected', function () {
        const c = new MultiSelectCore({
            options: [
                ...fruits,
                { value: 'durian', label: 'Durian', disabled: true },
            ],
        });
        const delta = c.select('durian');
        expect(delta.changed).toBe(false);
    });
    it('disabled core rejects every mutation', function () {
        const c = new MultiSelectCore({ options: fruits, disabled: true });
        expect(c.select('apple').changed).toBe(false);
        expect(c.toggle('apple').changed).toBe(false);
        expect(c.clear().changed).toBe(false);
    });
    it('toggle alternates select/unselect', function () {
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
    it('clear removes all and reports them in delta.removed', function () {
        const c = new MultiSelectCore({
            options: fruits,
            selected: ['apple', 'banana'],
        });
        const delta = c.clear();
        expect(delta.removed.sort()).toEqual(['apple', 'banana']);
        expect(c.getState().selected).toEqual([]);
    });
    it('unselectLast removes the most recently added', function () {
        const c = new MultiSelectCore({ options: fruits });
        c.select('apple');
        c.select('cherry');
        const delta = c.unselectLast();
        expect(delta.removed).toEqual(['cherry']);
    });
    it('setOptions drops selections that are no longer valid', function () {
        const c = new MultiSelectCore({
            options: fruits,
            selected: ['apple', 'banana'],
        });
        const delta = c.setOptions([{ value: 'apple', label: 'Apple' }]);
        expect(delta.removed).toEqual(['banana']);
        expect(c.getState().selected).toEqual(['apple']);
    });
});
describe('active index / keyboard coordination', function () {
    it('setQuery resets active to first visible option', function () {
        const c = new MultiSelectCore({ options: fruits });
        c.setQuery('a');
        expect(c.getState().activeIndex).toBe(0);
    });
    it('moveActive is clamped (no wrap)', function () {
        const c = new MultiSelectCore({ options: fruits });
        c.openListbox();
        c.setActive(0);
        c.moveActive(-5);
        expect(c.getState().activeIndex).toBe(0);
        c.moveActive(99);
        expect(c.getState().activeIndex).toBe(2);
    });
    it('toggleActive toggles the currently highlighted visible option', function () {
        const c = new MultiSelectCore({ options: fruits });
        c.openListbox();
        c.setActive(1); // visibleOptions sorted = [Apple, Banana, Cherry] → Banana
        const delta = c.toggleActive();
        expect(delta.added).toEqual(['banana']);
    });
});
describe('allowCreate + createFromQuery', function () {
    it('createFromQuery without allowCreate is a no-op', function () {
        const c = new MultiSelectCore({ options: fruits });
        c.setQuery('Durian');
        const delta = c.createFromQuery();
        expect(delta.changed).toBe(false);
    });
    it('createFromQuery appends option and selects it', function () {
        const c = new MultiSelectCore({ options: fruits, allowCreate: true });
        c.setQuery('Durian');
        const delta = c.createFromQuery();
        expect(delta.added).toEqual(['Durian']);
        expect(c.getState().options.some(function (o) {
            return o.value === 'Durian';
        })).toBe(true);
    });
    it('createFromQuery rejects when query matches an existing label', function () {
        const c = new MultiSelectCore({ options: fruits, allowCreate: true });
        c.setQuery('apple'); // case-insensitive match
        const delta = c.createFromQuery();
        expect(delta.changed).toBe(false);
    });
});
describe('port: OptionsSource drives the lifecycle', function () {
    it('loadOptions transitions idle → loading → ready on success', async function () {
        const c = new MultiSelectCore({ optionsSource: fixedSource(fruits) });
        const status = await c.loadOptions();
        expect(status).toBe(LIFECYCLE.READY);
        expect(c.getState().options.length).toBe(3);
    });
    it('loadOptions returns empty array → status=empty', async function () {
        const c = new MultiSelectCore({ optionsSource: fixedSource([]) });
        const status = await c.loadOptions();
        expect(status).toBe(LIFECYCLE.EMPTY);
    });
    it('loadOptions returns null/undefined → treated as empty', async function () {
        for (const nullish of [null, undefined]) {
            const c = new MultiSelectCore({ optionsSource: fixedSource(nullish) });
            const status = await c.loadOptions();
            expect(status).toBe(LIFECYCLE.EMPTY);
        }
    });
    it('loadOptions returns non-array (e.g. {}) → treated as empty', async function () {
        const c = new MultiSelectCore({
            optionsSource: fixedSource({ oops: true }),
        });
        const status = await c.loadOptions();
        expect(status).toBe(LIFECYCLE.EMPTY);
    });
    it('loadOptions → status=error with message when port throws', async function () {
        const c = new MultiSelectCore({
            optionsSource: throwingSource('Network down'),
        });
        const status = await c.loadOptions();
        expect(status).toBe(LIFECYCLE.ERROR);
        expect(c.getState().error).toBe('Network down');
    });
    it('loadOptions surfaces non-Error rejections as strings', async function () {
        const c = new MultiSelectCore({
            optionsSource: {
                load: async function () {
                    throw 'nope';
                },
            },
        });
        await c.loadOptions();
        expect(c.getState().error).toBe('nope');
    });
    it('listeners observe loading → ready transition in order', async function () {
        const c = new MultiSelectCore({ optionsSource: fixedSource(fruits) });
        const seen: string[] = [];
        c.subscribe(function (s) {
            return seen.push(s.status);
        });
        await c.loadOptions();
        expect(seen).toEqual([LIFECYCLE.LOADING, LIFECYCLE.READY]);
    });
    it('late resolve from superseded load is ignored', async function () {
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
    it('retry after error transitions back to ready', async function () {
        // First call throws, second returns data.
        let first = true;
        const src: OptionsSource = {
            load: async function () {
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
    it('setting optionsSource=null while loading synthesizes terminal state', async function () {
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
describe('subscribe', function () {
    it('listener fires on every mutation', function () {
        const c = new MultiSelectCore({ options: fruits });
        let count = 0;
        c.subscribe(function () {
            count++;
        });
        c.select('apple');
        c.setQuery('b');
        c.openListbox();
        expect(count).toBeGreaterThanOrEqual(3);
    });
    it('unsubscribe stops notifications', function () {
        const c = new MultiSelectCore({ options: fruits });
        let count = 0;
        const unsub = c.subscribe(function () {
            count++;
        });
        unsub();
        c.select('apple');
        expect(count).toBe(0);
    });
    it('a throwing listener does not break the core', function () {
        const c = new MultiSelectCore({ options: fruits });
        c.subscribe(function () {
            throw new Error('observer blew up');
        });
        const delta = c.select('apple');
        expect(delta.changed).toBe(true);
    });
});
