/**
 * CapabilityBridge — per-host registry of host-provided capabilities
 * invokable by widgets. Enforces INV-WIDGET-03: a widget may only invoke
 * capabilities declared in its manifest.
 */

import { CapabilityDeniedError } from './errors.ts';
import type {
  WidgetManifest,
  CapabilityHandler,
  CapabilityTraceEvent,
} from './types.ts';

interface InstanceRegistration {
  manifest: WidgetManifest;
  capabilities: Set<string>;
  correlationId?: string;
}

export interface CapabilityBridgeOptions {
  onTrace?: (event: CapabilityTraceEvent) => void;
}

export class CapabilityBridge {
  private _handlers: Map<string, CapabilityHandler> = new Map();
  private _instances: Map<string, InstanceRegistration> = new Map();
  private _onTrace: ((event: CapabilityTraceEvent) => void) | null;

  constructor(options: CapabilityBridgeOptions = {}) {
    this._onTrace =
      typeof options.onTrace === 'function' ? options.onTrace : null;
  }

  private _trace(event: CapabilityTraceEvent): void {
    if (!this._onTrace) return;
    try {
      this._onTrace(event);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[widget-host] bridge onTrace threw', err);
    }
  }

  register(name: string, handler: CapabilityHandler): void {
    if (typeof handler !== 'function') {
      throw new TypeError(
        `capability handler for '${name}' must be a function`,
      );
    }
    this._handlers.set(name, handler);
  }

  registerInstance(instanceId: string, manifest: WidgetManifest): void {
    this._instances.set(instanceId, {
      manifest,
      capabilities: new Set(manifest?.capabilities ?? []),
    });
  }

  revokeInstance(instanceId: string): void {
    this._instances.delete(instanceId);
  }

  async invoke(
    instanceId: string,
    capabilityName: string,
    args: unknown,
  ): Promise<unknown> {
    const registration = this._instances.get(instanceId);
    if (!registration) {
      this._trace({
        kind: 'denied',
        instanceId,
        capability: capabilityName,
        reason: 'unknown-instance',
      });
      throw new CapabilityDeniedError(
        `unknown instance ${instanceId} attempted to invoke capability '${capabilityName}'`,
      );
    }
    if (!registration.capabilities.has(capabilityName)) {
      this._trace({
        kind: 'denied',
        instanceId,
        capability: capabilityName,
        reason: 'undeclared',
      });
      throw new CapabilityDeniedError(
        `instance ${instanceId} may not invoke undeclared capability '${capabilityName}'`,
      );
    }
    const handler = this._handlers.get(capabilityName);
    if (!handler) {
      this._trace({
        kind: 'denied',
        instanceId,
        capability: capabilityName,
        reason: 'no-handler',
      });
      throw new CapabilityDeniedError(
        `no handler registered for capability '${capabilityName}'`,
      );
    }
    this._trace({
      kind: 'invoke',
      instanceId,
      capability: capabilityName,
      args,
    });
    try {
      const value = await handler(args, {
        instanceId,
        manifest: registration.manifest,
        correlationId: registration.correlationId,
      });
      this._trace({
        kind: 'resolve',
        instanceId,
        capability: capabilityName,
        value,
      });
      return value;
    } catch (err) {
      this._trace({
        kind: 'reject',
        instanceId,
        capability: capabilityName,
        error: err,
      });
      throw err;
    }
  }
}
