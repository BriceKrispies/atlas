# Compute / cluster domain

The **cluster** domain owns Atlas's view of the Kubernetes clusters that run tenant workloads. Tracks which clusters exist, their endpoints, their credentials, and their lifecycle. Does NOT own node provisioning (that's the planned `cluster-bootstrap` capability) or live status probing (that's the planned `cluster-status` capability).

Phase 1 of the project plan needs at least one cluster registered before any other Compute capability is meaningful. This domain ships first.

## Capabilities

| Capability | Status | Spec |
|------------|--------|------|
| cluster-registration | designed (no impl) | [`capabilities/cluster-registration/`](capabilities/cluster-registration/) |
| cluster-bootstrap | not yet scoped | — |
| cluster-status | not yet scoped | — |
| cluster-decommission | not yet scoped | — |

## Cross-references

- Platform README: [`../README.md`](../README.md)
- Owner: [`compute-owner`](../../../../.claude/agents/compute-owner.md)
- Pattern reference: [`tenancy/custom-domains`](../../tenancy/capabilities/custom-domains/README.md) — same shape (table + port + adapter + operator script during Phase 0)
