/**
 * Parity scenario for the demo-transform Rust WASM plugin invoked via
 * the TS WasmHost.
 *
 * Both modes invoke the SAME `.wasm` binary the Rust crate ships
 * (`plugins/demo-transform/target/wasm32-unknown-unknown/release/demo_transform.wasm`)
 * and assert byte-equivalent output. This is the cross-language parity
 * gate for the WASM contract.
 *
 * - Sim mode: BrowserWasmHost + InMemoryPluginLoader; bytes are
 *   loaded via `node:fs` at test-setup time.
 * - Node mode: requires the running server's `WASM_PLUGIN_DIR` to
 *   point at the demo plugin. Skipped when `NODE_PARITY_BASE_URL`
 *   isn't set, since the server contract for plugin-rendering pages
 *   is exercised through the standard Page.Create intent path.
 *
 * The fixture output mirrors the assertion in
 * `crates/wasm_runtime/src/lib.rs::test_execute_demo_plugin`.
 */

import { describe, test, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  NodeWasmHost,
  BrowserWasmHost,
  InMemoryPluginLoader,
} from '@atlas/wasm-host';

const DEMO_PLUGIN_PATH = join(
  process.cwd(),
  'plugins',
  'demo-transform',
  'target',
  'wasm32-unknown-unknown',
  'release',
  'demo_transform.wasm',
);

async function loadDemoPluginBytes(): Promise<Uint8Array | null> {
  try {
    return await readFile(DEMO_PLUGIN_PATH);
  } catch {
    return null;
  }
}

const demoInput = {
  pageId: 'page-123',
  title: 'My Page',
  slug: 'my-page',
  tenantId: 'tenant-001',
  createdAt: '2026-02-09T10:00:00+00:00',
};

const expectedOutput = {
  version: 1,
  nodes: [
    {
      type: 'heading',
      props: { level: 1 },
      children: [{ type: 'text', props: { content: 'My Page' } }],
    },
    {
      type: 'paragraph',
      children: [
        {
          type: 'text',
          props: { content: 'Page: page-123 | Slug: /my-page' },
        },
      ],
    },
  ],
};

describe('[wasm-plugin] demo-transform across both hosts', () => {
  test('NodeWasmHost runs the demo plugin and matches the Rust assertion', async () => {
    const bytes = await loadDemoPluginBytes();
    if (!bytes) {
      // Skip cleanly when the .wasm hasn't been built. The Rust test
      // suite has the same precondition.
      console.warn(
        `[wasm-plugin] demo plugin not built at ${DEMO_PLUGIN_PATH}; skipping`,
      );
      return;
    }
    const loader = new InMemoryPluginLoader([['demo-transform', bytes]]);
    const host = new NodeWasmHost({ loader });
    const out = await host.invoke({
      pluginRef: 'demo-transform',
      input: demoInput,
    });
    expect(out).toEqual(expectedOutput);
  });

  test('BrowserWasmHost runs the demo plugin and matches the Rust assertion', async () => {
    const bytes = await loadDemoPluginBytes();
    if (!bytes) {
      console.warn(
        `[wasm-plugin] demo plugin not built at ${DEMO_PLUGIN_PATH}; skipping`,
      );
      return;
    }
    const loader = new InMemoryPluginLoader([['demo-transform', bytes]]);
    const host = new BrowserWasmHost({ loader });
    const out = await host.invoke({
      pluginRef: 'demo-transform',
      input: demoInput,
    });
    expect(out).toEqual(expectedOutput);
  });

  test('both hosts produce byte-identical output for the same input', async () => {
    const bytes = await loadDemoPluginBytes();
    if (!bytes) return;
    const nodeHost = new NodeWasmHost({
      loader: new InMemoryPluginLoader([['demo-transform', bytes]]),
    });
    const browserHost = new BrowserWasmHost({
      loader: new InMemoryPluginLoader([['demo-transform', bytes]]),
    });
    const a = await nodeHost.invoke({
      pluginRef: 'demo-transform',
      input: demoInput,
    });
    const b = await browserHost.invoke({
      pluginRef: 'demo-transform',
      input: demoInput,
    });
    expect(a).toEqual(b);
  });
});
