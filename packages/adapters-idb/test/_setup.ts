// fake-indexeddb wires window.indexedDB / IDBKeyRange globals so the IDB
// adapters can be exercised in Node. It's safe to import unconditionally
// because vitest handles module dedup.
import 'fake-indexeddb/auto';
import { openAtlasIdb, type IdbDb } from '@atlas/adapters-idb';

let counter = 0;

export async function freshDb(): Promise<IdbDb> {
  counter++;
  const name = `contract-${counter}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
  return openAtlasIdb(name);
}
