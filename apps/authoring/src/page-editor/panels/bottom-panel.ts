/**
 * `<page-editor-bottom-panel>` — host for issues / history / preview-device tabs.
 *
 * Stage-2 ships empty placeholders; stage-5 wires preview-device, stage-6
 * wires issues + history-timeline.
 */

import { AtlasElement, PageEditorPanelElement } from './panel-base.ts';

export class PageEditorBottomPanelElement extends PageEditorPanelElement {
  static override surfaceId = 'authoring.page-editor.shell.bottom-panel';
  override readonly panelId = 'bottom' as const;
  override readonly resizeAxis = 'y' as const;
  override readonly resizeEdge = 'start' as const;
}

AtlasElement.define('page-editor-bottom-panel', PageEditorBottomPanelElement);
