import { secretStoreContract } from '@atlas/contract-tests';
import { EnvSecretStore } from '../src/index.ts';

secretStoreContract(async (seed) => new EnvSecretStore(seed));
