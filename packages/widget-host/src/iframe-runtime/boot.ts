/**
 * Boot script that runs inside the sandboxed iframe.
 *
 * Exported as a string constant so iframe-host.ts can inline it into
 * the iframe's srcdoc without any cross-origin module loading. The
 * script is self-contained: its only external reference is a dynamic
 * `import()` of the widget module URL supplied by the host in the
 * `init` envelope.
 *
 * Scope: matches what the announcements widget actually uses — a
 * `channel.publish`, a `context.request(capability, payload)`, and a
 * `log` triad. `channel.subscribe` and `channel.request` are stubbed
 * as clearly-throwing no-ops; extending the transport is future work.
 */

export const BOOT_SCRIPT: string = `
(function () {
  'use strict';

  const pending = new Map();
  let nextId = 1;
  let initialized = false;

  function post(msg) {
    window.parent.postMessage(msg, '*');
  }

  function makeContext(envelope) {
    const channel = Object.freeze({
      publish: (topic, payload) => {
        post({ kind: 'publish', topic: String(topic), payload });
      },
      subscribe: () => {
        // channel.subscribe is not implemented in the iframe transport
        // yet. Return a no-op unsubscribe so widgets that call it
        // defensively don't crash, but keep the gap visible.
        // eslint-disable-next-line no-console
        console.warn('[widget iframe] channel.subscribe is not implemented');
        return () => {};
      },
      request: () => {
        throw new Error('channel.request is not implemented in the iframe transport');
      },
    });

    const request = (capability, payload) =>
      new Promise((resolve, reject) => {
        const id = 'cap-' + (nextId++);
        pending.set(id, { resolve, reject });
        post({ kind: 'capability.invoke', id, capability: String(capability), payload });
      });

    const prefix = '[widget-iframe ' + (envelope.manifest && envelope.manifest.widgetId) +
      ' cid=' + (envelope.context && envelope.context.correlationId) + ']';
    const log = Object.freeze({
      // eslint-disable-next-line no-console
      info: (...args) => console.info(prefix, ...args),
      // eslint-disable-next-line no-console
      warn: (...args) => console.warn(prefix, ...args),
      // eslint-disable-next-line no-console
      error: (...args) => console.error(prefix, ...args),
    });

    return Object.freeze({
      correlationId: envelope.context.correlationId,
      principal: envelope.context.principal,
      tenantId: envelope.context.tenantId,
      locale: envelope.context.locale,
      theme: envelope.context.theme,
      channel,
      request,
      log,
    });
  }

  async function handleInit(envelope) {
    if (initialized) return;
    initialized = true;
    try {
      // Support modules (e.g. @atlas/design) must load before the
      // widget so any custom elements they register are defined in
      // this iframe's realm before the widget's template renders.
      const supportUrls = Array.isArray(envelope.supportModuleUrls)
        ? envelope.supportModuleUrls
        : [];
      for (const url of supportUrls) {
        await import(url);
      }
      const mod = await import(envelope.widgetModuleUrl);
      const ElementClass = mod && mod.element;
      if (typeof ElementClass !== 'function') {
        throw new Error('widget module did not export { element } at ' + envelope.widgetModuleUrl);
      }
      const context = makeContext(envelope);
      const element = new ElementClass();
      element.config = envelope.config;
      element.context = context;
      element.instanceId = envelope.instanceId;
      if (element.setAttribute) {
        element.setAttribute('data-widget-id', envelope.manifest.widgetId);
        element.setAttribute('data-widget-instance-id', envelope.instanceId);
      }
      const root = document.getElementById('root');
      root.appendChild(element);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[widget iframe] boot failed', err);
    }
  }

  function handleAck(envelope) {
    const entry = pending.get(envelope.id);
    if (!entry) return;
    pending.delete(envelope.id);
    if (envelope.ok) {
      entry.resolve(envelope.payload);
    } else {
      const errInfo = envelope.error || {};
      const err = new Error(errInfo.message || 'capability failed');
      if (errInfo.name) err.name = errInfo.name;
      entry.reject(err);
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.kind === 'init') {
      handleInit(data);
    } else if (data.kind === 'capability.ack') {
      handleAck(data);
    }
  });

  // Signal readiness. The host will respond with an 'init' envelope.
  post({ kind: 'widget-ready' });
})();
`;
