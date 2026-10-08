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
2. Run the ruleset — `runRuleset` returns the ruleset's matches, plus every consultee area within the nearby radius (`allNearby`, 20km by default)
3. Build the **search area** — the site grown by the nearby radius (`bufferGeometryForDisplay`) — and fetch **display geometry** for every nearby area and match, clipped to it (`getConsulteeAreaDisplayGeometries`, simplified to 25m). Regional areas such as counties and ambulance trusts would otherwise fill the map and the page: clipping cut one page's map data from 1.5MB to 360KB
4. `buildCaseMapConfig` (`app/maps/case-geojson.ts`) turns the project, matches, nearby areas and search area into the map config. It gives every consultee its category's colour (`colour`) and fill opacity (`fillOpacity`), so the interactive and static maps colour them the same way. It draws every match; only the fallback without a search area, which uses original geometry, caps drawn matches at `MAX_SAMPLED_MAP_MATCHES`
5. Embed map config JSON in the page; point the static fallback at `/consultees/:caseId/results/static-map?ruleset=…`

If step 3 fails, the page still renders: the map falls back to the project and matches, and the tables list every consultee.

Everything on that map comes from SQL — there is no fixture layer.

## Results map layers

Drawn bottom to top (`buildDatasets` in `javascripts/consultees-map.js`):

| Layer                      | What it shows                                                                                                          | Style                                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Search area (20km)         | The site grown by the nearby radius; the map opens on it                                                               | Dashed outline                                                                                                         |
| All consultees within 20km | Every nearby consultee area, one sublayer per category with a count. **Hidden until switched on** from the Layers menu | Outlines in the category's colour; point categories as small dots                                                      |
| The ruleset's name         | The consultees the ruleset identified, one sublayer per category with a count                                          | Areas filled in the category's colour; point categories (hospitals, harbours, generators, nuclear sites) as small dots |
| Project site               | The case boundary                                                                                                      | Red, translucent fill                                                                                                  |

**Regional categories are only tinted.** Police forces, ambulance trusts, ICBs and counties each cover the whole search area. A dozen of them stacked at a normal fill hide everything else. So a category with any area covering half or more of the search area's bounding box is filled at `REGIONAL_FILL_OPACITY` (6%) and drawn first. Local areas such as parishes and districts are filled at `LOCAL_FILL_OPACITY` (35%).

The static fallback opens on the same search area and uses the same colours and opacities. It draws only the project and the ruleset's matches.

> **Category colours are interim.** They're a placeholder palette of 14 (`CONSULTEE_CATEGORY_COLOURS` in `app/maps/category-colours.ts`). On each map, the ruleset's match categories are coloured first in alphabetical order, then any other nearby categories, so a category's colour can differ between projects. Consultee categories aren't in the GIS Tool Styling tables, so per [`AGENTS.md`](../AGENTS.md) they need product/design sign-off.

### Selecting a consultee

Clicking an area or point selects it, and a "Selected on the map" panel shows its name, category and region (or, for the project site, its name and reference). Clicking away or closing the panel clears the selection. There's no hover: the Defra map only offers selection, through the interact plugin (`buildSelectableLayers` and `wireFeatureDetails` in `javascripts/consultees-map.js`).

Two things have to line up for a click to match a feature:

- **Each dataset needs an `idProperty`.** MapLibre drops string feature ids, so features carry their id as a property (`consulteeId`, or `reference` for the project) and the dataset promotes it. Without it, nothing can be selected, and the console warns about "string native IDs".
- **Interact `layerId`s are MapLibre layer ids, not dataset config ids.** The datasets plugin names a sublayer's layer `<dataset id>-<sublayer id>` (for example `consultee-areas-identified-0`), with a `-stroke` layer when it has both a fill and an outline.

### Defra map styling gotchas

