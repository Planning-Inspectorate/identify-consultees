# Maps

"The map" means the interactive Defra Interactive Map. The "static map" is the server-rendered image shown without JavaScript or when the interactive map fails. The rules (static map caching, Defra gotchas, GIS styling) are in the Maps section of [AGENTS.md](../AGENTS.md); this page explains how the project maps are built.

| Mode        | How                                                                                                                                                                                                                                                                                                                                           |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interactive | Defra bundles from `/vendor/*`, started by `public/javascripts/consultees-map.js` from the page's inline JSON config                                                                                                                                                                                                                          |
| Static      | `/consultees/:caseId/results/static-map` — the boundary page's variant is `/consultees/:caseId/boundary-map` (AVIF, WebP or PNG from `Accept`) or `.../static-map.svg`. Tiles are fetched and composited by the app, with ETags and long caching (`maps/serve-static-map.ts`, `static-map.ts`, `static-map-raster.ts`, `static-map-cache.ts`) |

The project boundary page, a report category page and the results page all use the partial `views/partials/consultee-map-region.njk`; the boundary page serves its own `/boundary-map` route, and a category page adds `category` and `exclude` to the results route.

## Building the map

The results and category pages' controllers do the same steps, with helpers from `views/consultees/run-ruleset.ts` (the boundary page is simpler: `maps/boundary-map.ts` turns each stored shapefile into a dataset, no ruleset run):

1. Loads the case boundary (`resolveCase`).
2. Runs the ruleset in the Python function (`runRulesetSafely`, through `service.rulesetRunner`). It returns every consultee it found, by a condition or within the nearby radius (20km), with its reasons.
3. Builds the **search area**, the site grown by the nearby radius, and fetches display geometry for every consultee touching it (`buildSearchAreaSafely`). Areas are drawn whole and simplified by size: the larger of 25m and 1/200th of the area's width (`DISPLAY_SIMPLIFY_WIDTH_RATIO`). A parish stays at 25m and a 3,000km² county becomes about 270m, which keeps a Norwich to Tilbury page at 1.5MB rather than 3.8MB.
4. `buildCaseMapConfig` (`maps/case-geojson.ts`) makes the config: the project, the consultees and the search area, each consultee with its category's `colour` and `fillOpacity`, so both maps colour it the same.

If step 3 fails the page still renders, with the project and condition matches only (capped at `MAX_SAMPLED_MAP_MATCHES`).

## Layers

| Layer              | Shows                                                                                              | Style                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| The ruleset's name | Every consultee identified, one sublayer per category with a count                                 | Areas filled in the category colour; point categories (hospitals, harbours, generators, nuclear sites) as dots   |
| (same dataset)     | Each category's consultees only the nearby search found, as "Category: nearby, not identified (n)" | Fainter: 10% fill (3% regional), thin dashed outline; dots at 45% of the colour. Drawn under the identified ones |
| Project site       | The case boundary                                                                                  | Red, translucent                                                                                                 |

Regional categories (police, ambulance trusts, ICBs, counties) would hide everything else at a normal fill. A category with any area covering half or more of the search area's bounding box is filled at 6% (`REGIONAL_FILL_OPACITY`) and drawn first; local areas get 35% (`LOCAL_FILL_OPACITY`). Consultees only the nearby search found (`identified: 'false'`) get `NEARBY_REGIONAL_FILL_OPACITY` and `NEARBY_LOCAL_FILL_OPACITY` instead: they aren't in the report, but show what's around the site, out to each category's distance in [`config/nearby-consultees.yaml`](../config/nearby-consultees.yaml). They always start shown; the Layers panel can hide them.

**Category colours are interim**: a 14-colour placeholder palette (`maps/category-colours.ts`), assigned in alphabetical order per map, so a category's colour can change between projects. Consultee categories aren't in the GIS Tool Styling tables and need product and design sign-off.

Clicking a feature selects it and a "Selected on the map" panel shows its name, category and region. The Defra map has no hover; selection goes through the interact plugin (`buildSelectableLayers`, `wireFeatureDetails`).

## Defra map gotchas found here

