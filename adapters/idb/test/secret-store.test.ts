import { secretStoreContract } from '@atlas/contract-tests';
import { InMemorySecretStore } from '@atlas/adapter-idb';

secretStoreContract(async (seed) => new InMemorySecretStore(seed));
