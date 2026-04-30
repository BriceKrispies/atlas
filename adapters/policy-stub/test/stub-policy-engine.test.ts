import { policyEngineContract } from '@atlas/contract-tests';
import { StubPolicyEngine } from '@atlas/adapter-policy-stub';

policyEngineContract(async () => new StubPolicyEngine());
