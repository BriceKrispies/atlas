// Default DSL-expression authz fixture for the cedar-check gauntlet.
//
// Permits the read-side DSL authoring actions against the DslArtifact
// resource type. Validates against the deployment-wide schema generated
// from the bundled module manifest — `specs/domains/dsl/expression/
// module.manifest.json` declares DslArtifact as a `module`-owned resource
// type and the Dsl.Expression.{Read,List,Validate} actions all `appliesTo`
// DslArtifact.
//
// This is the read/validate analog of `authz-tenant-admin.cedar` and
// `content-pages-default.cedar`: a permit-by-action shape that grants a
// tenant-admin principal the DSL read surface. Anonymous + unprivileged
// principals are denied by the ABSENCE of a matching permit (Cedar is
// default-deny; only an explicit permit grants access — Invariant I4's
// deny-overrides-allow means even an added permit can be subtracted by a
// tenant deny).
//
// Tenant-scoped enforcement is handled upstream by the engine's
// tenant-mismatch deny path (CedarPolicyEngine.evaluate), so the policy
// doesn't need an explicit `principal.tenantId == resource.tenantId`
// clause. At runtime, the platform-default role packs
// (`modules/identity/src/policies/role-packs.ts`) classify these read/list
// verbs into the read bucket and grant them to TenantAdmin / Author /
// Viewer automatically; this fixture is the static-analysis witness that
// the action ids validate against the schema.

@id("dsl-expression-default-read")
permit (
  principal,
  action == Action::"Dsl.Expression.Read",
  resource is DslArtifact
);

@id("dsl-expression-default-list")
permit (
  principal,
  action == Action::"Dsl.Expression.List",
  resource is DslArtifact
);

@id("dsl-expression-default-validate")
permit (
  principal,
  action == Action::"Dsl.Expression.Validate",
  resource is DslArtifact
);
