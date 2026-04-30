import { projectionStoreContract } from '@atlas/contract-tests';
import { IdbProjectionStore } from '@atlas/adapter-idb';
import { freshDb } from './_setup.ts';

projectionStoreContract(async () => {
  const db = await freshDb();
  return new IdbProjectionStore(db);
});
