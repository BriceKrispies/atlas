/**
 * Self-test for the I16 schema-mutation-scope property ("test the test").
 *
 * @spec: specs/crosscut/testing.md#§6.3-property-test
 * @spec: specs/architecture.md#i16-schema-mutation-scope
 */
import { describe, test } from '@atlas/test';
import {
  runProperty,
  scopedMutateSchema,
  ALLOWED_DDL,
  type World,
  type SchemaMutation,
  type MutationResult,
} from './i16-schema-scope.ts';
import {
  expectPropertyToCatchViolation,
  expectPropertyToHold,
} from './_self-test.ts';

/**
 * BROKEN: honors the caller's `requestedDb` instead of pinning to the
 * issuing tenant. A mutation can name `control_plane` or a sibling tenant's
 * db and have it applied — the cross-tenant blast radius I16 forbids.
 */
function unscopedMutateSchema(world: World, mutation: SchemaMutation): MutationResult {
  if (!(ALLOWED_DDL as readonly string[]).includes(mutation.op)) {
    return { applied: false, rejected: 'FORBIDDEN_DDL' };
  }
  const target = mutation.requestedDb; // <-- the bug: trusts the request
  const tables = world.get(target) ?? new Set<string>();
  if (mutation.op === 'DROP TABLE') tables.delete(mutation.table);
  else tables.add(mutation.table);
  world.set(target, tables);
  return { applied: true };
}

describe('I16 schema-mutation-scope property', function () {
  test('holds when mutations are pinned to the issuing tenant db', async function () {
    await expectPropertyToHold(() =>
      runProperty({ mutateSchema: scopedMutateSchema }),
    );
  });

  test('catches + shrinks a mutator that honors a caller-supplied target db', async function () {
    await expectPropertyToCatchViolation(() =>
      runProperty({ mutateSchema: unscopedMutateSchema }),
    );
  });
});
