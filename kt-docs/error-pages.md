# Error pages and how to trigger them

Every error the manage app can put in front of a user, what correct looks like, and how to make it happen - for manual QA. The same templates have automated coverage in `apps/manage/src/app/pages.a11y.test.ts` and `apps/manage/e2e/`; this page is about seeing them for real.

Two handlers render these pages, which is why two slightly different pages exist:

- Errors thrown inside the app's routes go through the sanitising handler (`apps/manage/src/app/error-handler.ts`): the real error is logged and `views/errors/500.njk` renders with generic copy. Internal detail - file paths, query text, the error's message - must never reach the page.
- Unmatched routes, and failures in middleware that runs before routing (CSRF, body parsing, the session store), go through `@planning-inspectorate/core`'s default handler, which renders `views/layouts/error.njk` with a short message.

All of them share `views/layouts/error.njk`, so the header, service navigation and footer should look exactly like a normal page, ending in the "Contact IT if you continue to have problems with this service" block.

## Error pages you can open with a URL

| To see           | Visit                                              | Status | Expected copy                                                                                                                                         |
| ---------------- | -------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page not found   | `/this-page-does-not-exist` (any unmatched path)   | 404    | "Page not found", then "If you typed the web address, check it is correct." and "If you pasted the web address, check you copied the entire address." |
| Record not found | `/consultees/99999999-9999-9999-9999-999999999999` | 404    | The same "Page not found" page, rendered by the route itself                                                                                          |
| Login problem    | `/unauthenticated`                                 | 401    | "Sorry, there is a problem with your login" + "Try again later."                                                                                      |
| Firewall block   | `/error/firewall-error`                            | 200    | "Sorry, there is a problem with the service" + "We have not saved your answers. …"                                                                    |
| Signed out       | `/signed-out`                                      | 200    | "You have signed out" + "Sign in again" - a terminal state rather than an error, but part of the same pass                                            |

`/unauthenticated` and `/signed-out` mount before the sign-in guard, so they work signed out. `/error/firewall-error` and `/consultees/*` need a session on environments where auth is on - fine for the firewall page, since a WAF redirect happens mid-session.

The real-world causes: an unmatched 404 is any mistyped URL; a record 404 is a bad or stale case link; a failed MSAL sign-in lands on `/unauthenticated`; Front Door redirects requests its managed rules block to `/error/firewall-error` (`infrastructure/front-door.tf`).

## Dev-only error pages

The dev pages mount only while `devPagesEnabled` is on - always locally (`NODE_ENV` not `production`), or on a deployed environment with `ENABLE_DEV_PAGES=true` (`config.ts`). They sit behind the sign-in guard like the service's own pages, and are not part of the service:

| To see         | Visit                         | Status | Expected copy                                                                                                                                                                |
| -------------- | ----------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scenario index | `/error-test`                 | 200    | "Error scenarios" - an index linking to each reproducible error state                                                                                                        |
| Rendered 401   | `/error-test/401`             | 401    | "Sorry, there is a problem with your login" - the real template, for checking without a failed sign-in                                                                       |
| Rendered 403   | `/error-test/403`             | 403    | "Sorry, there is a problem with your login" + "You are not permitted to access this URL." - the real template; the real trigger still needs the environment (see below)      |
| Rendered 404   | `/error-test/404`             | 404    | "Page not found" - the real template                                                                                                                                         |
| Sanitised 500  | `/error-test/500`             | 500    | "Sorry, there is a problem with the service" + "Try again later." The route throws on purpose - check the error's message does **not** appear; full detail stays in the logs |
| Dev-page 404   | `/components/not-a-component` | 404    | "Page not found"                                                                                                                                                             |

On an environment without `ENABLE_DEV_PAGES`, `/error-test` and `/components` should themselves 404 - worth checking once on a deployed environment to prove the flag works.

## Forced failure triggers (temporary, for QA)

