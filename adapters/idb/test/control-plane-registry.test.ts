import { controlPlaneRegistryContract } from '@atlas/contract-tests';
import { InMemoryControlPlaneRegistry } from '@atlas/adapter-idb';

controlPlaneRegistryContract(async () => new InMemoryControlPlaneRegistry());
