# Normative Requirements for Atlas Platform Compiler

**Status:** Normative
**Version:** 1.1.0
**Date:** 2026-01-07

---

## Change Log

**Version 1.1.0 (2026-01-07):**

**Added:**
- Section 1: "Normative Discovery Rules" — explicit file allowlists (non-heuristic discovery)
- Section 2: "Compiler Input Contract" — self-contained discovery rules (removed circularity with inventory)
- Separation of "Compile-time Validation Requirements" vs "Runtime Semantics Documentation"
- REQ-DETERM-001: Compiler must produce deterministic IR output
- REQ-DIAG-001: Validation failures must emit error codes from error_taxonomy.json

**Removed:**
- REQ-FILE-001, REQ-FILE-002 (inventory circularity) — replaced by Section 2
- REQ-ARCH-005 (invented cache tags requirement) — moved to Candidates
- REQ-TRACE-001 (weak causationId format claim) — moved to Candidates
- 30+ micro-requirements for individual field constraints — consolidated to schema validation requirements

**Modified:**
- Discovery Rules D1-D7: Changed from structural pattern-matching to explicit file allowlists
- REQ-INPUT-001/002/003/004: Evidence reworded for clarity (normative contract definition)
- REQ-EVENT-003: Evidence corrected to cite event envelope schema, not search scoping
- REQ-EVENT-004, REQ-EVENT-005: Retained with specific diagnostic obligations (error codes)
- REQ-AUTHZ-001, REQ-AUTHZ-002 — moved to "Runtime Semantics Documentation" (not compile-time enforcement)
- All schema requirements now cite primary JSON schema sources, not inventory
- Evidence citations shortened to ≤25 words where quoted

**Candidates section expanded:**
- Added 4 new candidates from removed requirements

---

## Purpose and Scope

This document is the **normative source** of compiler-enforced requirements for the Atlas platform. Only statements in this document using RFC 2119 keywords (**MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, **MAY**) are considered normative requirements.

The companion document `/specs/spec_surface_inventory.md` is **descriptive and informative**. It catalogs the spec surface but does not define compiler behavior.

## Conformance

A conforming compiler implementation:
- **MUST** enforce all requirements in "Compile-time Validation Requirements" marked with Severity: ERROR
- **SHOULD** enforce all requirements marked with Severity: WARNING
- **MAY** use "Runtime Semantics Documentation" to guide code generation but is not required to implement runtime logic

---

## 1. Normative Discovery Rules

The following rules define exactly which files the compiler validates and which schemas apply. Discovery is based on explicit file paths, not structural inspection.

### Rule D1: Event Envelope Fixtures

The compiler MUST validate the following files against `schemas/contracts/event_envelope.schema.json`:
- `fixtures/valid_event_envelope.json`
- `fixtures/invalid_event_envelope_missing_idempotency.json`
- `fixtures/sample_page_create_intent.json`
- `fixtures/expected_page_created_event.json`

**Sanity check (non-discovery):** If a file contains a `$schema` field, the compiler SHOULD warn if the value does not match the expected schema path.

### Rule D2: Module Manifest Files

The compiler MUST validate the following files against `schemas/contracts/module_manifest.schema.json`:
- `modules/content-pages.json`

**Sanity check (non-discovery):** Additional JSON files under `modules/` MAY be validated if they match pattern `modules/*/*.json` and contain a `manifestVersion` field, but this is not required for conformance.

### Rule D3: Policy Bundle Fixtures

The compiler MUST validate each policy object in the `policies` array of the following file against `schemas/contracts/policy_ast.schema.json`:
- `fixtures/sample_policy_bundle.json`

### Rule D4: Search Document Fixtures

The compiler MUST validate each array element in the following file against `schemas/contracts/search_document.schema.json`:
- `fixtures/search_documents.json`

### Rule D5: Search Query Fixtures

The compiler MUST validate the following file against `schemas/contracts/search_query.schema.json`:
- `fixtures/search_query.json`

