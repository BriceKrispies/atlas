/**
 * Host-side postMessage transport for iframe-isolated widgets.
 *
 * The iframe is sandboxed with `allow-scripts` only, so its origin is
 * `"null"` and we cannot use an origin check. Instead we filter by
 * `event.source === iframe.contentWindow`, which is the documented
 * cross-browser signal for matching messages to a specific frame.
 *
 * Envelope shape (both directions):
 *   { id?, kind, topic?, capability?, payload?, ok?, error? }
 * where `kind` ∈ { widget-ready, publish, capability.invoke,
 * capability.ack, init }. See Step 5 of the widget-system plan for
 * the full protocol.
 */

/**
 * @param {{
 *   iframe: HTMLIFrameElement,
 *   onReady: () => void,
 *   onPublish: (env: { topic: string, payload: unknown }) => void,
 *   onCapabilityInvoke: (env: { id: string, capability: string, payload: unknown }) => void | Promise<void>,
 * }} args
 * @returns {{ send: (env: object) => void, dispose: () => void }}
 */
export function createPostMessageTransport({
  iframe,
  onReady,
  onPublish,
  onCapabilityInvoke,
}) {
  const handler = (event) => {
    // Origin is "null" for srcdoc sandbox iframes, so we cannot use
    // origin comparison. Source identity is the right check.
    if (event.source !== iframe.contentWindow) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    const kind = data.kind;
    if (kind === 'widget-ready') {
      try {
        onReady();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[widget-host/postmessage] onReady threw', err);
      }
      return;
    }
    if (kind === 'publish') {
      try {
        onPublish({ topic: String(data.topic ?? ''), payload: data.payload });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[widget-host/postmessage] onPublish threw', err);
      }
      return;
    }
    if (kind === 'capability.invoke') {
      try {
        void onCapabilityInvoke({
          id: String(data.id ?? ''),
          capability: String(data.capability ?? ''),
          payload: data.payload,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[widget-host/postmessage] onCapabilityInvoke threw', err);
      }
      return;
    }
    // Unknown kinds are ignored on the host side — forward compatibility.
  };

  window.addEventListener('message', handler);

  const send = (envelope) => {
    const target = iframe.contentWindow;
    if (!target) return;
    // Sandbox iframes have a "null" origin, so targetOrigin must be "*".
    // Source-identity filtering on the iframe side preserves isolation.
    target.postMessage(envelope, '*');
  };

  const dispose = () => {
    window.removeEventListener('message', handler);
  };

  return { send, dispose };
}
