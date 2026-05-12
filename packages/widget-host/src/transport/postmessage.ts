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

import { emitTelemetry } from '@atlas/core';

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
  /**
   * Optional log forwarder. The iframe-host wires this so log records
   * from inside the sandboxed widget surface on the parent's
   * telemetry pipeline with `tenantId` + `widgetId` stamped (foundational
   * for ADR 0003 tenant-code observability). When unset, log envelopes
   * are silently dropped.
   */
  onLog?: (env: {
    level: 'info' | 'warn' | 'error';
    args: ReadonlyArray<string>;
  }) => void;
}

export interface PostMessageTransport {
  send: (envelope: HostToWidgetMessage) => void;
  dispose: () => void;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Read `.message` from an arbitrary thrown value without a cast. */
function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function isWidgetMessage(data: unknown): data is WidgetToHostMessage {
  if (!isObject(data)) return false;
  const kind = data['kind'];
  return (
    kind === 'widget-ready' ||
    kind === 'publish' ||
    kind === 'capability.invoke' ||
    kind === 'log'
  );
}

export function createPostMessageTransport({
  iframe,
  onReady,
  onPublish,
  onCapabilityInvoke,
  onLog,
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
        emitTelemetry({
          eventName: 'atlas.widget.postmessage.onReady.threw',
          level: 'error',
          source: 'widget-host.postmessage',
          'error.message': errMessage(err),
        });
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
        emitTelemetry({
          eventName: 'atlas.widget.postmessage.onPublish.threw',
          level: 'error',
          source: 'widget-host.postmessage',
          'error.message': errMessage(err),
        });
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
        emitTelemetry({
          eventName: 'atlas.widget.postmessage.onCapabilityInvoke.threw',
          level: 'error',
          source: 'widget-host.postmessage',
          'error.message': errMessage(err),
        });
      }
      return;
    }
    if (data.kind === 'log') {
      if (!onLog) return;
      const level =
        data.level === 'info' || data.level === 'warn' || data.level === 'error'
          ? data.level
          : 'info';
      const args = Array.isArray(data.args)
        ? data.args.map((a) => String(a))
        : [];
      try {
        onLog({ level, args });
      } catch (err) {
        emitTelemetry({
          eventName: 'atlas.widget.postmessage.onLog.threw',
          level: 'error',
          source: 'widget-host.postmessage',
          'error.message': errMessage(err),
        });
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