### Rule D6: Analytics Event Fixtures

The compiler MUST validate each array element in the following file against `schemas/contracts/analytics_event.schema.json`:
- `fixtures/analytics_events.json`

### Rule D7: Analytics Query Fixtures

The compiler MUST validate the following file against `schemas/contracts/analytics_query.schema.json`:
- `fixtures/analytics_query.json`

### Rule D8: File Exclusions

The compiler MUST NOT process any files under `specs/book/` as these are generated build artifacts.

---

## 2. Compiler Input Contract (Normative)

This section defines the compiler's file discovery obligations as a self-contained contract.

### REQ-INPUT-001

**Statement:** The compiler MUST accept as valid input all JSON schema files under `schemas/contracts/` matching pattern `*.schema.json`.

**Source:** This document, Section 2

**Evidence:** Normatively defined in this document's Compiler Input Contract

**Test Hook:** File discovery enumerates all `schemas/contracts/*.schema.json` files

**Severity:** ERROR

---

### REQ-INPUT-002

**Statement:** The compiler MUST accept as valid input the file `error_taxonomy.json` at the root of `specs/`.

**Source:** This document, Section 2

**Evidence:** Normatively defined in this document's Compiler Input Contract

**Test Hook:** File discovery includes `specs/error_taxonomy.json`

**Severity:** ERROR

---

### REQ-INPUT-003

**Statement:** The compiler MUST accept as valid input all JSON files under `fixtures/` that match discovery rules D1-D7.

**Source:** This document, Section 1

**Evidence:** Normatively defined in this document's Discovery Rules D1-D7

**Test Hook:** File discovery applies rules D1-D7 correctly

**Severity:** ERROR

---

### REQ-INPUT-004

**Statement:** The compiler MUST ignore all files under `specs/book/` as they are generated build artifacts.

**Source:** This document, Section 1, Rule D8

**Evidence:** Normatively defined in this document's Discovery Rule D8

**Test Hook:** File discovery excludes `specs/book/*` pattern

**Severity:** ERROR

---

## 3. Compile-time Validation Requirements

These requirements define validation the compiler MUST perform on input artifacts.

---

## 3.1 Schema Validation

### REQ-SCHEMA-001

**Statement:** The compiler MUST validate all files matching Discovery Rule D1 against `schemas/contracts/event_envelope.schema.json`.

**Source:** `schemas/contracts/event_envelope.schema.json`

**Evidence:** Schema defines event envelope structure with required fields and constraints

**Test Hook:** JSON Schema validation engine returns success for valid fixtures, error for invalid

**Severity:** ERROR

---

### REQ-SCHEMA-002

**Statement:** The compiler MUST validate all files matching Discovery Rule D2 against `schemas/contracts/module_manifest.schema.json`.

**Source:** `schemas/contracts/module_manifest.schema.json`

**Evidence:** Schema defines module capability declaration structure

**Test Hook:** JSON Schema validation passes for `modules/content-pages.json`

**Severity:** ERROR

---

### REQ-SCHEMA-003

**Statement:** The compiler MUST validate all policy objects in files matching Discovery Rule D3 against `schemas/contracts/policy_ast.schema.json`.

**Source:** `schemas/contracts/policy_ast.schema.json`

**Evidence:** Schema defines Cedar policy structure for authorization

**Test Hook:** JSON Schema validation passes for `sample_policy_bundle.json` policies

**Severity:** ERROR

---

### REQ-SCHEMA-004

**Statement:** The compiler MUST validate all search documents in files matching Discovery Rule D4 against `schemas/contracts/search_document.schema.json`.

**Source:** `schemas/contracts/search_document.schema.json`

**Evidence:** Schema defines indexed document structure with permission attributes

**Test Hook:** JSON Schema validation passes for each element in `search_documents.json`

**Severity:** ERROR

---

### REQ-SCHEMA-005

**Statement:** The compiler MUST validate all files matching Discovery Rule D5 against `schemas/contracts/search_query.schema.json`.

