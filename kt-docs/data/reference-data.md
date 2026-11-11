# Reference data

Profiled from `combined_reference_data_v1.geojson` (18,258 consultee areas) and `all-project-boundaries.geojson` (282 case boundaries) in October 2026.

## Consultee categories

"Points" is vertices per shape, median and maximum: a rough measure of screening cost. "Conditions" are those in the England and Wales (Post 30 April 2024) ruleset that use the category.

| Category                                                                        |   Rows | Shape        |         Points | Conditions                                       |
| ------------------------------------------------------------------------------- | -----: | ------------ | -------------: | ------------------------------------------------ |
| Parish, town and community councils                                             | 11,548 | Polygon      |       28 / 702 | Host parish (intersects); bordering parishes     |
| Hospitals operated by NHS trusts and NHS foundation trusts (England)            |  3,088 | Point        |              1 | Within 10km                                      |
| Electricity generators with compulsory purchase order powers                    |  1,435 | Point        |              1 | Within 10km                                      |
| Dock and harbour authorities                                                    |  1,212 | Point        |              1 | Within 10km                                      |
| District councils (lower-tier authorities)                                      |    164 | Polygon      |    363 / 3,157 | Host district; bordering                         |
| Unitary authorities                                                             |    154 | Polygon      |    242 / 4,650 | Host unitary; bordering                          |
| Internal drainage boards (Wales)                                                |    113 | Polygon      |    163 / 3,946 | Within 10km                                      |
| Offshore wind export cables and sites                                           |    138 | Polygon      |       43 / 429 | Within 10km                                      |
| Fire and rescue authorities                                                     |     47 | Polygon      |  1,192 / 8,417 | Within 1km                                       |
| Police and crime commissioners                                                  |     43 | Polygon      |  1,377 / 8,417 | Within 1km (as Police & Crime Commissioners)     |
| Local resilience forums (Wales)                                                 |     42 | Polygon      |  1,470 / 8,413 | **None** (within 10km in both pre-2024 rulesets) |
| National Landscapes - areas of outstanding natural beauty (England) and (Wales) |     40 | Polygon      |    284 / 8,037 | Within 35km                                      |
| Office for Nuclear Regulation sites                                             |     37 | Point        |              1 | **None** (within 30km in both pre-2024 rulesets) |
| Integrated Care Boards (England)                                                |     36 | Polygon      |  1,177 / 4,049 | Within 10km                                      |
| Electricity interconnectors with compulsory purchase order powers               |     34 | MultiPolygon |   394 / 22,708 | Within 10km                                      |
| Railways                                                                        |     23 | Line         |  238 / 233,820 | Within 10km, see below                           |
| County councils (upper-tier authorities)                                        |     21 | Polygon      |  1,425 / 7,943 | Host county; bordering                           |
| Integrated transport authorities                                                |     15 | Polygon      | 1,919 / 10,846 | Within 10km                                      |
| Internal drainage boards (England)                                              |     14 | Polygon      |    860 / 9,839 | Within 10km                                      |
| Electricity distributors with compulsory purchase order powers                  |     14 | MultiPolygon | 3,482 / 14,057 | Within 10km                                      |
| National Parks UK (England) and (Wales)                                         |     13 | Polygon      |    753 / 3,119 | Host national park; bordering                    |
| Ambulance trusts                                                                |     12 | Polygon      |  2,390 / 7,483 | Within 1km and 10km                              |
| Local health boards (Wales)                                                     |      7 | Polygon      | 3,119 / 12,949 | Within 10km (Wales)                              |
| Corporate joint committees (Wales)                                              |      4 | MultiPolygon | 7,623 / 14,104 | **None**                                         |
| Passenger transport executives                                                  |      3 | Polygon      |  2,362 / 4,503 | Within 10km                                      |
| Greater London Authority                                                        |      1 | MultiPolygon |          2,282 | Within 35km                                      |

"Polygon" includes MultiPolygon; "Line" is LineString or MultiLineString.

**Since the 2026-11-02 export** (the group files, not the profiled combined file above):

| Category                                                             | Dataset  |  Rows | Shape   |        Points | Group         |
| -------------------------------------------------------------------- | -------- | ----: | ------- | ------------: | ------------- |
| Hospitals operated by NHS trusts and NHS foundation trusts (England) | `HSP_EN` | 1,291 | Point   |             1 | Public bodies |
| Ministry of Defence safeguarding areas                               | `MSG_EW` |   874 | Polygon | 910 / 115,199 | Other         |
| Mining remediation authority                                         | `CMA_EW` |   211 | Polygon |     9 / 4,413 | Other         |
| Ministry of Defence low flying areas                                 | `MLF_EW` |    40 | Polygon |     426 / 970 | Other         |
| Cheshire brine subsidence district                                   | `CBA_EN` |     1 | Polygon |        14,325 | Other         |

Hospitals are England's only (`HSP_EN`, 1,291), against 3,088 in the combined file profiled above. The rulesets' condition is for hospitals operated by NHS Trusts and NHS Foundation Trusts (England).

Offshore wind sites and their export cables come from one dataset, `OWF_EW`, told apart by `consultee_subcategory` (Offshore Wind Sites, Offshore Wind Export Cables): [`config/reference-data.yaml`](../../config/reference-data.yaml) loads both as the one Offshore wind export cables and sites category, so the rulesets' "Offshore Wind Sites" and "Wind Export Cables" conditions match them.

Corporate joint committees (Wales) is the England and Wales (Post 30 April 2024) ruleset's "Joint Transport Authorities (Wales)": Wales's Corporate Joint Committees hold its regional transport planning duties.

**Railways** is merged nationally by line type and status. "Freight And Passenger - Main Line - Active" is one shape covering the GB network: 115,966 parts and 233,820 points. Being near it is true almost everywhere and every query touching it is slow. The rulesets' "Railways within 10km" condition runs against it as it is, so most projects list the national railway features and long schemes screen more slowly; the general nearby search still leaves Railways out. Splitting it by route or region would fix both.

## Case boundaries

282 boundary submissions across 269 case references, Polygon and MultiPolygon.

- **Size**: under 0.1km² (a single site) to over 17,000km² (offshore wind zones).
- **Detail**: up to 177,585 points (Norwich to Tilbury, a 180km route). Many small sites are over-digitised: Silvertown Tunnel's 0.3km² has 2,536 points, mostly under a metre apart.

Long linear schemes are the heaviest to screen: a 180km route with a 20km radius covers thousands of square kilometres and over 1,000 nearby areas.
