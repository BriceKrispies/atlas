# Conceptual Data Schemas

This directory contains **conceptual / logical data models** derived from the specifications in `/specs/modules`. These schemas describe the entities, relationships, and data rules for each module from a domain perspective.

## Purpose

These schemas serve to:
- Document the **logical structure** of each module's data ownership
- Clarify **relationships** between entities across module boundaries
- Define **invariants** and lifecycle rules for each entity
- Provide a **technology-agnostic** foundation for implementation

## What This Is NOT

These are **conceptual schemas**, not physical database designs:
- **NO** SQL, DDL, migrations, or CREATE TABLE statements
- **NO** indexes, partitions, or storage-engine-specific optimizations
- **NO** technology choices (Postgres, DynamoDB, MongoDB, etc.)
- **NO** denormalization, flattening, or performance-driven compromises
- **NO** framework-specific models (ORMs, Active Record, etc.)

## Structure

Each module has its own schema file:
- `/specs/schemas/<module-name>.md`

Each schema file contains:
- **Module Overview** — data ownership and purpose
- **Entities** — core data concepts, their fields, lifecycle, and invariants
- **Relationships** — how entities connect within and across modules
- **Derived / Computed Concepts** — data derived from other sources
- **Events & Audit Implications** — what changes emit intents or require immutability
- **Open Questions** — unresolved decisions deferred by the specs

## Principles

- **Preserve module boundaries** — entities belong to their owning module
- **Explicit relationships** — cross-module dependencies are clearly stated
- **Separate concerns** — configuration vs. execution vs. history are distinct entities
- **Immutability where implied** — audit logs and history are append-only
- **Tenant isolation** — every entity is tenant-scoped unless explicitly global

## How to Evolve These Schemas

When specs change:
1. Read the updated spec files in `/specs/modules`
2. Identify new entities, fields, or relationships
3. Update the corresponding schema file in `/specs/schemas`
4. Add new open questions if ambiguities arise
5. Do **not** make implementation decisions not supported by the specs

When implementing:
1. Use these schemas as a logical foundation
2. Make physical design choices (tables, indexes, storage) based on your stack
3. Document deviations and rationale in implementation docs (not here)
4. Keep these schemas technology-agnostic and aligned with `/specs`

## Reading Order

1. Start with `audit.md` — the central event sink for the system
2. Then `org.md` — business units used across many modules
3. Then module-specific schemas as needed
4. Cross-reference relationships between modules
