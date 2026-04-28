/**
 * Host-side postMessage transport for iframe-isolated widgets.
 *
 * The iframe is sandboxed with `allow-scripts` only, so its origin is
 * `"null"` and we cannot use an origin check. Instead we filter by
 * `event.source === iframe.contentWindow`, which is the documented
 * cross-browser signal for matching messages to a specific frame.
 *
 * Envelope shape (both directions): see `WidgetToHostMessage` /
 * `HostToWidgetMessage` in `../types.ts`.
 */

import type {
  HostToWidgetMessage,
  WidgetToHostMessage,
} from '../types.ts';

export interface PostMessageTransportArgs {
  iframe: HTMLIFrameElement;
  onReady: () => void;
  onPublish: (env: { topic: string; payload: unknown }) => void;
  onCapabilityInvoke: (env: {
    id: string;
    capability: string;
    payload: unknown;
  }) => void | Promise<void>;
}

export interface PostMessageTransport {
  send: (envelope: HostToWidgetMessage) => void;
  dispose: () => void;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isWidgetMessage(data: unknown): data is WidgetToHostMessage {
  if (!isObject(data)) return false;
  const kind = data['kind'];
  return (
    kind === 'widget-ready' ||
    kind === 'publish' ||
    kind === 'capability.invoke'
  );
}

export function createPostMessageTransport({
  iframe,
  onReady,
  onPublish,
  onCapabilityInvoke,
}: PostMessageTransportArgs): PostMessageTransport {
  const handler = (event: MessageEvent): void => {
    // Origin is "null" for srcdoc sandbox iframes, so we cannot use
    // origin comparison. Source identity is the right check.
    if (event.source !== iframe.contentWindow) return;
    const data: unknown = event.data;
    if (!isWidgetMessage(data)) return;

    if (data.kind === 'widget-ready') {
      try {
        onReady();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[widget-host/postmessage] onReady threw', err);
      }
      return;
    }
    if (data.kind === 'publish') {
      try {
        onPublish({
          topic: String(data.topic ?? ''),
          payload: data.payload,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[widget-host/postmessage] onPublish threw', err);
      }
      return;
    }
    if (data.kind === 'capability.invoke') {
      try {
        void onCapabilityInvoke({
          id: String(data.id ?? ''),
          capability: String(data.capability ?? ''),
          payload: data.payload,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(
          '[widget-host/postmessage] onCapabilityInvoke threw',
          err,
        );
      }
      return;
    }
    // Unknown kinds are ignored on the host side — forward compatibility.
  };

  window.addEventListener('message', handler);

  const send = (envelope: HostToWidgetMessage): void => {
    const target = iframe.contentWindow;
    if (!target) return;
    // Sandbox iframes have a "null" origin, so targetOrigin must be "*".
    // Source-identity filtering on the iframe side preserves isolation.
    target.postMessage(envelope, '*');
  };

  const dispose = (): void => {
    window.removeEventListener('message', handler);
  };

  return { send, dispose };
}
