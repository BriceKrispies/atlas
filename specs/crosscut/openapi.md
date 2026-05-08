# Atlas OpenAPI surface

Atlas exposes its HTTP API through two **generated** OpenAPI 3.1 documents:

| Document | Audience | Path | Stability |
|---|---|---|---|
| **Tenant API** | tenant developers writing apps that integrate with Atlas | `specs/openapi.tenant.json` | high — backwards-compat is enforced |
| **Operator API** | operators, atlasctl, internal tooling | `specs/openapi.operator.json` | medium — can churn between phases |

Both are **build artifacts**, not hand-maintained documents. They are emitted by `pnpm sync-openapi` (mirrors the `pnpm sync-schemas` pattern) from authoritative sources and committed to git so external consumers can read them without standing up a build.

This spec covers the generation pipeline, the source-of-truth rules, how the two documents differ, and the conventions SDK consumers must understand.

## Sources of truth

Atlas already has the authoritative declarations. The generator reads them:

| Source | What it declares | Used for |
|---|---|---|
| **Module manifests** (bundled in `@atlas/schemas` from `manifests/`) | per-module: actions (`actionId`, payload schemaId, resourceType), events, projections | the intents endpoint expansion (one operation per action) |
| **JSON Schema contracts** (`specs/schemas/contracts/*.schema.json`, bundled into `@atlas/schemas/src/generated/`) | per-action payload shapes; envelope shape; error envelope | OpenAPI `components/schemas` entries; payload bodies |
| **Error taxonomy** ([`errors.md`](errors.md)) | every error code; status mapping | per-operation `responses` entries |
| **Route annotations** (`apps/server/src/openapi-routes.ts`, see below) | non-intent routes — paths, methods, security, request/response shapes, audience | every operation outside the intents endpoint |
| **Auth schemes** (`apps/server/src/middleware/principal.ts`) | JWT, API key, OAuth2 client-credentials | OpenAPI `securitySchemes` |

**Hand-written OpenAPI YAML is forbidden.** If a route exists, it appears in the generated spec by virtue of an annotation in `openapi-routes.ts` or by virtue of being declared in a manifest. There is no other path. This rule keeps the document from rotting.

## Audience filter — what's in each document

Every action and every annotated route is tagged with an `audience: 'tenant' | 'operator' | 'internal'` value. The generator filters by audience to emit each document.

| Audience | Tenant doc | Operator doc | What goes here |
|---|---|---|---|
| `tenant` | ✓ | ✓ | Intent submission for tenant-scoped actions, signup, public reads, events SSE — anything a tenant developer writes against. |
| `operator` | ✗ | ✓ | `/admin/*`, `/debug/*`, control-plane discovery (Phase B), atlasctl-facing endpoints. |
| `internal` | ✗ | ✗ | Internal-only routes (health probes, metrics scrape, SAML/OAuth/SCIM protocol callbacks). Documented in their own protocol-compliance docs, not OpenAPI. |

Action-by-action: each module manifest's `actions[]` declarations carry an audience tag (default `tenant`). Operator-only actions (for example, `Tenancy.Signup.Approve`) are tagged `operator`.

## Intent endpoint — expanded per-action

`POST /api/v1/intents` dispatches by `actionId`. The generator does NOT emit a single operation with a `oneOf` payload — that's accurate but unergonomic for SDK codegen. Instead, the generator walks the action manifest and emits **one operation per action**, all under the same path, distinguished by the `actionId` discriminator:

```yaml
paths:
  /api/v1/intents:
    post:
      tags: ['intents']
      operationId: contentPagesPageCreate         # derived from actionId
      summary: Create a content page
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/Envelope_ContentPages_Page_Create'
            # ...
      responses:
        '202': { $ref: '#/components/responses/IntentAccepted' }
        # plus 400, 401, 403, 409, 500 from error taxonomy
```

OpenAPI 3.1's `discriminator` keyword is used at the schema level so generators that DO want `oneOf` can synthesize it; the per-action operations are still distinct entries in the document. SDK generators (oapi-codegen, openapi-generator, scalar codegen) produce `client.contentPages.pageCreate(payload)` rather than `client.intents.submit({actionId, payload})`. This is the load-bearing DX decision.

The generator computes `operationId` from `actionId` by camel-case-stripping the dots: `Catalog.SeedPackage.Apply` → `catalogSeedPackageApply`.

## Auth schemes

`securitySchemes` in the tenant doc:

| Scheme | OpenAPI shape | When |
|---|---|---|
| `bearerAuth` | http, scheme: bearer, bearerFormat: JWT | OIDC token from the configured IdP |
| `apiKeyAuth` | apiKey, in: header, name: X-Api-Key | service-to-service / atlasctl |
| `oauth2ClientCredentials` | oauth2, flows: clientCredentials | machine-to-machine |

`X-Debug-Principal` is **deliberately excluded** from the tenant document — it's a dev-only test-auth bypass and showing it in tenant SDKs would be wrong. The operator doc includes it under a documented dev-only security scheme so atlasctl can declare its support.

