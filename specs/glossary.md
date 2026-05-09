# Glossary

## Multi-Tenant Fabric *(active vocabulary — added 2026-05-08)*

These terms describe Atlas as it is today: a multi-tenant platform fabric where tenants get identity / authz / audit / observability / search "for free," define their own data model, optionally provision backend services, and write functions and workflows against their data. See [`vision.md`](vision.md) and [`decisions/0003-tenant-defined-data-model-pivot.md`](decisions/0003-tenant-defined-data-model-pivot.md).

**Platform Fabric**
The multi-tenant chassis Atlas provides — identity, authorization, tenancy, audit, observability, search — applied uniformly to every operation. Tenants get all of these by virtue of being a tenant on Atlas, not because they wrote code for it.

**Custom Schema**
A tenant-defined data model: entity types, fields, and relationships declared by a tenant via Atlas API. Stored in the tenant's per-tenant Postgres schema (`atlas_t_<tenantId>`) per [ADR 0005](decisions/0005-custom-schema-storage-strategy.md). The Salesforce-shaped trunk of Atlas's vision.

**Tenant-Authored Function**
Sandboxed code written by a tenant, attached to schema lifecycle events / HTTP routes / schedules, executed in the `FunctionRuntime` port (gVisor-backed by default per [ADR 0006](decisions/0006-function-runtime-substrate.md)). Distinct from `function-runner`, which is the internal infrastructure for workflow jobs.

**Machine-Readable Surface**
An `AtlasSurface` that exposes its current state via `getSurfaceSnapshot()` and a registry manifest, per [`frontend/surface-introspection.md`](frontend/surface-introspection.md). Required for every surface (Invariant **I18**) so that AI agents can read what humans see.

**Public Signup**
Open self-serve tenant provisioning — any visitor can become a tenant without operator intervention. The default for the project author's public reference instance; opt-out for self-hosters who want gated signup. Rate-limited per IP and per email (REQ-SIGNUP-001/002).

**Self-Host**
A deployment of Atlas the software, run by someone other than the project author, on their own infrastructure. Tenancy is internal to that operator: their customers, team members, or applications.

**Public Reference Instance**
The project author's hosted Atlas at `atlas.<domain>`. Open public signup, runs the same software anyone else self-hosts. One example deployment, not a privileged form of Atlas.

**Mutual-Distrust Isolation**
The threat model the platform holds against: any two tenants on the same Atlas deployment may be mutually adversarial. The operator is not a fallback for isolation failures. Strict at the data layer (per-tenant DB), runtime layer (namespace-per-tenant), egress layer (mediated outbound), schema layer (DDL allowlist), and quota layer (no shared counters). See REQ-ISO-001 and `architecture.md` §"Tenant Runtime Isolation."

**Quota**
A per-tenant resource budget enforced at ingress before any side effect (Invariant **I13**, REQ-QUOTA-001). MVP-blocking dimensions: `signups-per-window`, `cpu-seconds`, `storage-bytes`, `function-invocations`, `egress-bytes`. Load-bearing — over-budget tenants are hard-blocked, not advised.

## Core Concepts

**Tenant**
A single customer of an Atlas deployment. All data and configuration is scoped to a tenant boundary. On the public reference instance, anyone who signs up becomes a tenant; on a self-host, tenants may be the operator's customers, team members, or applications.

**Tenant Admin**
A user with elevated permissions within their tenant, able to configure tenant-wide settings, manage users, and access administrative pages.

**End User**
A regular user within a tenant with standard permissions.

**Operator**
The party running an Atlas deployment. The project author is the operator of the public reference instance; a self-hoster is the operator of their own instance. The operator is **not** a fallback for tenant isolation per the mutual-distrust threat model.

**Intent**
A recorded user activity or action within the system. Intents are the foundation for history tracking, audit, and projection updates.

## CMS-Era Concepts *(scope: parked first-party CMS app)*

