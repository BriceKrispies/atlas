/**
 * Contract suite for the Node WasmHost adapter.
 */

import { wasmHostContract } from '@atlas/contract-tests';
import { NodeWasmHost, InMemoryPluginLoader } from '@atlas/wasm-host';

wasmHostContract(() => {
  const loader = new InMemoryPluginLoader();
  return {
    loader,
    makeHost: () => new NodeWasmHost({ loader }),
  };
});
