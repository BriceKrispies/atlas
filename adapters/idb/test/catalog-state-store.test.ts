import { catalogStateStoreContract } from '@atlas/contract-tests';
import { IdbCatalogStateStore } from '@atlas/adapter-idb';
import { freshDb } from './_setup.ts';

catalogStateStoreContract(async () => {
  const db = await freshDb();
  return new IdbCatalogStateStore(db);
});
