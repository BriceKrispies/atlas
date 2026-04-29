-- Enforce "exactly one active row per tenant" at the database level.
--
-- Application-side activation flow demotes the previous active row and
-- promotes the new one in the same transaction. Without this constraint a
-- race between two concurrent activations could leave two rows
-- `status='active'` for the same tenant; the bundle loader works around
-- that today by picking `ORDER BY version DESC LIMIT 1`, but the right
-- fix is to push the invariant down to Postgres.
--
-- We DROP the prior non-unique index of the same shape first; the unique
-- variant supersedes it (Postgres will use it for both equality and
-- ORDER BY queries).

DROP INDEX IF EXISTS control_plane.idx_policies_status;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_policies_active_per_tenant
    ON control_plane.policies(tenant_id)
    WHERE status = 'active';
