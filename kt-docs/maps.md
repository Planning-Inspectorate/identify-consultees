# Maps

**Status:** Current for the results-map pipeline and component showcase; Partial for upload-derived viewports and full GIS styling coverage.

## Architecture (PINS-data-spike pattern)

When people say **“the map”** in this project, they mean the **interactive** Defra Interactive Map (JS).

**Static map** / **non-interactive map** means the server-rendered image used for noscript / progressive-enhancement failure.

| Mode        | Mechanism                                                                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Interactive | Defra Interactive Map vendor bundles (`/vendor/*`) + client init from inline page config                                                       |
| Static      | App-served `/…/static-map` — AVIF/WebP/PNG negotiated from `Accept`; `/…/static-map.svg` for the explicit SVG route, caching / ETag throughout |

Result-page partial: `views/partials/consultee-map-region.njk`  
Showcase pages: `views/interactive-map-examples/` under `/components/interactive-map`  
Client behaviour: fingerprinted `javascripts/consultees-map.js` (built into `.static`); showcase init via `initAllInteractiveMapExamples` on `.app-interactive-map-example` containers

## Source selection (results page)

For `/consultees/:caseId/results?ruleset=…`:

1. Load the case boundary from `case_boundary` (`resolveCase` / `getCaseBoundaryById`)
2. Run the ruleset — `runRuleset` returns matched `consultee_area` features with distances
3. `buildCaseMapConfig` (`app/maps/case-geojson.ts`) turns project + matches into the map config, capping drawn matches at `MAX_SAMPLED_MAP_MATCHES`
4. Embed map config JSON in the page; point the static fallback at `/consultees/:caseId/results/static-map?ruleset=…`

Everything on that map comes from SQL — there is no fixture layer.

## Viewport consistency

Interactive and static maps for a page should share the same centre/zoom intent derived from the same GeoJSON inputs. If you change `buildCaseMapConfig` or the geometry helpers, re-check both:

- on-page interactive framing
- `/consultees/.../results/static-map` image framing

`geometry-bounds.ts` exists to derive centre/zoom from arbitrary FeatureCollections (intended for upload-style maps without hand-picked centres).

## Static map requirements (do not regress)

From `AGENTS.md` — summarise for Confluence:

- Proxy tiles / static rendering **through our app** — do not hot-link OSM tile URLs in page HTML for the fallback
- Long-lived `Cache-Control` and ETag; honour `If-None-Match` → 304
- `Vary: Accept` on the negotiated raster route — the format is part of the ETag fingerprint
- Keep upstream concurrency low; identify User-Agent
- Only load static `<img>` when needed (`<noscript>` and/or failure path)

Every new input that changes the rendered image (markers, badges, overlays, format) must join `buildStaticMapFingerprint`'s payload — see the `AGENTS.md` Maps section for the details and known sharp/`.composite()` gotcha.

## GIS styling

Overlay colours / hatches for recognised layer types must follow the GIS Tool Styling tables in `AGENTS.md` (geometry stage, sector, energy subtype, MOD areas, label buffers). Prefer shared constants over one-off hex values.

## Component showcase

`/components/interactive-map` renders one page per worked Defra example (`interactive-map-examples-data.ts`): style switcher, draw tools, feature selection with a side panel, fullscreen `buttonFirst`/`hybrid` variants, and static-map parity. Each example loads only the plugin bundles it needs and reuses the shared static-map pipeline for its `<noscript>` / init-failure fallback. It's the safest place to learn the Defra component's quirks — `AGENTS.md` lists the integration gotchas (`data-*` JSON-parsing, late plugin API attachment, `hasExitButton`, `mapStyle.id`, noscript DOM visibility).

## Map layers demo

`/map-layers-demo` is an explicit prototype for toggling overlays (railways, roads, etc.). Safe place to experiment without coupling to the main consultees journey.

## Where map data comes from

| Context                     | Source                                                                       |
| --------------------------- | ---------------------------------------------------------------------------- |
| Consultees results maps     | `case_boundary` geometry + `runRuleset` matches, via `buildCaseMapConfig`    |
| Home list                   | `case_boundary` rows (no map)                                                |
| Interactive-map showcase    | Sample GeoJSON in `interactive-map-examples-data.ts` / `sample-geojson.ts`   |
| Map layers demo             | Demo GeoJSON in `map-layers-demo-geojson.ts`                                 |
| Python consultee areas page | SQL via Python (no map UI focus yet)                                         |
| Future uploads map          | Expected to use DB geometries + `geometry-bounds` (not wired as a route yet) |

## Related pages

- [GOV.UK Frontend conventions](./govuk-frontend-conventions.md)
- [API and data contracts](./api-and-data-contracts.md)
- [Troubleshooting](./troubleshooting.md)