**Source:** `schemas/contracts/search_query.schema.json`

**Evidence:** Schema defines search query with execution context

**Test Hook:** JSON Schema validation passes for `search_query.json`

**Severity:** ERROR

---

### REQ-SCHEMA-006

**Statement:** The compiler MUST validate all analytics events in files matching Discovery Rule D6 against `schemas/contracts/analytics_event.schema.json`.

**Source:** `schemas/contracts/analytics_event.schema.json`

**Evidence:** Schema defines analytics event for time-series aggregation

**Test Hook:** JSON Schema validation passes for each element in `analytics_events.json`

**Severity:** ERROR

---

### REQ-SCHEMA-007

**Statement:** The compiler MUST validate all files matching Discovery Rule D7 against `schemas/contracts/analytics_query.schema.json`.

**Source:** `schemas/contracts/analytics_query.schema.json`

**Evidence:** Schema defines time-bucketed analytics query structure

**Test Hook:** JSON Schema validation passes for `analytics_query.json`

**Severity:** ERROR

---

## 3.2 Event Envelope Constraints (Architecturally Significant)

### REQ-EVENT-001

**Statement:** The compiler MUST reject event envelopes missing idempotencyKey (Invariant I3).

**Source:** `architecture.md#I3`, `fixtures/invalid_event_envelope_missing_idempotency.json`

**Evidence:** "Duplicate idempotencyKey MUST NOT cause re-execution"

**Test Hook:** Fixture `invalid_event_envelope_missing_idempotency.json` is rejected

**Severity:** ERROR

---

### REQ-EVENT-002

**Statement:** The compiler MUST reject event envelopes missing correlationId (Invariant I5).

**Source:** `architecture.md#I5`, `schemas/contracts/event_envelope.schema.json`

**Evidence:** "correlationId MUST propagate through entire request flow"

**Test Hook:** Schema validation requires correlationId field

**Severity:** ERROR

---

### REQ-EVENT-003

**Statement:** The compiler MUST reject event envelopes missing tenantId.

**Source:** `schemas/contracts/event_envelope.schema.json`

**Evidence:** required field: tenantId (string, minLength 1)

**Test Hook:** Schema validation requires tenantId field

**Severity:** ERROR

---

### REQ-EVENT-004

**Statement:** The compiler MUST validate that eventType matches pattern `^[A-Za-z0-9]+\.[A-Za-z0-9]+$` and emit error code SCHEMA_VALIDATION_FAILED on violation.

**Source:** `schemas/contracts/event_envelope.schema.json`, `error_taxonomy.json`

**Evidence:** properties.eventType.pattern enforces namespaced format

**Test Hook:** Regex validation; error code SCHEMA_VALIDATION_FAILED emitted on mismatch

**Severity:** ERROR

---

### REQ-EVENT-005

**Statement:** The compiler MUST validate that schemaId matches pattern `^[a-z0-9.]+$` and emit error code SCHEMA_VALIDATION_FAILED on violation.

**Source:** `schemas/contracts/event_envelope.schema.json`, `error_taxonomy.json`

**Evidence:** properties.schemaId.pattern enforces lowercase dotted notation

**Test Hook:** Regex validation; error code SCHEMA_VALIDATION_FAILED emitted on mismatch

**Severity:** ERROR

---

## 3.3 Module Manifest Constraints (Architecturally Significant)

### REQ-MANIFEST-001

**Statement:** The compiler MUST validate that manifestVersion equals 2.

**Source:** `schemas/contracts/module_manifest.schema.json`

**Evidence:** properties.manifestVersion: enum [2]

**Test Hook:** Enum validation rejects other values

**Severity:** ERROR

---

### REQ-MANIFEST-002

**Statement:** The compiler MUST validate that moduleId matches pattern `^[a-z0-9-]+$`.

**Source:** `schemas/contracts/module_manifest.schema.json`

**Evidence:** properties.moduleId.pattern enforces kebab-case

**Test Hook:** Regex validation; `content-pages` passes, `contentPages` fails

