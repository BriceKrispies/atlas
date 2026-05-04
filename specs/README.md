# Specs Overview

Formal specifications for the Atlas platform. Organized around 26 business
domains grouped into 5 platforms. See [`CLAUDE.md`](CLAUDE.md) for the full
domain index, the legacy → canonical migration history, and routing for
adding/modifying specs.

## Structure

```
/specs
  CLAUDE.md                — primary index (read this first)
  README.md                — this file
  glossary.md              — key terms and definitions
  error_taxonomy.json      — canonical error codes and categories
  architecture.md          — principles P1-P6, invariants I1-I12
  normative_requirements.md — RFC 2119 compliance rules
  LEXICON.md               — canonical vocabulary (nouns, verbs, pipelines)
  conformance.md           — invariant conformance checklist
  spec_surface_inventory.md — full spec surface inventory

  /domains                 — canonical home: 26 domains across 5 platforms
    /<domain>              — README.md + migrated content
      README.md            — domain overview (Platform / Status / Cross-refs)
      <topic>.md           — migrated cross-cutting docs
      <legacy-folder>/     — migrated module folders (README + surfaces + events)
      features/            — Gherkin features (lazily created)

  /crosscut                — system-wide content with no single domain home
    atlasctl.md            — operator CLI spec
    errors.md              — error taxonomy
    events.md              — event vocabulary

  /schemas                 — conceptual + JSON-schema contracts
  /fixtures                — golden test fixtures
  /policy-fixtures         — policy bundle fixtures
  /frontend                — frontend specs
```

## Adding a New Spec

1. Identify the canonical domain. See the platform → domain table in
   [`CLAUDE.md`](CLAUDE.md).
2. Drop content into `domains/<domain>/`. Use `README.md` for the overview;
   add `<topic>.md` siblings for narrative pieces; add `features/` Gherkin
   files when the spec gains executable witnesses.
3. Reference `crosscut/errors.md` and `crosscut/events.md` from your spec
   when relevant — those stay system-wide.
4. Update `glossary.md` with any new vocabulary.
5. If you genuinely need a 27th domain, bring it up before adding it — the
   canonical map is intentionally stable.

## Reading Order

1. [`CLAUDE.md`](CLAUDE.md) — domain index + routing
2. `glossary.md` — key terms
3. `architecture.md` — principles + invariants
4. The relevant `domains/<x>/README.md` for the area you're working in
