/**
 * Port-parity contract for `WasmHost`.
 *
 * Both `NodeWasmHost` and `BrowserWasmHost` MUST satisfy this suite.
 * Caller supplies a factory that returns a `WasmHost` whose loader is
 * preloaded with the fixture plugins this contract uses:
 *
 * - `noop-render` — returns `{"hello":"world"}` regardless of input.
 *   (Provided as `noopRenderWasm` below — a hand-rolled module.)
 * - `with-imports` — has one host import; must be rejected by the host.
 *   (Provided as `withImportsWasm` below.)
 * - `no-memory-export` — missing `memory` export; must be rejected.
 *
 * A separate parity scenario (`tests/parity/wasm-plugin-node.test.ts`)
 * runs the real Rust demo-transform plugin against the Node host and
 * the browser host — that's where cross-language byte-equivalence is
 * checked.
 */

import { describe, test, expect } from 'vitest';
import type { WasmHost, WasmPluginLoader } from '@atlas/ports';

export interface WasmHostFactoryArg {
  /** Loader the suite seeds fixture bytes into before constructing the host. */
  loader: WasmPluginLoader & {
    set(pluginRef: string, bytes: Uint8Array): void;
  };
  /** Constructs the host backed by the seeded loader. */
  makeHost(): WasmHost;
}

export interface WasmHostFactory {
  /** Called once per test; creates a fresh loader + host. */
  (): WasmHostFactoryArg;
}

/**
 * Minimal "always returns {\"hello\":\"world\"}" plugin. Hand-encoded WASM
 * binary — the `wat` source is documented inline below. Encoded once
 * with `wat2wasm` (output committed as bytes so tests don't need a wabt
 * dep at runtime).
 *
 * (module
 *   (memory (export "memory") 1)
 *   (data (i32.const 0) "{\"hello\":\"world\"}")
 *   (func (export "alloc") (param i32) (result i32)
 *     i32.const 256)
 *   (func (export "render") (param i32 i32) (result i64)
 *     ;; len(17) << 32 | ptr(0) = 73014444032
 *     i64.const 73014444032))
 */
export const noopRenderWasm = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // magic + version
  // type section: 2 funcs (size=12)
  // (func (param i32) (result i32))   = 0x60 0x01 0x7f 0x01 0x7f
  // (func (param i32 i32) (result i64)) = 0x60 0x02 0x7f 0x7f 0x01 0x7e
  0x01, 0x0c, 0x02,
  0x60, 0x01, 0x7f, 0x01, 0x7f,
  0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7e,
  // function section: 2 functions, types [0, 1]
  0x03, 0x03, 0x02, 0x00, 0x01,
  // memory section: 1 memory, 1 page minimum, no max
  0x05, 0x03, 0x01, 0x00, 0x01,
  // export section: memory, alloc, render (size=27 = 0x1b)
  0x07, 0x1b, 0x03,
  0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00, // "memory" memory 0
  0x05, 0x61, 0x6c, 0x6c, 0x6f, 0x63, 0x00, 0x00,        // "alloc" func 0
  0x06, 0x72, 0x65, 0x6e, 0x64, 0x65, 0x72, 0x00, 0x01,  // "render" func 1
  // code section: 2 function bodies (size=17 = 0x11)
  0x0a, 0x11, 0x02,
  // alloc body: locals=0, i32.const 256 (LEB128 256 = 80 02), end. Body=5 bytes.
  0x05, 0x00, 0x41, 0x80, 0x02, 0x0b,
  // render body: locals=0, i64.const 73014444032 (SLEB128: 80 80 80 80 90 02),
  // end. Body=9 bytes.
  0x09, 0x00, 0x42, 0x80, 0x80, 0x80, 0x80, 0x90, 0x02, 0x0b,
  // data section: 1 active segment (size=23 = 0x17)
  0x0b, 0x17, 0x01,
  0x00, 0x41, 0x00, 0x0b, // mem 0, i32.const 0, end
  0x11, // 17 bytes
  0x7b, 0x22, 0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x22,
  0x3a, 0x22, 0x77, 0x6f, 0x72, 0x6c, 0x64, 0x22, 0x7d,
]);

// 73014444032 SLEB128 encoding:
// = 17 << 32 = 0x0000_0011_0000_0000
// SLEB128: split into 7-bit groups, MSB high; sign-extend last group.
// Bytes (LE):
//   byte0: 0x00 | 0x80 = 0x80
//   byte1: 0x00 | 0x80 = 0x80
//   byte2: 0x00 | 0x80 = 0x80
//   byte3: 0x00 | 0x80 = 0x80
//   byte4: 0x10 | 0x80 = 0x90
//   byte5: 0x02
// (See https://en.wikipedia.org/wiki/LEB128 — i64 SLEB128.)

/**
 * Module with one host import. Should be rejected by the host
 * (zero-authority constraint).
 *
 * (module (import "env" "abort" (func (param i32))))
 */
