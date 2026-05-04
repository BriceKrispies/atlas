# Import Module Events

## Intents Emitted

**spreadsheet_uploaded**
- When: User uploads a spreadsheet file
- Context: filename, file size, uploader, row count, tenant

**spreadsheet_validated**
- When: Validation completes (dry-run)
- Context: upload ID, valid row count, error count, warning count, tenant

**import_committed**
- When: User commits a validated upload
- Context: upload ID, action type (points, users, etc.), committed row count, tenant

**import_row_processed**
- When: Each row is processed during commit (possibly, if granular tracking desired)
- Context: upload ID, row number, action performed, result (success/failure), tenant
- Note: High-volume; consider batching or summarizing

**import_failed**
- When: Import commit fails (partial or total failure)
- Context: upload ID, failure reason, failed row count, tenant

**widget_configured**
- When: Admin configures spreadsheet uploader widget
- Context: widget instance ID, column definitions, validation rules, action type, tenant

## Intents Consumed

None directly. Import module is a service provider that triggers actions in other modules.

## Event Integration

**Outbound**
- Upload and validation intents for audit trail
- Triggers downstream intents in target modules (e.g., "points_awarded" for each row)

**Triggers**
- **modules/points** — bulk point awards generate "points_awarded" intents
- **User management** — bulk user creation generates "user_created" intents
- **modules/audit** — all import activity recorded

**Used By**
- **modules/audit** — records import history and all row-level operations

## Downstream Intents (Examples)

When import commits:
- **Bulk point awards:** each row generates "points_awarded" intent
- **Bulk user creation:** each row generates "user_created" intent

These downstream intents are owned by the target modules (points, user management) but triggered by the import.

## Open Questions

- Should each row generate an individual intent, or is there a batch summary intent?
- Are there progress events for async processing of large imports?
- Are there notifications (email, in-app) when imports complete?
- Can downstream modules reject rows during commit (e.g., business rule violations)?
