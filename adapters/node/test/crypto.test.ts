import { cryptoContract } from '@atlas/contract-tests';
import { NodeCrypto } from '../src/index.ts';
cryptoContract(async function () {
    return new NodeCrypto();
});
