/**
 * In-process mediator transport.
 *
 * Under `inline` and `shadow` isolation the widget code runs in the same
 * JS realm as the host, so the mediator is invoked via direct method
 * calls. The transport layer exists so that `iframe` isolation (Step 5)
 * can swap in a postMessage implementation without changing widget code
 * or the mediator API.
 *
 * For inline/shadow, the "transport" is a thin identity wrapper: the
 * widget's `context.channel` is built directly on top of the mediator,
 * so there is nothing to marshal. This module returns a no-op factory
 * that the host can call to stay symmetric with the future iframe path.
 */

/**
 * @param {{ mediator: import('../mediator.js').WidgetMediator }} args
 */
export function createInprocTransport({ mediator }) {
  return {
    kind: 'inproc',
    mediator,
    // No teardown needed; the mediator is owned by the host-element.
    dispose() {},
  };
}
