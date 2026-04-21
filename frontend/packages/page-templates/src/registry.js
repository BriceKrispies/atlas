/**
 * TemplateRegistry — maps templateId to { manifest, element class }.
 *
 * Validation against page_template.schema.json happens at registration
 * time (INV-TEMPLATE-01). A module-default singleton is exposed for
 * convenience; a <content-page> instance MAY inject a custom registry
 * via the `.templateRegistry` property.
 */

import { validateTemplateManifest } from './manifest.js';
import { PageTemplateError } from './errors.js';

export class TemplateRegistry {
  constructor() {
    /** @type {Map<string, { manifest: object, element: Function }>} */
    this._entries = new Map();
  }

  /**
   * @param {{ manifest: object, element: Function }} entry
   */
  register({ manifest, element }) {
    if (!manifest || typeof manifest !== 'object') {
      throw new PageTemplateError('manifest must be an object');
    }
    if (typeof element !== 'function') {
      throw new PageTemplateError(
        `template element for ${manifest.templateId ?? '<unknown>'} must be a class`,
      );
    }
    const { ok, errors } = validateTemplateManifest(manifest);
    if (!ok) {
      throw new PageTemplateError(
        `invalid manifest for templateId=${manifest.templateId ?? '<unknown>'}`,
        { errors },
      );
    }
    this._entries.set(manifest.templateId, { manifest, element });
  }

  has(templateId) {
    return this._entries.has(templateId);
  }

  get(templateId) {
    const entry = this._entries.get(templateId);
    if (!entry) {
      throw new PageTemplateError(`unknown templateId: ${templateId}`);
    }
    return entry;
  }

  list() {
    return [...this._entries.values()].map(({ manifest }) => ({
      templateId: manifest.templateId,
      version: manifest.version,
      displayName: manifest.displayName,
    }));
  }
}

export const moduleDefaultTemplateRegistry = new TemplateRegistry();
