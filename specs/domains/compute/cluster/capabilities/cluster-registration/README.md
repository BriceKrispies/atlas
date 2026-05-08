# Capability: Cluster Registration

**Domain:** compute / cluster
**Status:** **Designed (no implementation yet).** This is the first capability spec for the Compute platform; no code lands until a follow-up implementation PR. The seam is the architectural foundation Phase 1 depends on — every later Compute capability assumes "Atlas knows about at least one cluster."

## Purpose

Lets Atlas record the existence of a Kubernetes cluster — its endpoint URL, its credentials, its region, its lifecycle status. Operators register clusters during Phase 0 with a small Node script (same posture as `scripts/atlas-domain.ts` for custom domains: operator is trusted, direct DB access during the Phase 0 bootstrap). Subsequent Compute capabilities (`cluster-bootstrap`, `cluster-status`, `runtime/deploy`) read the registered cluster and act on it.

This capability does **not** provision nodes, install k3s, validate connectivity, or surface clusters via atlasctl's HTTP API. Each of those is a separate capability and ships separately.

## Invariants Touched

- **I9** — cache keys for cluster lookups (when caching is added in a follow-up) include `tenantId` only when the lookup is tenant-scoped. Cluster records themselves are platform-level (not tenant-scoped); per-tenant cluster bindings are a separate capability.
- **I7** — clusters are platform resources, not tenant resources. There is no per-tenant data in `control_plane.clusters`. Tenant→cluster bindings (which tenant deploys to which cluster) live in a separate table and a separate capability, where tenant isolation applies.
- **I3** — register/disable operations are idempotent at the operator-script level (re-running `pnpm cluster:register dev ...` is a no-op once `dev` exists; `pnpm cluster:disable` is a no-op once already disabled).

## Lexicon

New terms (to add to `specs/LEXICON.md` in the implementation PR):

- **Cluster** — a Kubernetes cluster (today: k3s on Hetzner) that Atlas can deploy workloads to. Identified by `clusterId` (kebab-case, e.g. `dev`, `prod-us-fsn`).
- **Cluster endpoint** — the Kubernetes API URL (e.g. `https://k3s.example.com:6443`).
- **Cluster auth** — the credential Atlas uses to call the Kubernetes API. Phase 0 supports two kinds:
  - `kubeconfig` — full kubeconfig file contents.
  - `token` — a ServiceAccount token (the more production-shaped option once a cluster is healthy).

## Surfaces

- **Migration** — `adapters/node/src/migrations/control-plane/<timestamp>_clusters.sql`. Adds `control_plane.clusters` (see schema below).
- **Port** — `ports/src/cluster-store.ts`. Defines `ClusterStore` (CRUD-only — `add`, `get`, `list`, `disable`).
- **Adapter** — `adapters/node/src/cluster-store.ts`. `PostgresClusterStore` implements `ClusterStore` against the control-plane DB.
- **Operator script** — `scripts/atlas-cluster.ts`. Direct DB access (not HTTP); same trust posture as `scripts/atlas-domain.ts`. Wired into root `package.json` as `cluster:register`, `cluster:list`, `cluster:disable`.
- **No new HTTP route** — atlasctl Phase A doesn't speak to a control-plane API yet. Phase B atlasctl will wrap the operator commands once that API exists.

## End-to-End Flow