- **There is no fill-opacity option.** A `fillOpacity` style property is silently ignored and the fill is drawn solid. Put the transparency in the colour instead (`translucent('#55A868', 0.05)` → `rgba(...)`). The map-layers demo and interactive map examples still use `fillOpacity` and draw solid fills.
- **Custom point symbols must include the plugin's colour tokens.** A `symbolSvgContent` without `{{haloColor}}`, `{{selectedColor}}` and `{{activeColor}}` isn't drawn at all.
- **A sublayer is only drawn as points if its style sets `symbol`.** Setting just `symbolSvgContent` isn't enough when the parent dataset has a `fill` or `stroke`.

## Viewport consistency

Interactive and static maps for a page should share the same centre/zoom intent derived from the same GeoJSON inputs. If you change `buildCaseMapConfig` or the geometry helpers, re-check both:

- on-page interactive framing
- `/consultees/.../results/static-map` image framing

`geometry-bounds.ts` exists to derive centre/zoom from arbitrary FeatureCollections (intended for upload-style maps without hand-picked centres).

On the results page, both maps frame the search area when there is one, otherwise the project and matches. **Known issue:** the static image currently comes out at a much wider zoom than the interactive map for the same centre and zoom (Hinkley Point C's spans South Wales to the south coast). Not yet investigated.

## Static map requirements (do not regress)

From `AGENTS.md` — summarise for Confluence:

- Proxy tiles / static rendering **through our app** — do not hot-link OSM tile URLs in page HTML for the fallback
- Long-lived `Cache-Control` and ETag; honour `If-None-Match` → 304
- `Vary: Accept` on the negotiated raster route — the format is part of the ETag fingerprint
- Keep upstream concurrency low; identify User-Agent
- Only load static `<img>` when needed (`<noscript>` and/or failure path)

Every new input that changes the rendered image (markers, badges, overlays, format) must join `buildStaticMapFingerprint`'s payload — see the `AGENTS.md` Maps section for the details and known sharp/`.composite()` gotcha.

## GIS styling

Overlay colours / hatches for recognised layer types must follow the GIS Tool Styling tables in `AGENTS.md` (geometry stage, sector, energy subtype, MOD areas, label buffers). Prefer shared constants over one-off hex values. The results map's nearby consultee categories aren't in those tables yet, so their colours are interim — see [Results map layers](#results-map-layers).

## Component showcase

`/components/interactive-map` renders one page per worked Defra example (`interactive-map-examples-data.ts`): style switcher, draw tools, feature selection with a side panel, fullscreen `buttonFirst`/`hybrid` variants, and static-map parity. Each example loads only the plugin bundles it needs and reuses the shared static-map pipeline for its `<noscript>` / init-failure fallback. It's the safest place to learn the Defra component's quirks — `AGENTS.md` lists the integration gotchas (`data-*` JSON-parsing, late plugin API attachment, `hasExitButton`, `mapStyle.id`, noscript DOM visibility).

## Map layers demo

`/map-layers-demo` is an explicit prototype for toggling overlays (railways, roads, etc.). Safe place to experiment without coupling to the main consultees journey.

## Where map data comes from

| Context                     | Source                                                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Consultees results maps     | `case_boundary` geometry + `runRuleset` matches and nearby areas, clipped to the search area, via `buildCaseMapConfig` |
| Home list                   | `case_boundary` rows (no map)                                                                                          |
| Interactive-map showcase    | Sample GeoJSON in `interactive-map-examples-data.ts` / `sample-geojson.ts`                                             |
| Map layers demo             | Demo GeoJSON in `map-layers-demo-geojson.ts`                                                                           |
| Python consultee areas page | SQL via Python (no map UI focus yet)                                                                                   |
| Future uploads map          | Expected to use DB geometries + `geometry-bounds` (not wired as a route yet)                                           |

## Related pages

- [GOV.UK Frontend conventions](./govuk-frontend-conventions.md)
- [API and data contracts](./api-and-data-contracts.md)
- [Troubleshooting](./troubleshooting.md)
