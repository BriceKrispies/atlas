// Sample Cedar policy bundle for the badge-family slice.
//
// Demonstrates the four shapes the Atlas authoring UI should round-trip:
//   1. role-in (`principal in Role::"editor"`)
//   2. simple permit on a specific action
//   3. attribute-based permit (department match)
//   4. forbid that overrides a broader permit (Invariant I4)
//
// Used by `tests/parity/policy-cedar-node.test.ts` and the admin UI's
// preview surface (Chunk 6c, deferred). Keep small — exhaustive coverage
// belongs in the contract suite, not the sample.

// ------------------------------------------------------------------
// 1. Editors may publish any family in their tenant.
// ------------------------------------------------------------------
@id("editors-can-publish")
permit (
  principal,
  action == Action::"Catalog.Family.Publish",
  resource is Family
)
when {
  principal.role == "editor"
};

// ------------------------------------------------------------------
// 2. Anyone in the same department as the resource owner may read it.
//    Demonstrates attribute-based access keyed off both principal +
//    resource attribute snapshots from the request envelope.
// ------------------------------------------------------------------
@id("department-can-read")
permit (
  principal,
  action == Action::"Catalog.Family.Read",
  resource is Family
)
when {
  principal.department == resource.department
};

// ------------------------------------------------------------------
// 3. Owners may always archive their own families.
// ------------------------------------------------------------------
@id("owner-can-archive")
permit (
  principal,
  action == Action::"Catalog.Family.Archive",
  resource is Family
)
when {
  resource.ownerId == principal.id
};

// ------------------------------------------------------------------
// 4. Forbid: families flagged `protected: true` cannot be deleted by
//    anyone — even an editor. Cedar's deny-overrides semantics
//    (Invariant I4) ensures this wins over any matching permit.
// ------------------------------------------------------------------
@id("protected-families-cannot-be-deleted")
forbid (
  principal,
  action == Action::"Catalog.Family.Delete",
  resource is Family
)
when {
  resource has protected && resource.protected == true
};
