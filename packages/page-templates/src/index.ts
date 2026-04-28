/**
 * @atlas/page-templates — public entry point.
 *
 * Importing this module registers the <content-page> and <widget-palette>
 * custom elements as a side effect. <widget-host> is transitively registered
 * by content-page-element.ts.
 */

import { AtlasElement } from '@atlas/core';
import { ContentPageElement } from './content-page-element.ts';
import { WidgetPaletteElement } from './editor/widget-palette.ts';
// Side-effect imports so `<atlas-layout>` and `<atlas-layout-editor>`
// are registered as soon as the package loads.
import './layout/layout-element.ts';
import './layout-editor/layout-editor-element.ts';
import './block-editor/index.ts';

export { TemplateRegistry, moduleDefaultTemplateRegistry } from './registry.ts';
export type {
  TemplateManifest,
  TemplateRegion,
  TemplateRegistryEntry,
  TemplateSummary,
} from './registry.ts';
export { validateTemplateManifest } from './manifest.ts';
export type { ValidationError, ValidationResult } from './manifest.ts';
export { validatePageDocument } from './document.ts';
export { InMemoryPageStore, ValidatingPageStore } from './page-store.ts';
export type { PageDocument, PageStore, WidgetInstance } from './page-store.ts';
export { ContentPageElement } from './content-page-element.ts';
export type { LayoutStoreLike } from './content-page-element.ts';
export { computeValidTargets } from './drop-zones.ts';
export type {
  ValidRegion,
  InvalidRegion,
  ValidTargetsResult,
  SourcePosition,
  ValidRegionReason,
  InvalidRegionReason,
  WidgetRegistryLike,
} from './drop-zones.ts';
export { EditorController } from './editor/editor-controller.ts';
export type {
  EditorControllerOptions,
  FoundInstance,
  EntrySnapshot,
  EditorReason,
  EditorAction,
  Position,
  ApplyOkResult,
  ApplyFailResult,
  ApplyResult,
  AddArgs as ControllerAddArgs,
  MoveArgs as ControllerMoveArgs,
  UpdateArgs as ControllerUpdateArgs,
  RemoveArgs as ControllerRemoveArgs,
  EditorListener,
} from './editor/editor-controller.ts';
export { EditorAPI, freshInstanceId } from './editor/editor-api.ts';
export type {
  EditorAPIOptions,
  AddArgs,
  MoveArgs,
  UpdateArgs,
  RemoveArgs,
  ApiResult,
  ApiOkResult,
  ApiFailResult,
  ApiReason,
  ApiOp,
  GetResult,
  EditorSnapshot,
  CommitInfo,
  CommitPatch,
  CommitRecord,
} from './editor/editor-api.ts';
export { WidgetPaletteElement } from './editor/widget-palette.ts';
export type { ChipSelectArg, ChipActivateArg } from './editor/widget-palette.ts';
export * as dnd from './dnd/index.ts';
export * as layout from './layout/index.ts';
export {
  AtlasLayoutElement,
  validateLayoutDocument,
  cloneLayoutDocument,
  emptyLayoutDocument,
  nextFreeRect,
  InMemoryLayoutStore,
  ValidatingLayoutStore,
  LayoutRegistry,
  moduleDefaultLayoutRegistry,
  presetLayouts,
} from './layout/index.ts';
export type {
  LayoutDocument,
  LayoutGrid,
  LayoutSlot,
  LayoutStore,
  LayoutValidationError,
  LayoutValidationResult,
} from './layout/index.ts';
export { AtlasLayoutEditorElement } from './layout-editor/layout-editor-element.ts';
export { ensureLayoutEditorStyles } from './layout-editor/layout-editor-styles.ts';
export {
  BlockEditorController,
  AtlasBlockEditor,
  AtlasBlock,
  AtlasEditorToolbar,
  freshBlockId,
} from './block-editor/index.ts';
export type {
  Block,
  BlockDocument,
  BlockType,
  BlockContent,
  BlockEditorSnapshot,
  BlockEditorOptions,
} from './block-editor/index.ts';
export * from './errors.ts';

if (typeof customElements !== 'undefined') {
  AtlasElement.define('content-page', ContentPageElement);
  AtlasElement.define('widget-palette', WidgetPaletteElement);
}
