import { compressionContract } from '@atlas/contract-tests';
import { WebCompression } from '@atlas/adapter-idb';

compressionContract(async () => new WebCompression());
