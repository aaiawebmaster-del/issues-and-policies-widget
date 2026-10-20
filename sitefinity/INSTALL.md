# Sitefinity — Policy Note publish hook (RETIRED)

> Retired Oct 2026. The Policies list and Policy detail templates now look bills up through `/api/policy-note/batch` while the page renders, so no C# deploy is needed. Kept for reference only.

On Policy publish, if `Bill_number` is set, call the Netlify lookup API and write:

- `region` ← state name
- `Bill_status` ← choice value (1–7)
- `Policy_page` ← official URL (when the field accepts a string URL; adjust for Link field type)

If `Bill_number` is empty, leave those fields alone (manual entry).

## Install

1. Deploy `ga-policy-note` to Netlify and set env secrets.
2. Add app settings / web.config keys (or Sitefinity config):
   - `GaPolicyNoteLookupUrl` = `https://YOUR-SITE.netlify.app/api/policy-note/lookup`
   - `GaPolicyNoteProxyKey` = same as `GA_POLICY_PROXY_KEY`
3. Add [`PolicyNotePublishHook.cs.txt`](PolicyNotePublishHook.cs.txt) to your Sitefinity web app (rename to `.cs`), adjust the dynamic content type full name if needed (`Telerik.Sitefinity.DynamicTypes.Model.Governmentaffairs.Governmentaffair` is a placeholder — use your actual type).
4. Build/deploy the Sitefinity site.
5. Publish a Policy with only Bill Number and confirm region/status/URL populate.

## Notes

- Link fields (`Policy_page`) may need Sitefinity LinkModel assignment instead of a plain string — adapt `TrySetPolicyPage` for your SF version.
- Choice fields: writing the numeric value (1–7) usually works; if not, set the choice text label.
- Re-publish refreshes from Policy Note (no manual override when Bill Number is present).
