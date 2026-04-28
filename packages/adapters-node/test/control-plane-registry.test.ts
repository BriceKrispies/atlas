import { controlPlaneRegistryContract } from '@atlas/contract-tests';
import { PostgresControlPlaneRegistry } from '../src/index.ts';

// The registry is read-only over bundled manifests + ajv schemas. It does
// NOT need a Postgres connection for any of the three port methods, so
// this suite always runs (matching the IDB `InMemoryControlPlaneRegistry`
// suite, which also runs unconditionally).
controlPlaneRegistryContract(async () => new PostgresControlPlaneRegistry());
