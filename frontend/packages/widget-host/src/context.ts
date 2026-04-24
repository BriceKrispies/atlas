/**
 * buildContext — assembles the `context` object injected into a widget
 * before mount. Channel and request functions close over the widget's
 * `instanceId` so the widget cannot spoof another widget's identity.
 *
 * Returns a frozen object to discourage mutation.
 */

import type { WidgetMediator } from './mediator.ts';
import type { CapabilityBridge } from './capabilities.ts';
import type {
  WidgetManifest,
  WidgetContext,
  WidgetLogger,
} from './types.ts';

export interface BuildContextArgs {
  principal: unknown;
  tenantId: string;
  correlationId: string;
  locale: string;
  theme: string;
  mediator: WidgetMediator;
  bridge: CapabilityBridge;
  log?: Partial<WidgetLogger>;
  widgetInstanceId: string;
  widgetManifest: WidgetManifest;
}

type LogLevel = 'info' | 'warn' | 'error';

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
}: BuildContextArgs): WidgetContext {
  const instanceId = widgetInstanceId;

  const channel = Object.freeze({
    publish: (topic: string, payload: unknown): void =>
      mediator.publish(instanceId, topic, payload),
    subscribe: (
      topic: string,
      handler: (payload: unknown) => unknown,
    ): (() => void) => mediator.subscribe(instanceId, topic, handler),
    request: (
      topic: string,
      payload: unknown,
      opts?: { timeoutMs?: number },
    ): Promise<unknown> =>
      mediator.request(instanceId, topic, payload, opts),
  });

  const request = (
    capabilityName: string,
    args: unknown,
  ): Promise<unknown> => bridge.invoke(instanceId, capabilityName, args);

  const prefix = `[widget ${widgetManifest.widgetId}#${instanceId} cid=${correlationId}]`;
  const emit =
    (level: LogLevel) =>
    (...args: unknown[]): void => {
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

  const boundLog: WidgetLogger = Object.freeze({
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
