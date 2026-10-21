# Deploy checklist — Policy Note proxy + GA Policies widget

## 1. Netlify (`ga-policy-note/` → `zingy-macaron-49ae92.netlify.app`)

1. Build: `npm run build` · Publish: `dist` · Functions: `netlify/functions`
2. Set env vars (never commit secrets), then redeploy:
   - `POLICY_NOTE_API_KEY` (or the older `POLICY_NOTE_BEARER_TOKEN`): the full PolicyNote `key_prod_...` key
   - `GA_POLICY_PROXY_KEY` (generate a long random string)
   - `CONGRESS_API_KEY`: the api.congress.gov key. Federal bill numbers (`H.R. 906`, `S. 123`, or `119 HR 906`) are looked up here instead of PolicyNote. State bills are unchanged.
   - `POLICY_NOTE_BASE_URL` (optional; default `https://data.policynote.com`)
   - `POLICY_NOTE_KEY_ID` (optional): the `key_id` half of the API key, sent as `authentication_token` on app-data calls. Blank = the part of `POLICY_NOTE_API_KEY` before the dot.
   Use **Same value for all deploy contexts** so Production gets the same values.
   Deploys come from GitHub (`aaiawebmaster-del/issues-and-policies-widget`, branch `main`, this folder is the repo root): push to `main` and Netlify builds and bundles the functions. Don't drag-and-drop (it skips the build and `netlify/functions`, so endpoints 404).
   Check: the deploy summary lists the functions, and `/.netlify/functions/policy-note-project` without the key answers 401 (deployed), not 404.
3. Confirm (send header `x-ga-policy-key`):
   - `GET /api/policy-note/health` → `hasApiKey: true`, `hasProxyKey: true`, `hasCongressKey: true`
   - `GET /api/policy-note/health?congress=1` → `congressAuth: "ok"` (Congress.gov accepted `CONGRESS_API_KEY`)
   - `GET /api/congress/bill?bill=H.R.%201` → a federal bill (`source: "congress"`, status, title, `officialUrl` on congress.gov)
   - `GET /api/policy-note/health?check=1` → `policyNoteAuth: "ok"` (PolicyNote accepted the API key) and `appData.status: "ok"` with project / tag counts (the key_id works for app data)
   - `GET /api/policy-note/projects` → every PolicyNote project (formerly "issue") and tag on the account
   - `GET /api/policy-note/lookup?bill=OR%20HB%204144` → normalized record
   - `GET /api/policy-note/lookup?bill=OR%20HB%204144&raw=1` → compare the raw record with `lib/normalize.mjs` and adjust any field paths that come back empty; `appData` shows the bill's projects / tags (or the app-data error)
   - `GET /api/policy-note/batch?bills=OR%20HB%204144|H.R.%20906`
   - `GET /api/policy-note/project?name=ADAS&raw=1` → every bill and regulation in the project. Check:
     - `projects` holds the matched project (an unknown name lands in `missing`, with the account's names in `available`)
     - `meta.legislation.fetch` / `meta.regulations.fetch` show which fetch worked: `v2`, `v1` (fallback) or `search-only` (both failed; rows carry brief search data, error in `errors.*Fetch`)
     - `meta.*.deniedLocalities` lists jurisdictions outside the subscription (e.g. `US`); those are skipped, not fatal
     - `raw.legislation` / `raw.regulations` show the first search row and fetched record, for checking `lib/normalize.mjs`
     - Drop `raw=1` for the cached answer (6 hours in Blobs); `refresh=1` forces a fresh pull. Commas combine projects: `name=ADAS,EPR`
   - `GET /api/policy-note/item?kind=legislation&id=<policyNoteId from the project list>` and `kind=regulation&id=...` → one record (the shared PolicyNote page and regulation cards use this)
4. Timeouts: a project that isn't cached yet pages through PolicyNote (up to 500 bills and 500 regulations, `PROJECT_ITEM_CAP` in `lib/policy-note-client.mjs`). If the first `/project` call times out on a large project, raise the function timeout in Netlify (Site configuration → Functions) or lower the cap; once cached it answers instantly.

## 2. Sitefinity

1. web.config `<appSettings>`:
   - `<add key="GaPolicyNoteProxyKey" value="(same as GA_POLICY_PROXY_KEY)" />`
   - optional `<add key="GaPolicyNoteBaseUrl" value="https://zingy-macaron-49ae92.netlify.app" />`
   (Or set the `PN_PROXY_KEY_DEFAULT` constant at the top of both Policy templates.)
2. Add fields `Common_name` (short text) and `Auto_care_position` (choices) to the Government Affairs type.
3. Paste `Government-affairs-policies-list.cshtml.txt` (list template) and `Government-affairs-policy-detail.cshtml.txt` (detail template).
4. Upload the updated `Government-affairs-widget.css`.
5. Open a Policy with `?gadebug=1` to see the API status per bill.
6. PolicyNote project-driven Issue pages (fields and setup in `Government-affairs-widget-FIELDS.txt`, "PolicyNote projects on Issue pages"):
   - Government Affairs type: add `PolicyNote_project` (short text). Policy type: add `Kind` (choices 1 Legislation, 2 Regulation) and `PolicyNote_ID` (short text).
   - Re-paste every template with the PN shared block (11 files, listed there), plus the new `Government-affairs-pn-item.cshtml.txt` on a new `/all-policies/pn` page.
   - Set `PolicyNote_project` on one Issue and open it with `?gadebug=1`: the project line shows the matched project, legislation / regulation counts, card matches and PolicyNote-only items.

The C# publish hook (`sitefinity/PolicyNotePublishHook.cs.txt`) is no longer required.
