# Atlas Platform Specifications

Welcome to the Atlas platform specification documentation.

## Quick Start

Specs are organized around **25 business domains** in 5 platforms. The
canonical home is `domains/<domain>/`. Read [`CLAUDE.md`](CLAUDE.md) for the
full domain index and migration history.

- **[CLAUDE.md](CLAUDE.md)** — primary index (start here)
- **[Overview](README.md)** — structure and organization
- **[Glossary](glossary.md)** — core terminology
- **[Architecture](architecture.md)** — principles P1–P6, invariants I1–I12
- **Domains** — `domains/<domain>/README.md` for each of the 25 domains
- **Cross-Cutting** — `crosscut/{atlasctl,errors,events}.md` (system-wide only)
- **Data Schemas** — `schemas/<topic>.md` (conceptual data models)

## Navigation Guide

### For Product Managers
Start with [CLAUDE.md](CLAUDE.md) for the platform → domain map → drill into
the domain README that matches your area → check capabilities.

### For Architects
[Architecture](architecture.md) → cross-cutting concerns
([events](crosscut/events.md), [errors](crosscut/errors.md)) → domain READMEs
for the areas in scope → [data schemas](schemas/).

### For Developers
[CLAUDE.md](CLAUDE.md) → the relevant `domains/<domain>/README.md` → migrated
content (`<topic>.md` siblings or subfolders) → `features/` for executable
witnesses → schema.

### For QA/Testing
[CLAUDE.md](CLAUDE.md) → `domains/<domain>/features/` for Gherkin scenarios →
the surfaces.md / events.md inside any migrated module subfolder for legacy
acceptance criteria.

## Domain Folder Structure

Each canonical domain lives at `domains/<domain>/`:

```
domains/<domain>/
  README.md            — Platform / Status / Purpose / Capabilities / Cross-references
  <topic>.md           — migrated cross-cut docs (e.g. domains/identity/authn.md)
  <legacy-folder>/     — migrated legacy module folders (README + surfaces + events)
  features/            — Gherkin .feature files (executable witnesses)
```

Empty domains have a stub README only; content arrives as the domain is scoped.

## Viewing This Documentation

To browse locally with full navigation and search:

```bash
cd specs
mdbook serve
```

Then visit `http://localhost:3000`

## Contributing

When adding or updating specs:
1. Pick the canonical domain. See platform → domain table in [CLAUDE.md](CLAUDE.md).
2. Drop content into `domains/<domain>/`. Use sibling `.md` files for narrative pieces; use `features/` for Gherkin scenarios.
3. Reference `crosscut/errors.md` and `crosscut/events.md` from your spec when relevant.
4. Update [glossary.md](glossary.md) for new terminology.
5. Mark uncertainties as **TODO / Open Questions** rather than guessing.
6. Keep specs concise and technology-agnostic.
