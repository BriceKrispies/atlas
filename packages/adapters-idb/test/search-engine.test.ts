import { searchEngineContract } from '@atlas/contract-tests';
import { IdbSearchEngine } from '@atlas/adapters-idb';
import { freshDb } from './_setup.ts';

searchEngineContract(async () => {
  const db = await freshDb();
  return new IdbSearchEngine(db);
});
