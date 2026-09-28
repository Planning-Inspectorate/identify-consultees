# Node–Python integration

**Status:** Current for the consultee-areas bridge; sparse for broader geo tooling.

## How the UI calls Python

1. Manage config loads optional `PYTHON_FUNCTION_URL` (`apps/manage/src/app/config.ts`)
2. `ManageService` exposes `pythonFunctionUrl`
3. `POST /consultee-areas-python` handler (`buildRunConsulteeAreasPython`) uses `fetch(service.pythonFunctionUrl)`
4. On success, JSON `rows` are passed into the Nunjucks view model
5. On failure or missing URL, the same page re-renders with a user-facing error string

Local default URL: `http://localhost:7071/api/consultee-areas` (Azure Functions Core Tools).

Python side: `apps/function-python` — HTTP trigger reads `consultee_area` via pymssql, returns geometry as WKT text (`STAsText()`), matching Node geospatial patterns.

## Safety / isolation rules

| Rule                            | Practice                                                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Optional dependency             | App boots and serves Track A routes without Python running                                                |
| No hard crash on bridge failure | Catch fetch errors; log; show “Could not reach the Python function.”                                      |
| Missing config                  | If URL unset, do not call fetch; show the same class of error                                             |
| Secrets                         | Connection strings stay in Function `local.settings.json` / Azure app settings — not in browser responses |
| Timeout / abuse                 | Prefer short failures; future work may add explicit fetch timeouts / rate limits on the bridge page       |

## Expected fallback behaviour

> A missing Python environment, stopped Function host, or unavailable database must **not** break the UI.

Concrete expectations:

- `/` and `/consultees/:id` continue to work on fixtures
- `/consultee-areas-python` remains reachable and explains the failure
- Operators diagnose via manage logs + Function logs + SQL container health

## Expanding the bridge

When adding new Python geo endpoints:

1. Add/adjust Function routes under `apps/function-python`
2. Add manage config for the URL (or path suffix) if needed
3. Keep controllers resilient (same try/catch + view-model error pattern)
4. Add unit tests that stub `fetch` and assert no throw when the dependency is down
5. Document the new contract on [API and data contracts](./api-and-data-contracts.md)

## Related pages

- [Local setup](./local-setup.md)
- [Troubleshooting](./troubleshooting.md)
- [`apps/function-python/README.md`](../apps/function-python/README.md)
