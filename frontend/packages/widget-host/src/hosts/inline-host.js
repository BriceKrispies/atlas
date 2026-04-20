/**
 * Inline host strategy — mounts the widget directly into the host's
 * light DOM. Fastest path; no style or DOM boundary.
 *
 * Error boundary behavior: if construction or attachment throws, the
 * caller's `onError(err)` is invoked and a no-op unmount is returned.
 * Sibling widgets are unaffected (INV-WIDGET-07).
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
  let element = null;
  try {
    element = new ElementClass();
    element.config = config;
    element.context = context;
    element.instanceId = instanceId;
    element.setAttribute('data-widget-id', manifest.widgetId);
    element.setAttribute('data-widget-instance-id', instanceId);
    hostContainer.appendChild(element);
  } catch (err) {
    try {
      onError(err);
    } catch {
      /* never throw from the error handler back to the host */
    }
    return () => {};
  }

  return () => {
    try {
      element?.onUnmount?.();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[widget-host] inline onUnmount threw', err);
    }
    try {
      element?.remove();
    } catch {
      /* detached already */
    }
    element = null;
  };
}

export default { mount };
