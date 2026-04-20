/**
 * CapabilityBridge — per-host registry of host-provided capabilities
 * invokable by widgets. Enforces INV-WIDGET-03: a widget may only invoke
 * capabilities declared in its manifest.
 */

import { CapabilityDeniedError } from './errors.js';

export class CapabilityBridge {
  /**
   * @param {{ onTrace?: (event: object) => void }} [options]
   */
  constructor(options = {}) {
    /** @type {Map<string, Function>} */
    this._handlers = new Map();
    /** @type {Map<string, { manifest: object, capabilities: Set<string> }>} */
    this._instances = new Map();
    /** @type {((event: object) => void) | null} */
    this._onTrace = typeof options.onTrace === 'function' ? options.onTrace : null;
  }

  /** @private */
  _trace(event) {
    if (!this._onTrace) return;
    try {
      this._onTrace(event);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[widget-host] bridge onTrace threw', err);
    }
  }

  /**
   * @param {string} name
   * @param {(args: unknown, ctx: { instanceId: string, manifest: object, correlationId: string | undefined }) => Promise<unknown>} handler
   */
  register(name, handler) {
    if (typeof handler !== 'function') {
      throw new TypeError(`capability handler for '${name}' must be a function`);
    }
    this._handlers.set(name, handler);
  }

  /**
   * @param {string} instanceId
   * @param {object} manifest
   */
  registerInstance(instanceId, manifest) {
    this._instances.set(instanceId, {
      manifest,
      capabilities: new Set(manifest?.capabilities ?? []),
    });
  }

  /** @param {string} instanceId */
  revokeInstance(instanceId) {
    this._instances.delete(instanceId);
  }

  /**
   * @param {string} instanceId
   * @param {string} capabilityName
   * @param {unknown} args
   * @returns {Promise<unknown>}
   */
  async invoke(instanceId, capabilityName, args) {
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
