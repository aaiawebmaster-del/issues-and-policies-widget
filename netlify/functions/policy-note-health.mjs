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
    },
  };

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
