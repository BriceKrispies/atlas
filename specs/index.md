# Atlas Platform Specifications

Welcome to the Atlas platform specification documentation.

## Quick Start

All platform documentation lives in this `/specs` directory. Use the navigation sidebar to browse:

- **[Overview](README.md)** — Structure and organization of specs
- **[Glossary](glossary.md)** — Core terminology
- **Cross-Cutting Concerns** — System-wide patterns (tenancy, security, events, storage)
- **Modules** — Feature specifications organized by module
- **Data Schemas** — Conceptual data models

## Navigation Guide

### For Product Managers
Start with [Overview](README.md) → [Glossary](glossary.md) → Module READMEs to understand capabilities.

### For Architects
Review Cross-Cutting Concerns → Module dependencies → [Data Schemas](schemas/README.md).

### For Developers
Focus on specific modules: README → `surfaces.md` → `events.md` → schema.

### For QA/Testing
Review module `surfaces.md` files for acceptance scenarios and edge cases.

## Module Structure

Each module follows a consistent pattern:
- **README.md** — Purpose, responsibilities, and dependencies
- **surfaces.md** — UI specifications with acceptance criteria
- **events.md** — Intents emitted and consumed

## Viewing This Documentation

To browse locally with full navigation and search:

```bash
cd specs
mdbook serve
```

Then visit `http://localhost:3000`

## Contributing

When adding or updating specs:
1. Follow the existing directory structure under `/specs/modules/<module>/`
2. Update `/specs/glossary.md` for new terminology
3. Add cross-cutting concerns to `/specs/crosscut/` if they affect multiple modules
4. Mark uncertainties as **TODO / Open Questions** rather than guessing
5. Keep specs concise and technology-agnostic