**Severity:** ERROR

---

### REQ-MANIFEST-003

**Statement:** The compiler MUST validate that version matches semantic versioning pattern `^[0-9]+\.[0-9]+\.[0-9]+$`.

**Source:** `schemas/contracts/module_manifest.schema.json`

**Evidence:** properties.version.pattern enforces semver

**Test Hook:** Regex validation; "1.0.0" passes, "v1.0" fails

**Severity:** ERROR

---

### REQ-MANIFEST-004

**Statement:** The compiler MUST require uiRoutes field if moduleType array contains "ui".

**Source:** `schemas/contracts/module_manifest.schema.json`

**Evidence:** allOf conditional: moduleType contains ui → required uiRoutes

**Test Hook:** Conditional requirement validation

**Severity:** ERROR

---

### REQ-MANIFEST-005

**Statement:** The compiler MUST require projections field if moduleType array contains "projection".

**Source:** `schemas/contracts/module_manifest.schema.json`

**Evidence:** allOf conditional: moduleType contains projection → required projections

**Test Hook:** Conditional requirement validation

**Severity:** ERROR

---

### REQ-MANIFEST-006

**Statement:** The compiler MUST require jobs field if moduleType array contains "worker".

**Source:** `schemas/contracts/module_manifest.schema.json`

**Evidence:** allOf conditional: moduleType contains worker → required jobs

**Test Hook:** Conditional requirement validation

**Severity:** ERROR

---

### REQ-MANIFEST-007

**Statement:** The compiler MUST validate that eventContract.category is one of: "UI_INTENT", "DOMAIN", "AUDIT", "SYSTEM".

**Source:** `schemas/contracts/module_manifest.schema.json`

**Evidence:** $defs.eventContract.properties.category.enum

**Test Hook:** Enum validation for event category

**Severity:** ERROR

---

### REQ-MANIFEST-008

**Statement:** The compiler MUST validate that eventContract.compatibility is one of: "BACKWARD", "STRICT".

**Source:** `schemas/contracts/module_manifest.schema.json`

**Evidence:** $defs.eventContract.properties.compatibility.enum

**Test Hook:** Enum validation for schema compatibility

**Severity:** ERROR

---

### REQ-MANIFEST-009

**Statement:** The compiler MUST validate that job.kind is one of: "SCHEDULED", "EVENT_DRIVEN", "AD_HOC".

**Source:** `schemas/contracts/module_manifest.schema.json`

**Evidence:** $defs.job.properties.kind.enum

**Test Hook:** Enum validation for job kind

**Severity:** ERROR

---

### REQ-MANIFEST-010

**Statement:** The compiler MUST require schedule field if job.kind is "SCHEDULED".

**Source:** `schemas/contracts/module_manifest.schema.json`

**Evidence:** $defs.job.allOf: kind=SCHEDULED → required schedule

**Test Hook:** Conditional requirement validation

**Severity:** ERROR

---

### REQ-MANIFEST-011

**Statement:** The compiler MUST require triggerEvent field if job.kind is "EVENT_DRIVEN".

**Source:** `schemas/contracts/module_manifest.schema.json`

**Evidence:** $defs.job.allOf: kind=EVENT_DRIVEN → required triggerEvent

**Test Hook:** Conditional requirement validation

**Severity:** ERROR

---

## 3.4 Cache Policy Constraints

### REQ-CACHE-001

**Statement:** The compiler MUST validate that ttlSeconds is between 0 and 86400 inclusive.

**Source:** `schemas/contracts/cache_policy.schema.json`

**Evidence:** properties.ttlSeconds: minimum 0, maximum 86400

**Test Hook:** Range validation; 3600 passes, 90000 fails

**Severity:** ERROR

---

### REQ-CACHE-002

**Statement:** The compiler MUST validate that varyBy array contains unique items.

**Source:** `schemas/contracts/cache_policy.schema.json`

**Evidence:** properties.varyBy.uniqueItems: true