1. Operator decides to register a cluster (e.g. they've manually stood up k3s on a Hetzner box).
2. Operator runs `pnpm cluster:register dev "Dev Cluster" https://k3s.example.com:6443 --kubeconfig ~/.kube/config`. The script reads `CONTROL_PLANE_DB_URL`, opens a Postgres connection, reads the kubeconfig file, and inserts a row with `status='active'`.
3. Operator runs `pnpm cluster:list` — confirms the row landed.
4. (Future capability) Atlas's `runtime/deploy` flow looks up an active cluster, decrypts the auth, and uses `@kubernetes/client-node` to call the cluster's API.
5. (Future capability) `pnpm cluster:disable dev` flips status; subsequent deploys fail-fast against a disabled cluster rather than mid-deploy.

## What's Stubbed Today

**Nothing.** This is a forward-looking spec. No table, no port, no adapter, no script. The closest existing analogue is `tenancy/custom-domains`, which has the same shape — that spec is the pattern reference.

## What's NOT in scope

- Provisioning a node on Hetzner Cloud (separate capability: `cluster-bootstrap`).
- Live status probes against the cluster's `/version` endpoint (separate capability: `cluster-status`).
- Multi-cluster scheduling — picking *which* cluster a tenant deploys to (separate capability under `compute/runtime`).
- Tenant→cluster binding (which tenants are allowed on which clusters; default policy is "any active cluster"). Separate capability.
- atlasctl HTTP integration — atlasctl Phase B will add a control-plane API endpoint and a wrapping `atlasctl cluster register/list/disable` command. Phase 0 stays operator-script-only.
- At-rest encryption of `auth_secret`. Phase 0 stores it as TEXT, the same posture as `control_plane.tenants.db_password`. A future capability can add column-level encryption with a KMS-backed key without breaking this seam.
- Audit emission for cluster-CRUD operations. Should be added when the operator script is replaced with a real ingress-mediated path; for now operator actions are out-of-band.

## File-by-File Plan (for the implementation PR)

In execution order. Each step is a separate logical change but they ship as one PR.

1. **`adapters/node/src/migrations/control-plane/<YYYYMMDDHHMMSS>_clusters.sql`** — new migration:

   ```sql
   CREATE TABLE control_plane.clusters (
       cluster_id    TEXT PRIMARY KEY,
       name          TEXT NOT NULL,
       endpoint      TEXT NOT NULL,
       auth_kind     TEXT NOT NULL CHECK (auth_kind IN ('kubeconfig', 'token')),
       auth_secret   TEXT NOT NULL,
       region        TEXT,
       status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
       created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
   );
   ```

2. **`ports/src/cluster-store.ts`** — new port. Types-only (per `ports/CLAUDE.md`):

   ```ts
   export interface ClusterAddInput { clusterId; name; endpoint; authKind; authSecret; region? }
   export interface ClusterRecord   { clusterId; name; endpoint; authKind; authSecret; region; status; createdAt }
   export interface ClusterStore {
     add(input: ClusterAddInput): Promise<void>;
     get(clusterId: string): Promise<ClusterRecord | null>;
     list(opts?: { activeOnly?: boolean }): Promise<ReadonlyArray<ClusterRecord>>;
     disable(clusterId: string): Promise<void>;
   }
   ```

   Re-exported from `ports/src/index.ts`.

3. **`adapters/node/src/cluster-store.ts`** — new adapter. `PostgresClusterStore` implements `ClusterStore` against `control_plane.clusters`. Mirrors the shape of `PostgresCustomDomainStore`. Re-exported from `adapters/node/src/index.ts`.

4. **`scripts/atlas-cluster.ts`** — new operator script. Mirrors `scripts/atlas-domain.ts`:
   - `pnpm cluster:register <id> <name> <endpoint> --kubeconfig <path>` — reads file contents into `auth_secret`, `auth_kind='kubeconfig'`.
   - `pnpm cluster:register <id> <name> <endpoint> --token <token>` — uses `auth_kind='token'`, secret comes from arg (note: `--token-file` follow-up if the value is too sensitive for argv).
   - `pnpm cluster:list` — prints active clusters as a table.
   - `pnpm cluster:disable <id>` — flips status to `disabled`.

5. **Root `package.json`** — add the three `cluster:*` script entries (parallel to `domain:add`, `domain:list`, `domain:disable`).

6. **`packages/contract-tests/src/cluster-store.test.ts`** — contract test exercising `add → get → list → disable → list(activeOnly:true)`. Both `node` and `idb` adapters should pass it; `idb` impl will land when browser-side cluster reading becomes meaningful (probably never — clusters are server-only — so the `idb` impl can be a stub that throws "ClusterStore is platform-side only").

7. **`scripts/__tests__/atlas-cluster.test.ts`** (or wherever the operator-script test pattern lands) — smoke test that the script registers, lists, and disables against a test DB.

8. **`specs/LEXICON.md`** — add the new terms (Cluster, Cluster endpoint, Cluster auth).

9. **`specs/CLAUDE.md`** + root **`CLAUDE.md`** — drop the `*(stub, to be created)*` marker on the `compute/cluster` domain-map row.

## Things That DON'T Change

- **`control_plane.tenants` schema** — unchanged. Cluster registration is platform-level; tenants don't bind to clusters in this capability.
- **`atlasctl` Phase A surface** — unchanged. atlasctl gets cluster commands in Phase B once a control-plane API exists.
- **`apps/server/src/bootstrap.ts`** — unchanged. The server doesn't read cluster info during boot in Phase 0; the operator script runs out-of-band against the control-plane DB.
- **Existing `tenancy`, `identity`, `authz` flows** — unchanged.

If a future change *does* alter any of the above (e.g., the server starts caching cluster info at boot, or the migration is reshaped after `cluster-bootstrap` lands), it's a sign the capability is exceeding scope; revisit this spec.

## Acceptance

Tests the implementation PR must include:

- **Migration test** — running migrations against a fresh control-plane DB creates `control_plane.clusters` with the documented columns and constraints.
- **Adapter contract test** — `packages/contract-tests/src/cluster-store.test.ts > PostgresClusterStore > round-trip add → get → list → disable`.
- **Operator-script test** — `scripts/__tests__/atlas-cluster.test.ts > registers, lists, disables a cluster against a test DB` (or equivalent path; pattern follows whatever exists for `atlas-domain.ts`).
- **Lexicon present** — grep `specs/LEXICON.md` for "Cluster" returns the new entries.
- **N/A — handler test** — no intent handler ships in this capability.
- **N/A — dispatch / I12 test** — no projection ships in this capability.
- **N/A — BDD scenario** — no UI surface in this capability.

## Cross-References

- Platform README: [`../../../README.md`](../../../README.md)
- Domain README: [`../../README.md`](../../README.md)
- ADR introducing the Compute platform: [`../../../../../decisions/0002-developer-platform-domain-map.md`](../../../../../decisions/0002-developer-platform-domain-map.md)
- Vision: [`../../../../../vision.md`](../../../../../vision.md)
- Architecture invariants: [`../../../../../architecture.md`](../../../../../architecture.md)
- Capability template: [`../../../../../_capability-template.md`](../../../../../_capability-template.md)
- Pattern reference (same shape): [`../../../../tenancy/capabilities/custom-domains/README.md`](../../../../tenancy/capabilities/custom-domains/README.md)
- Existing operator script pattern: `scripts/atlas-domain.ts`
- Existing adapter pattern: `adapters/node/src/custom-domain-store.ts`
- atlasctl Phase B (deferred wrapping): [`../../../../../crosscut/atlasctl.md`](../../../../../crosscut/atlasctl.md)
