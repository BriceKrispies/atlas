/**
 * SpreadsheetUploaderWidget — stub. Real implementation pending.
 */

import { AtlasSurface, html } from '@atlas/core';

export class SpreadsheetUploaderWidget extends AtlasSurface {
  static override surfaceId = 'widget.import.spreadsheet-uploader';
  static override empty = null;

  override onMount(): void {
    this.setState('success');
  }

  override render(): DocumentFragment {
    return html`
      <atlas-box padding="md">
        <atlas-text name="stub-label" variant="muted">Spreadsheet uploader not implemented yet (stub).</atlas-text>
      </atlas-box>
    `;
  }
}

AtlasSurface.define('widget-spreadsheet-uploader', SpreadsheetUploaderWidget);
