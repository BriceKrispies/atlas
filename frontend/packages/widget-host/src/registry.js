/**
 * WidgetRegistry — maps widgetId to { manifest, element class }.
 *
 * Validation against widget_manifest.schema.json happens at registration
 * time (INV-WIDGET-01). A module-default singleton is exposed for
 * convenience; a <widget-host> instance MAY inject a custom registry
 * via the `.registry` property.
 */

import { validateManifest } from './manifest.js';
import { WidgetManifestError } from './errors.js';

export class WidgetRegistry {
  constructor() {
    /** @type {Map<string, { manifest: object, element: Function, schema: object | null }>} */
    this._entries = new Map();
  }

  /**
   * @param {{ manifest: object, element: Function, schema?: object | null }} entry
   */
  register({ manifest, element, schema = null }) {
    if (!manifest || typeof manifest !== 'object') {
      throw new WidgetManifestError('manifest must be an object');
    }
    if (typeof element !== 'function') {
      throw new WidgetManifestError(
        `widget element for ${manifest.widgetId ?? '<unknown>'} must be a class`,
      );
    }
    const { ok, errors } = validateManifest(manifest);
    if (!ok) {
      throw new WidgetManifestError(
        `invalid manifest for widgetId=${manifest.widgetId ?? '<unknown>'}`,
        { errors },
      );
    }
    this._entries.set(manifest.widgetId, { manifest, element, schema });
  }

  has(widgetId) {
    return this._entries.has(widgetId);
  }

  get(widgetId) {
    const entry = this._entries.get(widgetId);
    if (!entry) {
      throw new WidgetManifestError(`unknown widgetId: ${widgetId}`);
    }
    return entry;
  }

  list() {
    return [...this._entries.values()].map(({ manifest }) => ({
      widgetId: manifest.widgetId,
      version: manifest.version,
      displayName: manifest.displayName,
    }));
  }
}

export const moduleDefaultRegistry = new WidgetRegistry();
