# Capability: Custom Domains

**Domain:** tenancy
**Status:** **Stubbed.** The architectural seam (Host header → tenant id) is
landed and tested. The operational scaffolding (DNS verification, cert
issuance, edge tier) is intentionally out of scope and lives behind a
clearly-marked upgrade path documented below.

## Purpose

Lets a tenant serve their Atlas instance from a hostname they own
(`community.acme.com`) instead of the default subdomain
(`acme.atlas.example.com`). The customer-facing experience is white-label
(or partially branded) without changing how Atlas resolves the tenant
internally.

## What's Stubbed Today

The seam is fully wired:

- **Table** `control_plane.custom_domains`
  (`adapters/node/src/migrations/control-plane/20260503000001_custom_domains.sql`).
  Columns: `hostname`, `tenant_id`, `status` (active|disabled),
  `is_primary`, `created_at`. **Verification + cert columns are deliberately
  not present** — they land in a follow-up migration when the real flow
  ships.
- **Port** `CustomDomainStore` (`ports/src/custom-domain-store.ts`).
- **Postgres adapter** `PostgresCustomDomainStore`
  (`adapters/node/src/custom-domain-store.ts`).
- **Resolver** `resolveHostTenant` + `TenantHostCache`
  (`apps/server/src/middleware/tenant-resolution.ts`). 60s TTL cache;
  positive *and* negative caching to keep unrecognised hosts off the DB.
- **Middleware integration** in
  `apps/server/src/middleware/principal.ts`. The Host resolution runs
  before the auth flow; if the resolved tenant id and the JWT/debug
  principal's tenant id disagree, the request is rejected with
  PRINCIPAL_INVALID/403.
- **Link helper** `tenantBaseUrl(tenantId, store, fallbackBase)`
  (`packages/platform-core/src/tenant-urls.ts`). Returns the primary
  custom-domain URL when one exists; falls back to the subdomain
  otherwise. **Use this anywhere code constructs a tenant-facing URL** —
  email links, OIDC redirects, canonical metadata.
- **Hostname normalization** `normalizeHost(host)` in the same module.
  Lowercase + strip port + strip trailing dot. Use at every boundary that
  touches the table.
- **Operator CLI** `scripts/atlas-domain.ts`, exposed via:
  - `pnpm domain:add <tenant-id> <hostname> [--primary]`
  - `pnpm domain:list [<tenant-id>]`
  - `pnpm domain:disable <hostname>`

What's **NOT** stubbed (and is not meant to be):

