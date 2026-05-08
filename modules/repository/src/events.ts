/**
 * Event-type and schema-id constants for the repository module.
 *
 * Two event types in this slice — one per write-side intent:
 *   - `Repository.Created` — emitted by `handleRepositoryCreate`.
 *   - `Repository.Uploaded` — emitted by `handleRepositoryUpload`.
 *
 * Schema ids follow the canonical `domain.<domain>.<event>.v<version>` shape
 * used by `Tenancy.SignupApproved` and `ContentPages.PageCreated`. The JSON
 * Schema files themselves live under `specs/schemas/contracts/` and are
 * owned by the schema agent.
 */

export const REPOSITORY_CREATED_EVENT_TYPE = 'Repository.Created';
export const REPOSITORY_CREATED_SCHEMA_ID = 'domain.repository.created.v1';
export const REPOSITORY_CREATED_SCHEMA_VERSION = 1;

export const REPOSITORY_UPLOADED_EVENT_TYPE = 'Repository.Uploaded';
export const REPOSITORY_UPLOADED_SCHEMA_ID = 'domain.repository.uploaded.v1';
export const REPOSITORY_UPLOADED_SCHEMA_VERSION = 1;
