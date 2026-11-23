# Contracts

Fixtures that pin the JSON contract between the manage app and the Python
function — the boundary where the two deployables can silently drift apart,
because the app's tests all run against its own stub (`src/app/testing/`), and
the function's tests never see the app's requests.

Each directory holds a canonical `request.json` / `response.json` pair. Both
sides' contract tests pin to the same files:

- `apps/manage/src/app/ruleset-runner.test.ts` asserts the app posts exactly
  the request fixture and maps the response fixture;
- `apps/function-python/test_run_ruleset_contract.py` asserts the function
  parses the request fixture and produces the response fixture.

Changing the wire format means changing the fixture — which fails whichever
side no longer speaks it. See `kt-docs/screening-service.md` for the semantics
behind the fields.
