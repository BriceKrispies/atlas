/**
 * `<page-editor-left-panel>` — host for outline / palette / templates tabs.
 *
 * The tab content for `palette` (in content mode) and `templates` (in
 * structure mode) is built by the page-editor shell and slotted into the
 * panel body via `[data-tab=…]` containers. Stage-3 will add the outline
 * tree on `outline`.
 */

import { AtlasElement, PageEditorPanelElement } from './panel-base.ts';

export class PageEditorLeftPanelElement extends PageEditorPanelElement {
  static override surfaceId = 'authoring.page-editor.shell.left-panel';
  override readonly panelId = 'left' as const;
  override readonly resizeAxis = 'x' as const;
  override readonly resizeEdge = 'end' as const;
}

AtlasElement.define('page-editor-left-panel', PageEditorLeftPanelElement);
