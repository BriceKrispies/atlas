# Maps

**Platform:** Content
**Status:** Stub — domain shape committed, content TBD.

## Purpose

Hosting, authoring, and rendering of geospatial content. Includes self-hosted
tile infrastructure (vector + raster), custom tenant-branded basemaps, dataset
storage with feature CRUD, an interactive admin map editor, and the cross-domain
plumbing (geocoding, routing, spatial queries, geo field types) that lets other
domains attach geometry to their entities.

Atlas treats maps as authored content: basemaps and datasets are first-class
artifacts with versions, audit, and per-tenant access. Tile delivery is a
separate process (`apps/tiles/`) that runs the hot path at CDN scale.

## Capabilities

TBD. List capabilities here as they're scoped. Capabilities are the agent
ownership unit — one capability ≈ one agent. First-cut candidates:

- **tile-hosting** — MBTiles build pipeline (Planetiler/Tilemaker), tileset
  registry, versioned immutable tiles, CDN-friendly serving.
- **basemap-authoring** — style.json registry, sprite + glyph hosting,
  tenant-branded basemap composition.
- **dataset-store** — feature collections (points, lines, polygons), GeoJSON /
  Shapefile / KML import via Media → Maps pipeline, attribute schemas per
  dataset.
- **map-editor** — admin surface for drawing, snapping, attribute editing,
  layer/style configuration.
- **map-widget** — frontend rendering element (`<atlas-map>` and friends),
  registered through the Widgets domain.
- **geocoding** — forward/reverse address ↔ point, swappable adapter
  (self-hosted Nominatim, paid providers).
- **routing** — turn-by-turn + isochrones, swappable adapter (OSRM/Valhalla).
- **spatial-search** — `nearby(point, radius)` / `within(polygon)` extensions
  contributed to the Search port; PostGIS implementation on `adapters/node`.
- **geo-field-types** — `geo-point` / `geo-polygon` / `geo-line` field schemas
  consumable by Forms, Catalog, Organization, etc.

## Cross-domain Hooks

| Other domain | How maps plugs in |
|--------------|-------------------|
| `widgets` | `<atlas-map>` is registered as a widget; widgets domain owns the registration mechanism |
| `media` | Uploaded GeoJSON/Shapefile/KML lands in media first, then maps' import pipeline parses into a dataset; raw tiles are *not* stored under media |
| `catalog` | Catalog rows can carry a `geometry` attribute referencing a feature; spatial filters route through this domain |
| `forms` | New `geo-*` field types embed the map widget; forms own form composition, this domain owns the field schemas |
| `authoring` | Pages embed map widgets via the standard widget pipeline; the Map Editor is itself an authoring surface with custom tooling |
| `search` (Spine) | Contributes `nearby` / `within` filters to the SearchEngine port; PostGIS adapter implements |
| `organization` (Spine) | User / business-unit addresses are geocoded → cached point on the entity |
| `audit` (Spine) | Basemap, tileset, and dataset edits flow through the standard audit pipe |
| `localization` | Multilingual labels on vector basemaps consume the locale resolved by localization |
| `delivery` | Tile serving benefits from the same CDN/cache/edge story other Content domains use |

## Tenancy & Storage

- **PostGIS extension** is enabled in tenant DBs that have the maps module
  enabled; the migration is module-gated.
- **Datasets** are stored as `geometry` columns with GIST indexes per tenant.
- **Tiles** are immutable, addressed by `(tilesetId, z, x, y)`, served by
  `apps/tiles/` with long-TTL CDN caching and version-token invalidation.
- **Basemaps** and **tilesets** are tenant-scoped artifacts under standard
  authz, audit, and lifecycle.

## Sequencing (Domain-Internal)

The domain is large enough that it ships in layers, not a single cut:

1. **Static read path** — `<atlas-map>` widget + style resolver + tile-server
   serving one prebuilt OSM basemap. No editor. No datasets.
2. **Datasets + display** — GeoJSON upload, dataset CRUD, layer compositions,
   render datasets on top of basemaps.
3. **Map editor** — drawing, snapping, attribute editing.
4. **Custom basemaps** — style editor, tile-build pipeline, multiple
   tenant-branded basemaps.
5. **Geocoding + routing ports** — wire when the first consumer asks.
6. **Spatial search extension** — land when Organization or Catalog explicitly
   asks for "find near me."

## Cross-references

- App: `apps/tiles/` — dedicated tile + style + sprite + glyph server
- Module: `modules/maps/` — handlers, projections, queries, domain types
- Package: `packages/maps-widget/` — `<atlas-map>` and editor elements
- Ports: `ports/src/tile-store.ts`, `ports/src/geocoding.ts`,
  `ports/src/routing.ts`; spatial extensions on `ports/src/search-engine.ts`
- Adapters: `adapters/node/src/{tile-store-postgres,geocoding-nominatim,routing-osrm}.ts`
- Upstream tooling: OpenStreetMap (data), Planetiler / Tilemaker (tile build),
  tileserver-gl / Martin (serving), MapLibre GL JS (frontend),
  Nominatim (geocoding), OSRM (routing)
