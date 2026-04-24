import '@atlas/design';
// First-party composed widgets (data table, charts). Registers
// <atlas-data-table>, <atlas-chart>, <atlas-sparkline>, etc.
import '@atlas/widgets';
// Widget runtime: importing registers <widget-host> via customElements.define.
import '@atlas/widget-host';
// Page-template runtime: importing registers <content-page> and <widget-palette>.
import '@atlas/page-templates';
// Bundle: importing registers the three standard widgets into moduleDefaultRegistry,
// and both templates into moduleDefaultTemplateRegistry.
import {
  registerAllWidgets,
  registerAllTemplates,
} from '@atlas/bundle-standard/register';
registerAllWidgets();
registerAllTemplates();
// Templates barrel — side-effect import of templates.css so two-column grid
// styles etc. are loaded in the browser realm.
import '@atlas/bundle-standard/templates';
// Widget development harness — registers <widget-harness>.
import './harness/widget-harness.ts';
// Page editor shell — registers <sandbox-page-editor>. Specimens that mount
// it are declared in specimens.js.
import './page-editor/index.ts';

// sandbox-app.ts is imported by each specimen file (they need the class
// export). Specimens register before the element is defined, so data is
// ready on connectedCallback. The barrel imports every category file for
// its side-effect registration.
import './specimens/index.ts';
