import { compressionContract } from '@atlas/contract-tests';
import { NodeCompression } from '../src/index.ts';
compressionContract(async function () {
    return new NodeCompression();
});