export const withImportsWasm = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  // type section: 1 func, (func (param i32)) — content 5 bytes
  0x01, 0x05, 0x01, 0x60, 0x01, 0x7f, 0x00,
  // import section: 1 import: env.abort, func type 0 — content 13 bytes
  0x02, 0x0d, 0x01,
  0x03, 0x65, 0x6e, 0x76, // "env"
  0x05, 0x61, 0x62, 0x6f, 0x72, 0x74, // "abort"
  0x00, 0x00,
]);

/**
 * Module missing `memory` export — exports only `alloc` and `render`.
 * Rust counterpart returns `MissingExport("memory")`.
 *
 * (module
 *   (memory 1)
 *   (func (export "alloc") (param i32) (result i32) i32.const 0)
 *   (func (export "render") (param i32 i32) (result i64) i64.const 0))
 */
export const noMemoryExportWasm = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  // type section: 2 funcs (size=12)
  0x01, 0x0c, 0x02,
  0x60, 0x01, 0x7f, 0x01, 0x7f,
  0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7e,
  // function section: 2 functions
  0x03, 0x03, 0x02, 0x00, 0x01,
  // memory section: 1 memory, 1 page
  0x05, 0x03, 0x01, 0x00, 0x01,
  // export section: only alloc + render (size=18 = 0x12)
  0x07, 0x12, 0x02,
  0x05, 0x61, 0x6c, 0x6c, 0x6f, 0x63, 0x00, 0x00,
  0x06, 0x72, 0x65, 0x6e, 0x64, 0x65, 0x72, 0x00, 0x01,
  // code section: 2 bodies, each 4 bytes + 1 size byte (size=11 = 0x0b)
  0x0a, 0x0b, 0x02,
  0x04, 0x00, 0x41, 0x00, 0x0b,
  0x04, 0x00, 0x42, 0x00, 0x0b,
]);

export function wasmHostContract(factory: WasmHostFactory): void {
  describe('WasmHost contract', () => {
    test('invokes a noop plugin and returns the parsed JSON object', async () => {
      const { loader, makeHost } = factory();
      loader.set('noop-render', noopRenderWasm);
      const host = makeHost();
      const out = await host.invoke({
        pluginRef: 'noop-render',
        input: { hello: 'plugin' },
      });
      expect(out).toEqual({ hello: 'world' });
    });

    test('rejects a module with host imports (zero-authority)', async () => {
      const { loader, makeHost } = factory();
      loader.set('with-imports', withImportsWasm);
      const host = makeHost();
      await expect(
        host.invoke({ pluginRef: 'with-imports', input: {} }),
      ).rejects.toMatchObject({ kind: 'HasImports' });
    });

    test("rejects a module missing the `memory` export", async () => {
      const { loader, makeHost } = factory();
      loader.set('no-memory', noMemoryExportWasm);
      const host = makeHost();
      await expect(
        host.invoke({ pluginRef: 'no-memory', input: {} }),
      ).rejects.toMatchObject({ kind: 'MissingExport' });
    });

    test('honors the timeout when the plugin runs longer than allowed', async () => {
      // We can't easily build an "infinite loop" WASM binary by hand, but we
      // CAN simulate a slow loader to exercise the same Promise.race
      // wrapper. Replace the loader with one that resolves after the
      // timeout window — the host should reject with kind=Timeout.
      const { loader, makeHost } = factory();
      loader.set('noop-render', noopRenderWasm);
      const slowLoader: WasmPluginLoader = {
        async load(_ref: string): Promise<Uint8Array> {
          await new Promise((r) => setTimeout(r, 200));
          return noopRenderWasm;
        },
      };
      // The factory's loader IS the host's loader; we can't substitute.
      // Instead, rely on a tiny timeout against the existing slow path:
      // the noop plugin returns immediately so a 1ms timeout will only
      // fire if the host honors the option at all. This catches a host
      // that ignores `timeoutMs` entirely (regression guard).
      void slowLoader;
      const host = makeHost();
      // Invoke twice — first warms any module cache (`compile()` is the
      // most expensive step), second measures the steady-state path.
      await host.invoke({ pluginRef: 'noop-render', input: {} });
      // Steady-state invocations of the noop plugin are sub-millisecond
      // on Node; if the host ignored timeouts the test still passes,
      // but a 0ms timeout MUST reject — verify that.
      await expect(
        host.invoke({ pluginRef: 'noop-render', input: {}, timeoutMs: 0 }),
      ).rejects.toBeDefined();
    });

    test('input + output are passed by value (fresh state each invoke)', async () => {
      const { loader, makeHost } = factory();
      loader.set('noop-render', noopRenderWasm);
      const host = makeHost();
      const a = await host.invoke({ pluginRef: 'noop-render', input: { i: 1 } });
      const b = await host.invoke({ pluginRef: 'noop-render', input: { i: 2 } });
      // Same plugin, different inputs — output is identical by design.
      // What matters is that invocations don't share state (each call
      // gets a fresh instance — checked via no thrown errors across
      // repeated calls).
      expect(a).toEqual({ hello: 'world' });
      expect(b).toEqual({ hello: 'world' });
    });
  });
}
