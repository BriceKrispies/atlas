# Atlas Admin — Derived Feature Set

Derived from backend specs (8 module specs, architecture doc, crosscut specs, surface inventory). This is for tenant admins — power users who configure everything within their tenant boundary.

## Navigation Structure (8 modules)

The admin shell declares these nav items: Content, Badges, Points, Org, Comms, Tokens, Import, Audit. Maps 1:1 to the 8 modules in the specs.

---

## 1. Content

### Content Pages (partially built)
- List all pages with title, slug, status, last updated
- Create page (title + slug)
- Delete page
- Real-time updates via `projection.updated` subscription
- Future: page editor with widget composition (WidgetInstance placement, settings)

### Media Library
- Grid/list view of uploaded files with thumbnails
- File upload (any type, tenant-scoped, private by default)
- File detail: preview/display based on MIME type (images inline, PDF preview, download fallback)
- Privacy toggle: private <-> public (admin only), public generates stable URL
- Placeholder behavior: public URL serves placeholder when toggled back to private
- Category management: create/delete categories, assign files to categories
- Search by filename, filter by category, filter by date range
- Bulk upload support

### Announcements Widget Config
- Configure widget instances: text content OR file reference from media library
- Per-instance config (different announcements on different pages)
- Preview of how announcement renders

---

## 2. Badges

### Badge Definitions
- List all badge definitions with name, criteria summary, point reward, image, status
- Create badge: name, description, criteria, point reward, image (from media library), email template (from comms)
- Criteria builder:
  - Intent-based: select intent type + threshold count (e.g., "10 file_uploaded intents")
  - Role-based: select role requirement (e.g., "has role Manager")
  - Combined: AND/OR of the above
- Edit/delete badge definitions
- Manual badge award: select user, select badge, provide reason
- Manual badge revocation (if supported)

### Badge Award History
- Table of all awards: user, badge, date awarded, points granted
- Filter by badge, by user, by date range
- Badge evaluation status/trigger (manual run, view last batch run)

---

## 3. Points

### Points Configuration
- Set monetary value per point (e.g., "1 point = $0.50")
- Display current configuration with last-updated timestamp

### Points Dashboard
- Total points awarded across all users
- Top earners leaderboard (top N users by balance)
- Manual point adjustment: select user, enter amount (+/-), provide reason

### Point Transaction History
- Full transaction log: user, amount, reason, source module, timestamp
- Filter by user, by source, by date range
- Export (CSV)

---

## 4. Org (Organization)

### Business Units
- List all business units with member count, nesting indicator
- Create business unit: name, description, optional parent unit
- Business unit detail view: list of member users + nested child units
- User search and add:
  - Search by username pattern
  - Search by role
  - Bulk select and add
- Remove users from business unit
- Nest/unnest business units (add one unit as child of another)
- Delete business unit (with warning if referenced by comms, badges, etc.)
- Circular nesting prevention

---

## 5. Comms (Communications)

### Email Templates
- List all templates with name, subject preview, last updated
- Template editor: name, subject, HTML body (with token placeholder syntax `[token_name]`)
- Template preview (showing raw placeholders)
- Test send to self (future)
- Delete template (with warning if referenced by badge rules)
- Duplicate template

### Email Notifications History
- Paginated list of all emails sent by the system
- Columns: recipient, subject, template used, sent timestamp, delivery status
- Status tracking: sent, delivered, bounced, failed
- Click to view full email detail (from, to, subject, rendered body, status timeline)
- Search by recipient email, subject, content
- Filter by status, by date range
- Read-only / immutable

### Messaging Widget Config
- Configure widget instances: which business units can send, which can view
- Per-instance configuration (multiple widgets with different permission sets)

---

## 6. Tokens

### Token Registry
- List all token definitions with name, type (static/dynamic), current value preview
- Create token:
  - Static: name + fixed string value
  - Dynamic: name + evaluation source (e.g., "user's current point balance", "site URL from config")
- Edit token value/logic
- Delete token (with warning if used in email templates)
- Token preview/test: evaluate a token in context to see output
- Search/filter token list

---

## 7. Import

### Spreadsheet Upload
- Configure upload widget: define expected columns, data types, validation rules, target action
- Upload CSV/XLSX file
- Immediate validation with row-level feedback:
  - Error details per row (e.g., "Row 23: user 'jdoe' not found")
  - Warning vs. error distinction
  - Summary: total rows, valid, errors
- Dry-run preview: show what will happen before committing
- Commit: execute configured action for each valid row
- Success/failure summary after commit
- Built-in configs: bulk point awards (username + points), bulk user creation (username + email + role)

### Upload History
- List of all past uploads: filename, uploader, timestamp, row count, success/error count, committed status
- Click to view detailed validation results
- Re-download original file

---

## 8. Audit

### Intent History
- Paginated, chronological list of all user intents across all modules
- Columns: intent type, actor (user), timestamp, summary/context
- Click to view full intent detail (JSON payload)
- Filters:
  - By intent type (dropdown of known types: file_uploaded, badge_awarded, email_sent, etc.)
  - By user
  - By date range
  - By keyword search across payload
- Group by module or intent type
- Export filtered results (CSV, JSON)
- Real-time tail option (live intent feed)
- Human-friendly labels for intent types (not just raw strings)

---

## Cross-Cutting Admin Features

Not a nav module, but admin-level platform concerns:

### Authorization / Policy Management
- View active policies for the tenant
- Policy CRUD (Cedar policies, once Cedar integration is complete)
- Authorization decision log: recent denials with reason + matched rules
- Dry-run policy evaluation: "would user X be allowed to do action Y?"

### UI Bundle Selection
- List available published bundles with version, compatibility range, status
- Select active bundle for the tenant
- View current active bundle details
- Rollback to previous bundle

---

## Surface Count

| Module | Pages/Surfaces |
|--------|---------------|
| Content | Pages List, Page Editor (future), Media Library, Announcement Widget Config |
| Badges | Badge Definitions, Badge Award History |
| Points | Points Config + Dashboard, Transaction History |
| Org | Business Units List + Detail |
| Comms | Email Templates, Email Notifications History, Messaging Widget Config |
| Tokens | Token Registry |
| Import | Spreadsheet Upload + Config, Upload History |
| Audit | Intent History |
| Platform | Policy Viewer, UI Bundle Selector |
| **Total** | **~16 surfaces** |

The admin shell nav should evolve to support sub-navigation within modules that have multiple surfaces (Content, Comms especially). The current flat nav list works for now since most modules are single-surface, but Content and Comms will need expandable sections or a secondary nav within the content area.
