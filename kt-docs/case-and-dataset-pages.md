# Case and dataset pages

**Status:** Partial — “case” UX exists as consultees results over fixtures; rich dataset overview content is still light.

## Case reference routing

Users select a fixture geometry on the homepage. The app redirects to:

```
/consultees/:geometryId?ruleset=<optional>
```

Examples used in tests: `geo-1`, sometimes with `ruleset=post-30-apr-2024-england-wales`.

`GET /consultees` without `geometryId` redirects home. With `geometryId`, it 302s to the canonical path above.

## What the results page shows

Controller: `apps/manage/src/app/views/consultees/results/controller.ts`

Typical content:

- Case / project heading from dummy geometry metadata (reference, name, ruleset label)
- Section blocks (for example ambulance trusts, police force areas, fire and rescue)
- Per section: consultee name lists + map region (interactive + static fallback)
- Static map URLs namespaced by section id

Section definitions and sample area polygons are **hard-coded in the controller** for the prototype, not loaded from CBOS.

## Fixture cases vs database-only geometry records

| Kind              | How you recognise it                                  | Used by                                                                      |
| ----------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| Fixture case      | Id like `geo-*` from `DUMMY_GEOMETRIES`               | Homepage table, `/consultees/:id`                                            |
| Database geometry | Rows in SQL (`case_boundary`, `consultee_area`, etc.) | Count on home (optional); Python consultee-areas; geospatial package helpers |

A database-only boundary **does not automatically appear** as a selectable homepage row today. Do not tell stakeholders that uploading to SQL alone completes the UI journey.

## Dataset overview content

**Sparse:** There is no separate “dataset catalogue” page yet. Closest surfaces:

- Homepage project table (fixture catalogue stand-in)
- `/consultee-areas-python` (raw-ish rows from Python/SQL)
- `/map-layers-demo` (overlay experimentation)

## Related pages

- [Search and filtering](./search-and-filtering.md)
- [Maps](./maps.md)
- [Upload and spatial screening](./upload-and-spatial-screening.md)
