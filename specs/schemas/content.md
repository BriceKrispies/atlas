# Content Module Schema

## Module Overview

The content module owns user-facing content: announcements (widget configuration) and a media library for file storage with privacy controls and categorization.

**Data Ownership:**
- Owns: Announcement widget configurations, media files, file categories, file-to-category associations
- References: Business units (modules/org) for announcement targeting (possibly)

**Purpose:**
Provide content management for announcements and a tenant-scoped file library with public/private access control.

## Entities

### AnnouncementWidgetConfig

**Description:**
Configuration for an announcements widget instance, defining the message text or file to display to end users.

**Tenant Scope:** Tenant-scoped

**Lifecycle:**
- Created when widget is configured by tenant admin
- Updated when content changes
- Mutable configuration entity

**Key Fields:**
- widget_instance_id — unique identifier (may be scoped to page/context)
- tenant_id — owning tenant
- content_type — 'text' or 'file'
- message_text — announcement text (if content_type is 'text'), nullable
- file_id — reference to MediaFile (if content_type is 'file'), nullable
- created_at — creation timestamp
- updated_at — last modification timestamp

**Invariants:**
- Exactly one of message_text or file_id must be populated (based on content_type)
- Widget configuration is per-instance (different announcements on different pages)
- Content is tenant-scoped
- If file_id is set, the file must exist in MediaFile

---

### MediaFile

**Description:**
Metadata for an uploaded file in the media library. Files can be private (tenant-only) or public (accessible via stable URL).

**Tenant Scope:** Tenant-scoped

**Lifecycle:**
- Created when file is uploaded
- Privacy status can be toggled by admin (private ↔ public)
- Can be deleted by admin (spec unclear if deletion is supported or just privacy toggle)
- Mutable entity (privacy status, categories)

**Key Fields:**
- file_id — unique identifier
- tenant_id — owning tenant
- filename — original filename
- mime_type — file MIME type
- size — file size in bytes
- uploader_id — user who uploaded the file
- uploaded_at — upload timestamp
- privacy_status — 'private' or 'public'
- public_url — stable URL for public access (if public), nullable
- storage_location — reference to blob storage location (implementation detail, conceptually tracked)
- created_at — creation timestamp
- updated_at — last modification timestamp (e.g., privacy toggle)

