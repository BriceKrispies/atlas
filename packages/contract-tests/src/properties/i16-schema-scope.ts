/**
 * I16 — Schema-Mutation Scope (property).
 *
 * @spec: specs/architecture.md#i16-schema-mutation-scope
 * @spec: specs/crosscut/testing.md#§2.2-invariant-layer
 *
 * Invariant (universally quantified): for every tenant DDL, the affected
 * tables are exactly within the issuing tenant's database (testing.md
 * §2.2), and the operation is on the constrained DDL allowlist (I16). A
 * mutation MUST NOT reach the control-plane DB, another tenant's DB, or
 * execute a forbidden operation.
 *
 * No `SchemaMutation` port exists yet, so the seam is the function under
 * test: `adapters.mutateSchema(world, mutation)`. `world` is a snapshot of
 * every database (`atlas_t_<tenant>` per ADR 0005, plus the control plane);
 * the property diffs the world before/after and asserts:
 *
 *   - an ALLOWED op touches ONLY `atlas_t_<issuingTenant>`, and
 *   - a FORBIDDEN op (or one targeting another db) is rejected and changes
 *     NOTHING.
 *
 * A correct implementation pins the target database to the issuing tenant
 * and rejects off-allowlist DDL; a broken one lets the mutation specify an
 * arbitrary target db (cross-tenant blast radius — the I16 violation).
 */
import fc from 'fast-check';
import { runConfig } from './_harness.ts';

/** The constrained DDL allowlist (I16 semantics). */
export const ALLOWED_DDL = [
  'CREATE TABLE',
  'ADD COLUMN',
  'CREATE INDEX',
  'ALTER COLUMN TYPE',
  'DROP COLUMN',
  'DROP TABLE',
] as const;
export type AllowedOp = (typeof ALLOWED_DDL)[number];

/** Off-allowlist DDL the platform MUST refuse. */
export const FORBIDDEN_DDL = [
  'CREATE DATABASE',
  'DROP DATABASE',
  'CREATE EXTENSION',
  'GRANT',
  'REVOKE',
  'CREATE TRIGGER',
] as const;

/** A world = every database keyed by name, each a set of table names. */
export type World = Map<string, Set<string>>;

export interface SchemaMutation {
  issuingTenant: string;
  /** The db the mutation requests to target (a broken impl may honor this). */
  requestedDb: string;
  op: string;
  table: string;
}

export interface MutationResult {
  applied: boolean;
  rejected?: 'FORBIDDEN_DDL' | 'OUT_OF_SCOPE';
}

export interface I16Adapters {
  mutateSchema: (world: World, mutation: SchemaMutation) => MutationResult;
}

export function tenantDbName(tenantId: string): string {
  return `atlas_t_${tenantId}`;
}

/** Reference correct implementation: pin target to issuer, allowlist-gate. */
export function scopedMutateSchema(world: World, mutation: SchemaMutation): MutationResult {
  if (!(ALLOWED_DDL as readonly string[]).includes(mutation.op)) {
    return { applied: false, rejected: 'FORBIDDEN_DDL' };
  }
  // The target is ALWAYS the issuing tenant's db — the requestedDb is
  // ignored. This is the scope boundary.
  const target = tenantDbName(mutation.issuingTenant);
  const tables = world.get(target) ?? new Set<string>();
  if (mutation.op === 'DROP TABLE') tables.delete(mutation.table);
  else tables.add(mutation.table);
  world.set(target, tables);
  return { applied: true };
}

function snapshot(world: World): string {
  return JSON.stringify(
    [...world.entries()]
      .map(([db, tables]) => [db, [...tables].sort()] as const)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

const mutationArb: fc.Arbitrary<SchemaMutation> = fc.record({
  issuingTenant: fc.constantFrom('t1', 't2'),
  // A malicious/buggy caller may request the control plane or a sibling db.
  requestedDb: fc.constantFrom('atlas_t_t1', 'atlas_t_t2', 'control_plane'),
  op: fc.constantFrom(
    ...ALLOWED_DDL,
    ...FORBIDDEN_DDL,
  ),
  table: fc.constantFrom('orders', 'customers', 'widgets'),
});

const mutationsArb = fc.array(mutationArb, { minLength: 1, maxLength: 12 });

export function runProperty(adapters: I16Adapters): Promise<void> {
  return fc.assert(
    fc.asyncProperty(mutationsArb, async function (mutations) {
      const tenants = ['t1', 't2'];
      const controlPlaneTables = new Set(['_atlas_migrations', 'tenants']);

      for (const m of mutations) {
        // Fresh world per mutation so the before/after diff is isolated.
        const world: World = new Map([
          ['control_plane', new Set(controlPlaneTables)],
          ...tenants.map((t) => [tenantDbName(t), new Set<string>()] as const),
        ]);
        const before = snapshot(world);
        const result = adapters.mutateSchema(world, m);
        const ownDb = tenantDbName(m.issuingTenant);

        if (result.applied) {
          // Only the issuing tenant's db may differ.
          for (const [db, tables] of world) {
            if (db === ownDb) continue;
            const original =
              db === 'control_plane' ? controlPlaneTables : new Set<string>();
            if (snapshot(new Map([[db, tables]])) !== snapshot(new Map([[db, original]]))) {
              return false; // a non-issuing db changed — cross-tenant leak
            }
          }
          // An applied op MUST be on the allowlist.
          if (!(ALLOWED_DDL as readonly string[]).includes(m.op)) return false;
          // Control plane MUST be untouched.
          if (snapshot(new Map([['control_plane', world.get('control_plane')!]])) !==
              snapshot(new Map([['control_plane', controlPlaneTables]]))) {
            return false;
          }
        } else {
          // A rejected mutation changes NOTHING.
          if (snapshot(world) !== before) return false;
        }
      }
      return true;
    }),
    runConfig(),
  );
}
