# Maps

**Status:** Current for consultees results + static-map pipeline; Partial for upload-derived viewports and full GIS styling coverage.

## Architecture (PINS-data-spike pattern)

When people say **“the map”** in this project, they mean the **interactive** Defra Interactive Map (JS).

**Static map** / **non-interactive map** means the server-rendered image used for noscript / progressive-enhancement failure.

| Mode        | Mechanism                                                                  |
| ----------- | -------------------------------------------------------------------------- |
| Interactive | Defra Interactive Map assets + client init on `data-consultee-map` regions |
| Static      | App-served `/…/static-map` (and `.svg`) with caching / ETag                |

Partial: `views/partials/consultee-map-region.njk`  
Client behaviour: fingerprinted `javascripts/consultees-map.js` (built into `.static`)

## Source selection

For `/consultees/:geometryId` sections today:

1. Build project site GeoJSON from sample helpers (`buildProjectSiteGeojson`)
2. Build consultee area GeoJSON from section fixture areas (`buildConsulteeAreaGeojson`)
3. Compute a shared viewport (`mapViewForCollections` / `MAP_VIEWPORT`) so interactive and static views stay aligned
4. Embed map config JSON next to the region; point `data-static-map-src` at the section static-map route

Sample polygons are **not** read from SQL for this journey.

## Viewport consistency

Interactive and static maps for a section should share the same centre/zoom intent derived from the same GeoJSON inputs. If you change sample geometry builders, re-check both:

- on-page interactive framing
- `/consultees/.../static-map` image framing

`geometry-bounds.ts` exists to derive centre/zoom from arbitrary FeatureCollections (intended for upload-style maps without hand-picked centres).

## Static map requirements (do not regress)

From `AGENTS.md` — summarise for Confluence:

- Proxy tiles / static rendering **through our app** — do not hot-link OSM tile URLs in page HTML for the fallback
- Long-lived `Cache-Control` and ETag; honour `If-None-Match` → 304
- Keep upstream concurrency low; identify User-Agent
- Only load static `<img>` when needed (`<noscript>` and/or failure path)

## GIS styling

Overlay colours / hatches for recognised layer types must follow the GIS Tool Styling tables in `AGENTS.md` (geometry stage, sector, energy subtype, MOD areas, label buffers). Prefer shared constants over one-off hex values.

## Map layers demo

`/map-layers-demo` is an explicit prototype for toggling overlays (railways, roads, etc.). Safe place to experiment without coupling to the main consultees journey.

## How sample vs database boundaries are selected

| Context                     | Selection rule today                                                         |
| --------------------------- | ---------------------------------------------------------------------------- |
| Consultees results maps     | Always sample GeoJSON tied to fixture case metadata                          |
| Home list                   | Fixture rows; SQL count may only change total                                |
| Python consultee areas page | SQL via Python (no map UI focus yet)                                         |
| Future uploads map          | Expected to use DB geometries + `geometry-bounds` (not wired as a route yet) |

## Related pages

- [GOV.UK Frontend conventions](./govuk-frontend-conventions.md)
- [API and data contracts](./api-and-data-contracts.md)
- [Troubleshooting](./troubleshooting.md)