**Test Hook:** Uniqueness validation; ["TENANT", "LOCALE"] passes, ["TENANT", "TENANT"] fails

**Severity:** ERROR

---

### REQ-CACHE-003

**Statement:** The compiler MUST validate that privacy is one of: "PUBLIC", "TENANT", "USER", "ROLE_SCOPED".

**Source:** `schemas/contracts/cache_policy.schema.json`

**Evidence:** properties.privacy.enum

**Test Hook:** Enum validation

**Severity:** ERROR

---

## 3.5 Search Document Constraints

### REQ-SEARCH-001

**Statement:** The compiler MUST validate that permissionAttributes.allowedPrincipals, if present, has at least one element.

**Source:** `schemas/contracts/search_document.schema.json`

**Evidence:** permissionAttributes object properties.allowedPrincipals.minItems: 1

**Test Hook:** Array length validation; [] fails, ["principal-1"] passes

**Severity:** ERROR

---

## 3.6 Analytics Constraints

### REQ-ANALYTICS-001

**Statement:** The compiler MUST validate that analytics event schemaId matches pattern `^analytics\\.[a-z0-9_]+\\.[a-z0-9_]+\\.v[0-9]+$`.

**Source:** `schemas/contracts/analytics_event.schema.json`

**Evidence:** properties.schemaId.pattern enforces analytics schema format

**Test Hook:** Regex validation; "analytics.pages.view.v1" passes, "domain.page.v1" fails

**Severity:** ERROR

---

### REQ-ANALYTICS-002

**Statement:** The compiler MUST validate that analytics event metrics object has at least one property.

**Source:** `schemas/contracts/analytics_event.schema.json`

**Evidence:** properties.metrics.minProperties: 1

**Test Hook:** Object validation; {} fails, {"count": 1} passes

**Severity:** ERROR

---

### REQ-ANALYTICS-003

**Statement:** The compiler MUST validate that analytics query aggregationType is one of: "count", "sum", "avg", "min", "max".

**Source:** `schemas/contracts/analytics_query.schema.json`

**Evidence:** querySpec.properties.aggregationType.enum

**Test Hook:** Enum validation

**Severity:** ERROR

---

### REQ-ANALYTICS-004

**Statement:** The compiler MUST validate that analytics query bucketSize matches pattern `^[0-9]+(s|m|h|d)$`.

**Source:** `schemas/contracts/analytics_query.schema.json`

**Evidence:** querySpec.properties.bucketSize.pattern enforces time unit format

**Test Hook:** Regex validation; "5m" passes, "5min" fails

**Severity:** ERROR

---

## 3.7 Compiler Determinism

### REQ-DETERM-001

**Statement:** For identical discovered inputs, the compiler MUST produce byte-identical intermediate representation output.

**Source:** This document, Section 3.7

**Evidence:** Determinism is required for reproducible builds and golden tests

**Test Hook:** Run compiler twice on same inputs; byte-compare IR output files

**Severity:** ERROR

---

## 3.8 Diagnostics Contract

### REQ-DIAG-001

**Statement:** All ERROR-severity validation failures MUST emit an error code that exists in `error_taxonomy.json`.

**Source:** `error_taxonomy.json`

**Evidence:** Taxonomy defines codes: INVALID_ENVELOPE, MISSING_REQUIRED_FIELDS, SCHEMA_VALIDATION_FAILED, etc.

**Test Hook:** Validation failure error codes match entries in error_taxonomy.json

**Severity:** ERROR

---

## 3.9 Fixture Conformance

### REQ-FIXTURE-001

**Statement:** The compiler MUST validate that `fixtures/valid_event_envelope.json` passes event envelope schema validation.

**Source:** `fixtures/valid_event_envelope.json`

**Evidence:** Canonical well-formed event with all required fields

**Test Hook:** Schema validation returns success

**Severity:** ERROR

---

### REQ-FIXTURE-002

**Statement:** The compiler MUST reject `fixtures/invalid_event_envelope_missing_idempotency.json` due to missing idempotencyKey.

