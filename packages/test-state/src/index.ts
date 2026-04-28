/**
 * @atlas/test-state — dev-only registry that exposes interaction state to
 * Playwright via `window.__atlasTest`.
 *
 * Surfaces call `registerTestState(key, reader)` with a key like
 * `chart:<id>`, `editor:<id>`, `layout`, `drag:layout`. The reader is a
 * zero-arg function returning a JSON-safe snapshot of the surface's
 * externally-observable state, including `lastCommit` (see
 * specs/frontend/interaction-contracts.md).
 *
 * In production builds `import.meta.env.DEV` is false, so the registry map
 * is never allocated and every call is a no-op that bundlers can strip.
 */

export type TestStateReader = () => unknown;

export interface CommitRecord {
  surfaceId: string;
  intent: string;
  patch: unknown;
  at: number;
}

export interface AtlasTestApi {
  getState(): Record<string, unknown>;
  getChartState(id: string): unknown;
  getEditorState(id: string): unknown;
  getLayoutState(id: string | null): unknown;
  getDragState(surface?: string): unknown;
  getLastCommit(surfaceKey: string): unknown;
  keys(): string[];
}

declare global {
  interface Window {
    __atlasTest?: AtlasTestApi;
  }
}

// Vite replaces `import.meta.env.DEV` with a boolean literal at build time.
// The outer guard lets this module be imported by plain Node tools
// (dry-run scripts, unit tests) where `import.meta.env` is undefined.
// In a Vite prod build the whole expression folds to `false`.
const metaEnv: ImportMetaEnv | undefined = (import.meta as { env?: ImportMetaEnv }).env;
const DEV_MODE: boolean = !!(metaEnv && metaEnv.DEV === true);

const readers: Map<string, TestStateReader> | null = DEV_MODE ? new Map() : null;

/**
 * Register a reader for a state key. Returns an unregister function.
 * In prod this is a no-op.
 */
export function registerTestState(key: string, reader: TestStateReader): () => void {
  if (!DEV_MODE || !readers) return () => {};
  readers.set(key, reader);
  ensureInstalled();
  return () => {
    if (readers.get(key) === reader) readers.delete(key);
  };
}

/**
 * Explicitly unregister a key. Prefer the disposer returned by
 * registerTestState.
 */
export function unregisterTestState(key: string): void {
  if (!DEV_MODE || !readers) return;
  readers.delete(key);
}

let installed = false;

function ensureInstalled(): void {
  if (installed || !DEV_MODE || !readers) return;
  if (typeof window === 'undefined') return;

  const activeReaders = readers;

  const api: AtlasTestApi = {
    getState(): Record<string, unknown> {
      const out: Record<string, unknown> = {};
      for (const [key, reader] of activeReaders) {
        try {
          out[key] = reader();
        } catch (err) {
          out[key] = { error: String(err) };
        }
      }
      return out;
    },

    getChartState(id: string): unknown {
      const r = activeReaders.get(`chart:${id}`);
      return r ? r() : null;
    },

    getEditorState(id: string): unknown {
      const r = activeReaders.get(`editor:${id}`);
      return r ? r() : null;
    },

    getLayoutState(id: string | null): unknown {
      const r = id
        ? (activeReaders.get(`editor:${id}`) ?? activeReaders.get('layout'))
        : activeReaders.get('layout');
      return r ? r() : null;
    },

    getDragState(surface: string = 'layout'): unknown {
      const r = activeReaders.get(`drag:${surface}`);
      return r ? r() : null;
    },

    getLastCommit(surfaceKey: string): unknown {
      const r = activeReaders.get(surfaceKey);
      if (!r) return null;
      try {
        const snapshot = r();
        if (snapshot && typeof snapshot === 'object' && 'lastCommit' in snapshot) {
          return (snapshot as { lastCommit?: unknown }).lastCommit ?? null;
        }
        return null;
      } catch {
        return null;
      }
    },

    keys(): string[] {
      return [...activeReaders.keys()];
    },
  };

  Object.defineProperty(window, '__atlasTest', {
    value: api,
    writable: false,
    configurable: true,
  });
  installed = true;
}

/**
 * Build a commit record. Surfaces call this after mutating state so the
 * reader's `lastCommit` field matches the interaction-contracts.md envelope.
 */
export function makeCommit(surfaceId: string, intent: string, patch: unknown): CommitRecord {
  return { surfaceId, intent, patch, at: Date.now() };
}