- DNS-TXT verification of customer-supplied domains.
- Cert issuance (Let's Encrypt, ACM, Cloudflare for SaaS).
- The edge tier that terminates TLS using SNI for arbitrary hostnames.
- Self-service admin UI for adding / verifying / removing domains.
- Status state machine beyond `active | disabled`. The real flow needs
  `pending → verified → active`.

## How a Stub Domain Lands End-to-End

1. Operator runs `pnpm domain:add acme community.acme.com --primary`. The
   row is inserted with `status='active', is_primary=true`. No DNS
   check, no cert.
2. Customer (out-of-band) points DNS at the Atlas instance — typically a
   CNAME to whatever fronts apps/server (Cloudflare for SaaS or similar
   edge tier; in dev, just `127.0.0.1`).
3. Customer (or their edge) terminates TLS for the hostname. In dev,
   `mkcert` for a local cert and a hosts-file entry are sufficient.
4. A request lands at apps/server with `Host: community.acme.com`. The
   middleware resolves the tenant via `custom_domains` lookup and
   stashes it on the Hono context as `hostTenantId`.
5. The auth flow runs as today (JWT or debug principal). If its tenant
   id agrees with `hostTenantId`, the request continues. If it disagrees,
   403.

## Replacing the Stub With the Real Thing — File-by-File

Listed in execution order. Steps 1–3 are additive; step 4 introduces the
first piece of code that runs in a worker rather than in-request.

### 1. New migration: `*_custom_domains_verification.sql`

Adds nullable columns and widens the status check:

```sql
ALTER TABLE control_plane.custom_domains
    ADD COLUMN validation_token TEXT,
    ADD COLUMN verified_at      TIMESTAMPTZ,
    ADD COLUMN cert_provider    TEXT,
    ADD COLUMN cert_ref         TEXT;

ALTER TABLE control_plane.custom_domains
    DROP CONSTRAINT custom_domains_status_check;
ALTER TABLE control_plane.custom_domains
    ADD CONSTRAINT custom_domains_status_check
    CHECK (status IN ('pending', 'verified', 'active', 'disabled'));
```

### 2. Extend `adapters/node/src/custom-domain-store.ts`

Add to the port surface and the Postgres adapter:

- `addPending(input)` — like `add` but inserts with `status='pending'`
  and a freshly-minted `validation_token`.
- `setVerified(hostname, verifiedAt)` — `pending → verified`.
- `setCertRef(hostname, provider, ref)` — `verified → active` once a
  cert is in hand.
- The existing `getByHostname` / `getPrimary` queries already filter
  `status='active'` so they continue to work — the new states are
  invisible to the resolver until they reach `active`.

### 3. Extend `scripts/atlas-domain.ts`

- `add` defaults to `pending` (the current behaviour becomes
  `add --operator-active` for concierge mode).
- New `verify <hostname>` subcommand for operators who want to flip a
  row by hand after manual DNS check.
- New `set-cert <hostname> <provider> <ref>` for operators recording an
  externally-issued cert.

### 4. New: `apps/server/src/workers/domain-validator.ts`

Runs out-of-band (cron or polling worker). Reads `pending` rows; for
each, looks up the expected TXT record at `_atlas-verify.<hostname>` via
DNS; on match, calls `setVerified`. This is the **first** piece of code
that runs in a worker rather than in-request. Wire it in either:
- a separate process (`apps/worker` or similar), or
- a setInterval inside `apps/server` if traffic + cardinality are low.

### 5. New: `apps/server/src/workers/cert-issuer.ts`

Reads `verified` rows. Calls Cloudflare for SaaS' hostname-add API (or
ACM, or whatever edge tier is in use) to provision a cert for the
hostname, then `setCertRef(...)` to flip to `active`. The resolver
picks them up next request.

### 6. Self-service admin UI

A new surface in the tenant admin: "Custom Domains" with a wizard for
adding + showing verification instructions + status. Lives in
`apps/admin/src/features/`. Out of scope for this stub.

### 7. Things that DON'T change

The whole point of the stub is that these stay unchanged through the
upgrade:

- **The resolver function** (`tenant-resolution.ts`) — still does an
  exact-match lookup against `custom_domains` filtered to `active`.
- **The middleware integration** in `principal.ts` — the
  `hostTenantId !== authTenantId` guard is correct as-is.
- **The link helper** (`tenant-urls.ts`).
- **The data-model primary key** (`hostname`).
- **The unit tests** for resolver + cache.
- **The integration test** asserts the same gate behaviour.
- **The operator's `disable` command** — same query.

If a future change *does* alter any of the above, it's a sign the
upgrade is reaching beyond "operational scaffolding" into core seam
territory; revisit this doc.

## Cross-references

- Spec: [`specs/domains/tenancy/`](../../README.md), [`tenancy.md`](../../tenancy.md)
- Migration: [`adapters/node/src/migrations/control-plane/20260503000001_custom_domains.sql`](../../../../../adapters/node/src/migrations/control-plane/20260503000001_custom_domains.sql)
- Port: [`ports/src/custom-domain-store.ts`](../../../../../ports/src/custom-domain-store.ts)
- Adapter: [`adapters/node/src/custom-domain-store.ts`](../../../../../adapters/node/src/custom-domain-store.ts)
- Resolver: [`apps/server/src/middleware/tenant-resolution.ts`](../../../../../apps/server/src/middleware/tenant-resolution.ts)
- Middleware integration: [`apps/server/src/middleware/principal.ts`](../../../../../apps/server/src/middleware/principal.ts)
- Link helper: [`packages/platform-core/src/tenant-urls.ts`](../../../../../packages/platform-core/src/tenant-urls.ts)
- Operator CLI: [`scripts/atlas-domain.ts`](../../../../../scripts/atlas-domain.ts)
- Unit tests: [`apps/server/src/middleware/tenant-resolution.test.ts`](../../../../../apps/server/src/middleware/tenant-resolution.test.ts), [`adapters/node/test/custom-domain-store.test.ts`](../../../../../adapters/node/test/custom-domain-store.test.ts)
- Integration test: [`tests/integration/custom-domains.itest.ts`](../../../../../tests/integration/custom-domains.itest.ts)
