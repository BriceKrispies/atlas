/**
 * Seed page documents shipped with @atlas/bundle-standard.
 *
 * These are realistic sample pages that demonstrate the two templates
 * provided by the bundle. They are consumed by the sandbox app's
 * content-page demo and by the bundle's register test, which asserts
 * that every seed doc validates against `page_document.schema.json`.
 */

import welcome from './welcome.json' with { type: 'json' };
import about from './about.json' with { type: 'json' };
import dashboard from './dashboard.json' with { type: 'json' };

export const seedPages = [welcome, about, dashboard];
