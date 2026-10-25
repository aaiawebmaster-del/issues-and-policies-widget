# GA Policy Note (Netlify)

Proxies the PolicyNote API (`https://data.policynote.com`, docs at `https://data.policynote.com/docs/`) for Auto Care Government Affairs policies. The API key never ships to Sitefinity or the browser.

Auth: the proxy sends the API key as `x-api-key` to `POST /v1/auth/token`, then calls `GET /v1/legislation/search` with the returned 30-minute bearer token (kept in memory and refreshed automatically).

Live site: `https://zingy-macaron-49ae92.netlify.app`

## Endpoints

| Path | Purpose |
|---|---|
| `GET /api/policy-note/health` | Config sanity check (`hasApiKey`, `hasProxyKey`); add `?check=1` to test the API key against PolicyNote |
| `GET /api/policy-note/lookup?bill=` | One bill, normalized + cached in Netlify Blobs |
| `GET /api/policy-note/lookup?bill=&raw=1` | The matched PolicyNote record next to the normalized result (uncached) — use it to check `lib/normalize.mjs` |
| `GET /api/policy-note/batch?bills=A\|B\|C` | Up to 50 bills in one call (used by the Sitefinity Policies list + detail templates) |
| `GET /api/policy-note/tariff?ids=` | Tariff tracker: status, key details, current HTS rates and a timeline from the Federal Register and USITC (see below) |
| `/ga-policy-map.js` | Issue / Topic detail map client |
| `/tariff-check.html` | Staff preview for tariff tracking entries (asks for the proxy key, keeps it in the browser session only) |

Header on every call: `x-ga-policy-key: <GA_POLICY_PROXY_KEY>` (required once the key is set).

Add `&refresh=1` to bypass the cache. "Not found" answers are cached for 12 hours; found bills for `POLICY_NOTE_CACHE_TTL_HOURS`.

## Normalized record

```json
{
  "billNumber": "OR HB 4144",
  "policyNoteId": "aRKWyVsy",
  "title": "Official title",
  "shortTitle": "",
  "state": "Oregon",
  "hcKey": "us-or",
  "jurisdiction": "state",
  "jurisdictionLabel": "State/Regional",
  "chamber": "House",
  "session": "2026 Regular Session",
  "status": "In Committee",
  "statusKey": "in-committee",
  "statusValue": 2,
  "statusRaw": "INTRODUCED / Considering",
  "introducedDate": "2026-01-12",
  "lastAction": "Referred to Rules",
  "lastActionDate": "2026-02-03",
  "sponsors": [{ "name": "Jane Doe", "party": "" }],
  "summary": "",
  "officialUrl": "https://...",
  "cachedAt": "2026-10-07T13:00:00.000Z",
  "cache": "hit"
}
```

## Federal Register documents in `lookup` / `batch`

Bill numbers that are a Federal Register identifier are answered from the Federal Register API (no key):
`EO 14257`, `Proc 10896` (or `Proclamation 10896`), `FR 2026-20510`. Executive orders and proclamations come back as
`kind: "executive-order"`; agency notices and rules as `kind: "regulation"` with agencies, publication / effective dates and comment deadline.

## Tariff tracker

`GET /api/policy-note/tariff?ids=EO 14257|EO 14266|HTS 9903.01.25` (or `POST {"ids": "one\nper\nline"}`). Cached 6 hours; `&refresh=1` rebuilds.
The Policy detail template sends the policy's Bill number followed by its **Tariff tracking** field, one entry per line:

| Entry | Meaning |
|---|---|
| `EO 14257`, `Proc 10896`, `FR 2026-20510` | Federal Register documents; the first one is the primary document |
| `HTS 9903.01.25` | Current additional duty for a heading from the USITC HTS API (cached 24 hours) |
| `docket: USTR-2026-0265` | Newest documents filed under a docket |
| `search: "section 301" china` | Newest documents matching a Federal Register search |
| `agency: trade-representative-office-of-united-states` | Limits `search:` lines to an agency (Federal Register agency slug; repeatable) |
| `status: Paused for 90 days` | Shown as the status instead of the computed one |
| `authority: Section 232, Trade Expansion Act of 1962` | Shown instead of the detected legal authority |

Computed status, in order: the `status:` line; **Revoked** / **Superseded** when the primary order's Federal Register notes say so;
**Modified** when a listed, docket or search document is newer than the primary; **Pending** before the effective date; otherwise **In effect**.
The Federal Register does not record court rulings or other ends to a program, so use `status:` for those.

Response: `status`, `keyDetails` (authority, primary document, dates, agencies, latest change), `rates`, `timeline` (newest first,
`relation` = primary / listed / docket / search), `relatedActions` (from the primary order's "See" / "Amended by" / "Revoked by" notes),
`sources`, `warnings` (entries that weren't recognized or found).

## Env vars (Netlify UI → Site configuration → Environment variables)

- `POLICY_NOTE_API_KEY` — the full PolicyNote `key_prod_...` API key (**required**). The older name `POLICY_NOTE_BEARER_TOKEN` also works.
- `GA_POLICY_PROXY_KEY` — shared secret; put the same value in Sitefinity web.config `GaPolicyNoteProxyKey`
- `POLICY_NOTE_BASE_URL` — default `https://data.policynote.com` (an old `api.fiscalnote.com` value is ignored)
- `POLICY_NOTE_CACHE_TTL_HOURS` — default `168`

Redeploy after changing env vars.

## Local

```bash
cd ga-policy-note
npm install
npx netlify dev
```

## Sitefinity

The Policies list / Policy detail templates call `/batch` server-side while the page renders (no publish hook needed).
The old C# publish hook in `sitefinity/` is retired and kept for reference only.
