# Code platform

The **Code** platform owns tenant source code, build pipelines, and produced artifacts. Net-new as of the 2026-05-08 developer-platform pivot ([ADR `0002`](../../decisions/0002-developer-platform-domain-map.md)). Strategy is to **wrap existing tools as adapters** (Gitea for git hosting, kaniko for image builds, Distribution for the container registry) rather than build native — Atlas's value-add is the multi-tenant scoping + audit + quota check on every operation.

## Domains

| Domain | Spec home | Status |
|--------|-----------|--------|
| repository | [`repository/`](repository/) | active — first capability (`upload-tarball`) being scoped |
| pipeline | `pipeline/` | not yet created |
| artifact-registry | `artifact-registry/` | not yet created |

Domains are added lazily as their first capability is scoped, per [`specs/CLAUDE.md`](../../CLAUDE.md). No empty domain stubs are pre-created.

## Phasing

Per [`specs/vision.md`](../../vision.md), Phase 1 of the Atlas project plan delivers the simpler `atlasctl push <tarball>` path. Phase 3 adds the git server (Gitea adapter) and on-push triggers; the same `repository` domain wraps both. Tarball-push and git-push are two ingest paths to the same per-tenant `Repository` entity.

## Owner

[`code-owner`](../../../.claude/agents/code-owner.md) — spec/design authority for everything under this platform.

## Cross-platform contracts

- **Spine — identity:** push permissions, SSH keys (Phase 3+), audit emission per push. Owned with [`spine-owner`](../../../.claude/agents/spine-owner.md).
- **Workflow — triggers + jobs:** a push event is a workflow trigger; build/deploy pipelines are jobs run on Compute. Trigger contract owned with [`workflow-owner`](../../../.claude/agents/workflow-owner.md).
- **Compute — image-build + runtime:** pipelines run on Compute's substrate; built images are pulled by Compute when deploying. Owned with [`compute-owner`](../../../.claude/agents/compute-owner.md).
- **Storage — object-storage + secrets:** artifact bytes (tarballs, container layers) live in object-storage when that platform lands; build-time secrets (registry creds, repo deploy keys) live in the secret store. Owned with [`storage-owner`](../../../.claude/agents/storage-owner.md).
- **Commerce — quotas / metering:** every Code operation pre-checks quota (repo count, registry GB, push events, build minutes) and post-emits a metering signal. Owned with [`commerce-owner`](../../../.claude/agents/commerce-owner.md).
