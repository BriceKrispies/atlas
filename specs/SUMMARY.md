# Summary

[Introduction](index.md)

---

# Foundation

- [Overview](README.md)
- [Glossary](glossary.md)
- [Architecture](architecture.md)
- [Normative Requirements](normative_requirements.md)
- [Lexicon](LEXICON.md)
- [Conformance](conformance.md)
- [Spec Surface Inventory](spec_surface_inventory.md)

---

# Domains — Platform Spine

- [Identity](domains/identity/README.md)
  - [Authentication](domains/identity/authn.md)
  - [Identity (users, profiles)](domains/identity/identity.md)
  - [Tokens](domains/identity/tokens/README.md)
- [Authorization](domains/authorization/README.md)
  - [Authz Patterns](domains/authorization/authz.md)
  - [Security](domains/authorization/security.md)
  - [Authz Module Manifest](domains/authorization/authz-module/module.manifest.json)
- [Tenancy](domains/tenancy/README.md)
  - [Tenancy Spec](domains/tenancy/tenancy.md)
- [Organization](domains/organization/README.md)
  - [Org Module](domains/organization/org/README.md)
- [Audit](domains/audit/README.md)
  - [Audit Module](domains/audit/audit/README.md)
- [Observability](domains/observability/README.md)
- [Search](domains/search/README.md)

---

# Domains — Content Platform

- [Authoring](domains/authoring/README.md)
  - [Page Templates](domains/authoring/page-templates.md)
  - [Content Pages Manifest](domains/authoring/content-pages/module.manifest.json)
- [Delivery](domains/delivery/README.md)
- [Media](domains/media/README.md)
  - [Storage](domains/media/storage.md)
  - [Content Module](domains/media/content/README.md)
- [Maps](domains/maps/README.md)
- [Catalog](domains/catalog/README.md)
  - [Structured Catalog Manifest](domains/catalog/structured-catalog/module.manifest.json)
- [Widgets](domains/widgets/README.md)
  - [Widgets Spec](domains/widgets/widgets.md)
  - [UI Bundles](domains/widgets/ui.md)
- [Forms](domains/forms/README.md)
- [Localization](domains/localization/README.md)

---

# Domains — Workflow Platform

- [Automation](domains/automation/README.md)
- [Rules](domains/rules/README.md)
- [Scheduling](domains/scheduling/README.md)
- [Approvals](domains/approvals/README.md)
- [Import/Export](domains/import-export/README.md)
  - [Import Module](domains/import-export/import/README.md)

---

# Domains — Engagement Platform

- [Communications](domains/communications/README.md)
  - [Comms Module](domains/communications/comms/README.md)
- [Notifications](domains/notifications/README.md)
- [Analytics](domains/analytics/README.md)
- [Experimentation](domains/experimentation/README.md)
- [Gamification](domains/gamification/README.md)
  - [Badges](domains/gamification/badges/README.md)
  - [Points](domains/gamification/points/README.md)

---

# Domains — Commerce Platform

- [Billing](domains/billing/README.md)

---

# Cross-Cutting (no single domain home)

- [atlasctl](crosscut/atlasctl.md)
- [Errors](crosscut/errors.md)
- [Events](crosscut/events.md)

---

# Data Schemas

- [Audit Schema](schemas/audit.md)
- [Badges Schema](schemas/badges.md)
- [Communications Schema](schemas/comms.md)
- [Content Schema](schemas/content.md)
- [Import Schema](schemas/import.md)
- [Organization Schema](schemas/org.md)
- [Points Schema](schemas/points.md)
- [Tokens Schema](schemas/tokens.md)
