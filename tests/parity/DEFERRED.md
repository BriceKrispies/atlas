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

| Rust suite | Scenarios | Why deferred |
|--|--|--|
| `authentication_test.rs::test_valid_keycloak_token_*` | 2 | Requires a live Keycloak realm with the `atlas-s2s` client. The current parity stack assumes test-auth via `X-Debug-Principal`; standing up Keycloak in the parity loop is a follow-up once `apps/server` integration with `atlas itest` lands. |
| `authentication_test.rs::test_keycloak_is_reachable` | 1 | Same as above — Keycloak smoke test. |

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
  `content-pages-sim.test.ts::test_render_tree_survives_fast_path_clear`.
  Sim-only today — node mode needs a `/debug/render-tree/clear` endpoint
  to flip the in-memory projection without a process restart. Follow-up.

## Counts

- Total Rust scenarios across the 12 suites: **58**.
- Ported in Chunks 5 + 7 + 7.1 + 7.2: **57** scenarios.
  - 47 Chunk-5 originals as paired sim/node.
  - 4 Chunk-5 sim-only scenarios that flipped to paired in 7.2.
  - 5 observability scenarios + 1 authz-metrics paired in 7.1.
  - 1 render-tree paired in 7; 1 persistence sim-only with a documented
    node-mode follow-up.
- Deferred: **3** Keycloak-related scenarios (depend on a live Keycloak
  realm in the parity loop).

The remaining gap is the Keycloak integration story; everything else on
the request path now has parity coverage in both sim and node modes.
