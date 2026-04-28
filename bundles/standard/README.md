# @atlas/bundle-standard

The first-party Atlas UI Bundle. Provides the baseline set of widgets that every Atlas tenant can place on content pages: announcements, messaging, and the spreadsheet uploader. The bundle follows the `ui_bundle.schema.json` contract (see `src/bundle.manifest.json`) and registers its widgets into a `WidgetRegistry` supplied by `@atlas/widget-host`.

## Adding a widget

1. Create `src/widgets/<shortname>/` with `index.js`, `widget.element.js`, and `config.schema.json`.
2. `index.js` must `export { manifest, element }`. The manifest must satisfy `schemas/contracts/widget_manifest.schema.json`; the element must extend `AtlasSurface` and call `AtlasSurface.define('widget-<shortname>', ClassName)` at module load.
3. Add the widget's id to `provides.widgets` in `src/bundle.manifest.json`.
4. Wire it into `src/register.js` and `src/index.js`.
5. Run `pnpm --filter @atlas/bundle-standard test:register` — it registers every widget into a fresh `WidgetRegistry` and asserts every manifest validates.
