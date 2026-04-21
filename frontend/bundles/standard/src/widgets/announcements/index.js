/**
 * content.announcements — public widget entry.
 *
 * Importing this module has the side effect of registering the
 * <widget-announcements> custom element (see widget.element.js).
 */

export const manifest = {
  widgetId: 'content.announcements',
  version: '0.1.0',
  displayName: 'Announcements',
  description:
    'Displays a tenant-authored announcement — plain text or a media file from the media library.',
  configSchema: 'ui.widget.announcements.config.v1',
  isolation: 'inline',
  capabilities: ['backend.query'],
  provides: { topics: ['announcement.dismissed'] },
  consumes: { topics: [] },
  deferredStates: [
    { state: 'validationError', reason: 'Read-only widget; no user input.' },
    { state: 'unauthorized', reason: 'v1 shows empty state when content is inaccessible.' },
  ],
};

export { AnnouncementsWidget as element } from './widget.element.js';
