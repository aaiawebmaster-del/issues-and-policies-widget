import { connectBlobs, getCachedValue, isCacheFresh, setCachedValue } from './lib/cache.mjs';
import { assertProxyKey, corsHeaders, errorResponse, jsonResponse } from './lib/http.mjs';
import { listProjects } from './lib/policy-note-client.mjs';

const TTL_HOURS = 6;

/**
 * GET /api/policy-note/projects
 * → { projects: [{ id, name }], tags: [{ id, name }], cachedAt, cache }
 * Projects were "Issues" and tags were "Labels" in older PolicyNote naming.
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

  const refresh = ['1', 'true'].includes(String(event.queryStringParameters?.refresh || '').toLowerCase());
  try {
    if (!refresh) {
      const cached = await getCachedValue('projects');
      if (cached && isCacheFresh(cached, TTL_HOURS)) return jsonResponse(200, { ...cached, cache: 'hit' });
    }
    const { projects, tags } = await listProjects();
    const saved = await setCachedValue('projects', { projects, tags });
    return jsonResponse(200, { ...saved, cache: 'miss' });
  } catch (err) {
    return errorResponse(err);
  }
}
