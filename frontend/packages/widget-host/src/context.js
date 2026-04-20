/**
 * buildContext — assembles the `context` object injected into a widget
 * before mount. Channel and request functions close over the widget's
 * `instanceId` so the widget cannot spoof another widget's identity.
 *
 * Returns a frozen object to discourage mutation.
 */

/**
 * @param {{
 *   principal: unknown,
 *   tenantId: string,
 *   correlationId: string,
 *   locale: string,
 *   theme: string,
 *   mediator: import('./mediator.js').WidgetMediator,
 *   bridge: import('./capabilities.js').CapabilityBridge,
 *   log?: { info?: Function, warn?: Function, error?: Function },
 *   widgetInstanceId: string,
 *   widgetManifest: object,
 * }} args
 */
export function buildContext({
  principal,
  tenantId,
  correlationId,
  locale,
  theme,
  mediator,
  bridge,
  log,
  widgetInstanceId,
  widgetManifest,
}) {
  const instanceId = widgetInstanceId;

  const channel = Object.freeze({
    publish: (topic, payload) => mediator.publish(instanceId, topic, payload),
    subscribe: (topic, handler) => mediator.subscribe(instanceId, topic, handler),
    request: (topic, payload, opts) =>
      mediator.request(instanceId, topic, payload, opts),
  });

  const request = (capabilityName, args) =>
    bridge.invoke(instanceId, capabilityName, args);

  const prefix = `[widget ${widgetManifest.widgetId}#${instanceId} cid=${correlationId}]`;
  const emit = (level) => (...args) => {
    const fn = log?.[level];
    if (typeof fn === 'function') {
      try {
        fn(prefix, ...args);
        return;
      } catch {
        /* fall through to console */
      }
    }
    // eslint-disable-next-line no-console
    console[level](prefix, ...args);
  };

  const boundLog = Object.freeze({
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
  });

  return Object.freeze({
    correlationId,
    principal,
    tenantId,
    locale,
    theme,
    channel,
    request,
    log: boundLog,
  });
}
