# Maps (interactive and static)

## Terminology (how the user talks about maps)

When the user mentions maps in conversation or tickets, interpret wording as follows:

| User says                                 | Means                                                                                                                                                 |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **map** (unqualified)                     | The **JS-on interactive map** (Defra Interactive Map / client-side map when JavaScript works).                                                        |
| **static map** or **non-interactive map** | A **server-rendered image** of a map (PNG/JPEG/SVG served by our app), used for noscript / progressive-enhancement failure — not the interactive map. |

Do not assume “map” alone refers to the static fallback; only treat it as static when they say static or non-interactive (or clearly point at the image/fallback path).

## Shapefile upload and GIS report workflow (external)

For Astun GIS shapefile packaging, upload, attribute population, and prescribed-consultee report generation, read:

- [`gis-shapefile-upload-and-report.md`](./gis-shapefile-upload-and-report.md)

Keep that procedural detail out of this file; link here when an agent needs the operational context.

## GIS Styling — default values (map overlays — required)

Source: **GIS Styling (default values)** (last updated 19/10/2026, Jo Gerulaitis), superseding the earlier **GIS Tool Styling** sheet (12/09/2024) wherever the two disagree — the MOD area fills moved to `0.2` opacity and the safeguarding purple to `#cd2380`. Agents and contributors **must** use these styles whenever implementing or changing map overlays (interactive layers, legends/keys, and static-map drawings of the same features). Do not invent new colours or fill patterns for these layer types.

### Geometry selection map

Solid fill; fill opacity `0.2`; border opacity `1.0`; border width `1.5px`.

| Layer             | Colour    | Description |
| ----------------- | --------- | ----------- |
| Selected geometry | `#ff0000` | Solid fill  |
| Other geometries  | `#3c51ab` | Solid fill  |

### Consultee layers

Solid fill; fill opacity `0.2`; border opacity `1.0`; border width `1.5px`. The five group layers key the same groups as the generated report's workbook tabs (`GROUP_TABS` in `apps/manage/src/app/views/consultees/report/export/workbook.ts`).

