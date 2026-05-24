-- Compute platform — cluster registry (cluster-registration capability).
--
-- Records the Kubernetes clusters Atlas can deploy workloads to: endpoint,
-- credential, region, lifecycle status. Platform-level (NOT tenant-scoped) —
-- cluster records apply across the whole deployment (I7: no per-tenant data
-- here; tenant→cluster bindings are a separate capability). Operators register
-- clusters during Phase 0 via `scripts/atlas-cluster.ts` (direct DB, trusted
-- operator — same posture as `scripts/atlas-domain.ts`).
--
-- `auth_secret` is stored as TEXT in Phase 0 (same posture as
-- `control_plane.tenants.db_password`); at-rest encryption is a future
-- capability. Register/disable are idempotent at the operator-script level (I3).
--
-- @spec specs/domains/compute/cluster/capabilities/cluster-registration/README.md

SET search_path TO control_plane, public;

CREATE TABLE control_plane.clusters (
    cluster_id    TEXT        NOT NULL PRIMARY KEY,
    name          TEXT        NOT NULL,
    endpoint      TEXT        NOT NULL,
    auth_kind     TEXT        NOT NULL CHECK (auth_kind IN ('kubeconfig', 'token')),
    auth_secret   TEXT        NOT NULL,
    region        TEXT,
    status        TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
