import { describe } from 'vitest';
import type { ControlPlaneRegistry } from '@atlas/ports';

export function controlPlaneRegistryContract(
  _makeRegistry: () => Promise<ControlPlaneRegistry>,
): void {
  describe.skip('ControlPlaneRegistry contract (skeleton — bodies arrive in Chunk 2)', () => {
    // hasAction returns true for known action
    // getAction returns null for unknown action
    // getSchemaValidator returns a working validator for known schema
    // getSchemaValidator returns null for unknown schema
  });
}
