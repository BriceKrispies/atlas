/**
 * Page-editor left-panel content elements (outline + palette).
 *
 * Importing this module registers `<page-editor-outline>` and
 * `<page-editor-palette>` as custom elements (side effect via
 * `AtlasElement.define` calls in the underlying modules). The shell will
 * instantiate these tags into the matching tab slots and assign their
 * `controller` property.
 */

export { PageEditorOutlineElement } from './outline.ts';
export { PageEditorPaletteElement } from './palette.ts';

import './outline.ts';
import './palette.ts';
