# Search

**Platform:** Spine
**Status:** Stub — domain shape committed, content TBD.

## Purpose

Indexing, query permissions, tenant filtering, relevance. Cross-cutting service: consumed by Catalog, Content, Communications, Audit, etc. Has its own specs (relevance, tenant isolation) but rarely stands alone.

## Capabilities

TBD. List capabilities here as they're scoped. Capabilities are the agent
ownership unit — one capability ≈ one agent.

## Cross-references

- Port: `ports/src/search-engine.ts`
- Adapter: `adapters/node/src/search-engine.ts`, `adapters/idb/src/search-engine.ts`
