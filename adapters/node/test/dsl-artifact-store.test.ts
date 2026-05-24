/**
 * Cross-adapter contract test for `PostgresDslArtifactStore`. Driven by
 * `dslArtifactStoreContract` from `@atlas/contract-tests`. The suite is
 * silently skipped when `TEST_TENANT_DB_URL` is unset, matching the rest
 * of the @atlas/adapter-node test suite (see `_setup.ts`).
 *
 * Per-test cleanup: each `makeStore()` call drops the `_atlas_dsl_*`
 * tables for the kinds the suite uses, so a fresh adapter starts from
 * "no kind registered" — exercising the lazy-bootstrap path on every
 * test rather than once. This also lets the suite's "reads against a
 * never-bootstrapped kind return null/empty" assertion fire honestly.
 */
import { dslArtifactStoreContract } from '@atlas/contract-tests';
import type { DslArtifactStore } from '@atlas/ports';
import { PostgresDslArtifactStore } from '../src/index.ts';
import { freshSql, HAS_DB } from './_setup.ts';

// TEST_TENANT_DB_URL not set — DSL artifact store contract suite registers nothing.
if (HAS_DB) {
  dslArtifactStoreContract(async function makeStore(): Promise<DslArtifactStore> {
    const sql = await freshSql();
    // Drop the kinds the contract suite touches so each test starts from
    // a never-bootstrapped state. Idempotent — IF EXISTS guards.
    await sql.unsafe(`DROP TABLE IF EXISTS public._atlas_dsl_expression CASCADE`);
    await sql.unsafe(`DROP TABLE IF EXISTS public._atlas_dsl_expression_versions CASCADE`);
    await sql.unsafe(`DROP TABLE IF EXISTS public._atlas_dsl_formula CASCADE`);
    await sql.unsafe(`DROP TABLE IF EXISTS public._atlas_dsl_formula_versions CASCADE`);
    return new PostgresDslArtifactStore(sql);
  });
}
