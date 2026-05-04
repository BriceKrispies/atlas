# Storage

## File & Media Storage

### Privacy Model

**Private by Default**
- All uploaded files in the media library start as private
- Private files are accessible only within the tenant
- Tenant admins can toggle files to public

**Public Files**
- Can be linked anywhere on the site (via URL)
- Accessible without authentication
- Have stable URLs that persist even if file is made private again

**Privacy Toggle Behavior**
- Admin can switch file from private → public
- Admin can switch file from public → private
- When toggled to private, the public URL becomes a placeholder
- Placeholder preserves layout (prevents broken site appearance)
- Placeholder may show message like "This file is no longer available"

### File Organization

**Categories**
- Tenant admin defines file categories
- Categories are tenant-scoped
- Users can organize uploaded files into categories
- Categories aid in searchability and filtering

**Search & Display**
- Media library page attempts to display files (images, videos, PDFs, etc.)
- Searchable by filename, category, metadata
- Filterable by category, upload date, privacy status

### File Uploads

**Upload Sources**
- Users upload files directly via media library page
- Badges may reference images from media library
- Announcements may display files from media library

**Supported Formats**
- "Any file" can be uploaded
- System makes "best attempt at displaying" (implies format detection)
- Specific format restrictions not defined

### Storage Constraints

**Tenant Isolation**
- Files uploaded by one tenant are not accessible to other tenants
- Public files from tenant A cannot be linked by tenant B

**File Metadata**
- Track: uploader, upload timestamp, file size, MIME type, privacy status, category
- May track: last access, download count (not specified)

## Placeholder Behavior

When a public file is toggled to private:
- The public URL remains valid (does not 404)
- Instead of the file, a placeholder is returned
- Placeholder preserves the page layout (e.g., maintains image dimensions)
- Prevents breaking site appearance when files are revoked

### Open Questions

- What does the placeholder actually render? (image? text? configurable?)
- Are placeholders per-file or a single global default?
- Do placeholders match the original file dimensions/aspect ratio?
- Is there a file size limit per upload or per tenant?
- Is there versioning support (replace file but keep old versions)?
- Can files be deleted, or only toggled private?
- Are there retention policies or automatic deletion rules?
- Is virus scanning or content moderation performed on uploads?
