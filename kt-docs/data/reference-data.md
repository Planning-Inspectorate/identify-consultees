# Reference data

Profiled from `combined_reference_data_v1.geojson` (18,258 consultee areas) and `all-project-boundaries.geojson` (282 case boundaries) in October 2026.

## Consultee categories

"Points" is vertices per shape, median and maximum: a rough measure of screening cost. "Conditions" are those in the England Wales post 30 April 2024 ruleset that use the category.

| Category                       |   Rows | Shape        |         Points | Conditions                                                |
| ------------------------------ | -----: | ------------ | -------------: | --------------------------------------------------------- |
| Parish Council                 | 11,548 | Polygon      |       28 / 702 | Host parish (intersects); bordering parishes              |
| Hospital                       |  3,088 | Point        |              1 | Within 10km                                               |
| Electricity Generator          |  1,435 | Point        |              1 | **None**                                                  |
| Dock or Harbour                |  1,212 | Point        |              1 | Within 10km                                               |
| Lower Tier Authority           |    164 | Polygon      |    363 / 3,157 | Host district; bordering                                  |
| Unitary Authority              |    154 | Polygon      |    242 / 4,650 | Host unitary; bordering                                   |
| Internal Drainage District     |    113 | Polygon      |    163 / 3,946 | Within 10km (Wales)                                       |
| Offshore Wind Site             |     72 | Polygon      |       12 / 429 | Within 10km                                               |
| Offshore Wind Export Cable     |     66 | Polygon      |       43 / 245 | Within 10km                                               |
| Fire and Rescue Authority      |     47 | Polygon      |  1,192 / 8,417 | Within 1km                                                |
| Police                         |     43 | Polygon      |  1,377 / 8,417 | Within 1km                                                |
| Local Resilience Forum         |     42 | Polygon      |  1,470 / 8,413 | Intersects                                                |
| National Landscape             |     40 | Polygon      |    284 / 8,037 | Within 35km (England and Wales conditions, same category) |
| ONR Site                       |     37 | Point        |              1 | Intersects                                                |
| ICB                            |     36 | Polygon      |  1,177 / 4,049 | Within 10km                                               |
| Interconnector                 |     34 | MultiPolygon |   394 / 22,708 | **None**                                                  |
| Railway                        |     23 | Line         |  238 / 233,820 | **Excluded**, see below                                   |
| Upper Tier Authority           |     21 | Polygon      |  1,425 / 7,943 | Host county; bordering                                    |
| Integrated Transport Authority |     15 | Polygon      | 1,919 / 10,846 | Within 10km                                               |
| Internal Drainage Board        |     14 | Polygon      |    860 / 9,839 | Within 10km (England)                                     |
| DNO                            |     14 | MultiPolygon | 3,482 / 14,057 | **None**                                                  |
| National Park                  |     13 | Polygon      |    753 / 3,119 | Host national park; bordering                             |
| Ambulance Trust                |     12 | Polygon      |  2,390 / 7,483 | Within 1km and 10km                                       |
| Local Health Board             |      7 | Polygon      | 3,119 / 12,949 | Within 10km (Wales)                                       |
| Corporate Joint Committee      |      4 | MultiPolygon | 7,623 / 14,104 | **None**                                                  |
| Passenger Transport Executive  |      3 | Polygon      |  2,362 / 4,503 | Within 10km                                               |
| Greater London Authority       |      1 | MultiPolygon |          2,282 | Within 35km                                               |

"Polygon" includes MultiPolygon; "Line" is LineString or MultiLineString.

The four categories with no condition are left out until their data is reviewed. They still appear when the nearby search finds them, with the reason "Within 20km of the site".

**Railway** is merged nationally by line type and status. "Freight And Passenger - Main Line - Active" is one shape covering the GB network: 115,966 parts and 233,820 points. Being near it is true almost everywhere and every query touching it is slow, so Railway is excluded from conditions and the nearby search until it's split by route or region.

## Case boundaries

282 boundary submissions across 269 case references, Polygon and MultiPolygon.

- **Size**: under 0.1km² (a single site) to over 17,000km² (offshore wind zones).
- **Detail**: up to 177,585 points (Norwich to Tilbury, a 180km route). Many small sites are over-digitised: Silvertown Tunnel's 0.3km² has 2,536 points, mostly under a metre apart.

Long linear schemes are the heaviest to screen: a 180km route with a 20km radius covers thousands of square kilometres and over 1,000 nearby areas.
