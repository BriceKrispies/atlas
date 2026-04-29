import { policyEngineContract } from '@atlas/contract-tests';
import { StubPolicyEngine } from '@atlas/adapters-policy-stub';

policyEngineContract(async () => new StubPolicyEngine());
