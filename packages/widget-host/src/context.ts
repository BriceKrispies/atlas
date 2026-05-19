/**
 * buildContext — assembles the `context` object injected into a widget
 * before mount. Channel and request functions close over the widget's
 * `instanceId` so the widget cannot spoof another widget's identity.
 *
 * Returns a frozen object to discourage mutation.
 */
import type { WidgetMediator } from './mediator.ts';
import type { CapabilityBridge } from './capabilities.ts';
import type { WidgetManifest, WidgetContext, WidgetLogger, } from './types.ts';
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
export function buildContext({ principal, tenantId, correlationId, locale, theme, mediator, bridge, log, widgetInstanceId, widgetManifest, }: BuildContextArgs): WidgetContext {
    const instanceId = widgetInstanceId;
    const channel = Object.freeze({
        publish: function (topic: string, payload: unknown): void {
            return mediator.publish(instanceId, topic, payload);
        },
        subscribe: function (topic: string, handler: (payload: unknown) => unknown): (() => void) {
            return mediator.subscribe(instanceId, topic, handler);
        },
        request: function (topic: string, payload: unknown, opts?: {
            timeoutMs?: number;
        }): Promise<unknown> {
            return mediator.request(instanceId, topic, payload, opts);
        },
    });
    const request = function (capabilityName: string, args: unknown): Promise<unknown> {
        return bridge.invoke(instanceId, capabilityName, args);
    };
    const prefix = `[widget ${widgetManifest.widgetId}#${instanceId} cid=${correlationId}]`;
    const emit = function (level: LogLevel) {
        return function (...args: unknown[]): void {
            const fn = log?.[level];
            if (typeof fn === 'function') {
                try {
                    fn(prefix, ...args);
                    return;
                }
                catch {
                    /* fall through to console */
                }
            }
            // eslint-disable-next-line no-console -- contract-exempt: widget-host's bridge to the host page surfaces widget logs through the host's console when no telemetry sink is wired; this IS the documented dev-time fallback in specs/frontend/observability.md
            console[level](prefix, ...args);
        };
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
