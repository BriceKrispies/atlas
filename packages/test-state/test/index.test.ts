/**
 * Unit tests for `@atlas/test-state` — the dev-mode `window.__atlasTest`
 * registry.
 *
 * These tests exercise the registry's public contract without trying to
 * mock Vite's `import.meta.env.DEV` (which would require a build-time
 * transform). The vitest harness runs Node where `import.meta.env` is
 * undefined — which the module treats as DEV=false. To exercise the
 * DEV=true path we re-import the module after stamping a fake env on
 * `import.meta`.
 *
 * Since the module installs a global `window.__atlasTest` once, we use
 * `vi.resetModules()` between cases so each test gets a fresh registry.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

interface TestStateModule {
  registerTestState: (
    key: string,
    reader: () => unknown,
  ) => () => void;
  unregisterTestState: (key: string) => void;
  makeCommit: (
    surfaceId: string,
    intent: string,
    patch: unknown,
  ) => { surfaceId: string; intent: string; patch: unknown; at: number };
}

interface AtlasTestApi {
  getState: () => Record<string, unknown>;
  getChartState: (id: string) => unknown;
  getEditorState: (id: string) => unknown;
  getLayoutState: (id: string | null) => unknown;
  getDragState: (surface?: string) => unknown;
  getLastCommit: (surfaceKey: string) => unknown;
  keys: () => string[];
}

/**
 * Single audited type-system boundary for this suite.
 *
 * `@atlas/test-state` is the package whose entire job is to bridge a
 * loosely-typed JS DOM (`window.__atlasTest`) to a typed test API.
 * Verifying that bridge in unit tests requires three escape hatches that
 * have no safer typed expression:
 *
 *   1. Reading `import.meta.env` to stamp DEV=true/false. `ImportMeta`
 *      in tsconfig types `env` as `ImportMetaEnv | undefined` with
 *      readonly DEV — we MUST mutate it before re-importing the SUT.
 *   2. Re-importing `../src/index.ts` after `vi.resetModules()`. The
 *      dynamic import returns `unknown`; we know what we exported.
 *   3. Reading the `window.__atlasTest` property that the SUT installs
 *      onto `globalThis.window` (in the JSDOM/happy-dom env).
 *
 * All three are bona-fide test-harness boundaries; consolidating them
 * here gives the file ONE justified suppression instead of seven.
 */
/* eslint-disable @typescript-eslint/no-unsafe-type-assertion, atlas-widgets/no-double-cast --
   boundary: test-state's job is to bridge a JS global to a typed API;
   verifying that bridge requires controlled type-system escapes. */
function stampMetaEnv(env: Record<string, unknown>): void {
  const meta = import.meta as { env?: Record<string, unknown> };
  meta.env = { ...(meta.env ?? {}), ...env };
}

function clearMetaEnvKey(key: string): void {
  const meta = import.meta as { env?: Record<string, unknown> };
  if (meta.env) delete meta.env[key];
}

async function importSut(): Promise<TestStateModule> {
  vi.resetModules();
  return (await import('../src/index.ts')) as unknown as TestStateModule;
}

function getWindowSlot(): { window?: { __atlasTest?: AtlasTestApi } } {
  return globalThis as unknown as { window?: { __atlasTest?: AtlasTestApi } };
}
/* eslint-enable @typescript-eslint/no-unsafe-type-assertion, atlas-widgets/no-double-cast */

async function loadInDevMode(): Promise<TestStateModule> {
  // Stamp DEV=true onto import.meta.env so the module's gate flips.
  // Vitest evaluates the module at import time; we must do this BEFORE
  // the import resolves.
  stampMetaEnv({ DEV: true });
  return importSut();
}

async function loadInProdMode(): Promise<TestStateModule> {
  stampMetaEnv({ DEV: false });
  return importSut();
}

function getApi(): AtlasTestApi {
  const slot = getWindowSlot();
  if (!slot.window) throw new Error('window not installed in test env');
  const api = slot.window.__atlasTest;
  if (!api) throw new Error('__atlasTest API not installed');
  return api;
}

beforeEach(() => {
  // Reset the window slot so each test starts from a clean install.
  const slot = getWindowSlot();
  if (slot.window) {
    try {
      delete slot.window.__atlasTest;
    } catch {
      Object.defineProperty(slot.window, '__atlasTest', {
        value: undefined,
        configurable: true,
        writable: true,
      });
    }
  }
});

afterEach(() => {
  clearMetaEnvKey('DEV');
  vi.resetModules();
});

describe('registerTestState — DEV mode', () => {
  it('registers a reader, exposes it via getState, and disposer removes it', async () => {
    const mod = await loadInDevMode();
    const dispose = mod.registerTestState('chart:c1', () => ({ rows: 3 }));

    const api = getApi();
    expect(api.getState()['chart:c1']).toEqual({ rows: 3 });

    dispose();
    expect(api.getState()['chart:c1']).toBeUndefined();
  });

  it('registering the same key replaces the previous reader (last-write-wins)', async () => {
    const mod = await loadInDevMode();
    mod.registerTestState('chart:c2', () => ({ v: 'first' }));
    mod.registerTestState('chart:c2', () => ({ v: 'second' }));
    const api = getApi();
    expect(api.getState()['chart:c2']).toEqual({ v: 'second' });
  });

  it('disposer for the *old* registration after re-register does NOT clear the new value', async () => {
    const mod = await loadInDevMode();
    const disposeA = mod.registerTestState('chart:c3', () => ({ v: 'A' }));
    mod.registerTestState('chart:c3', () => ({ v: 'B' }));
    disposeA(); // safe: only deletes if the current reader matches A
    const api = getApi();
    expect(api.getState()['chart:c3']).toEqual({ v: 'B' });
  });

  it('unregisterTestState removes the key explicitly', async () => {
    const mod = await loadInDevMode();
    mod.registerTestState('editor:e1', () => ({ dirty: true }));
    expect(getApi().getState()['editor:e1']).toEqual({ dirty: true });
    mod.unregisterTestState('editor:e1');
    expect(getApi().getState()['editor:e1']).toBeUndefined();
  });

  it('keys() lists every registered key', async () => {
    const mod = await loadInDevMode();
    mod.registerTestState('chart:c1', () => 1);
    mod.registerTestState('editor:e1', () => 2);
    mod.registerTestState('layout', () => 3);
    const keys = getApi().keys().sort();
    expect(keys).toContain('chart:c1');
    expect(keys).toContain('editor:e1');
    expect(keys).toContain('layout');
  });
});

