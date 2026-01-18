# Glossary

## Core Concepts

**Tenant**
A single customer organization using the platform. All data and configuration is scoped to a tenant boundary.

**Tenant Admin**
A user with elevated permissions within their tenant, able to configure tenant-wide settings, manage users, and access administrative pages.

**End User**
A regular user within a tenant with standard permissions.

**Business Unit**
A named collection of users and/or other business units within a tenant. Used for organizing users and targeting communications/permissions.

**Intent**
A recorded user activity or action within the system. Intents are the foundation for history tracking, badge awards, and analytics.

**Token**
A named placeholder (e.g., `[site_url]`, `[current_user_points]`) that can be embedded in text and evaluated at runtime to produce dynamic content. Tokens can be static or dynamic (reading from system state).

**Email Template**
A reusable email layout saved by admins, available for use by any part of the system when sending emails. May contain tokens.

**Widget**
A configurable UI component that can be embedded in various contexts. Typically has tenant-specific configuration.

**Page**
A user-defined container composed of widget instances plus layout metadata. Pages include title, layout configuration, and an array of widget instances. The render model for a page is cacheable.

**Point**
A numeric reward unit tracked per user. Points have a configurable monetary value (default: 1 point ≈ 50 cents).

**Badge**
An achievement awarded to a user based on intents or roles. Badges may include a visual image (from media library) and point rewards.

**Media Library**
A tenant-scoped file storage system. Files can be private (tenant-only) or public (linkable). Public files have placeholders if reverted to private.

**Spreadsheet Upload**
A mechanism for bulk data import via CSV or XLSX files, with validation and dry-run capabilities.

## System Constructs

**Plane**
The access level or context for a UI surface:
- **Tenant Admin** — accessible only to tenant administrators
- **End User** — accessible to regular users within a tenant
- **Control Plane** — platform-level administration (cross-tenant)

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

**Resource**
Target of an authorization decision (e.g., Page, WidgetInstance, File). Each resource has a type, unique identifier, and ABAC attributes used in policy evaluation. Authorization decisions reference resources, not routes.

**Decision**
The result of an authorization evaluation. Contains allow or deny outcome, human-readable reason, and optionally the matched policy rules. Deny decisions must be explainable for audit and debugging purposes.

**Session**
A continuity handle for repeated requests, linking multiple operations to the same authenticated principal. Contains session ID, principal ID, and expiry metadata. Not used directly for authorization decisions.

**Ingress**
The single chokepoint that enforces validation, authentication, authorization, idempotency, and dispatch for all external requests. No module or service may expose direct external endpoints.

**IdempotencyKey**
A deduplication key ensuring repeat requests produce the same outcome without re-execution. Scoped by tenant ID, principal ID, and action ID. Required for any command that can be retried.

## Event & Data Concepts

**EventEnvelope**
A canonical wrapper for all events in the system. Contains metadata fields (event ID, tenant ID, timestamp, correlation ID, causation ID, idempotency key) plus event type and payload. All domain events, UI intents, audit events, and system events share this envelope structure.

**DomainEvent**
An immutable fact emitted by command handlers representing a state change. Events are append-only and serve as the source of truth for projections and audit trails.

**Projection**
A rebuildable read model derived from event history. Projections denormalize data for query performance and can be reconstructed by replaying events. Examples include RenderPageModel for UI rendering.

**RenderModel**
A UI-ready materialization optimized for fast frontend rendering. Render models are projections specifically designed for UI consumption and are aggressively cached.

**AuditEvent**
An immutable record of sensitive operations and authorization decisions. Includes timestamp, principal, action, resource, decision, and reason. Audit events support compliance and debugging.

## Caching Concepts

**CacheArtifact**
A named cacheable output of a query or materialization. Each artifact declares its cache key shape, tags for invalidation, TTL policy, vary-by dimensions (tenant, locale, role, user), and privacy level.

**CacheKey**
The key used to store and retrieve a cache artifact. Format: `{tenantId}:{artifactName}:{params}`. Tenant ID is required unless the artifact is explicitly marked PUBLIC.

**Tag**
An invalidation selector attached to cache entries. Tags like `Tenant:{id}`, `Page:{id}`, or `WidgetInstance:{id}` enable event-driven cache invalidation when entities change.

## UI Composition

**WidgetType**
A widget blueprint defining the code, settings schema, and declared capabilities. Widget types are registered in the platform and can be instantiated multiple times on different pages.

**WidgetInstance**
A concrete placement of a widget type on a specific page. Contains the widget type ID, page ID, instance-specific settings, and policies for visibility and interaction.

**WidgetSettings**
Instance-specific configuration for a widget, validated against the widget type's settings schema. Settings are provided as JSON and validated at ingress.
