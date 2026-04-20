/**
 * Iframe host strategy — renders the widget inside a sandboxed iframe
 * (`sandbox="allow-scripts"`, no `allow-same-origin`) so the widget
 * runs in a separate origin with no DOM access to the host page.
 *
 * Communication flows exclusively through the postMessage transport.
 * The iframe loads its own copy of the widget module via dynamic
 * `import(widgetModuleUrl)`, which the caller must supply — there is
 * no way from inside a sandboxed frame to resolve a bare specifier
 * like `@atlas/core`. The host-element surfaces this via the
 * `resolveWidgetModuleUrl(widgetId)` hook; if it returns null we fail
 * fast with a clear error rather than mounting a blank frame.
 *
 * ElementClass is intentionally unused here: the iframe loads a fresh
 * instance of the class inside its own realm. The signature matches
 * the inline/shadow hosts for parity.
 */

import { BOOT_SCRIPT } from '../iframe-runtime/boot.js';
import { createPostMessageTransport } from '../transport/postmessage.js';

/**
 * @param {{
 *   manifest: object,
 *   config: object,
 *   context: object,
 *   instanceId: string,
 *   hostContainer: HTMLElement,
 *   ElementClass?: Function,
 *   onError: (err: unknown) => void,
 *   widgetModuleUrl?: string | null,
 * }} args
 * @returns {Promise<() => void>}
 */
export async function mount({
  manifest,
  config,
  context,
  instanceId,
  hostContainer,
  onError,
  widgetModuleUrl,
  supportModuleUrls,
}) {
  if (!widgetModuleUrl) {
    try {
      onError(
        new Error(
          `iframe isolation requires a widgetModuleUrl for '${manifest.widgetId}' — ` +
            'set <widget-host>.resolveWidgetModuleUrl to provide one.',
        ),
      );
    } catch {
      /* never throw from the error handler */
    }
    return () => {};
  }

  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.setAttribute('data-widget-id', manifest.widgetId);
  iframe.setAttribute('data-widget-instance-id', instanceId);
  iframe.style.cssText = 'width:100%;border:0;display:block;min-height:0;';
  iframe.srcdoc =
    '<!doctype html><html><body><div id="root"></div>' +
    '<script type="module">' + BOOT_SCRIPT + '</script>' +
    '</body></html>';

  const transport = createPostMessageTransport({
    iframe,
    onReady: () => {
      // Strip non-serializable fields (functions, mediator/bridge,
      // log closures) before crossing the postMessage boundary.
      const serializableContext = {
        correlationId: context.correlationId,
        principal: context.principal,
        tenantId: context.tenantId,
        locale: context.locale,
        theme: context.theme,
      };
      transport.send({
        kind: 'init',
        config,
        context: serializableContext,
        manifest: {
          widgetId: manifest.widgetId,
          version: manifest.version,
          capabilities: Array.isArray(manifest.capabilities) ? manifest.capabilities : [],
        },
        instanceId,
        widgetModuleUrl,
        supportModuleUrls: Array.isArray(supportModuleUrls) ? supportModuleUrls : [],
      });
    },
    onPublish: ({ topic, payload }) => {
      try {
        context.channel.publish(topic, payload);
      } catch (err) {
        // A widget publishing an undeclared topic throws inside its
        // own frame at request time; the iframe's publish is
        // fire-and-forget, so any mediator-side rejection surfaces
        // here. Log for debugging but don't cascade.
        // eslint-disable-next-line no-console
        console.error('[iframe-host] publish from widget failed', err);
      }
    },
    onCapabilityInvoke: async ({ id, capability, payload }) => {
      try {
        const result = await context.request(capability, payload);
        transport.send({ id, kind: 'capability.ack', ok: true, payload: result });
      } catch (err) {
        transport.send({
          id,
          kind: 'capability.ack',
          ok: false,
          error: {
            message: err && err.message ? err.message : String(err),
            name: err && err.name ? err.name : undefined,
          },
        });
      }
    },
  });

  hostContainer.appendChild(iframe);

  return () => {
    try {
      transport.dispose();
    } catch {
      /* already disposed */
    }
    try {
      iframe.remove();
    } catch {
      /* detached already */
    }
  };
}

export default { mount };
