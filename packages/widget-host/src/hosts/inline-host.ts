/**
 * Inline host strategy — mounts the widget directly into the host's
 * light DOM. Fastest path; no style or DOM boundary.
 *
 * Error boundary behavior: if construction or attachment throws, the
 * caller's `onError(err)` is invoked and a no-op unmount is returned.
 * Sibling widgets are unaffected (INV-WIDGET-07).
 */
import { emitTelemetry } from '@atlas/core';
import type { HostMountArgs, WidgetElementInstance, } from '../types.ts';
export async function mount({ manifest, config, context, instanceId, hostContainer, ElementClass, onError, }: HostMountArgs): Promise<() => void> {
    let element: WidgetElementInstance | null = null;
    try {
        if (!ElementClass) {
            throw new Error(`inline isolation requires an ElementClass for '${manifest.widgetId}'`);
        }
        element = new ElementClass();
        element.config = config;
        element.context = context;
        element.instanceId = instanceId;
        element.setAttribute('data-widget-id', manifest.widgetId);
        element.setAttribute('data-widget-instance-id', instanceId);
        hostContainer.appendChild(element);
    }
    catch (err) {
        try {
            onError(err);
        }
        catch {
            /* never throw from the error handler back to the host */
        }
        return function (): void { };
    }
    return function (): void {
        try {
            element?.onUnmount?.();
        }
        catch (err) {
            emitTelemetry({
                eventName: 'atlas.widget.inline.onUnmount.threw',
                level: 'error',
                source: 'widget-host.inline-host',
                widgetId: manifest.widgetId,
                instanceId,
                'error.message': err instanceof Error ? err.message : String(err),
            });
        }
        try {
            element?.remove();
        }
        catch {
            /* detached already */
        }
        element = null;
    };
}
export default { mount };
