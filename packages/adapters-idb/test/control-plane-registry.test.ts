import { controlPlaneRegistryContract } from '@atlas/contract-tests';
import { InMemoryControlPlaneRegistry } from '@atlas/adapters-idb';

controlPlaneRegistryContract(async () => new InMemoryControlPlaneRegistry());
