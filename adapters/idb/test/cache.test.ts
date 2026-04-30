import { cacheContract } from '@atlas/contract-tests';
import { IdbCache } from '@atlas/adapter-idb';
import { freshDb } from './_setup.ts';

cacheContract(async () => {
  const db = await freshDb();
  return new IdbCache(db);
});
