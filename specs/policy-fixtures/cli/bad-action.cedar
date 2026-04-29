// Negative-test fixture for `pnpm cedar:check`.
//
// References `Action::"Catalog.Family.NoSuchAction"` — an action not in
// the bundled module manifest. The CLI expects this fixture to FAIL
// schema validation; if it ever validates clean, something is wrong with
// the schema generator or cedar-wasm's strict-mode validator.
//
// Naming: files under `specs/policy-fixtures/cli/` whose basename starts
// with `bad-` are negative fixtures (validation must fail). Anything else
// is a positive fixture (validation must pass).

@id("permits-non-existent-action")
permit (
  principal,
  action == Action::"Catalog.Family.NoSuchAction",
  resource is Family
);
