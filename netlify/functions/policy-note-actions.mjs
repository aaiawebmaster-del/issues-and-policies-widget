import { connectBlobs, getCachedValue, isCacheFresh, setCachedValue } from './lib/cache.mjs';
import { assertProxyKey, corsHeaders, errorResponse, jsonResponse } from './lib/http.mjs';
import { listPublishedActions } from './lib/policy-note-client.mjs';

const TTL_HOURS = 1;

/**
 * GET /api/policy-note/actions?project=Issue name
 * GET /api/policy-note/actions?id=policyNoteId&bill=H.R. 1566
 * Only actions tagged PublishtoAutoCareOrg.
 */
export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const auth = assertProxyKey(event);
  if (!auth.ok) return auth.response;

  connectBlobs(event);

  const project = String(event.queryStringParameters?.project || '').trim();
  const id = String(event.queryStringParameters?.id || '').trim();
  const bill = String(event.queryStringParameters?.bill || '').trim();
  const refresh = ['1', 'true'].includes(String(event.queryStringParameters?.refresh || '').toLowerCase());
  const cacheKey = `actions:${project.toLowerCase()}|${id}|${bill.toLowerCase()}`;

  try {
    if (!refresh) {
      const cached = await getCachedValue(cacheKey);
      if (cached && isCacheFresh(cached, TTL_HOURS)) return jsonResponse(200, { ...cached, cache: 'hit' });
    }
    const result = await listPublishedActions({ projectName: project, id, billNumber: bill });
    if (result.tag === 'missing') return jsonResponse(200, { ...result, cache: 'skip' });
    const saved = await setCachedValue(cacheKey, result);
    return jsonResponse(200, { ...saved, cache: 'miss' });
  } catch (err) {
    return errorResponse(err);
  }
}