Every operation declares its `security` requirement. The default is `[bearerAuth, apiKeyAuth]` (tenant API). Operator routes additionally require admin role; this is documented in the operation description (not in `security`, since OpenAPI doesn't model RBAC role checks natively).

## Multi-tenant URLs — explained, not leaked

Atlas paths do NOT include `:tenantId`. Tenant identity is implicit in the auth credential. The OpenAPI document's `info.description` carries a paragraph explaining this so SDK consumers don't expect a `tenantId` URL param. SDK ergonomics: `client.contentPages.pageCreate(payload, { token })` — the token carries the tenant.

Tenant-resolution edge cases (custom domains, host-resolved tenant) are documented in the operator API only; they don't affect tenant SDK behavior.

## Correlation + idempotency — first-class headers

Two HTTP headers every SDK MUST handle. Documented in `info.description` and on every relevant operation:

| Header | Direction | Required | Purpose |
|---|---|---|---|
| `X-Correlation-Id` | request | optional (server mints if absent) | Per Invariant I5 — the flow id that traces every downstream operation. SDK consumers SHOULD send one for retries to be linkable. |
| `X-Correlation-Id` | response | always present | The id the server used. SDK should surface this in errors so users can paste it into support requests. |
| `idempotencyKey` (in payload) | request | required for write intents | Per Invariant I3 — replays return the same eventId without re-execution. SDK consumers MUST mint one per logical operation, NOT per HTTP retry. |

The error envelope (per [`errors.md`](errors.md)) carries both `correlationId` and `supportId` — both surface in the OpenAPI `responses` schema.

## Versioning policy

Atlas's URL prefix is `/api/v1/`. The OpenAPI document version tracks that:

- `/api/v1/*` ↔ `openapi.tenant.json` with `info.version: 1.x.y`
- Breaking change → new prefix `/api/v2/*` → new doc `openapi.tenant.v2.json`
- Both versions coexist during the deprecation window (per `Deprecation Handling` in [`atlasctl.md`](atlasctl.md))

`info.version` follows semver:
- patch — added fields, new optional headers
- minor — added operations, new actions
- major — breaking changes (forces a new URL prefix)

The generator stamps a build hash and the source git commit into `info.x-atlas-build` so consumers can correlate spec to code.

## Generation pipeline

```
@atlas/schemas/src/generated/         apps/server/src/openapi-routes.ts
  manifests/<module>.manifest.json      route annotations (paths, methods,
  *.schema.json                          security, request/response, audience)
                  \                  /
                   v                v
              packages/openapi (buildOpenApi)
                       │
                       ├── filter audience='tenant'  → specs/openapi.tenant.json
                       └── filter audience='operator' → specs/openapi.operator.json
                       │
                       v
              served by apps/server at:
                /docs           (tenant, public)
                /admin/docs     (operator, admin-gated)
```

The generator is a pure function — testable with fixtures. The CLI script `pnpm sync-openapi` runs it and writes the artifacts. The script is wired as `prepare` so artifacts regenerate on `pnpm install`.

### CI guard

A test in `packages/openapi/test/coverage.test.ts` enumerates Hono routes in `apps/server/src/routes/` (via filesystem walk + import) and asserts each one has a corresponding annotation in `openapi-routes.ts`. Routes without annotations fail the build. This makes drift impossible.

### What the generator does NOT do

- It does NOT transform schemas. JSON Schema contracts are referenced as-is via `$ref` to a `components/schemas` entry that mirrors the source schema 1:1.
- It does NOT mint `operationId` for non-intent routes. The annotation declares the operationId.
- It does NOT generate SDKs. SDK generation is a downstream concern; consumers point oapi-codegen / openapi-generator / scalar codegen at the emitted JSON.
- It does NOT serve docs. That's `apps/server/src/routes/docs.ts`.

## Tooling

- **No third-party generation framework.** The generator builds the OpenAPI document by manual JSON construction (same posture as `@atlas/schemas` and `@atlas/logging`). One fewer dep to track; the generator is ~500 lines of code, fully under our control.
- **Docs UI: Scalar.** Static HTML + a CDN-loaded Scalar bundle. No SDK install; no build step in the docs route. Operator UI is the same Scalar with a different spec.
- **Validation.** Each emitted document is round-tripped through `@apidevtools/json-schema-ref-parser` (or the equivalent OpenAPI validator) at generation time, asserting it parses cleanly. Failure = generator bug.

## Out of scope for this contract

- **Generated client SDKs.** Atlas does not ship SDKs. Consumers run their preferred OpenAPI codegen.
- **gRPC / protobuf.** Atlas is HTTP-first. Cross-protocol surface is a future concern.
- **Webhook / event-stream documentation.** SSE is mentioned in the operations table but deeper event-vocabulary docs live in [`events.md`](events.md), not OpenAPI.
- **GraphQL.** Not on the roadmap.
- **OpenAPI 3.0 emission.** OpenAPI 3.1 only, leveraging full JSON Schema compatibility.

## Cross-references

- [`errors.md`](errors.md) — the error envelope and code taxonomy emitted in every operation's responses
- [`events.md`](events.md) — the event-name vocabulary used in the manifest's `events[]` declarations
- [`atlasctl.md`](atlasctl.md) — the operator CLI; consumes the operator OpenAPI document
- [`logging.md`](logging.md) — the structured logging contract; correlationId discipline that SDK consumers must follow
- [`architecture.md`](../architecture.md) — Invariants I1 (single ingress), I3 (idempotency), I5 (correlation propagation) — all of which the OpenAPI documentation reflects in its conventions
