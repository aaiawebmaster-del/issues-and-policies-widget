export function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-ga-policy-key',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}

export function jsonResponse(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

export function errorResponse(err) {
  const code = err.code || 'ERROR';
  if (code === 'CONFIG') return jsonResponse(500, { error: err.message, code });
  if (code === 'BAD_REQUEST') return jsonResponse(400, { error: err.message, code });
  if (code === 'NOT_FOUND') return jsonResponse(404, { error: err.message, code, details: err.details || null });
  if (code === 'NOT_PERMITTED') {
    return jsonResponse(404, { error: 'This jurisdiction is not included in the PolicyNote API subscription', code, details: err.details || null });
  }
  if (code === 'AUTH') {
    return jsonResponse(502, {
      error: err.message,
      code,
      status: err.status || null,
      details: err.details || null,
      hint: 'Check that POLICY_NOTE_API_KEY in Netlify is the full key_prod... value (key.secret format), then redeploy.',
    });
  }
  if (code === 'UPSTREAM') {
    return jsonResponse(502, { error: err.message, code, status: err.status || null, details: err.details || null });
  }
  return jsonResponse(500, { error: err.message || 'Lookup failed', code });
}

/**
 * Require x-ga-policy-key when GA_POLICY_PROXY_KEY is configured.
 */
export function assertProxyKey(event) {
  const expected = String(process.env.GA_POLICY_PROXY_KEY || '').trim();
  if (!expected) return { ok: true };
  const provided = String(
    event.headers?.['x-ga-policy-key'] ||
      event.headers?.['X-Ga-Policy-Key'] ||
      '',
  ).trim();
  if (provided && provided === expected) return { ok: true };
  return { ok: false, response: jsonResponse(401, { error: 'Unauthorized' }) };
}
