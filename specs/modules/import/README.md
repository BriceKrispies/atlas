# Import Module

## Purpose

Provides a configurable widget for uploading and processing spreadsheets (CSV or XLSX) with validation, dry-run capabilities, and intent generation for bulk operations.

## Responsibilities

- Accept spreadsheet uploads (CSV and XLSX formats)
- Validate spreadsheet structure and data against configured rules
- Provide dry-run mode for previewing results before commit
- Execute bulk operations (e.g., award points, create users) when user commits
- Generate intents for each row processed
- Maintain upload history with validation results
- Provide rich validation feedback (errors, warnings, suggestions)

## Owned Data

**Spreadsheet Uploads**
- Upload metadata (filename, uploader, timestamp, status)
- Validation results (errors, warnings, row-level details)
- Dry-run vs. committed status
- Tenant scope

**Widget Configuration**
- Expected columns and data types
- Validation rules
- Action to perform (award points, create users, etc.)
- Tenant scope

**Upload History**
- Record of all uploads, validation outcomes, and commit status
- Audit trail for bulk operations

## Dependencies

### Consumed Services
- **modules/points** — bulk point awards (example use case)
- **User management system** — bulk user creation (example use case)
- File parsing library (CSV/XLSX reader)

### Consumed By
- Tenant admins performing bulk operations
- **modules/audit** — upload and import actions generate intents

## Runtime Behavior

**Upload Flow**
1. Admin uploads spreadsheet file (CSV or XLSX)
2. Widget parses file based on configuration
3. Validates each row against rules (required fields, data types, uniqueness)
4. Displays validation results (errors, warnings, row count)
5. Admin reviews results in dry-run mode
6. Admin commits if validation passes
7. Widget executes configured action for each valid row
8. Generates intents for each operation (e.g., "points_awarded")
9. Records upload in history

**Validation Rules (Examples)**
- Required columns present
- Data types match (numeric, string, email format)
- Referenced entities exist (e.g., user ID or username exists)
- No duplicate keys in batch
- Value ranges (e.g., points > 0)

**Example Configurations**
1. **Bulk Point Awards:** columns = username, points; action = award points to user
2. **Bulk User Creation:** columns = username, email, role; action = create user

## Integration Points

- Points module API for bulk awards
- User management API for bulk creation
- Audit module for intent recording
- File parsing library

## Open Questions

- How are widget configurations defined? (admin UI, JSON config, presets?)
- What is the maximum file size or row count?
- Are there row-level permissions (e.g., can only award points to users in my business unit)?
- Can imports be rolled back after commit?
- Is there async processing for very large uploads?
- Can admins download validation results (CSV with errors)?
- What happens on partial failures (some rows succeed, some fail)?