describe('typed accessors — DEV mode', () => {
  it('getChartState routes via "chart:<id>"', async () => {
    const mod = await loadInDevMode();
    mod.registerTestState('chart:weekly', () => ({ ok: true }));
    expect(getApi().getChartState('weekly')).toEqual({ ok: true });
    expect(getApi().getChartState('missing')).toBeNull();
  });

  it('getEditorState routes via "editor:<id>"', async () => {
    const mod = await loadInDevMode();
    mod.registerTestState('editor:doc-1', () => ({ caret: 7 }));
    expect(getApi().getEditorState('doc-1')).toEqual({ caret: 7 });
  });

  it('getLayoutState falls back to "layout" when id is null', async () => {
    const mod = await loadInDevMode();
    mod.registerTestState('layout', () => ({ regions: 2 }));
    expect(getApi().getLayoutState(null)).toEqual({ regions: 2 });
  });

  it('getLayoutState prefers editor:<id> when id is provided and matches', async () => {
    const mod = await loadInDevMode();
    mod.registerTestState('layout', () => ({ src: 'layout' }));
    mod.registerTestState('editor:p1', () => ({ src: 'editor' }));
    expect(getApi().getLayoutState('p1')).toEqual({ src: 'editor' });
  });

  it('getDragState routes via "drag:<surface>" with default "layout"', async () => {
    const mod = await loadInDevMode();
    mod.registerTestState('drag:layout', () => ({ over: 'r1' }));
    expect(getApi().getDragState()).toEqual({ over: 'r1' });
    mod.registerTestState('drag:other', () => ({ over: 'r2' }));
    expect(getApi().getDragState('other')).toEqual({ over: 'r2' });
  });
});

describe('error handling', () => {
  it('getState surfaces a thrown reader as { error: ... } per key', async () => {
    const mod = await loadInDevMode();
    mod.registerTestState('chart:bad', () => {
      throw new Error('reader-failed');
    });
    const snapshot = getApi().getState();
    expect(snapshot['chart:bad']).toEqual({
      error: 'Error: reader-failed',
    });
  });

  it('getLastCommit returns { error: ... } when the reader throws', async () => {
    const mod = await loadInDevMode();
    mod.registerTestState('editor:e1', () => {
      throw new Error('boom');
    });
    const result = getApi().getLastCommit('editor:e1');
    expect(result).toEqual({ error: 'Error: boom' });
  });

  it('getLastCommit returns null when surfaceKey is unknown', async () => {
    const mod = await loadInDevMode();
    // Register at least one reader so the API installs onto window.
    mod.registerTestState('placeholder', () => ({ ok: true }));
    expect(getApi().getLastCommit('chart:none')).toBeNull();
  });

  it('getLastCommit extracts lastCommit from the snapshot', async () => {
    const mod = await loadInDevMode();
    const stamp = { surfaceId: 's', intent: 'i', patch: {}, at: 1 };
    mod.registerTestState('editor:withCommit', () => ({
      lastCommit: stamp,
      other: 'x',
    }));
    expect(getApi().getLastCommit('editor:withCommit')).toEqual(stamp);
  });
});

describe('makeCommit', () => {
  it('builds a commit record with at>=Date.now floor', async () => {
    const mod = await loadInDevMode();
    const before = Date.now();
    const c = mod.makeCommit('s1', 'select', { id: 1 });
    expect(c.surfaceId).toBe('s1');
    expect(c.intent).toBe('select');
    expect(c.patch).toEqual({ id: 1 });
    expect(c.at).toBeGreaterThanOrEqual(before);
  });
});

describe('prod mode (DEV=false)', () => {
  it('registerTestState returns a no-op disposer in prod', async () => {
    const mod = await loadInProdMode();
    const dispose = mod.registerTestState('chart:c1', () => ({ rows: 1 }));
    expect(typeof dispose).toBe('function');
    expect(() => dispose()).not.toThrow();
  });

  it('the prod-mode module register/unregister never throws', async () => {
    // Loose contract: in prod the function is a no-op disposer. The
    // window property is a leaky-global side effect of dev-mode use
    // earlier in the suite, so we don't gate on its identity.
    const mod = await loadInProdMode();
    const dispose = mod.registerTestState('any', () => null);
    expect(typeof dispose).toBe('function');
    expect(() => mod.unregisterTestState('any')).not.toThrow();
    expect(() => dispose()).not.toThrow();
  });

  it('unregisterTestState is a no-op in prod', async () => {
    const mod = await loadInProdMode();
    expect(() => mod.unregisterTestState('any')).not.toThrow();
  });
});