| Layer                     | Colour    | Differentiation hints (design suggestions, not mandated)                         |
| ------------------------- | --------- | -------------------------------------------------------------------------------- |
| Latest project geometries | `#ff0000` |                                                                                  |
| Administrative boundaries | `#007a7a` | Ranges of opacities or overlaid hatch patterns (`\`, `/`, `=`, `\|`)             |
| Public bodies             | `#2a72b2` | `+` markers in `#2a72b2` for hospitals                                           |
| Energy                    | `#330165` |                                                                                  |
| Transport                 | `#444444` | Dashed lines; `.`, `+`, `*` port-type markers in `#330165`, `#2a72b2`, `#cd2380` |
| Other                     | `#cd2380` | See the MOD layers below                                                         |

The sheet's mock-up legend also sketches per-group fill patterns (administrative boundaries a diagonal hatch, public bodies horizontal lines, energy a diagonal hatch, transport a dashed line, other constraints a cross-dot). The mock-up is marked approximate and AI-generated — the tables above are the source of truth for colours and opacities; treat the patterns as a differentiation aid where one colour per group is not enough on its own.

Consultee areas on the maps should ultimately follow these group colours — the per-category palette in `apps/manage/src/app/maps/category-colours.ts` is an interim placeholder until group colouring lands.

### All layers — labels and buffers

Applies to label styling on all map overlays:

| Property       | Value     |
| -------------- | --------- |
| Font name      | Arial     |
| Font size      | 10pt      |
| Colour         | `#424145` |
| Buffer width   | 2mm       |
| Buffer colour  | `#ffffff` |
| Buffer opacity | `0.9`     |

### All projects layer — by `geometryStage`

Solid fill; fill opacity `0.6`; border opacity `1`.

| Layer                 | Column          | Colour    | Description |
| --------------------- | --------------- | --------- | ----------- |
| Scoping               | `geometryStage` | `#3c51ab` | Solid fill  |
| Acceptance            | `geometryStage` | `#bd2327` | Solid fill  |
| Consultation adequacy | `geometryStage` | `#ee853e` | Solid fill  |
| DCO consent           | `geometryStage` | `#85a54e` | Solid fill  |
| Built                 | `geometryStage` | `#4c888e` | Solid fill  |

### All projects — by type (`Sector`)

Solid fill; fill opacity `0.6`; border opacity `1`.

| Layer                  | Column   | Colour    | Description |
| ---------------------- | -------- | --------- | ----------- |
| Transport              | `Sector` | `#da7c7e` | Solid fill  |
| Business or Commercial | `Sector` | `#782e98` | Solid fill  |
| Energy                 | `Sector` | `#e0a620` | Solid fill  |
| Waste                  | `Sector` | `#874927` | Solid fill  |
| Waste water            | `Sector` | `#418335` | Solid fill  |
| Water                  | `Sector` | `#85b6b1` | Solid fill  |
| Other                  | `Sector` | `#77767b` | Solid fill  |

### Energy projects — by subtype (`subType`)

Diagonal hatch (`Hatched /`); fill opacity `1`; border opacity `1`.

| Layer             | Column    | Colour    | Description |
| ----------------- | --------- | --------- | ----------- |
| Natural gas       | `subType` | `#da7c7e` | Hatched /   |
| Energy from waste | `subType` | `#782e98` | Hatched /   |
| Solar             | `subType` | `#e0a620` | Hatched /   |
| Offshore wind     | `subType` | `#3b629b` | Hatched /   |
| Biomass           | `subType` | `#418335` | Hatched /   |
| Nuclear           | `subType` | `#85a54e` | Hatched /   |
| Tidal             | `subType` | `#4c888e` | Hatched /   |
| Hydrogen          | `subType` | `#85b6b1` | Hatched /   |
| Onshore wind      | `subType` | `#77767b` | Hatched /   |
| Other             | `subType` | `#874927` | Hatched /   |

### MOD low flying areas

Cross hatch (`Hatched X`); fill opacity `0.2`; border/hatch opacity `1.0`.

| Layer | Colour    | Description |
| ----- | --------- | ----------- |
| Green | `#418335` | Hatched X   |
| Amber | `#e0a620` | Hatched X   |
| Red   | `#bd2327` | Hatched X   |
| Blue  | `#2068e4` | Hatched X   |

### MOD safeguarding areas

Cross hatch (`Hatched X`); fill opacity `0.2`; border/hatch opacity `1.0`.

| Layer  | Colour    | Description |
| ------ | --------- | ----------- |
| Purple | `#cd2380` | Hatched X   |

### Agent rules for overlay styling

- Prefer shared constants / a single style module over hard-coding hex values in multiple views.
- Match legend/key swatches to the same colour and fill pattern as the map layer.
- When a new overlay type is needed and is not listed above, ask product/design rather than inventing a palette.
- Static-map fallbacks that draw the same features should use the same colours and opacities where the render path allows.

## Architecture

The manage app follows the PINS-data-spike pattern: **Defra Interactive Map** when JavaScript works, plus a **server-rendered static map** for noscript / progressive-enhancement failure.

## Formats

Non-JS / fallback maps are **not always SVG**. Depending on configuration they may be:

| Format                | Typical source                                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `image/avif`          | Default OSM-tile path composited with `sharp` and encoded as AVIF when the client accepts it                                     |
| `image/webp`          | Same composited raster, encoded as WebP when AVIF is not accepted                                                                |
| `image/png` (or JPEG) | Composited raster fallback for older clients, or Google Maps Static API when configured                                          |
| `image/svg+xml`       | SVG with a single compressed basemap embedded (`renderSvgBasemapImage` — JPEG data URI) + vector overlay (explicit `.svg` route) |

The default `/…/static-map` route negotiates AVIF → WebP → PNG from the request `Accept` header, so it must send `Vary: Accept`, and the negotiated format is part of the ETag fingerprint (`buildStaticMapFingerprint`). The `/…/static-map.svg` route always returns SVG.

Treat static maps as **binary or markup images served by our app**, never as a reason for browsers to hit third-party tile hosts directly.

## Static map / tile server usage (required)

OpenStreetMap tile servers and commercial static-map APIs rate-limit and block abusive clients. Agents and contributors **must**:

1. **Proxy through our app** — serve `/…/static-map` (and optional `/…/static-map.svg`) from Express; do not put `tile.openstreetmap.org` (or equivalent) URLs in page HTML/CSS/JS for the static fallback.
2. **Cache heavily** — responses must send long-lived `Cache-Control` (and preferably `ETag`). Matching `If-None-Match` must return **`304` and skip upstream Google/OSM fetches**. Prefer an in-process tile cache so repeat renders of the same viewport do not re-hit tile servers.
3. **Keep concurrency low** when fetching tiles (small batches; identifying `User-Agent` naming this service and repo).
4. **Only load static `<img>` when needed** — put the image in `<noscript>` and/or inject it after interactive-map failure; never eager-load static images for JS-capable users who will use the interactive map. Pass fallback details via the page's `<script type="application/json">` config block, not `data-*` attributes on the map container (see the `data-*` hazard below).
5. **Do not invent uncached polling or prefetch** of static maps or tiles (e.g. pre-warming every section on every page view without cache).
6. **Keep every static-map response inside the size budget** — target ≤100KB and never exceed ~200KB; this service prioritises frontend performance and low data download. An SVG variant is only acceptable when compression keeps it inside that budget: never embed raw raster tiles (base64 PNG tiles produce ~900KB documents), embed a single compressed basemap instead (`renderSvgBasemapImage`), and don't repeat the data URI in a deprecated `xlink:href` attribute — it doubles the payload. If a variant cannot be brought inside budget, serve negotiated raster only.

When changing static-map code, preserve ETag fingerprinting of framing + geometry so validators continue to avoid unnecessary upstream work. Every new input that affects the rendered image (markers, numbered badges, overlays, format) must be added to `buildStaticMapFingerprint`'s payload — otherwise stale cached variants keep serving after the config changes.

The static fallback should carry the same feature information as the interactive map. For feature-based maps, draw numbered badges at each feature's centroid and pair them with a GOV.UK table below the map that keys the numbers to names/details.

`sharp` gotcha in `static-map-raster.ts`: **`.composite()` replaces the input list, it does not append.** Tiles and the overlay must go into a single `.composite()` call — a second call silently drops the basemap, producing a background-only image (this exact bug shipped once because tile fetches also fail silently to an empty array, making the two failure modes indistinguishable). Tests should assert on output pixel stats, not just format signatures.

## Defra component integration gotchas (learned from real bugs)

- **`data-*` attributes are JSON-parsed.** The `InteractiveMap` constructor runs `JSON.parse` on every `data-*` attribute it finds on the map container. Plain strings like `data-static-map-src="/static-map"` log `SyntaxError`s to the console (harmless but noisy, and confusing to diagnose). Keep `data-*` off the container — put configuration in the page's `<script type="application/json">` block (the consultee maps carry their static-map fallback as `config.fallback`) and discover containers by a class selector (`.app-consultee-map`).
- **Plugin API methods attach late.** The object returned by `defra.interactPlugin()` (and siblings) has no `enable`/`clear` methods at construction — the core attaches them when the plugin's init component mounts, around `map:ready`. Guard wiring on the plugin object existing, then call the API lazily: `map.on('map:ready', () => interactPlugin.enable?.())`. A jsdom mock that exposes `enable` immediately masks this and lets the bug ship — model the late attachment (plugin object without the API until `map:ready`) in tests.
- **`mapStyles` entries need a `thumbnail`.** The `map-styles` plugin renders `mapStyle.thumbnail` as an `<img>`; an omitted field leaves an empty placeholder box in the style panel. Inline SVG `data:` URIs work well — zero requests, decorative `alt=""`, and CSP already allows `img-src data:`.
- **Feature info is a panel, not a tooltip.** The component has no floating-tooltip API for clicked features (its internal tooltips are only control labels). The supported pattern is `interact` + `interact:selectionchange` writing into an `addPanel` side panel — also the more accessible option for keyboard and touch users. Escape property values (`escapeHtml`) before `innerHTML`.
- **`buttonFirst`/`hybrid` fullscreen needs `hasExitButton: true`.** The shell ships a built-in Exit control (top-left, fullscreen only) but excludes it unless `appConfig.hasExitButton` is set — without it, a `buttonFirst` map opens fullscreen with no way out. Pass the flag through the page config; `inline` maps can leave it off since they never fullscreen.
- **`mapStyle` must have an `id`.** The draw adapter builds per-style override properties (`user_fill<Id>` etc.) via `mapStyle.id.charAt(0)` and crashes at mount with `Cannot read properties of undefined (reading 'charAt')` when the style object lacks `id` — the draw control then silently never attaches. Give the shared style object `id: 'liberty'` ; style-switcher `mapStyles` entries already carry ids.
- **`<noscript>` contents are not in the live DOM.** With JS enabled, browsers don't expose noscript markup to `querySelector` or Playwright — content needed for _both_ no-JS users and JS-users-on-init-failure must be rendered twice: inside `<noscript>` and again in a `hidden` block (`#<mapId>-fallback`) that `showStaticMapFallback` reveals on failure. Tests asserting the fallback must read the raw HTML response, not the live DOM.
- **Verify plugin interactions with a real click, not DOM presence.** The draw adapter crashed during mount (`mapStyle.id` missing) while its toolbar markup still rendered — a presence assertion passes but the feature is dead. When touching plugin wiring, click through the actual interaction in a browser (Playwright against the dev server) and watch `pageerror`/`console` for mount-time exceptions.
- **Never give vendor lazy chunks a nonzero `max-age`.** Webpack loads `im-core.js` and the numeric `NNNN.js` plugin chunks by literal filename — the URL never changes across package versions, unlike the fingerprinted `index-<hash>.js` entry. A cached stale chunk booting against a new entry throws `o[e] is not a function` inside webpack's module lookup and the map fails with "There was a problem loading the map" — seen in Chrome (warm cache) while Firefox (cold cache) worked, right after a `@defra/interactive-map` bump. `createDefraVendorRouter` is mounted with no `maxAge` → `max-age=0` + ETag/304 revalidation. Do not plumb `service.cacheControl.maxAge` back into it; `CACHE_CONTROL_MAX_AGE` still feeds core's static mount, which serves nothing (the app overrides `staticDir` with an empty mount).
- **Draw tools need a consumer-added entry button.** The draw plugin only renders in-session controls (Cancel/Add point/Done); nothing starts a session until the consumer wires a button: `map.on('map:ready', () => map.addButton('drawPolygon', { label: 'Draw polygon', onClick: () => drawPlugin.newPolygon?.(crypto.randomUUID()) }))`. `newPolygon(featureId, options?)` is late-bound like `interact.enable` — call it with `?.` at click time.
- **Viewport `aria-controls` is a dangling idref upstream (0.0.44+).** `Features` (`#<id>-features`) was replaced by `SpatialList` (`#<id>-spatial-list`) but the viewport's `aria-controls` still points at the old id — axe flags it as critical `aria-valid-attr-value`. `scripts/patch-im-aria-controls.ts` rewrites the idref in the installed `dist/{umd,esm}/im-core.js` at postinstall; it throws when the pattern disappears so a fixed upstream version fails loudly and the patch can be removed.
