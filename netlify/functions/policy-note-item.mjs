import { connectBlobs, getCachedValue, isCacheFresh, setCachedValue } from './lib/cache.mjs';
import { assertProxyKey, corsHeaders, errorResponse, jsonResponse } from './lib/http.mjs';
import { lookupItem, parseKind } from './lib/policy-note-client.mjs';

const TTL_HOURS = 6;

function flag(event, name) {
  const v = String(event.queryStringParameters?.[name] || '').toLowerCase();
  return v === '1' || v === 'true';
}

/**
 * GET /api/policy-note/item?kind=legislation|regulation&id=<PolicyNote id>   (kind=1 / kind=2 also work)
 * → one normalized record (same shape as the items in /project), plus cache: hit | miss
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

  const params = event.queryStringParameters || {};
  const kind = parseKind(params.kind);
  const id = String(params.id || '').trim();
  if (!kind) return jsonResponse(400, { error: 'kind must be legislation (1) or regulation (2)' });
  if (!id || !/^[A-Za-z0-9_.:-]{3,80}$/.test(id)) return jsonResponse(400, { error: 'id is required' });

  const key = `item:${kind}:${id}`;
  try {
    if (!flag(event, 'refresh')) {
      const cached = await getCachedValue(key);
      if (cached && isCacheFresh(cached, TTL_HOURS)) {
        if (cached.notFound) return jsonResponse(404, { error: `No ${kind} found for id "${id}"`, code: cached.code || 'NOT_FOUND', cache: 'hit' });
        return jsonResponse(200, { ...cached, cache: 'hit' });
      }
    }
    try {
      const item = await lookupItem(kind, id);
      const saved = await setCachedValue(key, item);
      return jsonResponse(200, { ...saved, cache: 'miss' });
    } catch (err) {
      if (err.code === 'NOT_FOUND' || err.code === 'NOT_PERMITTED') {
        await setCachedValue(key, { notFound: true, code: err.code });
      }
      throw err;
    }
  } catch (err) {
    return errorResponse(err);
  }
}