**Source:** `fixtures/invalid_event_envelope_missing_idempotency.json`

**Evidence:** Demonstrates violation: missing required field

**Test Hook:** Schema validation returns error code for missing field

**Severity:** ERROR

---

### REQ-FIXTURE-003

**Statement:** The compiler MUST validate that `fixtures/sample_module_manifest.json` passes module manifest schema validation.

**Source:** `fixtures/sample_module_manifest.json`

**Evidence:** Complete manifest with all declaration types

**Test Hook:** Schema validation returns success

**Severity:** ERROR

---

### REQ-FIXTURE-004

**Statement:** The compiler MUST validate that correlationId in `expected_page_created_event.json` matches correlationId in `sample_page_create_intent.json`.

**Source:** `fixtures/sample_page_create_intent.json`, `fixtures/expected_page_created_event.json`

**Evidence:** Both fixtures have correlationId: "corr-xyz789"

**Test Hook:** String equality check; both contain "corr-xyz789"

**Severity:** ERROR

---

### REQ-FIXTURE-005

**Statement:** The compiler MUST validate that causationId in `expected_page_created_event.json` equals eventId from `sample_page_create_intent.json`.

**Source:** `fixtures/expected_page_created_event.json`

**Evidence:** causationId: "evt-20250101-parent456" references parent

**Test Hook:** String equality check between causationId and parent eventId

**Severity:** ERROR

---

## 3.10 Error Taxonomy Structure

### REQ-ERROR-001

**Statement:** The compiler MUST validate that `error_taxonomy.json` contains a version field of type string.

**Source:** `error_taxonomy.json`

**Evidence:** Top-level version field present

**Test Hook:** Field presence and type validation

**Severity:** ERROR

---

### REQ-ERROR-002

**Statement:** The compiler MUST validate that each error in `error_taxonomy.json` has code, category, and description fields.

**Source:** `error_taxonomy.json`

**Evidence:** All error objects have these three fields

**Test Hook:** Object structure validation for all errors array elements

**Severity:** ERROR

---

### REQ-ERROR-003

**Statement:** The compiler MUST validate that error categories are one of: VALIDATION, REGISTRY, TENANT, AUTHZ, AUTHN, RESOURCE, CACHE, PERSISTENCE, QUOTA.

**Source:** `error_taxonomy.json`

**Evidence:** Nine enumerated categories present

**Test Hook:** Category field membership validation

**Severity:** ERROR

---

## 4. Runtime Semantics Documentation

This section documents runtime semantics that fixtures and architecture define. Compilers **MAY** use these to guide code generation but are **NOT required** to implement runtime logic.

---

### SEM-AUTHZ-001

**Semantics:** Cedar policy evaluation follows forbid-overrides-permit: any matching FORBID policy causes denial regardless of PERMIT policies (Invariant I4).

**Source:** `architecture.md#I4`, `fixtures/sample_policy_bundle.json`

