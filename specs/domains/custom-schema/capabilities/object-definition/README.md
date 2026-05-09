# Capability: Object Definition

**Capability:** object-definition
**Domain:** custom-schema
**Platform:** Extensibility
**Status:** **Designed (no implementation yet).** First capability under the Extensibility platform's `custom-schema` domain. Lands the seam every subsequent custom-schema capability (`field-types`, `indexes`, `schema-migrations`, `formula-fields`) builds on. Greenfield; no prior code.

## Purpose

A signed-in tenant administrator declares an object type — by name plus a minimum set of metadata (label, plural label, description, optional API name override) — and the platform provisions a native, per-tenant Postgres table to back it. After this slice, the tenant can list the object types they've defined and describe a single one by id. They cannot yet add fields beyond a system-minted primary key + audit columns, cannot yet store records, and cannot yet drop or rename a type — those are subsequent capability slices. The success criterion is: after `Define`, the tenant's `atlas_t_<tenantUuid>` schema contains a new table named per the deterministic translation rules ([Per-Tenant Schema Translation](#per-tenant-schema-translation) below), the object type is visible in `GET /api/v1/object-types`, and replaying the event stream produces an identical projection.

## Invariants Touched

- **I7 — Tenant isolation in search/data** ([`../../../../architecture.md`](../../../../architecture.md), "Invariants" section). Object-type rows live exclusively in the issuing tenant's per-tenant control rows; the underlying table is provisioned in `atlas_t_<tenantUuid>` per [ADR 0005](../../../../decisions/0005-custom-schema-storage-strategy.md). No projection key, query input, or DDL target spans tenants.
- **I9 — Cache keys include `tenantId`** ([`../../../../architecture.md`](../../../../architecture.md)). Read-side caches for `listObjectTypes` / `describeObjectType` are keyed `objectTypes:${tenantId}` and `objectType:${tenantId}:${objectTypeId}`. PUBLIC scope does not apply — there is no cross-tenant read surface.
- **I10 — Tag-based cache invalidation** ([`../../../../architecture.md`](../../../../architecture.md)). `ObjectType.Defined` carries `cacheInvalidationTags: ['Tenant:${tenantId}', 'ObjectType:${objectTypeId}']`. The handler test asserts both tags.
- **I12 — Projections rebuildable from events** ([`../../../../architecture.md`](../../../../architecture.md)). The object-type registry projection rebuilds identically from a synthetic `[ObjectType.Defined]` stream. The DDL side-effect (table provisioning) is **not** the source of truth — the event stream is. On rebuild, the projection is reconstituted from events; reconciling the physical schema against the registry is a separate operator-side reconciliation step (see [Per-Tenant Migration Ledger](#per-tenant-migration-ledger) below).
- **I16 — DDL containment** ([ADR 0005](../../../../decisions/0005-custom-schema-storage-strategy.md), "Constraints this imposes" §1; tracked in [`../../../../architecture.md`](../../../../architecture.md) once codified). Tenants never issue raw SQL. The handler translates `CustomSchema.ObjectType.Define` into exactly one DDL statement drawn from the [allowlist](#ddl-allowlist-grammar), targeting only the tenant's own schema. Cross-schema references, extensions, triggers, and `DROP DATABASE` are unreachable from this surface.

## Lexicon

This capability touches four lexicon entries: `CustomSchema` (refines an existing entry), `ObjectType` (new — the unit this capability defines), `Field` (new — referenced as the smallest declared unit even though field shapes are deferred to `field-types`), and `Relation` (new — currently missing; ADR 0005's "relationships become foreign keys" needs a vocabulary anchor). All four updates land in the spec PR for this capability, **before** any module code lands.

### Lexicon Patch

The following are the literal entries to append/edit in [`../../../../LEXICON.md`](../../../../LEXICON.md). Insert under "Multi-Tenant Fabric Nouns *(v2)*" alongside `CustomSchema`.

**Edit existing `CustomSchema` entry** — append a "Capabilities" cross-ref row to **Rules**:

```diff
   Rules:
   - Mutations confined to the issuing tenant's schema (Invariant I16).
   - DDL drawn from a constrained allowlist; no DROP DATABASE, no CREATE EXTENSION, no cross-schema references.
+  - The unit of declaration is the `ObjectType`; see `domains/custom-schema/capabilities/object-definition/README.md` for the seam.
```

**Add new `ObjectType` entry:**

```markdown
### ObjectType
- **Kind**: Noun
- **Meaning**: A tenant-declared entity type within a `CustomSchema`. Backed by a native Postgres table inside the tenant's `atlas_t_<tenantUuid>` schema. Identified by `objectTypeId` (UUID-shaped) and a tenant-unique `apiName` (regex `^[A-Za-z][A-Za-z0-9_]{0,62}$`, max 63 chars). Each `ObjectType.Defined` event mints exactly one type.
- **Shape**:
  - `tenantId`
  - `objectTypeId`
  - `apiName` — tenant-unique stable identifier used in API routes and as the table-name seed
  - `label`, `pluralLabel`, `description`
  - `createdAt`, `createdBy`
- **Touches**: PIPE-CMD-001, INV-DERIVED-001, **I7**, **I16**
- **Rules**:
  - `apiName` is unique per `tenantId`; collision returns `OBJECT_TYPE_API_NAME_TAKEN`.
  - Only types defined in the issuing tenant's schema are addressable; cross-tenant access is impossible at the type level (`tenantId` flows through every read).
  - Field declarations are NOT part of this entity in v1 — see the `field-types` capability for adding columns.
```

**Add new `Field` entry:**

```markdown
### Field
- **Kind**: Noun
- **Meaning**: A column declaration on an `ObjectType`. Has a `fieldType` (string/number/date/boolean/lookup/etc — defined by the `field-types` capability), an `apiName`, a `label`, and per-type constraints. Backed by a native column on the object type's table.
- **Shape**:
  - `fieldId`, `objectTypeId`, `apiName`, `label`, `fieldType`, `constraints`
- **Touches**: PIPE-CMD-001, **I16**
- **Rules**:
  - Out of scope for `object-definition`; declared and frozen by the `field-types` capability.
  - System-minted audit columns (`id`, `created_at`, `updated_at`, `version`) are not Fields — they are platform infrastructure.
```

**Add new `Relation` entry:**

```markdown
### Relation
- **Kind**: Noun
- **Meaning**: A typed reference from one `ObjectType` to another within the same tenant's `CustomSchema`. Backed by a foreign-key column per ADR 0005 ("relationships become foreign keys"). Distinct from the existing `RelationStore` port, which is a generic platform-level adjacency store; `Relation` here is a tenant-defined first-class metadata declaration.
- **Shape**:
  - `relationId`, `tenantId`, `fromObjectTypeId`, `toObjectTypeId`, `apiName`, `cardinality` (`one-to-many` | `many-to-one` | `many-to-many`), `onDelete` (`restrict` | `cascade` | `set-null`)
- **Touches**: PIPE-CMD-001, **I7**, **I16**
- **Rules**:
  - Both endpoints MUST live in the same tenant's schema (Invariant **I16**); cross-tenant relations are forbidden.
  - Out of scope for `object-definition`; declared as a reference-typed field by the `field-types` capability — there is no separate `relations` capability.
  - Naming disambiguation: this entry refers to the *tenant-defined* relation metadata, not the platform-level `RelationStore` port at `ports/src/relation-store.ts`.
```

## Surfaces

What this capability adds, by surface:

- **Module** — **NEW** `modules/custom-schema/`:
  - `src/handlers/object-define.ts` — `CustomSchema.ObjectType.Define` intent handler. Validates `apiName` against the grammar, mints `objectTypeId`, calls into the schema-definition store to provision the table, emits `ObjectType.Defined`.
  - `src/projections/object-type-registry.ts` — per-tenant projection: `Map<objectTypeId, { apiName, label, pluralLabel, description, createdAt, createdBy }>`.
  - `src/queries/object-types.ts` — `listObjectTypes(tenantId)`, `describeObjectType(tenantId, objectTypeId)`.
  - `src/dispatch.ts` — `customSchemaDispatcher` factory.
  - `src/events.ts` — `ObjectType.Defined` event type.
  - `src/errors.ts` — `CustomSchemaError` with codes (`OBJECT_TYPE_API_NAME_TAKEN`, `OBJECT_TYPE_NAME_INVALID`, `OBJECT_TYPE_NAME_RESERVED`, `TENANT_SCHEMA_NOT_PROVISIONED`).
  - `src/index.ts` — public surface.

- **Handlers / intents:**
  - `CustomSchema.ObjectType.Define` — payload `{ apiName: string; label: string; pluralLabel: string; description?: string }`. Idempotent on the envelope's `idempotencyKey` (standard ingress contract). A second `Define` with a *different* `idempotencyKey` but the same `apiName` returns `OBJECT_TYPE_API_NAME_TAKEN` — the asymmetry is intentional: DDL is irreversible, so name collisions are user errors, not retries.

- **Events emitted:**
  - `ObjectType.Defined` — envelope:
    ```ts
    {
      type: 'ObjectType.Defined',
      tenantId, objectTypeId, apiName, label, pluralLabel,
      description: string | null, createdAt, createdBy,
      cacheInvalidationTags: ['Tenant:${tenantId}', 'ObjectType:${objectTypeId}'],
      correlationId,
    }
    ```

- **Projections:** `_atlas_object_types` — per-tenant table holding the registry, located at `atlas_t_<tenantUuid>._atlas_object_types` (sibling of `_atlas_tenant_migrations`). Columns: `object_type_id`, `api_name`, `sql_identifier`, `label`, `plural_label`, `description`, `created_at`, `created_by`. Unique on `(api_name)` — uniqueness is implicit per-tenant since the table only ever contains the issuing tenant's rows. No `tenant_id` column; the schema is the tenant boundary.

- **Queries:**
  - `listObjectTypes(tenantId)` — registry rows for the tenant; cache key `objectTypes:${tenantId}`, tag `Tenant:${tenantId}`.
  - `describeObjectType(tenantId, objectTypeId)` — single registry row; cache key `objectType:${tenantId}:${objectTypeId}`, tag `ObjectType:${objectTypeId}`.

- **Routes** — **NEW** `apps/server/src/routes/object-types.ts`:
  - `GET /api/v1/object-types` — list tenant's object types (read).
  - `GET /api/v1/object-types/:objectTypeId` — describe a single object type (read).
  - **No POST routes here** — `CustomSchema.ObjectType.Define` flows through the existing `POST /api/v1/intents` route. Standard ingress pipeline gives I2/I3/I5 enforcement.

- **Port — position:** **Introduce a new `SchemaDefinitionStore` port** at `ports/src/schema-definition-store.ts`. Justification:
  - `EntityTypeRegistry` ([`../../../../../ports/src/entity-type-registry.ts`](../../../../../ports/src/entity-type-registry.ts)) is **read-only by design** ("Writes (registering / updating / removing types) are deliberately not on this port"), and its tenant-override-vs-platform-default model is the wrong shape for tenant-defined types — there is no platform default for `Account` or `Contact` in a tenant's CustomSchema. They are tenant-authored end-to-end.
  - `EntityTypeRegistry` is wired against `EntityStore` (a generic typed-row store), which is a different storage strategy from ADR 0005's schema-per-tenant native tables. Conflating the two ports would force adapter implementations to fork internally on the tenant's "data model regime."
  - Naming: `SchemaDefinitionStore` matches ADR 0005's "Migration §3" scoping ("`SchemaDefinitionStore` port (declarations) + `EntityStore` adapter").
  - Surface (skeleton):
    ```ts
    export interface SchemaDefinitionStore {
      getObjectTypeByApiName(tenantId: string, apiName: string): Promise<ObjectTypeRecord | null>;
      getObjectType(tenantId: string, objectTypeId: string): Promise<ObjectTypeRecord | null>;
      listObjectTypes(tenantId: string): Promise<readonly ObjectTypeRecord[]>;
      defineObjectType(tenantId: string, input: {
        objectTypeId: string; apiName: string; label: string;
        pluralLabel: string; description: string | null; createdBy: string;
      }): Promise<void>; // single transaction in the tenant DB
    }
    ```
  - **Atomicity:** `defineObjectType` runs as a single transaction against the tenant DB — the `CREATE TABLE atlas_t_<tenantUuid>.<sql_identifier>`, the `INSERT` into `_atlas_object_types`, and the `INSERT` into `_atlas_tenant_migrations` all commit or rollback together. No cross-DB coordination, no saga.

- **UI surfaces — explicitly deferred.** No admin-UI surface lands in this slice. The API + atlasctl path lands first; a tenant-admin "Object Manager" surface is a follow-up frontend slice scoped against the surface-introspection contract.

## End-to-End Flow

1. Tenant admin runs `atlasctl object-type define --api-name account --label Account --plural-label Accounts` (or POSTs the equivalent intent directly).
2. CLI/UI builds the intent envelope `{ action: 'CustomSchema.ObjectType.Define', payload: { apiName: 'account', label: 'Account', pluralLabel: 'Accounts' }, idempotencyKey, correlationId }` and POSTs to `/api/v1/intents`.
3. `apps/server` ingress chain runs: authn → tenant resolve → schema validation against `specs/schemas/contracts/custom-schema.object-type.define.intent.schema.json` → idempotency check on `(tenantId, idempotencyKey)` → authz (`CustomSchema.ObjectType:Define` action against the tenant) → `enforceQuota(tenantId, 'object-types-per-tenant')` (Commerce resolves the limit per the tenant's plan + any per-tenant override; see the Commerce handoff at the bottom) → handler dispatch.
4. `handleObjectTypeDefine` calls `schemaDefinitionStore.getObjectTypeByApiName(tenantId, apiName)`. If present, returns `OBJECT_TYPE_API_NAME_TAKEN`. (Standard envelope-key idempotency caught the retry case earlier in the chain.)
5. Handler validates `apiName` against the regex `^[A-Za-z][A-Za-z0-9_]{0,62}$` and the reserved-word denylist (Postgres reserved words + `_atlas_*` + `pg_*` prefixes). Rejects on violation with `OBJECT_TYPE_NAME_INVALID` or `OBJECT_TYPE_NAME_RESERVED`.
6. Handler verifies `atlas_t_<tenantUuid>` exists; if missing, returns `TENANT_SCHEMA_NOT_PROVISIONED` (tenancy provisions the schema at signup; see [Connection-Role Enforcement](#connection-role-enforcement)).
7. Handler mints a fresh `objectTypeId` (UUID) and calls `schemaDefinitionStore.defineObjectType(...)`. The adapter opens a single transaction on the tenant DB and runs three statements together: (a) `CREATE TABLE atlas_t_<tenantUuid>.<sql_identifier> (id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version bigint NOT NULL DEFAULT 1)`; (b) `INSERT INTO atlas_t_<tenantUuid>._atlas_object_types (object_type_id, api_name, sql_identifier, label, plural_label, description, created_at, created_by) VALUES (...)`; (c) `INSERT INTO atlas_t_<tenantUuid>._atlas_tenant_migrations (...)`. All commit or rollback together.
8. Handler emits `ObjectType.Defined` with `cacheInvalidationTags: ['Tenant:${tenantId}', 'ObjectType:${objectTypeId}']`, `correlationId` propagated.
9. Dispatcher chain runs:
   a. `customSchemaDispatcher` rebuilds `_atlas_object_types` projection (no-op if the adapter already wrote inline; included for I12 rebuildability).
   b. `cacheTagDispatcher(cache)` purges `Tenant:${tenantId}` and `ObjectType:${objectTypeId}`.
   c. `serverEventDispatcher` broadcasts to SSE subscribers.
10. Server returns 202 with `{ objectTypeId, correlationId }`.
11. Tenant runs `GET /api/v1/object-types`. Read goes through `evaluateRead` → cache lookup (`objectTypes:${tenantId}`) → cache miss → `listObjectTypes(tenantId)` query → registry projection read → cache populate with tag `Tenant:${tenantId}` → response.

## DDL Allowlist Grammar

Every DDL statement Atlas can emit on behalf of a tenant falls into exactly one bucket. Reviewers should be able to take this table to ADR 0005 §"Constraints" and check off every clause.

| DDL operation | Bucket | Owner | Notes / ADR 0005 clause satisfied |
|---|---|---|---|
| `CREATE SCHEMA atlas_t_<tenantUuid>` | **Bootstrapped before this capability runs** | tenancy/signup (provisioned at tenant creation; see Decision 1) | Pre-condition. ADR 0005 §Migration item 4. Not issued by `object-definition` itself. |
| `CREATE TABLE atlas_t_<tenantUuid>.<objectType> (id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version bigint NOT NULL DEFAULT 1)` | **Issued by `object-definition`** | this capability | ADR 0005 §Constraints item 1. The headline DDL the capability is allowed to emit. |
| `CREATE UNIQUE INDEX <objectType>_pkey_idx ON atlas_t_<tenantUuid>.<objectType> (id)` (implicit via PRIMARY KEY) | **Issued by `object-definition`** | this capability | ADR 0005 §Constraints item 1. Required so the table is queryable at all. |
| `INSERT` row into `atlas_t_<tenantUuid>._atlas_object_types` | **Issued by `object-definition`** | this capability | The per-tenant registry of declared object types — projection source of truth. Co-emitted in the same transaction as the `CREATE TABLE`. |
| `CREATE TABLE IF NOT EXISTS atlas_t_<tenantUuid>._atlas_object_types (...)` | **Issued by `object-definition`** (lazy, on first `Define` per tenant) | this capability | Idempotent bootstrap of the per-tenant registry table itself. Same transaction as the first `CREATE TABLE` for an object type. |
| `CREATE TABLE IF NOT EXISTS atlas_t_<tenantUuid>._atlas_tenant_migrations (...)` | **Issued by `object-definition`** (lazy, on first `Define` per tenant) | this capability | Idempotent bootstrap of the per-tenant migration ledger. Same transaction as above. |
| `INSERT` row into `atlas_t_<tenantUuid>._atlas_tenant_migrations` | **Issued by `object-definition`** | this capability | ADR 0005 §Constraints item 2 (per-tenant migration ledger). Co-emitted in the same transaction as the `CREATE TABLE`. |
| `ADD COLUMN` | **Deferred** | `field-types` capability | ADR 0005 §Constraints item 1 explicitly lists this as DDL — but the per-field grammar (types, nullability, defaults, check constraints) is `field-types`' headline deliverable. |
| `CREATE INDEX` (beyond the PK) | **Deferred** | `indexes` capability | ADR 0005 §Constraints item 1. Tenant-controlled index hints. |
| `ALTER COLUMN ... TYPE` (with safe-cast rules) | **Deferred** | `schema-migrations` capability | ADR 0005 §Constraints item 1. Safe-cast policy is non-trivial; needs its own spec. |
| `DROP COLUMN`, `DROP TABLE` | **Deferred** | `schema-migrations` capability | ADR 0005 §Constraints item 1. Destructive; gated separately. |
| Foreign-key constraints (`REFERENCES`) | **Deferred** | `field-types` (reference fields) — see Decision 4 | ADR 0005 §Decision sentence 3 ("relationships become foreign keys"). Outside `object-definition`. |
| `CREATE EXTENSION`, `DROP DATABASE`, `CREATE FUNCTION`, `CREATE PROCEDURE`, `CREATE TRIGGER`, raw `EXECUTE`, `COPY ... FROM PROGRAM`, `GRANT` / `REVOKE`, `SET ROLE`, `\copy` | **Forbidden everywhere** | n/a | ADR 0005 §Constraints item 1 ("no `DROP DATABASE`, no `CREATE EXTENSION`, no triggers"). Triggers are explicitly Extensibility/`functions`' job. I16 (DDL containment). |
| Any DDL referencing a schema other than `atlas_t_<tenantUuid>` (cross-schema joins, `public.*`, another tenant's schema) | **Forbidden everywhere** | n/a | ADR 0005 §Constraints item 3 (connection role lacks USAGE; would fail at the DB anyway). I7 (tenant isolation). |
| Any DDL whose identifier was constructed by string concatenation rather than the parameterized identifier helper | **Forbidden everywhere** | n/a | I16 / SQL-injection failure mode. See [Per-Tenant Schema Translation](#per-tenant-schema-translation) below. |

The allowlist is **closed**: anything not in the "Issued by" or "Deferred" rows above is forbidden until a future capability spec moves it from forbidden into deferred and then into issued.

## Per-Tenant Schema Translation

The capability translates one declaration — `CustomSchema.ObjectType.Define { apiName: "lead", label: "Lead", ... }` — into one DDL transaction against the tenant's schema.

**Identifier safety.** Tenant-supplied object-type names never reach DDL via string interpolation. Instead:

1. The handler validates the input against a strict regex: `^[A-Za-z][A-Za-z0-9_]{0,62}$` (max 63 chars to leave headroom under Postgres' `NAMEDATALEN` of 64). Anything else is rejected at the ingress boundary with `OBJECT_TYPE_NAME_INVALID`.
2. The validated `apiName` is lower-cased and case-folded for the SQL identifier (`lead`), but the original cased form is preserved on the projection as the display `apiName`.
3. The SQL identifier is rendered via postgres.js's tagged-template identifier helper (e.g. `` sql`CREATE TABLE ${sql(tableName)} (...)` ``) — never via `unsafe()` string concatenation. Failure mode if violated: SQL injection at the DDL boundary, exactly the class of bug that motivated I16. The migration runner's existing `kind`-narrowing pattern (`adapters/node/src/migrations/runner.ts` lines 55-59) is the same defensive shape.
4. Reserved-word handling: a denylist of Postgres reserved words (`user`, `select`, `table`, `order`, etc.) and Atlas-reserved prefixes (`_atlas_`, `pg_`) rejects collisions at validation time with `OBJECT_TYPE_NAME_RESERVED`.

**Naming scope.** Object-type names are unique **per tenant**. Cross-tenant collisions are impossible because each tenant has its own schema (the schema-per-tenant choice from ADR 0005).

**Duplicate-name behavior.** A second `Define` with the same `apiName` (and a different `idempotencyKey`) returns `OBJECT_TYPE_API_NAME_TAKEN`. Re-submission of the same envelope (same `idempotencyKey`) is a no-op via the standard ingress idempotency check. The asymmetry — re-naming is harder than re-submitting — is intentional: DDL is irreversible, so we treat name collisions as user errors rather than retries.

**Object-id allocation.** Every object type has a stable platform-side UUID (`objectTypeId`) on the projection. The SQL-side identifier (`lead`) is derived from the validated `apiName` and **not** the UUID — operators reading `psql` output need human-meaningful table names. The mapping `objectTypeId ↔ sql_identifier` is the projection's job to maintain; the schema is the source of truth for "does this table exist," but the projection is the source of truth for "what is its platform-stable id."

**Built-in columns.** Every tenant table created by this capability has these four columns and only these four — fields are added later by `field-types`:

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid PRIMARY KEY` | Row identity. Generated by the platform on insert (not by Postgres `gen_random_uuid()` default — keeps it adapter-agnostic if an IDB mirror lands later). |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Set on insert; never updated. |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Updated on every write by the row writer (not a trigger — triggers are forbidden, see allowlist). |
| `version` | `bigint NOT NULL DEFAULT 1` | Optimistic-concurrency token; incremented on update. |

These four are platform-owned and the tenant cannot add fields with these names — the `field-types` validator must reject them as reserved.

## Per-Tenant Registry and Migration Ledger

Two platform-owned tables live inside each tenant's schema:

- **`atlas_t_<tenantUuid>._atlas_object_types`** — the registry / projection. One row per declared object type. This is the read source for `listObjectTypes` / `describeObjectType`. Source of truth: rebuildable from `ObjectType.Defined` events (I12).
- **`atlas_t_<tenantUuid>._atlas_tenant_migrations`** — the migration ledger. One row per DDL-emitting event, for replay safety and operator audit.

Both tables are **bootstrapped lazily** in the same transaction as the tenant's first `CustomSchema.ObjectType.Define` (`CREATE TABLE IF NOT EXISTS` for both, then the `INSERT`s). Neither is owned by `adapters/node/src/migrations/runner.ts` — that runner is for adapter-bundled SQL files; these are event-driven and live in the tenant's schema.

ADR 0005 §Constraints item 2 motivates this design — a per-tenant migration ledger distinct from the control-plane `_atlas_migrations` table.

**Why per-tenant.** Keeps both tables inside the unit of isolation: dropping/restoring a tenant schema takes its history with it; the tenant's connection role has USAGE on the schema natively; cross-tenant operator queries ("how many object types per tenant") become a fan-out over tenants rather than a single SQL query, which is the operational tradeoff we accept for stronger isolation.

**Registry table shape.**

```sql
CREATE TABLE atlas_t_<tenantUuid>._atlas_object_types (
    object_type_id  uuid PRIMARY KEY,
    api_name        text NOT NULL UNIQUE,            -- per-tenant unique; schema is the tenant boundary
    sql_identifier  text NOT NULL UNIQUE,            -- the actual table name in atlas_t_<tenantUuid>
    label           text NOT NULL,
    plural_label    text NOT NULL,
    description     text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      text NOT NULL
);
```

**Migration ledger shape.**

```sql
CREATE TABLE atlas_t_<tenantUuid>._atlas_tenant_migrations (
    id              bigserial PRIMARY KEY,
    applied_at      timestamptz NOT NULL DEFAULT now(),
    event_id        text NOT NULL,                   -- the event that drove this DDL
    event_type      text NOT NULL,                   -- e.g. "ObjectType.Defined"
    correlation_id  text NOT NULL,                   -- I5 propagation
    principal_id    text,                            -- who, if a human
    object_type_id  uuid,                            -- platform-stable id, if applicable
    sql_identifier  text NOT NULL,                   -- the schema-qualified identifier touched
    ddl_summary     text NOT NULL,                   -- human-readable: "CREATE TABLE atlas_t_x.lead"
    UNIQUE (event_id)
);
```

The `UNIQUE (event_id)` constraint makes ledger writes idempotent on event replay — the same event applied twice is a no-op at the DB level (`ON CONFLICT DO NOTHING`).

**Replay reconstruction (I12).** ADR 0005 §Constraints item 2 requires the schema be rebuildable from events alone. The reconstruction algorithm:

1. Operator-side: tenancy ensures `atlas_t_<tenantUuid>` exists (provisioned at signup; if missing, an operator-driven re-provision step recreates the empty schema).
2. The first `ObjectType.Defined` replay re-creates `_atlas_object_types` and `_atlas_tenant_migrations` via `CREATE TABLE IF NOT EXISTS` (idempotent bootstrap).
3. Re-play every `custom-schema.*` event in `seq` order; each handler emits the same DDL it would on first apply, the same registry insert, plus the same ledger insert. The `UNIQUE (event_id)` makes mid-replay restarts safe.
4. After replay, `SELECT count(*) FROM _atlas_tenant_migrations` equals the count of `custom-schema.*` events for that tenant — the parity test that proves I12.

## Connection-Role Enforcement

Per ADR 0005 §Constraints item 3, each tenant's connection uses a Postgres role with `USAGE` on its own schema only.

**Role grants** (provisioned by tenancy at signup, outside this capability):

| Grant | Purpose |
|---|---|
| `GRANT USAGE ON SCHEMA atlas_t_<tenantUuid> TO atlas_t_<tenantUuid>_role` | Allows the role to resolve identifiers in the schema |
| `GRANT CREATE ON SCHEMA atlas_t_<tenantUuid> TO atlas_t_<tenantUuid>_role` | Required for `CREATE TABLE` / `CREATE INDEX` issued by this capability |
| `ALTER DEFAULT PRIVILEGES IN SCHEMA atlas_t_<tenantUuid> GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO atlas_t_<tenantUuid>_role` | Tables created by this capability are automatically writable by the role; no per-table GRANT needed |
| **No** `GRANT` on `public`, `pg_catalog` (beyond defaults), or any other `atlas_t_*` schema | Cross-schema queries fail at the DB layer (ADR 0005 §Constraints item 3) |

**Failure modes.**

- Role missing `USAGE`: `42501` `permission denied for schema atlas_t_xxx` — clean refusal at the DB layer; the application catches and surfaces as `TENANT_SCHEMA_NOT_PROVISIONED`. No data leak; no app-side fallback.
- Role missing `CREATE`: `42501` on the `CREATE TABLE`; same refusal path.
- Wrong role on connection (e.g. another tenant's role): the `atlas_t_<currentTenantUuid>` schema is invisible — `42P01` `relation "atlas_t_xxx.lead" does not exist`. Cross-tenant access is impossible because USAGE is missing; the failure is detected before any row is touched.

**Connection resolution.** The existing `adapters/node/src/tenant-db-provider.ts` resolves `tenantId → postgres.Sql` via per-tenant `db_user` / `db_password` columns on `control_plane.tenants` (lines 244-275). This capability does **not** modify that surface — it relies on tenancy provisioning having populated those columns with the per-tenant role's credentials. If a tenant's `db_user` is the wrong role (e.g. left as a shared dev superuser in non-prod), the failure modes above don't fire and the test environment silently bypasses isolation. The acceptance suite must include a "wrong role rejected" test against a real Postgres to catch this.

## What's Stubbed Today

**Nothing — this is greenfield.** The closest pattern references:

- `tenancy/public-signup` (write-side: handler + event + dispatcher + cache invalidation) — pattern reference only; not extending it.
- `tenancy/custom-domains` (read-side: per-tenant projection + query + cache key shape) — pattern reference only; not extending it.
- `code/repository/upload-tarball` (greenfield slice with new module + new port) — pattern reference for the spec shape itself.
- `EntityTypeRegistry` port already exists at `ports/src/entity-type-registry.ts` but is **not** the port for this capability (see "Port — position" rationale above).

## What's NOT in Scope

Explicit boundary so subsequent capabilities have somewhere to land:

- **Field add/remove.** `Define` creates a table with the four built-in columns and nothing else. Adding `name TEXT`, `email TEXT`, etc. is `field-types`. Modifying or dropping fields is `schema-migrations`.
- **Relation declarations.** Foreign keys (`REFERENCES atlas_t_<tenantUuid>.<otherType>(id)`) are deferred to `field-types` as a reference-field kind. There is no separate `relation-define` capability — many-to-one and one-to-many ride on reference fields directly.
- **Indexes beyond the implicit primary key.** Tenant-declared indexes (`indexes` capability) are out of scope here.
- **Destructive operations.** No `DROP TABLE`, `DROP COLUMN`, or `ALTER COLUMN ... TYPE`. All deferred to `schema-migrations`, which has to spec the safe-cast rules.
- **Formula fields, triggers, computed columns.** Triggers are forbidden at all (see allowlist); formula fields are `formula-fields` capability and ride on the future `functions` domain.
- **Cross-tenant sharing.** ADR 0005 §"Out of scope" item 2 defers this to Phase 5+.
- **Adapter re-shape from sparse-pivot `entities` table to native tables.** The current shared `entities` / `relations` substrate at `adapters/node/src/migrations/tenant/00000001_initial.sql` is the **wrong shape** under ADR 0005 — it stays for legacy modules but `custom-schema` will not use it. The actual migration of `EntityStore` adapter from sparse-pivot to native-tables-per-objectType is an adapter slice owned by `port-adapter-dev` and explicitly out of scope here.
- **IDB adapter behavior.** ADR 0005 is Postgres-flavored (Postgres schemas, `pg_namespace_size()`, role isolation). The IDB mirror has no schemas. **Proposed deferral:** the IDB adapter throw-stubs `SchemaDefinitionStore` with `"SchemaDefinitionStore is server-only — tenant DDL cannot run in the browser sim"`. When/if the sim grows a fake-DDL backend, this is revisited under a follow-up adapter-parity ADR.
- **Admin UI.** No tenant-admin UI for browsing or creating object types. Follow-up frontend slice.

## File-by-File Plan (for the implementation PR)

In execution order. Each entry: path + one-line rationale.

1. **Lexicon** — `specs/LEXICON.md` adds `ObjectType`, `Field`, `Relation`; edits `CustomSchema`. Lands with the spec PR, before code.
2. **Schema contract** — `specs/schemas/contracts/custom-schema.object-type.define.intent.schema.json` — payload schema with `apiName` regex `^[A-Za-z][A-Za-z0-9_]{0,62}$`, `label`/`pluralLabel` length caps, optional `description`. *(No control-plane migration — both `_atlas_object_types` and `_atlas_tenant_migrations` are bootstrapped lazily inside the tenant schema on the first `Define`. See [Per-Tenant Registry and Migration Ledger](#per-tenant-registry-and-migration-ledger).)*
3. **Port** — `ports/src/schema-definition-store.ts` (per "Port — position" skeleton). Re-export from `ports/src/index.ts`.
4. **Adapter (node)** — `adapters/node/src/schema-definition-store.ts`: `PostgresSchemaDefinitionStore`. Implements the single-transaction `defineObjectType` (lazy bootstrap of `_atlas_object_types` + `_atlas_tenant_migrations`, then `CREATE TABLE` for the object type, then `INSERT` into both metadata tables) plus the read accessors over `_atlas_object_types`.
5. **Adapter (idb)** — throw-stub: `"SchemaDefinitionStore is server-only — tenant DDL cannot run in the browser sim"`. Contract test marks the suite as expected-to-throw.
6. **Module** — `modules/custom-schema/` per the standard skeleton (`modules/CLAUDE.md`): handler, projection, query, dispatcher, events, errors, index. Cache tags asserted in handler tests.
7. **Routes** — `apps/server/src/routes/object-types.ts` (read endpoints only). Action id registers via the existing handler-registry composition.
8. **Bootstrap** — `apps/server/src/bootstrap.ts` wires `SchemaDefinitionStore` into `AppState`. `apps/server/src/middleware/state.ts` adds `customSchemaDispatcher` to the chain. **Mirror in** `apps/projection-worker/src/tenant-loop.ts` (worker parity is a non-negotiable check).
9. **atlasctl** — `apps/atlasctl/src/commands/object-type.ts`: `object-type define`, `object-type list`, `object-type show`. Wraps the standard intent submission.
10. **Tests** — see [Acceptance](#acceptance).

## Things That DON'T Change

- **`apps/server/src/routes/intents.ts`** — unchanged. New action id registers via the existing handler-registry composition.
- **`EntityTypeRegistry` port and its adapter** — unchanged. This capability does not extend or modify it; the platform-default-vs-tenant-override model continues to apply to its current consumers (catalog, etc.) until they're parked or migrated separately.
- **Existing `EntityStore`, `RelationStore` ports** — unchanged. CustomSchema does not piggyback on the generic typed-row stores; ADR 0005 is explicit about native-tables-per-type.
- **Tenancy provisioning flow** — unchanged at the public-signup seam. ADR 0005 §"Migration" item 4 notes that `tenant-db-provider.ts` gains `provisionTenantSchema(tenantId)`, but that hook is owned by a separate `tenancy/self-serve-provisioning` capability and is a precondition for this slice, not part of it. If a tenant's `atlas_t_*` schema is missing at handler time, the handler returns `TENANT_SCHEMA_NOT_PROVISIONED`.
- **All other modules under `/modules/`** — no cross-module imports added; reads go through events/projections per I12.
- **`pnpm deps:check` config** — no boundary exception needed.

## Acceptance

Tests the implementation PR must include. Concrete file paths and named tests, not "we'll add tests."

- **Lazy-bootstrap test** — `adapters/node/test/schema-definition-store/lazy-bootstrap.test.ts > first Define on a tenant creates _atlas_object_types and _atlas_tenant_migrations with the expected columns and unique constraints in the same transaction as the object-type CREATE TABLE`.
- **Handler tests** — `modules/custom-schema/test/handlers/object-define.test.ts`:
  - `CustomSchema.ObjectType.Define > emits ObjectType.Defined with cacheInvalidationTags ['Tenant:${tenantId}', 'ObjectType:${objectTypeId}']`
  - `CustomSchema.ObjectType.Define > envelope-key idempotency: replay returns same objectTypeId without re-DDL`
  - `CustomSchema.ObjectType.Define > rejects duplicate apiName for same tenant with OBJECT_TYPE_API_NAME_TAKEN`
  - `CustomSchema.ObjectType.Define > rejects invalid apiName per regex with OBJECT_TYPE_NAME_INVALID`
  - `CustomSchema.ObjectType.Define > rejects reserved apiName (e.g. "user") with OBJECT_TYPE_NAME_RESERVED`
  - `CustomSchema.ObjectType.Define > returns TENANT_SCHEMA_NOT_PROVISIONED when atlas_t_<tenantUuid> is absent`
- **Dispatch / I12 rebuild test** — `modules/custom-schema/test/dispatch.test.ts > replays [ObjectType.Defined, ObjectType.Defined] and rebuilds _atlas_object_types projection identically to inline dispatch`. The test does not exercise DDL — projection rebuild is over the registry only; physical-schema reconciliation is a separate operator-side concern.
- **Cross-tenant operator query (fan-out)** — `adapters/node/test/schema-definition-store/cross-tenant-fanout.test.ts > listing all object types across all tenants is a fan-out: loop over tenant DBs, union the per-tenant _atlas_object_types reads`. Documents the operational tradeoff of the per-tenant registry placement (no single SQL across all tenants).
- **Contract test (new port)** — `packages/contract-tests/src/schema-definition-store.test.ts`:
  - `PostgresSchemaDefinitionStore > round-trip define → list → describe`
  - `PostgresSchemaDefinitionStore > apiName uniqueness is per-tenant (tenant A and tenant B can both define apiName 'account')`
  - `PostgresSchemaDefinitionStore > cross-tenant read denied at the type level (tenantId is required on every accessor)`
  - `PostgresSchemaDefinitionStore > wrong connection role yields TENANT_SCHEMA_NOT_PROVISIONED, not a leak` *(requires a real Postgres in test infra)*
  - IDB suite skipped (server-only, throw-stub).
- **Route tests** — `apps/server/test/routes/object-types.test.ts`:
  - `GET /api/v1/object-types > returns tenant's types only (I7)`
  - `GET /api/v1/object-types/:id > tenant A cannot describe tenant B's type`
- **BDD scenarios** — `tests/bdd/features/custom-schema/object-definition.feature`:
  - Scenario: `Tenant admin defines an object type and it appears in the listing`
  - Scenario: `Tenant admin defining a duplicate apiName receives OBJECT_TYPE_API_NAME_TAKEN`
  - Scenario: `Two tenants independently define an object type with the same apiName and each sees only their own`
  - Surface assertions deferred until the admin-UI slice; until then, the BDD scenarios drive `atlasctl` + assert on the JSON API responses.
- **Parity test (node ↔ idb)** — **N/A in v1.** ADR 0005 is Postgres-flavored; idb has no native-DDL story. Parity is **explicitly deferred** with a stub test that asserts the idb adapter throws the documented error. When/if the sim grows a fake-DDL backend, this is revisited.
- **Boundary checks** — `pnpm typecheck` + `pnpm deps:check` (0 errors) + `pnpm lint` + `pnpm test`.

## Cross-References

- Capability template: [`../../../../_capability-template.md`](../../../../_capability-template.md)
- Domain README: [`../../README.md`](../../README.md)
- ADR — Extensibility revival: [`../../../../decisions/0003-tenant-defined-data-model-pivot.md`](../../../../decisions/0003-tenant-defined-data-model-pivot.md)
- ADR — schema-per-tenant storage: [`../../../../decisions/0005-custom-schema-storage-strategy.md`](../../../../decisions/0005-custom-schema-storage-strategy.md)
- Architecture invariants: [`../../../../architecture.md`](../../../../architecture.md) (I7, I9, I10, I12, I16)
- Lifecycle (projection rebuild section): [`../../../../lifecycle.md`](../../../../lifecycle.md)
- Lexicon entries: [`../../../../LEXICON.md`](../../../../LEXICON.md) ▸ `CustomSchema`, `ObjectType`, `Field`, `Relation`
- Pattern reference (write-side, atlasctl): [`../../../tenancy/capabilities/public-signup/README.md`](../../../tenancy/capabilities/public-signup/README.md)
- Pattern reference (read-side, port shape): [`../../../tenancy/capabilities/custom-domains/README.md`](../../../tenancy/capabilities/custom-domains/README.md)
- Pattern reference (greenfield slice template): [`../../../code/repository/capabilities/upload-tarball/README.md`](../../../code/repository/capabilities/upload-tarball/README.md)
- Existing port that this capability does **not** extend (with rationale): [`../../../../../ports/src/entity-type-registry.ts`](../../../../../ports/src/entity-type-registry.ts)
- Module conventions: [`../../../../../modules/CLAUDE.md`](../../../../../modules/CLAUDE.md)
- Ports conventions: [`../../../../../ports/CLAUDE.md`](../../../../../ports/CLAUDE.md)

## Decisions (2026-05-09)

User checkpoint resolved the four design questions that the initial draft flagged as open. Recording here so future readers don't have to git-archaeology the change history.

1. **Tenant-schema bootstrap is owned by tenancy/signup.** `atlas_t_<tenantUuid>` is provisioned at signup. This capability assumes the schema exists and fails fast with `TENANT_SCHEMA_NOT_PROVISIONED` if missing. No defensive `CREATE SCHEMA IF NOT EXISTS` here — would require elevated role grants that conflict with the connection-role enforcement.
2. **Registry placement is per-tenant.** `_atlas_object_types` lives at `atlas_t_<tenantUuid>._atlas_object_types`, sibling to `_atlas_tenant_migrations`. Architecturally consistent with "tenant data lives entirely in the tenant's schema." Cross-tenant operator queries become a fan-out (loop over tenants); we accept that tradeoff for the isolation win.
3. **`defineObjectType` is a single transaction.** Falls out of decision 2 — registry insert + DDL + ledger insert all run in one tenant-DB transaction. No saga, no outbox.
4. **Foreign keys ride on `field-types` reference fields.** No separate `relation-define` capability. The `Relation` lexicon entry is canonical vocabulary; the implementation surface is a reference-typed field declared via `field-types`.

## Handoff — Commerce

This capability declares the call site `enforceQuota(tenantId, 'object-types-per-tenant')` in the ingress chain (step 3 of [End-to-End Flow](#end-to-end-flow)). The dimension itself is owned by Commerce and **must be configurable**: per-plan default with per-tenant override. Hard-coded global caps are explicitly rejected — operators need to grant headroom on a per-tenant basis (paid upgrades, internal accounts, etc.) without a code deploy.

Action: `commerce-owner` drafts `specs/domains/commerce/quotas/capabilities/object-types-per-tenant/README.md` (or the equivalent path under however Commerce structures dimension specs). Not gating Phase 1 of this capability — `enforceQuota` returns "no limit configured" until the Commerce dimension lands, and the call site is wired regardless. But it must land before the platform onboards the first paying tenant on a plan that caps the dimension.
