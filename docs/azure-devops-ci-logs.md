# Reading Azure DevOps CI logs

When a PR check fails, work down this ladder — anonymous access to the DevOps project is denied,
so the API needs a token, and local reproduction is the fallback when auth isn't available.

1. **Get the build id** — `gh pr checks <pr>` prints each check's URL; `buildId=N` in the
   `dev.azure.com/planninginspectorate/…` link is the build run.
2. **Fetch the log via the REST API.** A DevOps-resource token is required — a plain ARM token
   (the `az` default) gets a 401. `499b84ac-1321-427f-aa17-267ca6975798` is Azure DevOps's fixed
   resource id:

   ```bash
   TOKEN=$(az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv)
   # per-task results, each with a log id — find the failed task first
   curl -sH "Authorization: Bearer $TOKEN" \
     "https://dev.azure.com/planninginspectorate/2420751a-9599-4d19-8e37-2e8514532e1e/_apis/build/builds/<buildId>/timeline?api-version=7.1"
   # then that task's log text
   curl -sH "Authorization: Bearer $TOKEN" \
     "https://dev.azure.com/planninginspectorate/2420751a-9599-4d19-8e37-2e8514532e1e/_apis/build/builds/<buildId>/logs/<logId>?api-version=7.1"
   ```

   Equivalents: `az rest --resource 499b84ac-1321-427f-aa17-267ca6975798 --url …`, or a PAT
   (`AZURE_DEVOPS_EXT_PAT` for `az devops`, or basic auth on curl). If `az` reports an expired
   token, `az login` again or ask for a PAT.

3. **If auth isn't available at all, reproduce locally.** `.azure/pipelines/pr.yml` lists every
   step the job runs, in order — walk it until the failure reproduces. The usual suspect is
   `npm run test-coverage`: the hard 100% line/function/branch gate in
   `apps/manage/scripts/run-frontend-coverage.mjs` only runs through that script (and the root
   `npm test`), never through plain `node --test` or `npm test --workspace` — so a green unit run
   alone does not prove the gate passes.

   Coverage report tip: the text report truncates the uncovered-lines column and lists only the
   files under threshold, so several files can be failing while the log names just the first. To
   pinpoint a stubborn uncovered **branch** (the report shows a sub-100% figure with no line
   numbers), run the file's test under `NODE_V8_COVERAGE=<dir>` and read the zero-count ranges in
   the emitted JSON.
