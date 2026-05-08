# Compute platform

The **Compute** platform is where tenant code actually runs on Atlas. Net-new as of the 2026-05-08 developer-platform pivot ([ADR `0002`](../../decisions/0002-developer-platform-domain-map.md)). Strategy is to **wrap existing tools as adapters** (k3s, kaniko, Caddy, Hetzner Cloud, Hetzner DNS) rather than build native — Atlas's value-add is the multi-tenant glue + audit + unified API on top.

## Domains

| Domain | Spec home | Status |
|--------|-----------|--------|
| cluster | [`cluster/`](cluster/) | active — first capability (`cluster-registration`) specced |
| runtime | `runtime/` | not yet created |
| image-build | `image-build/` | not yet created |
| ingress | `ingress/` | not yet created |
| dns | `dns/` | not yet created |

Domains are added lazily as their first capability is scoped, per [`specs/CLAUDE.md`](../../CLAUDE.md). No empty domain stubs are pre-created.

## Owner

[`compute-owner`](../../../.claude/agents/compute-owner.md) — spec/design authority for everything under this platform.

## Cross-platform contracts

- **Spine — tenancy:** tenant signup triggers per-tenant namespace + ingress route creation in Compute. Owned with [`spine-owner`](../../../.claude/agents/spine-owner.md).
- **Code — pipeline:** pipelines run as jobs on Compute's substrate (same runtime, same security model). Owned with [`code-owner`](../../../.claude/agents/code-owner.md).
- **Storage — secrets / object-storage:** workloads inject secrets at startup; image-build cache lives in object storage. Owned with [`storage-owner`](../../../.claude/agents/storage-owner.md).
- **Commerce — quotas / metering:** every Compute provisioning intent pre-checks quota and post-emits a metering signal. Owned with [`commerce-owner`](../../../.claude/agents/commerce-owner.md).
