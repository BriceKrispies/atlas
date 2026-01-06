# Import Module Schema

## Module Overview

The import module owns the spreadsheet upload workflow: accepting CSV/XLSX files, validating them against configurable rules, providing dry-run preview, and executing bulk operations.

**Data Ownership:**
- Owns: Spreadsheet upload records, upload validation results, widget configurations
- References: Users (external), points (modules/points) for bulk awards, business units (modules/org) possibly

**Purpose:**
Enable bulk data operations (point awards, user creation, etc.) via spreadsheet upload with validation and audit trail.

## Entities

### SpreadsheetUploaderWidgetConfig

**Description:**
Configuration for a spreadsheet uploader widget instance, defining column definitions, validation rules, and the action to perform on commit.

**Tenant Scope:** Tenant-scoped

**Lifecycle:**
- Created when widget is configured by tenant admin
- Updated when configuration changes
- Mutable configuration entity

**Key Fields:**
- widget_instance_id — unique identifier (may be scoped to page/context)
- tenant_id — owning tenant
- column_definitions — schema for expected columns (names, data types)
- validation_rules — rules to validate each row (required fields, formats, ranges)
- action_type — what to do on commit (e.g., 'award_points', 'create_users')
- created_at — creation timestamp
- updated_at — last modification timestamp

**Invariants:**
- Widget must be configured before accepting uploads
- Column definitions and validation rules must be defined
- Action type determines which downstream module is called on commit

---

### SpreadsheetUpload

**Description:**
A record of a single spreadsheet upload, including the file, validation results, and commit status.

**Tenant Scope:** Tenant-scoped

**Lifecycle:**
- Created when user uploads spreadsheet
- Validation results populated immediately (dry-run mode)
- Commit status updated when user commits (or remains uncommitted)
- Immutable after commit (unless rollback is supported, which is unclear)

**Key Fields:**
- upload_id — unique identifier
- widget_instance_id — which widget this upload belongs to
- tenant_id — owning tenant
- uploader_id — user who uploaded the file
- filename — original filename
- uploaded_at — upload timestamp
- status — 'uploaded', 'validated', 'committed', 'failed'
- validation_results — JSON payload with validation errors, warnings, row-level details
- row_count — total rows in spreadsheet
- valid_row_count — rows that passed validation
- error_row_count — rows with validation errors
- committed_at — timestamp when upload was committed (nullable)
- created_at — record creation timestamp
- updated_at — last status update timestamp

**Invariants:**
- Validation runs immediately on upload (dry-run mode)
- User cannot commit until validation passes (or only valid rows are committed, unclear)
- All uploads are logged regardless of commit status
- Uploads are tenant-scoped

---

### UploadHistory

**Description:**
A historical record of upload outcomes, tracking success/failure counts and audit trail.

**Tenant Scope:** Tenant-scoped

**Lifecycle:**
- Created when upload is committed
- Immutable after creation
- Append-only

**Key Fields:**
- history_id — unique identifier
- upload_id — reference to SpreadsheetUpload
- tenant_id — owning tenant
- row_count — total rows processed
- success_count — rows successfully processed
- error_count — rows that failed during commit
- committed_at — timestamp of commit
- created_at — record creation timestamp

**Invariants:**
- One history record per committed upload
- Provides audit trail for bulk operations
- Immutable

## Relationships

### Internal Relationships

**SpreadsheetUploaderWidgetConfig → SpreadsheetUpload**
- Cardinality: One-to-many (one widget config governs many uploads)
- Directionality: SpreadsheetUpload references widget config
- Notes: Upload inherits column definitions and validation rules from config

**SpreadsheetUpload → UploadHistory**
- Cardinality: One-to-one (one upload creates one history record on commit)
- Directionality: UploadHistory references SpreadsheetUpload
- Notes: History is created only after commit

### Cross-Module Relationships

**SpreadsheetUpload → (triggers) → PointTransaction (modules/points)**
- Cardinality: One-to-many (one upload creates many point transactions)
- Directionality: Upload triggers point awards on commit
- Notes: For bulk point award use case, each valid row generates a PointTransaction

**SpreadsheetUpload → (triggers) → User Creation (external)**
- Cardinality: One-to-many (one upload creates many users)
- Directionality: Upload triggers user creation on commit
- Notes: For bulk user creation use case, each valid row creates a user

**SpreadsheetUpload → (may reference) → BusinessUnit (modules/org)**
- Cardinality: Many-to-one (possibly, if uploads reference business units)
- Directionality: References
- Notes: Spec mentions spreadsheet uploads may reference business units, but details are unclear

**SpreadsheetUpload → (uploaded by) → User (external)**
- Cardinality: Many-to-one (many uploads from one user)
- Directionality: References uploader
- Notes: uploader_id references user directory

