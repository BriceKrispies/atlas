import { eventStoreContract } from '@atlas/contract-tests';
import { IdbEventStore } from '@atlas/adapters-idb';
import { freshDb } from './_setup.ts';

eventStoreContract(async () => {
  const db = await freshDb();
  return new IdbEventStore(db);
});
