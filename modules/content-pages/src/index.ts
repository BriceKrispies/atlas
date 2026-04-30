/**
 * @atlas/content-pages — Page CRUD + render-tree projection.
 *
 * Mirrors the Rust content-pages handler logic in
 * `crates/ingress/src/main.rs::handle_intent` (Page.Create branch) +
 * `crates/ingress/src/worker.rs::build_render_tree` so render trees are
 * byte-equivalent across the Rust/TS flip.
 */

export { newEventId, pageDocumentKey, renderTreeKey, pageListKey } from './ids.ts';
export type {
  PageStatus,
  PageDocument,
  PageSummary,
  RenderNode,
  RenderTree,
} from './types.ts';

export {
  handlePageCreate,
  type PageCreateCommand,
  type PageCreateResult,
} from './handlers/page-create.ts';
export {
  handlePageUpdate,
  type PageUpdateCommand,
  type PageUpdateResult,
} from './handlers/page-update.ts';
export {
  handlePageDelete,
  type PageDeleteCommand,
  type PageDeleteResult,
} from './handlers/page-delete.ts';
export {
  contentPagesHandlerEntries,
  contentPagesHandlerRegistry,
} from './handlers/registry.ts';

export {
  defaultRenderTree,
  buildRenderTree,
  rebuildRenderTree,
  deleteRenderTree,
} from './projections/render-tree.ts';
export {
  upsertPageInList,
  removePageFromList,
  listPages as readPageList,
} from './projections/page-list.ts';
export {
  readPageDocument,
  writePageDocument,
  deletePageDocument,
} from './projections/page-document.ts';

export {
  dispatchContentPagesEvent,
  contentPagesDispatcher,
  type ContentPagesDispatchContext,
} from './dispatch.ts';
export {
  listPages,
  getPage,
  getRenderTree,
  type ContentPagesQueryDeps,
} from './queries.ts';

export { ContentPagesError, codes as contentPagesErrorCodes } from './errors.ts';
