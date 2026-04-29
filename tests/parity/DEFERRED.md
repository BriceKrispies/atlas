# Deferred parity scenarios

These Rust black-box scenarios are not yet ported in Chunk 5. Each line
documents what would need to land first.

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
| `render_tree_test.rs` | 1 | Render-tree is content-pages module territory. The TS port hasn't started — see Chunk 7. |
| `persistence_test.rs` | 1 | Tests "render tree survives cache clear" — depends on render-tree (Chunk 7+). |
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

## Counts

- Total Rust scenarios across the 12 suites: **58**.
- Ported in Chunks 5 + 7.2: **51** scenarios as paired sim/node tests
  (47 Chunk-5 originals + the 4 ex-sim-only scenarios that flipped to
  paired in Chunk 7.2).
- Deferred: **8** (render-tree 1, observability 5, persistence 1, Keycloak smoke 1).
  Authorization metrics overlaps with observability so it counts once.

The only remaining surface debt for parity completion is the Prometheus
`/metrics` endpoint (unblocks the observability suite + authorization
metrics), and the render-tree projection (unblocks render-tree +
persistence).
