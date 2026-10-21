import { resolveCongressBill } from './lib/congress.mjs';
import { connectBlobs } from './lib/cache.mjs';
import { assertProxyKey, corsHeaders, jsonResponse } from './lib/http.mjs';
import { checkAppData, checkAuth, getApiKey, getBaseUrl } from './lib/policy-note-client.mjs';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  const auth = assertProxyKey(event);
  if (!auth.ok) return auth.response;

  const hasApiKey = Boolean(getApiKey());
  const hasProxyKey = Boolean(String(process.env.GA_POLICY_PROXY_KEY || '').trim());
  const body = {
    ok: true,
    hasApiKey,
    hasBearer: hasApiKey,
    hasProxyKey,
    hasCongressKey: Boolean(String(process.env.CONGRESS_API_KEY || '').trim()),
    baseUrl: getBaseUrl(),
    endpoints: {
      lookup: '/api/policy-note/lookup?bill=',
      raw: '/api/policy-note/lookup?bill=&raw=1',
      batch: '/api/policy-note/batch?bills=A|B|C',
      projects: '/api/policy-note/projects',
      project: '/api/policy-note/project?name=ADAS  (commas combine projects; refresh=1, raw=1)',
      item: '/api/policy-note/item?kind=legislation|regulation&id=',
      health: '/api/policy-note/health',
      authCheck: '/api/policy-note/health?check=1',
      congress: '/api/congress/bill?bill=H.R. 906',
    },
  };

  /* ?congress=1 asks Congress.gov for H.R. 1 of the current congress, to prove CONGRESS_API_KEY works */
  if (['1', 'true'].includes(String(event.queryStringParameters?.congress || '').toLowerCase())) {
    connectBlobs(event);
    try {
      const sample = await resolveCongressBill('H.R. 1', '1', true);
      body.congressAuth = sample && !sample.notFound ? 'ok' : 'failed';
      if (sample && sample.notFound) body.congressError = 'H.R. 1 was not found';
    } catch (err) {
      body.ok = false;
      body.congressAuth = 'failed';
      body.congressError = err.message;
    }
  }

  /* ?check=1 trades the API key for a token to prove PolicyNote accepts it */
  if (['1', 'true'].includes(String(event.queryStringParameters?.check || '').toLowerCase())) {
    try {
      await checkAuth();
      body.policyNoteAuth = 'ok';
    } catch (err) {
      body.ok = false;
      body.policyNoteAuth = 'failed';
      body.authError = { message: err.message, code: err.code || 'ERROR', status: err.status || null, details: err.details || null };
    }
    if (body.policyNoteAuth === 'ok') {
      try {
        body.appData = { status: 'ok', ...(await checkAppData()) };
      } catch (err) {
        body.appData = { status: 'failed', message: err.message, code: err.code || 'ERROR', status_code: err.status || null, details: err.details || null };
      }
    }
  }

  return jsonResponse(body.ok ? 200 : 502, body);
}
