# Function (Python)

A Python Azure Function app, kept separate from [apps/function](../function) (Node/TypeScript)
because a single Function App runs one language worker - Node and Python functions can't live in
the same app.

`consultee-areas` runs a real SQL query against the `consultee_area` table (see
[packages/database/src/schema.prisma](../../packages/database/src/schema.prisma)) using
[pymssql](https://pypi.org/project/pymssql/), the same database the rest of this project uses. The
`geometry` column is converted to WKT text with `STAsText()` before being returned, since it can't
be read back over pymssql directly - the same pattern the Node data-access layer
([packages/database/src/geospatial](../../packages/database/src/geospatial)) uses.

## Layout

```
function_app.py            HTTP trigger entry point (required at the app root by Azure Functions)
setup_database/
  db.py                    connection string parsing + pymssql connection params
querying/
  consultee_areas.py       the consultee_area query
```

This mirrors the directory concerns of the `PINS-data-spike` reference this was built from
(`setup_database/`, `querying/`, plus `data_processing/`, `orchestrator/` and `intersector/` for
GeoJSON conversion, writing data, and rule-based screening respectively) - only the two directories
this function actually needs exist so far. Add the others in the same style if/when this function
needs to write geometry data or run rule-based screening, rather than pre-building empty stubs now.

Tests are colocated next to the code they test (`test_db.py` beside `db.py`, etc.), matching this
repo's convention for the TypeScript apps.

## Setup

To set up your local dev environment, in `/apps/function-python`:

* install Python 3.12
* create a virtual environment and install dependencies:
  ```
  python3 -m venv .venv
  source .venv/bin/activate
  pip install -r requirements.txt
  pip install pytest ruff
  ```
* install azure-functions-core-tools with `npm install -g azure-functions-core-tools@4`
* install the azurite storage emulator with `npm install -g azurite`
* start the local database (`docker compose up` from the repo root, see the root README)
* create `local.settings.json` with:
  ```json
  {
    "IsEncrypted": false,
    "Values": {
      "FUNCTIONS_WORKER_RUNTIME": "python",
      "AzureWebJobsStorage": "UseDevelopmentStorage=true",
      "SQL_CONNECTION_STRING": "sqlserver://localhost:1434;database=identify-consultees;user=sa;password=DockerDatabaseP@22word!;trustServerCertificate=true"
    }
  }
  ```
  (match the connection string to whatever's in `packages/database/.env`)

See also [Code and test Azure Functions locally](https://learn.microsoft.com/en-us/azure/azure-functions/functions-develop-local?pivots=programming-language-python).

## Run

* Run `azurite` in a temporary directory somewhere as a storage emulator
* Run `func start` in `apps/function-python` to start the function
* `curl http://localhost:7071/api/consultee-areas` to call it

## Test

* `ruff check .` to lint
* `pytest` to test (from within the activated virtual environment) - the database-backed tests skip
  gracefully if `SQL_CONNECTION_STRING` isn't set or no database is reachable
