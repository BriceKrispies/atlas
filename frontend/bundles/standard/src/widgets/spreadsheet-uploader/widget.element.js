/**
 * SpreadsheetUploaderWidget — stub. Real implementation pending.
 */

import { AtlasSurface, html } from '@atlas/core';

export class SpreadsheetUploaderWidget extends AtlasSurface {
  static surfaceId = 'widget.import.spreadsheet-uploader';
  static empty = null;

  onMount() {
    this.setState('success');
  }

  render() {
    return html`
      <atlas-box padding="md">
        <atlas-text name="stub-label" variant="muted">Spreadsheet uploader not implemented yet (stub).</atlas-text>
      </atlas-box>
    `;
  }
}

AtlasSurface.define('widget-spreadsheet-uploader', SpreadsheetUploaderWidget);
