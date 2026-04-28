import type { WidgetManifest } from '@atlas/widget-host';

export const manifest: WidgetManifest = {
  widgetId: 'import.spreadsheet-uploader',
  version: '0.0.1',
  displayName: 'Spreadsheet Uploader',
  description: 'Placeholder stub for the spreadsheet uploader widget.',
  configSchema: 'ui.widget.spreadsheet-uploader.config.v1',
  isolation: 'inline',
  capabilities: [],
  provides: { topics: [] },
  consumes: { topics: [] },
  deferredStates: [
    { state: 'loading', reason: 'Stub: not implemented yet.' },
    { state: 'empty', reason: 'Stub: not implemented yet.' },
    { state: 'validationError', reason: 'Stub: not implemented yet.' },
    { state: 'backendError', reason: 'Stub: not implemented yet.' },
    { state: 'unauthorized', reason: 'Stub: not implemented yet.' },
  ],
};

export { SpreadsheetUploaderWidget as element } from './widget.element.ts';
