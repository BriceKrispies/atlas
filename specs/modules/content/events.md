# Content Module Events

## Intents Emitted

**file_uploaded**
- When: User uploads a file to media library
- Context: file name, file size, MIME type, uploader, tenant

**file_privacy_toggled**
- When: Admin changes file privacy status (private ↔ public)
- Context: file ID, old status, new status, public URL (if applicable), tenant

**file_deleted**
- When: Admin deletes a file from media library
- Context: file name, file ID, category, privacy status, tenant

**file_categorized**
- When: User assigns file to a category
- Context: file ID, category ID, tenant

**category_created**
- When: Admin creates a new file category
- Context: category name, tenant

**category_deleted**
- When: Admin deletes a file category
- Context: category name, file count in category, tenant

**announcement_configured**
- When: Admin configures or updates announcements widget
- Context: widget instance ID, content type (text/file), content reference, tenant

**announcement_viewed**
- When: User views an announcement (possibly)
- Context: widget instance ID, viewer ID, timestamp, tenant
- Note: May be high-volume if tracked

**public_file_accessed**
- When: Public file URL is accessed (possibly)
- Context: file ID, access timestamp, referrer, tenant
- Note: May be high-volume if tracked; useful for analytics

## Intents Consumed

None directly. Content module is primarily a service provider.

## Event Integration

**Outbound**
- File management generates audit intents
- Privacy changes may affect other modules (badges, announcements)
- File access logs may feed analytics

**Used By**
- **modules/badges** — selects badge images from media library
- **modules/audit** — records all content management in intent history
- Announcements widget displays files

## Open Questions

- Should every public file access be logged as an intent? (Analytics vs. performance trade-off)
- Are there notifications when files used by badges/announcements are deleted?
- Is there an intent for "placeholder served" (when private file accessed via public URL)?
