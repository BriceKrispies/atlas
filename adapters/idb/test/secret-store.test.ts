import { secretStoreContract } from '@atlas/contract-tests';
import { InMemorySecretStore } from '@atlas/adapter-idb';
secretStoreContract(async function (seed) {
    return new InMemorySecretStore(seed);
});
