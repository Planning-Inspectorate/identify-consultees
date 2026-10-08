# Reference data catalogue

**Status:** Current — profiled from `combined_reference_data_v1.geojson` (18,258 rows) in October 2026.

## Consultee categories

"Points" is the number of vertices per shape, median and maximum — a rough measure of how expensive a category is to screen. "Ruleset" lists the [England Wales post 30 April 2024 ruleset](./spatial-screening-engine.md) conditions that use the category.

| Category                       |   Rows | Shape                        | Points (median / max) | Ruleset                                                        |
| ------------------------------ | -----: | ---------------------------- | --------------------: | -------------------------------------------------------------- |
| Parish Council                 | 11,548 | Polygon / MultiPolygon       |              28 / 702 | Host parish (intersects); bordering parishes                   |
| Hospital                       |  3,088 | Point                        |                     1 | Within 10km                                                    |
| Electricity Generator          |  1,435 | Point                        |                     1 | **None**                                                       |
| Dock or Harbour                |  1,212 | Point                        |                     1 | Within 10km                                                    |
| Lower Tier Authority           |    164 | Polygon / MultiPolygon       |           363 / 3,157 | Host district; bordering                                       |
| Unitary Authority              |    154 | Polygon / MultiPolygon       |           242 / 4,650 | Host unitary; bordering                                        |
| Internal Drainage District     |    113 | Polygon / MultiPolygon       |           163 / 3,946 | Within 10km (Wales)                                            |
| Offshore Wind Site             |     72 | Polygon / MultiPolygon       |              12 / 429 | Within 10km                                                    |
| Offshore Wind Export Cable     |     66 | Polygon / MultiPolygon       |              43 / 245 | Within 10km                                                    |
| Fire and Rescue Authority      |     47 | Polygon / MultiPolygon       |         1,192 / 8,417 | Within 1km                                                     |
| Police                         |     43 | Polygon / MultiPolygon       |         1,377 / 8,417 | Within 1km                                                     |
| Local Resilience Forum         |     42 | Polygon / MultiPolygon       |         1,470 / 8,413 | Intersects                                                     |
| National Landscape             |     40 | Polygon / MultiPolygon       |           284 / 8,037 | Within 35km (two conditions, England and Wales, same category) |
| ONR Site                       |     37 | Point                        |                     1 | Intersects                                                     |
| ICB                            |     36 | Polygon / MultiPolygon       |         1,177 / 4,049 | Within 10km                                                    |
| Interconnector                 |     34 | MultiPolygon                 |          394 / 22,708 | **None**                                                       |
| Railway                        |     23 | MultiLineString / LineString |         238 / 233,820 | **Excluded** — see below                                       |
| Upper Tier Authority           |     21 | Polygon / MultiPolygon       |         1,425 / 7,943 | Host county; bordering                                         |
| Integrated Transport Authority |     15 | Polygon / MultiPolygon       |        1,919 / 10,846 | Within 10km                                                    |
| Internal Drainage Board        |     14 | Polygon / MultiPolygon       |           860 / 9,839 | Within 10km (England)                                          |
| DNO                            |     14 | MultiPolygon                 |        3,482 / 14,057 | **None**                                                       |
| National Park                  |     13 | Polygon / MultiPolygon       |           753 / 3,119 | Host national park; bordering                                  |
| Ambulance Trust                |     12 | Polygon / MultiPolygon       |         2,390 / 7,483 | Within 1km and 10km                                            |
| Local Health Board             |      7 | Polygon / MultiPolygon       |        3,119 / 12,949 | Within 10km (Wales)                                            |
| Corporate Joint Committee      |      4 | MultiPolygon                 |        7,623 / 14,104 | **None**                                                       |
| Passenger Transport Executive  |      3 | Polygon / MultiPolygon       |         2,362 / 4,503 | Within 10km                                                    |
| Greater London Authority       |      1 | MultiPolygon                 |                 2,282 | Within 35km                                                    |

**Categories with no ruleset condition** (Electricity Generator, Interconnector, DNO, Corporate Joint Committee) are deliberately left out until their data is reviewed. They still appear in the "all consultees within 20km" list on the results page.

## Railway

Railway data is merged nationally by line type and status rather than split by route or region. One feature, "Freight And Passenger - Main Line - Active", is a single shape covering the whole GB network: 115,966 parts and 233,820 points. Being "near" it is true almost everywhere, so it carries no information, and its size makes every query that touches it slow. Railway is therefore excluded from the ruleset and from the "all consultees nearby" list. It needs splitting into routes or regions before it can be used.

## Case boundaries

`all-project-boundaries.geojson` holds the site boundaries of planning cases: 282 boundary submissions across 269 case references.

| Property | Range                                                                                                                                                                            |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Size     | From under 0.1 km² (a single site) to over 17,000 km² (offshore wind zones)                                                                                                      |
| Detail   | Up to 177,585 points (Norwich to Tilbury, a 180km route). Many small sites are over-digitised: Silvertown Tunnel's 0.3 km² boundary has 2,536 points, mostly under a metre apart |
| Types    | Polygon and MultiPolygon                                                                                                                                                         |

Long linear schemes (pipelines, power lines, railways) are the heaviest to screen: a 180km route with a 20km search radius covers thousands of square kilometres and over 1,000 nearby areas.

## Related pages

- [Data model](./data-model.md)
- [Screening issues and open questions](./screening-issues-and-open-questions.md)