**Invariants:**
- Files are private by default
- Public files have stable public_url that persists even if toggled back to private
- When public file is toggled to private, public_url returns a placeholder instead of file
- Files are tenant-scoped (cannot access other tenant's files)
- Only admin can toggle privacy status

---

### FileCategory

**Description:**
A tenant-defined category for organizing files in the media library.

**Tenant Scope:** Tenant-scoped

**Lifecycle:**
- Created by tenant admin
- Updated by tenant admin (name, description)
- Deleted by tenant admin
- Mutable configuration entity

**Key Fields:**
- category_id — unique identifier
- tenant_id — owning tenant
- category_name — unique name within tenant
- description — optional descriptive text
- created_at — creation timestamp
- updated_at — last modification timestamp

**Invariants:**
- Category names must be unique within a tenant
- Categories are defined by admin, applied by users

---

### FileCategoryAssociation

**Description:**
Association between a media file and one or more categories.

**Tenant Scope:** Tenant-scoped

**Lifecycle:**
- Created when user assigns file to category
- Deleted when category is removed from file
- Mutable association

**Key Fields:**
- association_id — unique identifier
- file_id — reference to MediaFile
- category_id — reference to FileCategory
- tenant_id — owning tenant (for isolation)
- created_at — when association was created

**Invariants:**
- A file can belong to multiple categories
- A category can contain multiple files
- File and category must belong to the same tenant

## Relationships

### Internal Relationships

**AnnouncementWidgetConfig → MediaFile**
- Cardinality: Many-to-one (many announcements can reference one file)
- Directionality: References
- Notes: file_id in AnnouncementWidgetConfig references MediaFile

**MediaFile → FileCategoryAssociation**
- Cardinality: One-to-many (one file can have many category associations)
- Directionality: Owns
- Notes: Files can be organized into multiple categories

**FileCategory → FileCategoryAssociation**
- Cardinality: One-to-many (one category contains many files)
- Directionality: Owns
- Notes: Categories group files

### Cross-Module Relationships

**AnnouncementWidgetConfig → (references) → BusinessUnit (modules/org) (possibly)**
- Cardinality: Many-to-many (possibly, if announcements are targeted by business unit)
- Directionality: References
- Notes: Spec mentions "visibility rules (show to all users, specific business units, etc.)" as optional, but details are unclear

**MediaFile → (referenced by) → BadgeDefinition (modules/badges)**
- Cardinality: One-to-many (one file can be used as badge image for many badges)
- Directionality: Referenced by
- Notes: Badge images come from media library

**MediaFile → (uploaded by) → User (external)**
- Cardinality: Many-to-one (many files from one user)
- Directionality: References uploader
- Notes: uploader_id references user directory

## Derived / Computed Concepts

**Public File Access:**
- Not stored separately
- When public file is accessed via public_url:
  - If privacy_status is 'public': serve file
  - If privacy_status is 'private': serve placeholder instead
- Placeholder behavior prevents broken links when files are revoked

**File Display:**
- Media library page makes "best attempt at displaying" based on MIME type
- Display strategy (inline preview, download link, thumbnail) is computed at render time
- Not persisted

**Searchable File Metadata:**
- Files are searchable by filename, category, upload date, privacy status
- Search results are computed on-demand, not pre-aggregated

## Events & Audit Implications

**Intents Emitted:**
- `file_uploaded` — user uploads file (immutable event, though file metadata is mutable)
- `file_privacy_toggled` — admin changes privacy status (mutable admin activity)
- `file_deleted` — admin deletes file (if supported)
- `file_categorized` — user assigns file to category (mutable association)
- `category_created` — admin creates category (mutable admin activity)
- `category_deleted` — admin deletes category (mutable admin activity)
- `announcement_configured` — admin configures announcement widget (mutable admin activity)
- `announcement_viewed` (possibly) — user views announcement (high-volume, may not be tracked)
- `public_file_accessed` (possibly) — public URL accessed (high-volume, may not be tracked)

**Immutability:**
- MediaFile metadata is mutable (privacy status, categories can change)
- File upload event is immutable (the fact that upload happened)
- AnnouncementWidgetConfig is mutable
- FileCategory is mutable
- FileCategoryAssociation is mutable

**Audit Dependency:**
- All file management and announcement configuration intents are consumed by modules/audit for history tracking
- File access logs (if tracked) may feed analytics

## Open Questions

### File Storage Backend
- What storage backend is used? (S3, Azure Blob, local filesystem, CDN?)
- Are files physically deleted or just metadata marked as deleted?
- Is there versioning support (replace file but keep old versions)?

### File Lifecycle
- Can files be deleted, or only toggled private?
- If deleted, what happens to references (announcement widgets, badges)?
- Is there a soft-delete or retention policy for deleted files?

### File Upload Permissions
- Can non-admin end users upload files? If so, what permissions?
- Can users only see/manage their own uploads, or all files in tenant?

### File Constraints
- What is the file size limit per upload or per tenant?
- Are there allowed/blocked file types?
- Is there virus/malware scanning on upload?
- Is there content moderation for uploaded files?

### Placeholder Behavior
- What exactly is the placeholder? (image with dimensions? generic message? 404 with special handling?)
- Are placeholders per-file or a single global default per tenant?
- Do placeholders match the original file dimensions to prevent layout shifts?
- Can admins customize the placeholder?

### File Display
- What file types are explicitly supported vs. "best attempt"?
- What does "best attempt at displaying" mean technically? (inline preview, download link, thumbnail generation?)

### Announcement Widget
- Can widget show both text and file simultaneously, or is it one or the other?
- Is there scheduling (show announcement during date range)?
- Can announcements be dismissed by users?
- Are announcements targeted by business unit or role?
- Is there a history of past announcements?
- Can there be multiple active announcements per widget (carousel or list)?

### Announcement Targeting
- Are announcements targeted by business unit, role, or always shown to all users?
- If targeted, is this configured in AnnouncementWidgetConfig or a separate targeting entity?

### File Categories
- What happens to files when a category is deleted?
- Are files automatically uncategorized, or does deletion fail if category contains files?
- Is there a limit on the number of categories per tenant or per file?

### File Search
- Is there full-text search on filename, or just prefix/substring matching?
- Can users filter by multiple categories simultaneously?
- Are there saved searches or advanced filter combinations?

### Public File Analytics
- Should every public file access be logged as an intent? (Analytics vs. performance trade-off)
- Are there metrics on public file access counts, referrers, or geographic distribution?