- Each dataset needs an `idProperty` (`consulteeId`, `reference` for the project, `fileKey` for the boundary page's shapefiles). MapLibre drops string feature ids, so without it nothing can be selected and the console warns about "string native IDs".
- Interact `layerId`s are MapLibre layer ids: `<dataset id>-<sublayer id>` (for example `consultee-areas-identified-0`), plus `-stroke` when a sublayer has both fill and outline.
- There's no fill-opacity option; `fillOpacity` is ignored and the fill drawn solid. Put the alpha in the colour (`translucent('#55A868', 0.05)`). The map-layers demo and component examples still draw solid fills for this reason.
- A custom `symbolSvgContent` must include `{{haloColor}}`, `{{selectedColor}}` and `{{activeColor}}`, or it isn't drawn.
- A sublayer is drawn as points only if its style sets `symbol`.

## Loading state

The Defra component has no built-in "loading map" message. `im-is-loading` only hides the `<body>` until the app mounts (anti-flicker for fullscreen behaviour); there's no spinner or `loadingText` option; and a plugin manifest can't help — a plugin's `load()` runs inside `loadApp()`, after the `im-core` and provider chunks have downloaded, so nothing registered there can cover the download phase. The `middle` slot is documented for loading screens but only exists after the React app mounts, and `createRoot()` discards anything already inside the container at that point.

`map-loading-plugin.mjs` manages the overlay outside the app instead: the container is wrapped in `.app-map-loading-wrap` and the `.app-map-loading` overlay sits beside it, so it survives the React mount and covers the whole window from script execution to tiles-idle. `consultee-map-region.njk` and `example.njk` server-render the same markup inside the container (hidden by a `noscript` style), which the plugin adopts — moves out of the container before `replaceChildren()`/`createRoot()` would discard it — so one seamless overlay covers first paint to first idle.

Dismissal is `map:firstidle` — the first MapLibre `idle`, once style, sources and tiles have settled (the provider emits it once, `map:ready`/`map:loaded` fire earlier on `load`) — or the `.im-c-error` watcher it shares with the static fallback, or a 60s safety timeout: the provider forwards no MapLibre `error` event, so a failed style or tile fetch would otherwise leave the overlay up forever.

It only suits `behaviour: 'inline'` — buttonFirst's collapsed launcher is inside the covered area and a fullscreen app escapes the sibling overlay (`position: fixed`), so `interactive-map-examples.js` skips it for other behaviours. A fullscreen-capable variant would need a `middle`-slot panel (post-mount coverage only) or the component gaining a loading API upstream.

## Serving map data at scale

Embedded GeoJSON in the page config is fine at current sizes. If a map ever needs more features than a page can carry (for example every project boundary nationwide), the datasets plugin offers two paths, both with backend implications:

- `dynamicGeoJSON` — the plugin fetches GeoJSON per viewport (`bbox` via `transformRequest`). Needs a backend endpoint that clips/filters by bounding box (PostGIS `ST_Intersects` + `ST_MakeEnvelope`) and honours `maxFeatures`/simplification; auth headers are supported through `transformRequest`.
- `tiles` + `sourceLayer` — vector tiles. Either generated on demand (PostGIS `ST_AsMVT` behind an endpoint) or pre-built archives. **PMTiles and FlatGeobuf need HTTP range requests**: the server (or CDN/front door in front of it) must accept `Range` headers and return `206 Partial Content` with `Accept-Ranges: bytes`. Azure Blob Storage supports ranges natively, but an app-proxied or fronted endpoint must forward the header and stream partial responses — worth verifying early, as a broken range path fails silently into full-file downloads or missing data. The bundled MapLibre provider does not register the `pmtiles://` protocol, so that would need wiring too.

## Framing

Both maps frame the search area, or the project and matches when there isn't one. If you change `buildCaseMapConfig` or the geometry helpers, check both. **Known issue:** the static image comes out much wider than the interactive map for the same centre and zoom (Hinkley Point C's spans South Wales to the south coast). Not yet investigated.

Every input that changes the rendered static image must be part of `buildStaticMapFingerprint`'s payload, or caches serve stale images.

The static image has options only the report's map PDFs use (`StaticMapBuildOptions`): `labels` names each consultee area where a label fits (on a grid over the part of the area on the map, nearest its middle, smallest areas placed first, none overlapping), `basemap: 'greyscale'` greys and lightens the basemap - tiles or Google's image - before the overlay goes on (sharp composites after its other operations, so it's a step of its own), and `bufferGeojson` draws dashed outlines, each labelled on its outline above the site. The labels are SVG text, which needs a font installed (see `apps/manage/Dockerfile`).

## Dev pages

`/components/interactive-map` has worked Defra examples (style switcher, draw tools, selection panel, fullscreen variants, static parity) from `interactive-map-examples-data.ts`; it's the safest place to learn the component. `/map-layers-demo` is a layer-toggle prototype. Neither touches the database.
