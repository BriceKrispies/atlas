# Content Module

## Purpose

Manages user-facing content including announcements and a media library for file storage with privacy controls and categorization.

## Responsibilities

- Display arbitrary messages or files to users via announcements widget
- Store and manage uploaded files (media library)
- Enforce file privacy (private by default, admin-toggleable to public)
- Provide file categorization and search capabilities
- Serve public files via stable URLs
- Render placeholders for files toggled from public to private
- Attempt to display various file types (images, videos, PDFs, etc.)

## Owned Data

**Announcements**
- Announcement content (text or file reference), widget instance config, tenant scope

**Media Files**
- File metadata (name, MIME type, size, uploader, upload timestamp)
- Privacy status (private or public)
- Category assignments
- File storage location (blob storage, filesystem, CDN, etc.)
- Public URL (if public)
- Tenant scope

**Media Categories**
- Category name, description, tenant scope

## Dependencies

### Consumed Services
- File storage backend (S3, Azure Blob, local filesystem)
- CDN or static file server for public file access
- **modules/badges** — badges may reference images from media library

### Consumed By
- **modules/badges** — selects badge images from media library
- Announcements widget displays files from media library
- Any feature needing to display or link to files

## Runtime Behavior

**File Upload Flow**
1. User uploads file via media library page
2. File is stored in tenant-scoped storage location
3. File metadata saved to database (private by default)
4. User can assign file to a category

**Public File Access Flow**
1. Admin toggles file from private to public
2. System generates stable public URL
3. File is accessible via public URL without authentication
4. If later toggled to private, public URL returns placeholder instead of file

**Placeholder Behavior**
- When public file is toggled to private, public URL remains valid
- Instead of serving file, serves a placeholder (image, HTML, or JSON)
- Placeholder prevents broken links and maintains site layout

## Integration Points

- Badge image selection from media library
- Announcement widget file display
- Public URL generation and access control
- Placeholder rendering for revoked public files

## Open Questions

- What file types are explicitly supported vs. "best attempt"?
- What does "best attempt at displaying" mean technically? (inline preview, download link, thumbnail?)
- What storage backend is used?
- Are there file size limits per upload or per tenant?
- Is there virus scanning on upload?
- Can files be versioned or replaced?
- Can files be deleted, or only toggled private?
- What exactly is rendered as a placeholder? (dimensions-matched image? generic message?)
