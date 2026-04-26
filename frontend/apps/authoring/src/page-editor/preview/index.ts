/**
 * Barrel for the dedicated page-editor preview surface (S5).
 *
 * Importing this module registers the `<page-editor-preview>` custom
 * element. It is NOT wired into the shell yet; the shell currently
 * renders preview by setting `<content-page edit=false>` on the canvas
 * content-page. Stage-5 integration replaces that inline path with a
 * mount of `<page-editor-preview>` when the controller's mode is
 * `'preview'`.
 */
import './preview.ts';

export { PageEditorPreviewElement } from './preview.ts';
export { DEVICES, deviceFrame } from './devices.ts';
export type { DeviceFrame } from './devices.ts';