**Evidence:** "evaluationSemantics.mode: forbid-overrides-permit" (Cedar's deny-overrides-allow semantics)

**Usage:** Cedar policy evaluator implementation guidance

---

### SEM-AUTHZ-002

**Semantics:** Default Cedar authorization decision is deny when no policies match (Invariant I4).

**Source:** `architecture.md#I4`, `fixtures/sample_policy_bundle.json`

**Evidence:** "evaluationSemantics.defaultDecision: deny"

**Usage:** Cedar policy evaluator implementation guidance

---

### SEM-DETERM-001

**Semantics:** Analytics time buckets align to epoch + bucketSize intervals (Invariant I11).

**Source:** `architecture.md#I11`, `fixtures/expected_analytics_buckets.json`

**Evidence:** "Bucket boundary = floor(timestamp / bucketSize) * bucketSize"

**Usage:** Analytics aggregation implementation guidance

---

### SEM-DETERM-002

**Semantics:** Analytics queries produce deterministic buckets for identical events and query parameters.

**Source:** `fixtures/expected_analytics_buckets.json`

**Evidence:** "$invariants.deterministic_bucketing"

**Usage:** Analytics aggregation testing and verification

---

### SEM-TENANT-001

**Semantics:** Search results exclude cross-tenant documents (Invariant I7).

**Source:** `architecture.md#I7`, `fixtures/expected_search_results_filtered.json`

**Evidence:** "Cross-tenant documents MUST NOT appear"

**Usage:** Search filter implementation guidance

---

### SEM-CACHE-001

**Semantics:** Cache keys include tenantId unless artifact is marked PUBLIC (Invariant I9).

**Source:** `architecture.md#I9`

**Evidence:** "All cache keys MUST include tenantId unless PUBLIC"

**Usage:** Cache key construction implementation guidance

---

---

## Non-normative Candidates (Not Enforced)

These are potential requirements identified but lacking sufficient explicit evidence for normative enforcement. They are listed for future consideration.

### CANDIDATE-001: Action Registry Collision Detection

**Observation:** `error_taxonomy.json` includes "ACTION_ALREADY_REGISTERED"

**Rationale for exclusion:** No schema defines collision detection algorithm or validation rule

**Future work:** Define actionId uniqueness constraint across module manifests

---

### CANDIDATE-002: Module Enablement Checking

**Observation:** `architecture.md` describes "Per-tenant module enablement"

**Rationale for exclusion:** No schema defines module enablement state or validation

**Future work:** Define module enablement contract and enforcement

---

### CANDIDATE-003: Schema Registry Compatibility Enforcement

**Observation:** `architecture.md` mentions schema compatibility; manifest defines BACKWARD/STRICT

**Rationale for exclusion:** No algorithm defined for BACKWARD vs STRICT checking

**Future work:** Define compatibility validation rules for schema evolution

---

### CANDIDATE-004: Outbox Pattern Enforcement

**Observation:** `architecture.md` I12 states "Events published via outbox pattern only"

**Rationale for exclusion:** No compile-time artifact validates outbox usage

**Future work:** Define compile-time markers for outbox pattern verification

---

### CANDIDATE-005: Projection Rebuildability Verification

**Observation:** `architecture.md` I12 states "Projections rebuildable from events"

**Rationale for exclusion:** No schema defines purity constraints for projections

**Future work:** Define projection dependency validation rules

---

### CANDIDATE-006: Policy AST Operator Completeness

**Observation:** Current policy AST supports: literal, equals, not, and, or

**Rationale for exclusion:** No documentation states additional operators (in, regex, etc.)

**Future work:** Document current operator set as complete OR extend schema

---

### CANDIDATE-007: CausationId Format Validation

**Observation:** `causationId` field exists in event envelope

**Rationale for exclusion:** Schema defines causationId as optional string with no pattern constraint

**Future work:** Define causationId format requirements if needed for trace linking

---

### CANDIDATE-008: Cache Artifact Tag Requirements

**Observation:** `fixtures/sample_module_manifest.json` shows cache artifacts with tenantId in tags

**Rationale for exclusion:** No schema constraint requires tenantId in tags for non-PUBLIC artifacts; Invariant I9 describes cache key construction, not tag requirements

**Future work:** Clarify relationship between cache artifact tags and cache key construction; define enforceable tag constraints if needed

---

### CANDIDATE-009: Event Envelope AdditionalProperties Enforcement

**Observation:** `event_envelope.schema.json` has "additionalProperties": false

**Rationale for exclusion:** Already enforced by schema validation (REQ-SCHEMA-001); not architecturally significant

**Future work:** None; covered by general schema validation

---

### CANDIDATE-010: Search Query ExecutionContext Validation

**Observation:** Both search and analytics queries require tenantId and principalId in executionContext

**Rationale for exclusion:** Already enforced by schema validation; semantics (tenant isolation) documented in SEM-TENANT-001

**Future work:** None; covered by schema validation and runtime semantics

---

**End of Normative Requirements**
