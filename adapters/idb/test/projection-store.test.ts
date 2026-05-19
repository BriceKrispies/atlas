import { projectionStoreContract } from '@atlas/contract-tests';
import { IdbProjectionStore } from '@atlas/adapter-idb';
import { freshDb } from './_setup.ts';
projectionStoreContract(async function () {
    const db = await freshDb();
    return new IdbProjectionStore(db);
});
