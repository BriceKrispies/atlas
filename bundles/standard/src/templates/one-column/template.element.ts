/**
 * OneColumnTemplate — CSS-only layout chrome for the single-region
 * one-column template.
 *
 * Templates do not render their own children. `<content-page>` appends a
 * `<widget-host>` as a direct child after construction; the widget-host's
 * per-region `<section data-slot="...">` children participate in the
 * template's layout via the rules in `../templates.css`.
 *
 * AtlasElement's `connectedCallback` only sets up a reactive render when
 * the subclass overrides `render()`. This class deliberately does NOT
 * override `render()`, so no render pass runs and the appended
 * widget-host survives untouched.
 */

import { AtlasElement } from '@atlas/core';

export class OneColumnTemplate extends AtlasElement {}

AtlasElement.define('template-one-column', OneColumnTemplate);
