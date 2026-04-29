/**
 * Plugin loaders.
 *
 * The Rust counterpart resolves `pluginRef` to
 * `${WASM_PLUGIN_DIR}/${pluginRef}/target/wasm32-unknown-unknown/release/${snake_case(pluginRef)}.wasm`.
 * We mirror that lookup in the Node loader so the demo plugin runs
 * unchanged in either host.
 *
 * - `FilesystemPluginLoader`: Node-only. Reads bytes from disk, caches
 *   them per-process so the same plugin doesn't pay the I/O hit twice.
 * - `InMemoryPluginLoader`: works in any environment. Holds raw bytes
 *   passed in by the caller. Browser sim mode uses this — bytes are
 *   prefetched (e.g. via `fetch()` against a static asset) and seeded
 *   into the loader at boot.
 */

import type { WasmPluginLoader } from '@atlas/ports';
import { WasmHostError } from './errors.ts';

/** Convert kebab-case `pluginRef` to the Cargo-emitted snake_case file. */
function pluginRefToFileName(pluginRef: string): string {
  return pluginRef.replace(/-/g, '_');
}

export interface FilesystemPluginLoaderOptions {
  /** Defaults to `WASM_PLUGIN_DIR` env var; failing that, `./plugins`. */
  pluginDir?: string;
}

/**
 * Node loader. Resolves `pluginRef` to
 * `${pluginDir}/${pluginRef}/target/wasm32-unknown-unknown/release/${snake_case(pluginRef)}.wasm`.
 */
export class FilesystemPluginLoader implements WasmPluginLoader {
  readonly #pluginDir: string;
  readonly #cache = new Map<string, Uint8Array>();

  constructor(options: FilesystemPluginLoaderOptions = {}) {
    const explicit = options.pluginDir ?? process.env['WASM_PLUGIN_DIR'];
    this.#pluginDir = explicit ?? './plugins';
  }

  async load(pluginRef: string): Promise<Uint8Array> {
    const cached = this.#cache.get(pluginRef);
    if (cached) return cached;
    const fileName = `${pluginRefToFileName(pluginRef)}.wasm`;
    // Defer node:fs/path so non-Node hosts can import this module
    // without a hard error (e.g. when a vitest browser runner picks up
    // the loader file by mistake). The constructor already requires
    // `process.env`, so practical use is Node-only — this just keeps
    // the import graph clean.
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const path = join(
      this.#pluginDir,
      pluginRef,
      'target',
      'wasm32-unknown-unknown',
      'release',
      fileName,
    );
    let bytes: Uint8Array;
    try {
      bytes = await readFile(path);
    } catch (e) {
      throw new WasmHostError(
        'LoadFailed',
        `failed to read plugin '${pluginRef}' at ${path}: ${(e as Error).message}`,
      );
    }
    this.#cache.set(pluginRef, bytes);
    return bytes;
  }
}

/**
 * Environment-agnostic loader backed by an in-memory map. Browser sim
 * uses this; tests use it for fixture plugins.
 */
export class InMemoryPluginLoader implements WasmPluginLoader {
  readonly #plugins: Map<string, Uint8Array>;
  constructor(plugins?: Iterable<readonly [string, Uint8Array]>) {
    this.#plugins = new Map(plugins);
  }
  set(pluginRef: string, bytes: Uint8Array): void {
    this.#plugins.set(pluginRef, bytes);
  }
  async load(pluginRef: string): Promise<Uint8Array> {
    const v = this.#plugins.get(pluginRef);
    if (!v) {
      throw new WasmHostError(
        'LoadFailed',
        `plugin '${pluginRef}' not registered with the in-memory loader`,
      );
    }
    return v;
  }
}
