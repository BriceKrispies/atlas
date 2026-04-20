import '@atlas/design';
// Widget runtime: importing registers <widget-host> via customElements.define.
import '@atlas/widget-host';
// Bundle: importing registers the three standard widgets into moduleDefaultRegistry.
import { registerAllWidgets } from '@atlas/bundle-standard/register';
registerAllWidgets();
// Widget development harness — registers <widget-harness>.
import './harness/widget-harness.js';

// sandbox-app.js is imported by specimens.js (it needs the class export)
// specimens register before the element is defined, so data is ready on connectedCallback
import './specimens.js';
