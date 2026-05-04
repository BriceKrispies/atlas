# Tenancy

**Platform:** Spine
**Status:** Active — content migrated from legacy locations.

## Purpose

Tenant lifecycle, tenant settings, isolation, provisioning. Atlas is db-per-tenant; this domain owns the tenant boundary.

## Capabilities

TBD. List capabilities here as they're scoped. Capabilities are the agent
ownership unit — one capability ≈ one agent.

## Cross-references

- Spec: [./tenancy.md](./tenancy.md) — tenant boundaries, data isolation
- Adapter: `adapters/node/src/tenant-db-provider.ts` (per-tenant pool resolution)
