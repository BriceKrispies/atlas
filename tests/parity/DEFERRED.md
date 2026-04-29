# Deferred parity scenarios

These Rust black-box scenarios are not yet ported. Each line documents
what would need to land first.

## Sim-only

_None._ The four scenarios that previously lived here graduated to paired
sim/node parity in **Chunk 7.2** when `apps/server` shipped the test-only
debug surface (`/debug/events/:eventId`, `/debug/search/index`,
`/debug/search/rebuild`, `/debug/cache/clear`). Both modes are now exercised:

| Rust scenario | Node-mode file | Debug endpoint that unblocked it |
|--|--|--|
| `catalog_badge_family::test_seed_event_has_cache_invalidation_tags` | `catalog-search-node.test.ts` | `GET /debug/events/:eventId` |
| `catalog_search::test_search_permission_filter_excludes_disallowed` | `catalog-search-node.test.ts` | `POST /debug/search/index` |
| `catalog_search::test_search_rebuild_is_deterministic` | `catalog-search-node.test.ts` | `POST /debug/search/rebuild` |
| `catalog_search::test_search_index_cache_invalidation_tag_present` | `catalog-search-node.test.ts` | `GET /debug/events/:eventId` |

The debug surface is gated by `DEBUG_AUTH_ENDPOINT_ENABLED=true` and
`TEST_AUTH_ENABLED=true`, matching the Rust ingress gate (see
`crates/ingress/src/main.rs`). When either is unset the routes aren't
mounted and the node-mode helpers (`readEventTags`, `truncateSearch`,
`indexSearchDocument`) raise `UnsupportedInMode` so tests skip cleanly.

## Deferred for both modes

_None._ The three Keycloak-dependent scenarios graduated to node parity
in **Chunk 9** when `apps/server`'s JWT path landed alongside the baked
`atlas` realm in `infra/compose/config/keycloak/atlas-realm.json`:

| Rust scenario | Node-mode file | What unblocked it |
|--|--|--|
| `authentication_test::test_keycloak_is_reachable` | `keycloak-node.test.ts` | Keycloak service in `compose.itest-infra.yml` + supervisor wait in `itest_supervisor.rs::wait_for_keycloak` |
| `authentication_test::test_valid_keycloak_token_returns_200_with_principal` | `keycloak-node.test.ts::test_valid_keycloak_token_grants_access` | `client_credentials` mint via `atlas-s2s` + JWKS verify in `apps/server/src/middleware/principal.ts` |
| `authentication_test::test_valid_token_extracts_correct_principal` | `keycloak-node.test.ts::test_valid_keycloak_token_principal_extraction` | `tenant_id` claim mapper baked into the realm export — extracted by `principal.ts` and surfaced via `/debug/whoami` |

The new tests skip cleanly when `KEYCLOAK_BASE_URL` is unset (mirrors the
existing `NODE_PARITY_BASE_URL` gate). `atlas itest` exports both via
`itest_supervisor::run_blackbox_tests`; standalone `pnpm test:parity:node`
runs assume the supervisor (or the `make itest-up` stack) is already up.

### Unblocked by Chunk 7.1

`/metrics` (Prometheus text format) shipped in Chunk 7.1 with the
`@atlas/metrics` package. The 5 observability scenarios + the
`authorization_test::test_policy_evaluation_metrics_recorded`
scenario now have a node-mode counterpart in
`tests/parity/observability-node.test.ts`. Note: the Atlas TS metric
names are namespace-prefixed (`atlas_*`); the Rust counterparts are
not. Dashboards must use the prefix-aware names when querying the
TS-backed deployment.

### Unblocked by Chunk 7

- `render_tree_test.rs` (1 scenario) — covered by
  `content-pages-sim.test.ts::test_render_tree_is_default_shape` and
  the matching `content-pages-node.test.ts` pair.
- `persistence_test.rs` (1 scenario) — covered by
  `content-pages-sim.test.ts::test_render_tree_survives_fast_path_clear`
  AND `content-pages-node.test.ts::test_render_tree_survives_fast_path_clear`.
  Paired in Chunk 10 via `POST /debug/render-tree/clear?pageId=...`,
  gated by `DEBUG_AUTH_ENDPOINT_ENABLED=true`. Cross-language WASM
  plugin parity (`tests/parity/wasm-plugin-node.test.ts`) shipped at
  the same time, exercising the demo-transform plugin against the
  Node + browser hosts.

## Counts

- Total Rust scenarios across the 12 suites: **58**.
- Ported in Chunks 5 + 7 + 7.1 + 7.2 + 9 + 10: **58** scenarios. All
  paired sim/node where applicable.
  - 47 Chunk-5 originals as paired sim/node.
  - 4 Chunk-5 sim-only scenarios that flipped to paired in 7.2.
  - 5 observability scenarios + 1 authz-metrics paired in 7.1.
  - 1 render-tree paired in 7; 1 persistence paired in 10
    (`/debug/render-tree/clear`).
  - 3 Keycloak smoke + token-extraction paired in **Chunk 9**.
- Deferred: **0**.

The Keycloak parity scenarios round out the request path; every Rust
black-box scenario now has a node-mode counterpart.
