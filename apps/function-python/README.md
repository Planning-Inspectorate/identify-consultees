# Function (Python)

The `pins-func-consultees-orchestrator-*` Function App ([`infrastructure/app-function.tf`](../../infrastructure/app-function.tf)). It runs the screening against our database, and reads case boundaries from CBOS, the back office.

| Route | What |
| ----- | ---- |
| `GET /api/health` | Checks it can reach our database. No key needed |
| `POST /api/run-ruleset` | Screens a site against a ruleset: the consultees and why each qualifies |
| `GET /api/consultee-areas` | A sample of `consultee_area` rows. The manage app's `PYTHON_FUNCTION_URL` names this route, and the others are found beside it |
| `GET /api/cbos/health` | Checks it can reach CBOS's database and document storage |
| `GET /api/cbos/boundary-files[/{guid}/{version}]` | CBOS's case boundaries, and one's GeoJSON, for the boundary import |
| `GET /api/cbos/gis-files[/{guid}/{version}]` | Every file in CBOS's GIS Shapefiles folders, for debugging the import |

Every route but `health` needs the `x-api-key` header to match `CONSULTEE_AREAS_API_KEY`, the same value as the manage app's `PYTHON_FUNCTION_API_KEY`. Without the setting, those routes refuse to serve (500). CBOS is reached as the app's managed identity, or locally as whoever is signed in to the Azure CLI; see [`cbos/config.py`](./cbos/config.py) for its settings.

## Layout

```
function_app.py     the HTTP routes (Azure Functions needs it at the root)
intersector/        the screening: start at run_ruleset in screening.py, whose SQL is in queries.py
cbos/               reading CBOS's database and blob storage
setup_database/     connecting to our database; sample_data/ is what `npm run db-seed` loads
querying/           the consultee-areas query
```

Tests sit beside the code they test (`test_screening.py` beside `screening.py`).

## Run and test

`npm start` from the repo root sets up the virtual environment and a local API key, and runs the function with the web app. By hand, in this folder:

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt pytest ruff
func start                                  # needs local.settings.json, below
curl http://localhost:7071/api/health
ruff check . && pytest                      # database tests skip without SQL_CONNECTION_STRING
```

`local.settings.json` (not committed; match the connection string to `packages/database/.env`):

```json
{
  "IsEncrypted": false,
  "Values": {
    "FUNCTIONS_WORKER_RUNTIME": "python",
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "SQL_CONNECTION_STRING": "sqlserver://localhost:1434;database=identify-consultees;user=sa;password=DockerDatabaseP@22word!;trustServerCertificate=true",
    "CONSULTEE_AREAS_API_KEY": "any-local-shared-secret"
  }
}
```

How the screening works: [`kt-docs/screening-service.md`](../../kt-docs/screening-service.md) and [`kt-docs/data/screening-engine.md`](../../kt-docs/data/screening-engine.md).
