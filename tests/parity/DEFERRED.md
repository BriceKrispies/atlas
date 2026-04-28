# Deferred parity scenarios

These Rust black-box scenarios are not yet ported in Chunk 5. Each line
documents what would need to land first.

## Sim-only

These scenarios exist in `tests/parity/<suite>-sim.test.ts` but have no
node-mode counterpart, because `apps/server` does not yet expose the
debug surface they require.

| Rust scenario | Sim file | Why no node counterpart |
|--|--|--|
| `catalog_badge_family::test_seed_event_has_cache_invalidation_tags` | `catalog-sim.test.ts` | Requires reading raw `EventEnvelope.cacheInvalidationTags` off the event store. The Rust black-box also covers this only indirectly in node mode; until `apps/server` ships a `/debug/events/:eventId` endpoint, the same in node mode is impossible without a direct DB connection from tests. |
| `catalog_search::test_search_permission_filter_excludes_disallowed` | `catalog-sim.test.ts` | Requires injecting a search document with custom `permissionAttributes`. The Rust black-box uses `POST /debug/search/index`, which `apps/server` has not yet shipped. |
| `catalog_search::test_search_rebuild_is_deterministic` | `catalog-sim.test.ts` | Requires truncating `catalog_search_documents` mid-test. The Rust black-box uses a direct sqlx connection. The TS server has no equivalent debug endpoint. |
| `catalog_search::test_search_index_cache_invalidation_tag_present` | `catalog-sim.test.ts` | The Rust black-box version is "indirect": apply seed, see hits, conclude tags worked. The sim version reads tags directly. The TS server cannot replay the indirect proof without rebuild access (above) so the node counterpart is blocked on the same debug surface. |

## Deferred for both modes

| Rust suite | Scenarios | Why deferred |
|--|--|--|
| `render_tree_test.rs` | 1 | Render-tree is content-pages module territory. The TS port hasn't started — see Chunk 7. |
| `observability_test.rs` | 5 | `apps/server` has not yet shipped `/metrics` (Prometheus text format). Port these once Chunk 6+ adds the metrics surface. |
| `persistence_test.rs` | 1 | Tests "render tree survives cache clear" — depends on render-tree (Chunk 7+). |
| `authentication_test.rs::test_valid_keycloak_token_*` | 2 | Requires a live Keycloak realm with the `atlas-s2s` client. The current parity stack assumes test-auth via `X-Debug-Principal`; standing up Keycloak in the parity loop is a follow-up once `apps/server` integration with `atlas itest` lands. |
| `authentication_test.rs::test_keycloak_is_reachable` | 1 | Same as above — Keycloak smoke test. |
| `authorization_test.rs::test_policy_evaluation_metrics_recorded` | 1 | Depends on `/metrics` (see observability above). |

## Counts

- Total Rust scenarios across the 12 suites: **58**.
- Ported in Chunk 5: **47** scenarios as paired sim/node tests, plus
  **4 sim-only** scenarios where the node debug surface doesn't exist yet.
- Deferred: **8** (render-tree 1, observability 5, persistence 1, Keycloak smoke 1).
  Authorization metrics overlaps with observability so it counts once.

When the `/metrics` endpoint and `/debug/search/index` ship in `apps/server`,
the deferred sim/node pairs unblock without changes to test bodies — only the
node counterpart files are added.
