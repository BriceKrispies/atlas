/**
 * `<page-editor-right-panel>` — host for the inspector (settings tab).
 *
 * Stage-2 wires the existing property panel; stage-4 grows the inspector
 * into a full schema-grouped, multi-select-aware widget editor.
 */

import { AtlasElement, PageEditorPanelElement } from './panel-base.ts';

export class PageEditorRightPanelElement extends PageEditorPanelElement {
  static override surfaceId = 'authoring.page-editor.shell.right-panel';
  override readonly panelId = 'right' as const;
  override readonly resizeAxis = 'x' as const;
  override readonly resizeEdge = 'start' as const;
}

AtlasElement.define('page-editor-right-panel', PageEditorRightPanelElement);
