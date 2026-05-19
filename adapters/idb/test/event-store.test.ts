import { eventStoreContract } from '@atlas/contract-tests';
import { IdbEventStore } from '@atlas/adapter-idb';
import { freshDb } from './_setup.ts';
eventStoreContract(async function () {
    const db = await freshDb();
    return new IdbEventStore(db);
});
