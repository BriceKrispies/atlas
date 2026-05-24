# `tools/db-snapshot`

Atlas-aware Postgres **capture / restore / verify** tool. Produces a
structured-JSON snapshot of the full control-plane + per-tenant database
topology, restores it byte-for-byte, and verifies a live database against a
golden bundle.

This is W0 of the snapshot workstream — a **pre-materializer stepping stone**.
ADR 0014 (snapshot materializer) is deferred; this tool is the manual,
script-driven precursor that captures the same shape ADR 0014 will eventually
own.

## Why structured JSON, not `pg_dump`

`pg_dump` output is opaque to diffing and not codec-aware. This tool emits one
JSON file per database with a **fixed key order**, so a re-capture of unchanged
data produces a byte-identical file and `git diff` is meaningful. Values are
encoded losslessly through a small codec so binary, big-integer, timestamp, and
array/jsonb values survive a JSON round-trip exactly.

## Format contract

Output directory (default `fixtures/golden/`):

```
control_plane.json        # the control-plane DB
tenants/<tenantId>.json   # one per provisioned tenant DB
manifest.json             # capturedAt, per-DB tables+rowcounts, _migrations set, sha256 per file
```

Each DB file is `JSON.stringify(…, null, 2)` with a **fixed top-level key
order** and a **trailing newline**. Row values use these wrappers:

| Postgres type        | JSON form                         |
|----------------------|-----------------------------------|
| `bytea`              | `{ "$bytea": "<base64>" }`        |
| `bigint` / bigserial | `{ "$bigint": "<decimal string>" }` |
| `timestamptz`        | ISO-8601 string (verbatim)        |
| `text[]`             | JSON array of strings             |
| `jsonb` / `json`     | value as-is (object/array/scalar) |
| `uuid` / `text` / …  | passthrough scalar                |
| `NULL`               | `null`                            |

Generated columns (`is_generated = 'ALWAYS'`, e.g.
`catalog_search_documents.search_vector`) are **never captured** — they
re-derive identically on restore.

## Restore semantics — verbatim

Restore reproduces the captured bytes exactly:

- Tenant runtime roles are recreated with the **captured `db_password`** (not a
  freshly generated one). `provisionTenantDatabase` is intentionally NOT used —
  it would rotate the password and break consistency with the captured
  `control_plane.tenants` row.
- `events.seq` (bigserial) and all timestamps are inserted verbatim; sequences
  are then `setval`'d to `COALESCE(MAX(col), 1)`.
- Schema is built by re-running the bundled migrations
  (`runMigrations(sql, 'control-plane' | 'tenant')`). `_migrations` rows are NOT
  inserted (the runner owns them); instead the captured filename set is
  ASSERTED equal to what the runner applied — a mismatch means schema drift
  between the golden snapshot and the current migrations.
- `control_plane.registry_version` is seeded by a migration, so its captured
  row is UPSERTed onto the seeded singleton (the captured `version` wins).

## Verify

`verify` loads the golden bundle, re-captures the live topology, and diffs.
Non-zero exit on any diff. The diff is **full deep-equal** minus a tiny
Postgres-derived exclusion set:

- `EXCLUDED_COLUMNS`: `catalog_search_documents.search_vector` (generated).
- `SET_MATCH_TABLES`: `_migrations` is compared by its `filename` **set** only
  (the runner regenerates `id` / `executed_at`).

jsonb / array cells are compared structurally, so key order and whitespace
inside a jsonb document are non-issues.

## Usage

```sh
# Capture (READ-ONLY) the live topology into fixtures/golden/
node --experimental-transform-types tools/db-snapshot/src/cli-capture.ts [goldenDir]

# Restore a golden bundle. By default targets the control-plane DB named in
# CONTROL_PLANE_DB_URL — pass --control-plane-db <scratch> to avoid clobbering.
node --experimental-transform-types tools/db-snapshot/src/cli-restore.ts [goldenDir] --control-plane-db <scratch>

# Verify the live topology matches golden (exit 1 on any diff)
node --experimental-transform-types tools/db-snapshot/src/cli-verify.ts [goldenDir]
```

`CONTROL_PLANE_DB_URL` defaults to the `make db-up` loopback URL.

## Safety warnings

- **The golden bundle carries secrets.** `control_plane.tenants` rows include
  `db_password` verbatim. `fixtures/golden/` is **gitignored** — do not commit
  it.
- **Loopback only.** All three CLIs refuse a non-loopback DB host (mirrors
  `scripts/dev-up.ts` `assertLoopback`). This is a developer-laptop tool.
- **Capture is READ-ONLY.** It only issues `SELECT` and `information_schema`
  reads. Restore WRITES (creates databases/roles, inserts rows) — point it at
  scratch databases unless you intend to overwrite.

## Tests

- Unit (pure, no DB): `tools/db-snapshot/test/codec.test.ts` (encode/decode
  round-trip per type), `tools/db-snapshot/test/diff.test.ts` (diff core,
  exclusion set, `_migrations` set-match).
- Round-trip integration: `tools/db-snapshot/test/round-trip.test.ts` captures
  the live control-plane (read-only), restores into **scratch** databases,
  re-captures, and asserts zero diffs. Tears down all scratch DBs in `afterAll`.
  Skipped silently when no Postgres is reachable.

```sh
node packages/test/bin/atlas-test.mjs tools/db-snapshot/test/codec.test.ts tools/db-snapshot/test/diff.test.ts
node packages/test/bin/atlas-test.mjs tools/db-snapshot/test/round-trip.test.ts
```
