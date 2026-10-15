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

## External controls (radio buttons bound to map shapes)

`public/javascripts/external-controls-plugin.mjs` is a custom plugin that binds ordinary form controls outside the map component (the boundary page's "Confirm shapefile for report" radios) to datasets-plugin features, both ways: a radio `change` selects the shape (`interact:selectFeature`), and a map click that selects a bound feature checks its radio (`interact:selectionchange`). The radios stay normal form fields — they submit with the form and work without JavaScript.

A page opts in by putting an `externalControls` block in the map's JSON page config — `maps/external-controls-config.ts`'s `buildExternalControlsConfig` emits it, one `binding` per file:

```json
{
	"value": "file-a",
	"featureId": "file-a",
	"idProperty": "fileKey",
	"datasetId": "shapefile-file-a",
	"layerId": "shapefile-file-a"
}
```

The link convention: the input's `value` equals the bound feature's `idProperty` value, and the dataset/layer ids are the `shapefile-<id>` names `buildBoundaryMapConfig` already produces. Options beside `control` (a CSS selector scoping the inputs) and `bindings`: `emphasis` (`'select'` ring only, `'solo'` hides the other bound datasets, `'dim'` fades them to `dimOpacity`), `primaryControl` (`'shared'` keeps the Layers menu entries, `'external'` removes them so the radios are the only per-file control), `ensureVisible`, `zoomTo`, and `persistent` (a map deselect re-asserts the checked radio's highlight). The plugin's file header documents every option and the interact gotchas (programmatic select needs the plugin enabled; re-selecting toggles off).

## Defra map gotchas found here

- Each dataset needs an `idProperty` (`consulteeId`, `reference` for the project, `fileKey` for the boundary page's shapefiles). MapLibre drops string feature ids, so without it nothing can be selected and the console warns about "string native IDs".
- Interact `layerId`s are MapLibre layer ids: `<dataset id>-<sublayer id>` (for example `consultee-areas-identified-0`), plus `-stroke` when a sublayer has both fill and outline.
- There's no fill-opacity option; `fillOpacity` is ignored and the fill drawn solid. Put the alpha in the colour (`translucent('#55A868', 0.05)`). The map-layers demo and component examples still draw solid fills for this reason.
- A custom `symbolSvgContent` must include `{{haloColor}}`, `{{selectedColor}}` and `{{activeColor}}`, or it isn't drawn.
- A sublayer is drawn as points only if its style sets `symbol`.
- **One interactive map per page.** The datasets plugin's `datasetRegistry` and `layerAdapter` are module-level singletons shared by every `InteractiveMap` on the page — each map's init rebinds them to itself. With two maps, `setDatasetVisibility`/`setOpacity` read and write whichever map attached last (a Layers-menu toggle applies to the wrong map when the dataset ids match), and `datasets:changed` attaches another map's state to every panel's registry. The external-controls demo therefore renders one map per `?mode=`; the boundary page is safe because it has a single map. Similarly, `im-core` memoises plugin components in a global cache keyed on component identity, capturing `pluginConfig` once — always return a fresh manifest (fresh `InitComponent`) from a plugin factory, never a shared one.

## Framing

Both maps frame the search area, or the project and matches when there isn't one. If you change `buildCaseMapConfig` or the geometry helpers, check both. **Known issue:** the static image comes out much wider than the interactive map for the same centre and zoom (Hinkley Point C's spans South Wales to the south coast). Not yet investigated.

Every input that changes the rendered static image must be part of `buildStaticMapFingerprint`'s payload, or caches serve stale images.

## Dev pages

`/components/interactive-map` has worked Defra examples (style switcher, draw tools, selection panel, fullscreen variants, static parity) from `interactive-map-examples-data.ts`; it's the safest place to learn the component. `/map-layers-demo` is a layer-toggle prototype. `/map-external-controls-demo` shows the external-controls plugin on three fictional overlapping shapefiles — the same page rendered under `?mode=select-shared|solo-external|dim-zoom` with `emphasis`/`primaryControl`/`zoomTo` varied, each mode with a "How this map is configured" panel showing its exact options. One map per page because of the datasets-plugin singletons (see gotchas). None touches the database.
