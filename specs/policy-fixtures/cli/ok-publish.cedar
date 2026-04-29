// Positive CLI fixture for `pnpm cedar:check`.
//
// Validates against the deployment-wide schema generated from the bundled
// module manifest. Uses ONLY actions + resources that the manifest
// declares — `Catalog.Family.Publish` against `Family`.
//
// NOTE: deliberately attribute-free. Cedar's strict-mode validator
// (cedar-wasm 4.10) rejects attribute access against entity types that
// don't declare a closed shape. Until module manifests grow a structured
// attribute schema (Chunk 6c+1), positive CLI fixtures stick to action +
// entity-type checks. Attribute-based policies live in
// `specs/policy-fixtures/badge-family-rbac.cedar` and are exercised by
// the parity tests, not by `cedar:check`.

@id("editors-can-publish-families")
permit (
  principal,
  action == Action::"Catalog.Family.Publish",
  resource is Family
);
