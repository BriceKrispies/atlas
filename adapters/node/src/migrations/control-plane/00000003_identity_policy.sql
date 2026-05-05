-- Phase A5.8 — per-tenant identity policy.
--
-- `identity_policy_json` mirrors the `IdentityPolicy` shape in
-- `@atlas/identity` (`modules/identity/src/types.ts`). NULL means
-- "use the platform defaults" — tenants that haven't customized stay
-- at (mfaRequired=false, attestation=['none'], recoveryCount=10,
-- lockoutThreshold=5, lockoutMinutes=15) without an explicit row write.
--
-- Distinct from `session_policy_json` (Phase A2.4) — sessions and
-- MFA are different policy surfaces and merging them would force
-- tenants to update both when only one changed. Merge later if the
-- doubled column count gets unwieldy.

ALTER TABLE control_plane.tenants
  ADD COLUMN IF NOT EXISTS identity_policy_json JSONB NULL;
