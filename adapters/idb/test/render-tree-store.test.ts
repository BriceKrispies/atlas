import { renderTreeStoreContract } from '@atlas/contract-tests';
import { IdbRenderTreeStore } from '@atlas/adapter-idb';
import { freshDb } from './_setup.ts';

renderTreeStoreContract(async () => {
  const db = await freshDb();
  return new IdbRenderTreeStore(db);
});
