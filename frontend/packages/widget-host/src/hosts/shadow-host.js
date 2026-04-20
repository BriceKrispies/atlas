/**
 * Shadow host strategy — mounts the widget inside a closed shadow root
 * attached to a host-managed container. Provides CSS and DOM
 * encapsulation on top of the inline guarantees.
 *
 * Note: closed shadow roots are used per spec; the host keeps a reference
 * to the shadow root via the returned unmount closure. External callers
 * cannot traverse into the widget's DOM via `querySelector`.
 */

/**
 * @param {{
 *   manifest: object,
 *   config: object,
 *   context: object,
 *   instanceId: string,
 *   hostContainer: HTMLElement,
 *   ElementClass: Function,
 *   onError: (err: unknown) => void,
 * }} args
 * @returns {Promise<() => void>}
 */
export async function mount({
  manifest,
  config,
  context,
  instanceId,
  hostContainer,
  ElementClass,
  onError,
}) {
  let host = null;
  let shadow = null;
  let element = null;

  try {
    host = document.createElement('div');
    host.setAttribute('data-widget-shell', '');
    host.setAttribute('data-widget-id', manifest.widgetId);
    host.setAttribute('data-widget-instance-id', instanceId);
    hostContainer.appendChild(host);

    // Some headless DOMs (linkedom) do not implement attachShadow; fall
    // back to the inline path in that case so dry-run tests still work.
    if (typeof host.attachShadow === 'function') {
      shadow = host.attachShadow({ mode: 'closed' });
    }

    element = new ElementClass();
    element.config = config;
    element.context = context;
    element.instanceId = instanceId;

    if (shadow) {
      shadow.appendChild(element);
    } else {
      host.appendChild(element);
    }
  } catch (err) {
    try {
      onError(err);
    } catch {
      /* swallow */
    }
    return () => {
      try {
        host?.remove();
      } catch {
        /* already detached */
      }
    };
  }

  return () => {
    try {
      element?.onUnmount?.();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[widget-host] shadow onUnmount threw', err);
    }
    try {
      host?.remove();
    } catch {
      /* detached */
    }
    element = null;
    shadow = null;
    host = null;
  };
}

export default { mount };
