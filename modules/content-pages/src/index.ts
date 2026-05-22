/**
 * @atlas/content-pages — Page + PageRenderTree on the L3 entity substrate.
 *
 * Storage: every Page and PageRenderTree is a row in `entities` keyed by
 * `(tenantId, entity_type, entity_id)`; the page→render-tree relationship
 * is a row in `relations` (edge_type='page.render-tree').
 */

export { newEventId } from './ids.ts';
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

export { defaultRenderTree, buildRenderTree } from './render-tree.ts';

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

// L3 substrate surface.
export {
  PAGE_ENTITY_TYPE,
  PAGE_LATEST_VERSION,
  getPageEntity,
  putPageEntity,
  deletePageEntity,
  listPageEntities,
} from './entities/page.ts';
export {
  PAGE_RENDER_TREE_ENTITY_TYPE,
  PAGE_RENDER_TREE_LATEST_VERSION,
  renderTreeEntityIdFor,
  getRenderTreeEntity,
  putRenderTreeEntity,
  deleteRenderTreeEntity,
  toRenderTree,
  type PageRenderTreeAttrs,
  type PutRenderTreeOptions,
} from './entities/page-render-tree.ts';
export {
  PAGE_RENDER_TREE_EDGE,
  PAGE_WIDGET_EDGE,
  linkRenderTree,
  unlinkRenderTree,
  findRenderTreeIdFor,
} from './entities/relations.ts';
export type {
  ContentPagesDispatchContextV2,
  ContentPagesQueryDepsV2,
} from './entities/contracts.ts';

// Action-driven query registry — substrate-only stub today (content-pages
// reads migrate onto the catch-all in a follow-up slice).
export { contentPagesQueryRegistry } from './queries/registry.ts';
