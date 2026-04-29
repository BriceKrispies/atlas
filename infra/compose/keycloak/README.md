# Keycloak realm — itest stack

The `atlas` realm pre-imported into the integration-test Keycloak instance
(see `compose.itest-infra.yml` and `docker-compose.itest.yml`). Realm
export lives at:

```
infra/compose/config/keycloak/atlas-realm.json
```

The compose service mounts this file read-only into Keycloak's
`/opt/keycloak/data/import/` directory and runs `start-dev --import-realm`
on first boot, so the realm is reproducible from a cold container.

## What's in the realm

- **Realm**: `atlas`
- **Client**: `atlas-s2s`
  - Confidential client, `client_credentials` grant enabled.
  - Direct-access grants enabled (so `password`-grant tests can mint a
    token for `test-user` against the same client).
  - Hardcoded `tenant_id` claim mapper baked at value `tenant-itest-001`
    so service-account tokens carry the tenant the ingress expects (see
    `apps/server/src/middleware/principal.ts` and
    `crates/ingress/src/authn.rs`).
  - Audience mapper adds `account` to the access-token `aud` array so
    tokens validate against `OIDC_AUDIENCE=account` without any extra
    config on the server side.
  - Secret: `sQgPBnIo4TyopWfovMHhq6PaMEALlFt0` — **dev-only**. Do not
    reuse in any environment that talks to production data.
- **Client**: `atlas-ingress` — bearer-only resource-server entry the
  ingress can be cross-referenced against if a future test needs to
  audit-trail token issuance.
- **Realm roles**: `atlas-admin`, `atlas-user`.
- **Test user**: `test-user` (password `test-password`) with the
  `tenant_id` user attribute set to `tenant-itest-001` and the
  `atlas-user` realm role. **Dev-only credentials.**

## Refreshing the export

If the parity tests need a new claim, role, or mapper:

1. `make itest-up` to start the stack (or `atlas itest up`).
2. Visit the admin console at `http://localhost:8081/admin`
   (`admin` / `admin`) and edit the realm in place.
3. Dump the partial export:

   ```bash
   podman exec -it atlas-itest-keycloak \
     /opt/keycloak/bin/kc.sh export \
       --dir /tmp/export --realm atlas \
       --users realm_file
   podman cp atlas-itest-keycloak:/tmp/export/atlas-realm.json \
     infra/compose/config/keycloak/atlas-realm.json
   ```

4. Diff the new file against the committed copy. Drop ephemeral fields
   (Keycloak rewrites `id` UUIDs and timestamps on each export) — keep
   only the structural changes that motivated the refresh.
5. Re-run `make itest-reset` to confirm the new realm imports cleanly
   from cold.

## Image pin

The compose files pin Keycloak to `quay.io/keycloak/keycloak:25.0`. If
you bump the tag, verify:

- The `--import-realm` CLI flag still imports JSON of the same shape.
- The health endpoint is still on port 9000 (the compose `healthcheck`
  hits that port directly via `/dev/tcp`).
- The `tenant_id` hardcoded-claim mapper still serializes the same way
  (Keycloak occasionally renames mapper config keys across majors).
