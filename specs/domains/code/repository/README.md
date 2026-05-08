# Code / repository domain

The **repository** domain owns the per-tenant view of "a thing you push code to." Every tenant gets their own namespace of repositories. Each repository holds an ordered list of **revisions** — immutable snapshots of source bytes at a point in time. Phase 1 ingests revisions via `atlasctl push <dir>` (tarball upload). Phase 3 adds a git transport (Gitea adapter) that ingests revisions via `git push`; both transports produce the same `Repository.Uploaded` event shape so consumers (workflow triggers, build pipelines) don't care which path was used.

This domain owns the Repository entity + Revision entity + the upload pipeline. It does **not** own:

- Building the uploaded code into an artifact (that's `pipeline`).
- Pushing built artifacts to a registry (that's `artifact-registry`).
- Deploying artifacts to a cluster (that's `compute/runtime`).

## Capabilities

| Capability | Status | Spec |
|------------|--------|------|
| upload-tarball | being scoped | [`capabilities/upload-tarball/`](capabilities/upload-tarball/) |
| git-push (transport) | not yet scoped | — (Phase 3) |
| repository-list | not yet scoped | — (read-side surface lands with `upload-tarball` initially) |
| repository-delete | not yet scoped | — |
| repository-rename | not yet scoped | — |

## Cross-references

- Platform README: [`../README.md`](../README.md)
- Owner: [`code-owner`](../../../../.claude/agents/code-owner.md)
- Pattern reference: [`tenancy/custom-domains`](../../tenancy/capabilities/custom-domains/README.md) — same shape (table + port + adapter + first ingress route + atlasctl wrapper)
