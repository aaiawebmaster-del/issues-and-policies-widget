import { connectBlobs, getCachedValue, isCacheFresh, setCachedValue } from './lib/cache.mjs';
import { assertProxyKey, corsHeaders, errorResponse, jsonResponse } from './lib/http.mjs';
import { lookupProject } from './lib/policy-note-client.mjs';

const TTL_HOURS = 6;

function flag(event, name) {
  const v = String(event.queryStringParameters?.[name] || '').toLowerCase();
  return v === '1' || v === 'true';
}

/** "ERP, ADAS" and "adas,erp" share one cache entry */
function cacheKey(name) {
  const parts = String(name)
    .split(/[,|;]/)
    .map((s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .sort();
  return `project:${parts.join('+')}`;
}

/**
 * GET /api/policy-note/project?name=ADAS            (commas combine projects: name=ADAS,ERP)
 * → { projects: [{ id, name }], missing: [], legislation: [...], regulations: [...], meta, errors, cachedAt, cache }
 * refresh=1 skips the cache; raw=1 adds the first search / fetch record of each kind (never cached).
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
  const name = String(params.name || params.project || params.projects || '').trim();
  if (!name) return jsonResponse(400, { error: 'name is required (PolicyNote project name; commas combine projects)' });

  try {
    if (flag(event, 'raw')) {
      return jsonResponse(200, { ...(await lookupProject(name, { raw: true })), cache: 'bypass' });
    }
    const key = cacheKey(name);
    if (!flag(event, 'refresh')) {
      const cached = await getCachedValue(key);
      if (cached && isCacheFresh(cached, TTL_HOURS)) return jsonResponse(200, { ...cached, cache: 'hit' });
    }
    const result = await lookupProject(name);
    /* Don't pin a failed upstream answer for 6 hours */
    const failed = Object.keys(result.errors || {}).some((k) => !k.endsWith('Fetch')) || !result.projects.length;
    const saved = failed ? result : await setCachedValue(key, result);
    return jsonResponse(200, { ...saved, cache: failed ? 'skip' : 'miss' });
  } catch (err) {
    return errorResponse(err);
  }
}
