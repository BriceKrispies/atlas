/**
 * Page-editor panel hosts. Importing this module registers the three
 * `<page-editor-*-panel>` custom elements and re-exports their classes for
 * test/typing access.
 */

export { PageEditorPanelElement } from './panel-base.ts';
export type {
  PanelTabSpec,
  PanelResizeEventDetail,
  PanelToggleEventDetail,
  PanelTabEventDetail,
} from './panel-base.ts';
export { PageEditorLeftPanelElement } from './left-panel.ts';
export { PageEditorRightPanelElement } from './right-panel.ts';
export { PageEditorBottomPanelElement } from './bottom-panel.ts';
export { loadPanelSizes, savePanelSize } from './panel-storage.ts';
