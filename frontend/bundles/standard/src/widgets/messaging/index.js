export const manifest = {
  widgetId: 'comms.messaging',
  version: '0.0.1',
  displayName: 'Messaging',
  description: 'Placeholder stub for the messaging widget.',
  configSchema: 'ui.widget.messaging.config.v1',
  isolation: 'inline',
  capabilities: [],
  provides: { topics: [] },
  consumes: { topics: [] },
  deferredStates: [
    { state: 'loading', reason: 'Stub: not implemented yet.' },
    { state: 'empty', reason: 'Stub: not implemented yet.' },
    { state: 'validationError', reason: 'Stub: not implemented yet.' },
    { state: 'backendError', reason: 'Stub: not implemented yet.' },
    { state: 'unauthorized', reason: 'Stub: not implemented yet.' }
  ],
};

export { MessagingWidget as element } from './widget.element.js';
