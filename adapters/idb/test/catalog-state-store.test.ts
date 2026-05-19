import { catalogStateStoreContract } from '@atlas/contract-tests';
import { IdbCatalogStateStore } from '@atlas/adapter-idb';
import { freshDb } from './_setup.ts';
catalogStateStoreContract(async function () {
    const db = await freshDb();
    return new IdbCatalogStateStore(db);
});
