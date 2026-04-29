// Tenant-admin authz fixture for the cedar-check gauntlet.
//
// Permits the standard tenant-admin permission set against the Policy
// resource type. Validates against the deployment-wide schema generated
// from the bundled module manifest — the manifest now declares Policy
// as a `module`-owned resource type and the Authz.Policy.{List,Read,
// Create,Activate,Archive} actions all `appliesTo` Policy.
//
// Deliberately attribute-free: tenant-scoped enforcement is handled
// upstream by the engine's tenant-mismatch deny path
// (CedarPolicyEngine.evaluate), so the policy itself doesn't need an
// `principal.tenantId == resource.tenantId` clause. Adding entity
// attribute schemas later (audit followup #1) will let policies
// constrain on `principal.role` etc.

@id("authz-tenant-admin-list")
permit (
  principal,
  action == Action::"Authz.Policy.List",
  resource is Policy
);

@id("authz-tenant-admin-read")
permit (
  principal,
  action == Action::"Authz.Policy.Read",
  resource is Policy
);

@id("authz-tenant-admin-create")
permit (
  principal,
  action == Action::"Authz.Policy.Create",
  resource is Policy
);

@id("authz-tenant-admin-activate")
permit (
  principal,
  action == Action::"Authz.Policy.Activate",
  resource is Policy
);

@id("authz-tenant-admin-archive")
permit (
  principal,
  action == Action::"Authz.Policy.Archive",
  resource is Policy
);
