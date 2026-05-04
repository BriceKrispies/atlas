-- Phase A2 (#A2.4) — per-tenant session policy.
--
-- `session_policy_json` mirrors the `SessionPolicy` shape in
-- `@atlas/identity` (`modules/identity/src/types.ts`). NULL means "use
-- the platform defaults" — tenants that haven't customized stay at
-- (10/30/24/30) without an explicit row write.
--
-- Rationale for JSONB over typed columns: per-tenant policies will
-- gain fields over time (passkey-only requirement, MFA-required
-- threshold, etc.) — adding columns each time triggers ALTER TABLE
-- on a hot table. JSONB lets the policy schema evolve without DDL.

ALTER TABLE control_plane.tenants
  ADD COLUMN IF NOT EXISTS session_policy_json JSONB NULL;