The `?test-fail=` triggers (`apps/manage/src/app/views/consultees/test-faults.ts`) force the in-journey error states that would otherwise need a real backend outage. They are on everywhere except the prod deployment (`ENVIRONMENT !== 'prod'` - `Config.testFaultsEnabled`; test and training run `NODE_ENV=production`, so that alone couldn't gate them).

Add `?test-fail=<fault>` - `&test-fail=<fault>` where the URL already has parameters - to any `/consultees/...` page. `map` and `download` are one-offs: they fail only the request carrying the parameter and nothing is stored. `ruleset` is stored in the session, so the failure persists as the journey is clicked through, like a real outage, until `?test-fail=off` on any `/consultees/...` page clears it (or the session ends). On prod the parameter does nothing.

| Fault      | What fails                              | What shows                                                                                                                                                                                                      |
| ---------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `map`      | The boundary page's map can't be loaded | `/consultees/<case-id>` - "There's a problem loading the map - try again later" as a GOV.UK error message, with a "Try again" link; the shapefile radios still render. That request only - nothing is stored    |
| `ruleset`  | Every ruleset run fails                 | The report check page, category pages and the Report created page - "The ruleset could not be run" with a "Try again" link                                                                                      |
| `download` | The report ZIP can't be built           | `/consultees/<case-id>/report/created` - "Report could not be created" on a red panel with "The scoping report could not be downloaded - try again" and no download link. That request only - nothing is stored |

### Boundary map failure (AC5)

1. Sign in and open a project's boundary page with the fault: `/consultees/<case-id>?test-fail=map`
   - Expected: the "There's a problem loading the map - try again later" GOV.UK error message in place of the map; the "Confirm shapefile for report" radios still render.
2. The fault is per-request - nothing is stored. Reload the page (or click "Try again", which is the page URL without the parameter) and the map loads again.
3. For the ruleset-run variant (the intersector itself failing for the selected ruleset): `/consultees/<case-id>/report?ruleset=england-wales-post-20240430&test-fail=ruleset`
   - Expected: "The ruleset could not be run" banner; the "Try again" link keeps the selected project and ruleset parameters. The same fault also fails the category pages, the Report created page and the report's static maps, as a real screening outage would.

### Report download failure (AC6)

1. Walk the journey to the Report created page and add the fault: `/consultees/<case-id>/report/created?ruleset=england-wales-post-20240430&test-fail=download`
   - Expected: the panel is red, titled "Report could not be created", with "The scoping report could not be downloaded - try again" and no download link.
2. The fault is per-request - nothing is stored. Reload the created page without the parameter and the link returns; the ZIP downloads.
3. The real-world equivalent: the link only appears once the page has built the ZIP successfully; a download that fails on click sends the user back here with `download=failed`, which shows the same red-panel error.

Expected on prod: `?test-fail=` parameters are ignored and every page behaves normally.

## Errors that need a request, not just a URL

### CSRF failure

Every POST needs the `_csrf` token the forms carry in a hidden input. To see what happens without one:

```bash
# no token at all
curl -i -X POST https://<host>/consultees/<case-id>/ruleset

# a wrong token
curl -i -X POST -d "_csrf=wrong" https://<host>/consultees/<case-id>/ruleset
```

Or in the browser: open any form (the ruleset radios will do), delete the `_csrf` hidden input in DevTools, and submit - the realistic path, e.g. a stale form after a long pause. With dev pages on, the `/error-test` index's "Submit without a token" / "Submit with a token" buttons do the same thing one click each.

Expected: HTTP 500 (lusca marks the response 403 internally, but the default handler that renders the page issues 500), the "Sorry, there was an error" page showing "CSRF token missing" or "CSRF token mismatch", then "Try again later". The message being visible is expected here - this is the pre-router pipeline, not the sanitised 500.

### Rate limiting

Two limiters, both plain-text 429s from `express-rate-limit` rather than branded pages: `/auth/*` at 100 requests per 15 minutes, and the static-asset/`/vendor/*` mounts at 1000. The auth one only exists when auth is on (`AUTH_DISABLED` unset), so this is a deployed-environment check:

```bash
for i in $(seq 105); do curl -s -o /dev/null https://<host>/auth/signin; done
```

Expected: HTTP 429, body "Too many requests, please try again later." Run it against a test environment, not one other people are using. With dev pages on, `/error-test/rate-limited` shows the same plain-text 429 after three refreshes, no scripting needed.

### Malformed body

```bash
curl -i -X POST -H 'content-type: application/json' -d '{' https://<host>/
```

Expected: HTTP 400 and the default-handler error page showing the parser's message. body-parser fails before CSRF, so the CSRF check never runs.

## Errors that need the environment

- **403 group access** - real trigger only: on an auth-enabled environment, sign in with an Entra account that is not in the `AUTH_GROUP_APPLICATION_ACCESS` group. Expected: 403, "Sorry, there is a problem with your login" + "You are not permitted to access this URL." No URL simulates the guard itself; the template can be viewed via `/error-test/403` (dev pages) and is covered by `pages.a11y.test.ts`.
- **Session store down** - sessions run in memory locally (`MANAGED_REDIS_URL` unset), so point it at an unreachable Redis and restart, or catch a real Redis outage on a deployed environment. Expected: 500, "The service is not ready. Please try again in a moment." (the Redis error is wrapped, never shown raw).
- **Database down** - `docker stop identify-consultees-mssql` locally. `/` still renders with an empty project list (the search degrades rather than erroring); pages that need the database show "Request could not be handled (code: …)" or "Connection error (code: P1001)".
- **Real WAF block** - on a deployed environment, a request Front Door's managed rules score as an attack is redirected to `/error/firewall-error`. Plain JSON in a query string is the known example - it's why the report URLs base64url-encode theirs.

## What to check on every error page

- The HTTP status matches the table above - use `curl -i` or dev tools; a "Page not found" body served with a 200 is a bug.
- The copy matches, and on the sanitised 500 nothing internal leaks: no error message, stack, file paths or query text.
- Header, service navigation and footer render normally, and the "Contact IT if you continue to have problems with this service" block is there.
- On deployed environments without `ENABLE_DEV_PAGES`, the dev-only routes 404 like any other unmatched path.
