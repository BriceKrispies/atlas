import { compressionContract } from '@atlas/contract-tests';
import { NodeCompression } from '../src/index.ts';

compressionContract(async () => new NodeCompression());
