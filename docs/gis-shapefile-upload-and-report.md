# How to add a shapefile to the GIS software and create a report

Operational guidance for NSIP geometry workflows used by Identify Consultees.
Agents should read this when work involves shapefile packaging, Astun GIS upload,
attribute population, or prescribed-consultee report generation.

**GIS software:** [https://pins.astuntechnology.com/](https://pins.astuntechnology.com/)

## Part 1 — Getting the shapefile in the correct format

Received shapefiles arrive as a **zipped folder**.

Before upload, the zip must contain **only** these four files:

- `.dbf`
- `.prj`
- `.shp`
- `.shx`

### Steps

1. Right-click the zipped folder and choose **Extract all** (extract to the current folder).
2. Inspect the extracted files.
3. Keep only the `.dbf`, `.prj`, `.shp`, and `.shx` files.
4. Create a new compressed (zipped) folder containing just those four files:
   - Highlight the four files
   - Right-click → **Send to** → **Compressed (zipped) folder**
5. Use this new zip for upload in Part 2.

## Part 2 — Uploading the shapefile to the GIS software

1. Open [https://pins.astuntechnology.com/](https://pins.astuntechnology.com/) and sign in.
2. Open the **profiles** tab and select **NSIPS**.
3. On the **NSIPs** tab:
   - Select **Upload Site**
   - Enter the site name using this format (full project name; no abbreviations or nicknames):

     `EN010155_Acceptance_Dean Moor Solar Farm`

     Pattern: `{projectCode}_{projectStage}_{fullProjectName}`

   - **Choose File** and select the zip created in Part 1
   - Select **Upload**

After a successful upload, the GIS software zooms to the new red-line boundary.

## Part 3 — Populating the attributes

1. Open the feature editor (pencil) on the NSIP layer.
2. Select **modify**, then manually select the relevant shapefile.
3. Fill attributes in the left-hand column using the **CBOS project page** and own research.
4. Select **save** when complete.

### Attribute formatting guide

| Attribute                         | Format / values                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Project code                      | e.g. `EN010155`                                                                                              |
| Project name                      | `{Project code}_{Project stage}_{Project name}`                                                              |
| Applicant Name                    | e.g. `FVS Dean Moor`                                                                                         |
| Sector / Type                     | See sector type codes below                                                                                  |
| Sub-type (energy projects only)   | Natural Gas; Energy from waste; Solar; Offshore wind; Biomass; Nuclear; Tidal; Hydrogen; Onshore wind; Other |
| Project stage geometry relates to | e.g. Scoping / Acceptance                                                                                    |
| S35 direction                     | Yes / No                                                                                                     |
| Most recent geometry              | **Yes / No** — should be **Yes** when uploading a new shapefile                                              |
| Dates                             | e.g. `26/03/2025`                                                                                            |

### Sector / Type codes

| Sector                 | Type codes                                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Business or Commercial | `BC01` – Office Use; `BC03` – An Industrial Process or Processes; `BC04` – Storage or Distribution of Goods; `BC08` – Leisure                                                               |
| Energy                 | `EN01` – Generating Stations; `EN02` – Electric Lines; `EN03` – Underground Gas Storage Facilities; `EN04` – LNG Facilities; `EN06` – Gas Transporter Pipe-lines; `EN07` – Other Pipe-lines |
| Transport              | `TR01` – Highways; `TR02` – Airports; `TR03` – Harbour Facilities; `TR04` – Railways; `TR05` – Rail Freight Interchanges                                                                    |
| Water                  | `WA01` – Dams and Reservoirs; `WA02` – Transfer of Water Resources                                                                                                                          |
| Waste                  | `WS01` – Hazardous Waste Facilities                                                                                                                                                         |
| Waste Water            | `WW01` – Waste Water Treatment Plants                                                                                                                                                       |

Energy **sub-type** values align with the GIS Tool Styling energy subtype overlays documented in [`AGENTS.md`](../AGENTS.md).

## Part 4 — Generating the report

1. Select the shapefile and click **Create Report**.
2. Choose the preset template for the project.
   - Templates account for APFP Regulations changes.
   - If the applicant started consulting under section 42 of the Planning Act 2008 **before 30 April 2024**, or submitted a scoping request **prior to 30 April 2024**, use the **England or Wales pre-30 April 2024** template (amendments do not apply).
3. Click **Create report**.
   - The UI shows **Generating report**.
   - If the report does not appear within about one minute: **NSIPs** tab → **View reports**.
4. In **View reports**, scroll to the bottom and open the relevant shapefile report (most recent reports are at the bottom). Save it to an appropriate folder.
5. The download contains PDF maps and a spreadsheet with GIS report data.
6. Save the folder to the relevant SharePoint and CBOS folders.

When this is complete, the shapefile is uploaded, the report exists, and information is available to begin the **Prescribed Consultee** list.
