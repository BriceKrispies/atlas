/**
 * Contract suite for the browser-mode (sim) WasmHost adapter.
 *
 * Exercised via Vitest's Node runner because both adapters share the
 * native `WebAssembly` API; the browser variant differs only in NOT
 * doing any worker isolation. The contract is identical so we run the
 * same suite against the same fixtures.
 */

import { wasmHostContract } from '@atlas/contract-tests';
import { BrowserWasmHost, InMemoryPluginLoader } from '@atlas/wasm-host';

wasmHostContract(() => {
  const loader = new InMemoryPluginLoader();
  return {
    loader,
    makeHost: () => new BrowserWasmHost({ loader }),
  };
});
