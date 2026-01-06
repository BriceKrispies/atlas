# Specs Overview

This directory contains formal specifications for the Atlas platform, organized into cross-cutting concerns and feature modules.

## Structure

```
/specs
  README.md           — this file
  glossary.md         — key terms and definitions
  /crosscut           — system-wide patterns and constraints
    tenancy.md
    security.md
    events.md
    storage.md
  /modules            — feature module specifications
    /<module-name>
      README.md       — module overview
      surfaces.md     — UI surface specifications
      events.md       — intents and events emitted/consumed
```

## Modules

- **tokens** — Token registry and substitution system
- **comms** — Email templates, messaging, and notification tracking
- **org** — Business unit and organizational structure management
- **content** — Announcements and media library
- **points** — Point system configuration and management
- **audit** — Intent history and activity tracking
- **import** — Spreadsheet upload and validation
- **badges** — Badge awards based on intents and roles

## How to Add a New Spec

1. Determine if the feature fits into an existing module or requires a new one
2. If new module needed, create `/specs/modules/<module-name>/` with `README.md`, `surfaces.md`, `events.md`
3. Update `/specs/glossary.md` with any new domain terms
4. Add cross-cutting concerns to `/specs/crosscut/` if they affect multiple modules
5. Use the Spec Card template from any existing `surfaces.md` for consistency
6. Document dependencies on other modules explicitly
7. Mark uncertainties as TODO/OPEN QUESTION rather than guessing

## Reading Order

1. Start with `glossary.md` for key terms
2. Read `/crosscut` specs to understand system-wide constraints
3. Dive into individual modules as needed
4. Each module's `README.md` provides overview before diving into `surfaces.md`
