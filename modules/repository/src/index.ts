/**
 * @atlas/repository — Code platform's `repository` domain.
 *
 * First capability: `upload-tarball` — a tenant runs `atlasctl push` and
 * a tar.gz of the working directory ends up stored as a new revision
 * under their tenant scope.
 *
 * Owns:
 *   - `Repository.Create` + `Repository.Upload` intent handlers.
 *   - `Repository.Created` + `Repository.Uploaded` event types.
 *   - The dispatcher that rebuilds canonical metadata from events
 *     (rebuildable from event history — Invariant I12).
 *   - Read-side queries (`getRepository`, `listRepositories`,
 *     `getRevision`, `listRevisions`).
 *
 * Persistence is delegated to `RepositoryStore` + `RepositoryRevisionStore`
 * (both server-only — the IDB adapter ships throw-stubs since browser
 * push is not supported in Phase 1).
 */

export {
  RepositoryError,
  codes as repositoryErrorCodes,
  type RepositoryErrorCode,
} from './errors.ts';

export { newRepoId, newRevisionId, newEventId } from './ids.ts';

export {
  REPOSITORY_CREATED_EVENT_TYPE,
  REPOSITORY_CREATED_SCHEMA_ID,
  REPOSITORY_CREATED_SCHEMA_VERSION,
  REPOSITORY_UPLOADED_EVENT_TYPE,
  REPOSITORY_UPLOADED_SCHEMA_ID,
  REPOSITORY_UPLOADED_SCHEMA_VERSION,
} from './events.ts';

export type {
  RepositoryRecord,
  RevisionRecord,
  RepositoryCreateCommand,
  RepositoryCreateResult,
  RepositoryCreatedPayload,
  RepositoryUploadCommand,
  RepositoryUploadResult,
  RepositoryUploadedPayload,
} from './types.ts';
export { UPLOAD_BYTE_LIMIT } from './types.ts';

export { handleRepositoryCreate } from './handlers/repository-create.ts';
export { handleRepositoryUpload } from './handlers/repository-upload.ts';
export {
  repositoryHandlerEntries,
  repositoryHandlerRegistry,
} from './handlers/index.ts';

export {
  applyRepositorySummary,
  rebuildRepositorySummary,
} from './projections/repository-summary.ts';
export {
  applyRevisionList,
  rebuildRevisionList,
} from './projections/revision-list.ts';

export {
  getRepository,
  listRepositories,
  getRevision,
  listRevisions,
  type RepositoryReadDeps,
  type RepositoryRevisionReadDeps,
} from './queries/repositories.ts';

export {
  dispatchRepositoryEvent,
  repositoryDispatcher,
  type RepositoryDispatchContext,
} from './dispatch.ts';
