import { secretStoreContract } from '@atlas/contract-tests';
import { EnvSecretStore } from '../src/index.ts';
secretStoreContract(async function (seed) {
    return new EnvSecretStore(seed);
});