## Derived / Computed Concepts

**Validation Errors:**
- Derived from validation_results JSON payload
- Displayed to user as row-by-row feedback
- Not stored as separate entities

**Dry-Run Preview:**
- Computed from validation results: "what will happen if committed"
- Shows success/error counts, row-level details
- Ephemeral (not persisted beyond validation_results)

**Commit Success Summary:**
- Derived from UploadHistory: "100 rows processed, 95 succeeded, 5 failed"
- Computed on-demand for UI display
- Not stored separately

## Events & Audit Implications

**Intents Emitted:**
- `spreadsheet_uploaded` — user uploads file (immutable event)
- `spreadsheet_validated` — validation completes (immutable event)
- `import_committed` — user commits upload (immutable event)
- `import_row_processed` (possibly) — each row processed on commit (high-volume, may be batched)
- `import_failed` — import commit fails (immutable event)
- `widget_configured` — admin configures widget (mutable admin activity)

**Downstream Intents:**
- Bulk point awards: each row generates `points_awarded` intent (modules/points)
- Bulk user creation: each row generates `user_created` intent (external)
- These downstream intents are owned by target modules but triggered by import

**Immutability:**
- SpreadsheetUploaderWidgetConfig is mutable
- SpreadsheetUpload is mostly immutable after creation (status field may update)
- UploadHistory is immutable (append-only)

**Audit Dependency:**
- All upload and import intents are consumed by modules/audit for history tracking
- UploadHistory provides secondary audit trail for bulk operations

## Open Questions

### Widget Configuration
- How are widget configurations defined? (admin UI, JSON config, presets?)
- Are there built-in configurations (point awards, user creation), or is it fully custom?
- Is the widget configuration per-instance (multiple widgets on different pages) or global per-tenant?

### Validation Rules
- What validation rules are supported? (required fields, data types, regex, custom logic?)
- Can validation rules call external services (e.g., check if username exists)?
- Can admins test validation rules before uploading real data?

### Partial Commits
- Can widget be configured to allow partial commits (skip errors, commit valid rows)?
- Or must all rows pass validation before commit is allowed?
- If partial commits are allowed, how are failed rows tracked?

### File Size and Row Limits
- What is the maximum file size or row count?
- Is there a warning for large uploads?
- Is processing synchronous (blocking) or asynchronous (background job)?

### Async Processing
- Is processing synchronous or async for large files?
- If async, are there notifications when processing completes?
- Are there progress indicators for long-running imports?

### Rollback
- Can imports be rolled back after commit?
- If so, how are downstream changes (point transactions, user creations) undone?
- Is rollback a manual admin action or automated?

### Row-Level Error Detail
- Is there row-level error detail in the UI (e.g., "Row 23: user 'jdoe' not found")?
- Can admins download validation results as annotated CSV?
- Are validation errors stored in validation_results JSON or separate entity?

### Concurrent Uploads
- Can multiple admins upload concurrently?
- Are there concurrency safeguards (e.g., prevent duplicate uploads)?
- Can the same file be uploaded multiple times?

### Malformed Files
- What happens if CSV/XLSX fails to parse?
- Is there error handling for malformed files, incorrect encoding, etc.?

### Referenced Entity Validation
- When validating "user exists", is this checked at upload time or commit time?
- What happens if referenced entity is deleted between upload and commit (e.g., user deleted)?
- Is validation re-run before commit, or does commit use cached validation results?

### Empty Spreadsheets
- What happens if spreadsheet is empty or contains only headers?
- Is this treated as error or valid upload with zero rows?

### Upload File Storage
- Is the original uploaded file stored, or just metadata?
- Can admins re-download the original file later?
- If file is stored, where (blob storage, filesystem)?

### Validation Results Storage
- Are validation results stored as JSON in validation_results field?
- Or is there a separate ValidationError entity for row-level errors?
- Is there a size limit on validation_results JSON?

### Commit-Time Failures
- What happens on partial failures during commit (some rows succeed, some fail)?
- Is the entire import rolled back, or are successes kept and failures logged?
- How are commit-time failures different from validation failures?

### Downstream Module Rejection
- Can downstream modules reject rows during commit (e.g., business rule violations)?
- If so, how is this surfaced to the user?
- Is this treated as validation error or commit-time failure?

### Intent Granularity
- Should each row generate an individual intent, or is there a batch summary intent?
- If individual intents, how is high-volume write to audit managed?

### Action Type Extensibility
- Is action_type a fixed enum (award_points, create_users) or extensible?
- Can custom action types be defined by admins or developers?
- How does the import module know which downstream API to call for each action type?