The terms below come from Atlas's earlier CMS / SaaS-framework framing. They are retained for historical continuity but are **not active platform vocabulary**. The parked CMS app at `apps/cms/` may revive on top of `custom-schema` + `functions` later (per ADR 0003 §"Out of scope"); if so, these terms get re-homed under that bundle's local vocabulary.

**Business Unit** *(parked)*
A named collection of users and/or other business units within a tenant. Used for organizing users and targeting communications/permissions.

**Token** *(parked — CMS sense)*
A named placeholder (e.g., `[site_url]`, `[current_user_points]`) that can be embedded in text and evaluated at runtime to produce dynamic content. Distinct from authentication tokens (`InviteToken`, API keys) which are active vocabulary in the lexicon.

**Email Template** *(parked)*
A reusable email layout saved by admins, available for use by any part of the system when sending emails. May contain tokens.

**Widget** *(parked)*
A configurable UI component that can be embedded in various contexts. Typically has tenant-specific configuration.

**Page** *(parked — CMS sense)*
A full standalone UI surface, typically accessible via navigation. Distinct from the active `AtlasSurface` / surface-contract concept which has its own vocabulary.

**Point** *(parked)*
A numeric reward unit tracked per user. Points have a configurable monetary value (default: 1 point ≈ 50 cents).

**Badge** *(parked)*
An achievement awarded to a user based on intents or roles. Badges may include a visual image (from media library) and point rewards.

**Media Library** *(parked)*
A tenant-scoped file storage system. Files can be private (tenant-only) or public (linkable). Public files have placeholders if reverted to private.

**Spreadsheet Upload** *(parked)*
A mechanism for bulk data import via CSV or XLSX files, with validation and dry-run capabilities.

## System Constructs

**Plane**
The access level or context for a UI surface:
- **Tenant Admin** — accessible only to tenant administrators
- **End User** — accessible to regular users within a tenant
- **Control Plane** — platform-level administration (cross-tenant — operator only)

**Dry Run**
A validation mode where an operation is simulated but not committed, allowing users to preview results and catch errors.

**History**
Immutable record of past events, intents, or system actions. Typically read-only and filterable.

## UI Artifacts

**UI Bundle**
A versioned, deployable artifact containing compiled frontend code (routes, widgets, themes) for an Atlas tenant interface. UI Bundles are platform-global artifacts that can be selected by individual tenants. Each tenant has exactly one active bundle at any time.

**Active Bundle**
The currently selected UI Bundle for a tenant. Determines which frontend code is served to the tenant's users.

**Platform Compatibility**
A version range declared by a UI Bundle specifying which platform API versions it supports. The platform rejects activation of bundles outside the compatible range.

## Authentication & Authorization

**Principal**
The authenticated identity making a request. Contains principalId, tenantId, roles, and ABAC attributes. Can be a user principal (interactive user) or service principal (API key, system service).

**PrincipalId**
Unique identifier for a principal. Format: `principal-{source}-{id}` (e.g., `principal-user-123`, `principal-service-analytics`).

**Authentication (AuthN)**
The process of verifying identity and constructing a Principal object from provider credentials (OIDC, SAML, API keys). Performed by ingress gateway before any business logic.

**Authorization (AuthZ)**
The process of determining whether a Principal is allowed to perform an Action on a Resource. Uses Cedar policy language for hybrid RBAC + ABAC with forbid-overrides-permit semantics. Enforced at ingress before dispatch.

**Action**
A named operation in the system. Format: `{ModuleId}.{ResourceType}.{Verb}` (e.g., `ContentPages.Page.Create`). Declared in module manifests and registered in action registry. Represented as Cedar Action entities.

**Policy**
A Cedar authorization rule defining permit or forbid decisions based on principal scope, action scope, resource scope, and optional conditions. Policies stored per-tenant and evaluated by Cedar authorization engine.

**Cedar**
Industry-standard authorization policy language from AWS. Used for all authorization decisions. Supports expressive policies with principal/action/resource scoping and attribute-based conditions.
