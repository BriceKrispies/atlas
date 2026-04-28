/**
 * TwoColumnTemplate — CSS-only layout chrome for a primary main region
 * plus an optional sidebar.
 *
 * Templates do not render their own children. `<content-page>` appends a
 * `<widget-host>` as a direct child after construction; the widget-host's
 * per-region `<section data-slot="...">` children participate in the
 * template's grid via the rules in `../templates.css`.
 *
 * AtlasElement's `connectedCallback` only sets up a reactive render when
 * the subclass overrides `render()`. This class deliberately does NOT
 * override `render()`, so no render pass runs and the appended
 * widget-host survives untouched.
 */

import { AtlasElement } from '@atlas/core';

export class TwoColumnTemplate extends AtlasElement {}

AtlasElement.define('template-two-column', TwoColumnTemplate);
