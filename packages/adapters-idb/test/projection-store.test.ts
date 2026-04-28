import { projectionStoreContract } from '@atlas/contract-tests';
import { IdbProjectionStore } from '@atlas/adapters-idb';
import { freshDb } from './_setup.ts';

projectionStoreContract(async () => {
  const db = await freshDb();
  return new IdbProjectionStore(db);
});
