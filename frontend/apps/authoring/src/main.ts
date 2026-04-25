import '@atlas/design';
// First-party composed widgets (data table, charts).
import '@atlas/widgets';
// Widget runtime: importing registers <widget-host>.
import '@atlas/widget-host';
// Page-template runtime: importing registers <content-page> and <widget-palette>.
import '@atlas/page-templates';
// Bundle: registers the three standard widgets and templates.
import {
  registerAllWidgets,
  registerAllTemplates,
} from '@atlas/bundle-standard/register';
registerAllWidgets();
registerAllTemplates();
// Templates barrel — side-effect import of templates.css.
import '@atlas/bundle-standard/templates';

// Authoring shell — registers <atlas-authoring> and all route elements.
import './authoring-app.ts';
