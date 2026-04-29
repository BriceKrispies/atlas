// Default content-pages authz fixture for the cedar-check gauntlet.
//
// Permits the standard tenant-admin permission set against the Page
// resource type. Validates against the deployment-wide schema generated
// from the bundled module manifest — the manifest declares Page as a
// `module`-owned resource type and the ContentPages.Page.{Create,Read,
// Update,Delete} actions all `appliesTo` Page.
//
// Tenant-scoped enforcement is handled upstream by the engine's
// tenant-mismatch deny path (CedarPolicyEngine.evaluate), so the policy
// doesn't need an explicit `principal.tenantId == resource.tenantId`
// clause. Adding entity attribute schemas later (audit followup) will
// let policies constrain on `principal.role` etc.

@id("content-pages-tenant-admin-create")
permit (
  principal,
  action == Action::"ContentPages.Page.Create",
  resource is Page
);

@id("content-pages-tenant-admin-read")
permit (
  principal,
  action == Action::"ContentPages.Page.Read",
  resource is Page
);

@id("content-pages-tenant-admin-update")
permit (
  principal,
  action == Action::"ContentPages.Page.Update",
  resource is Page
);

@id("content-pages-tenant-admin-delete")
permit (
  principal,
  action == Action::"ContentPages.Page.Delete",
  resource is Page
);
