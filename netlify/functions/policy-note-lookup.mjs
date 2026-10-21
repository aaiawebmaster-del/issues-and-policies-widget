import { connectBlobs, getCachedLookup, isCacheFresh, setCachedLookup } from './lib/cache.mjs';
import { isFederalBill, resolveCongressBill } from './lib/congress.mjs';
import { isExecutiveOrder, resolveExecutiveOrder } from './lib/federal-register.mjs';
import { assertProxyKey, corsHeaders, errorResponse, jsonResponse } from './lib/http.mjs';
import { normalizeLegislationRecord } from './lib/normalize.mjs';
import { fetchAppData, lookupLegislation, normalizeAppData, searchLegislation } from './lib/policy-note-client.mjs';

function readBillNumber(event) {
  const params = event.queryStringParameters || {};
  if (params.bill || params.billNumber || params.q) {
    return String(params.bill || params.billNumber || params.q).trim();
  }
  if (!event.body) return '';
  try {
    const parsed = JSON.parse(event.body);
    return String(parsed.bill || parsed.billNumber || parsed.q || '').trim();
  } catch {
    return '';
  }
}

function flag(event, name) {
  const v = String(event.queryStringParameters?.[name] || '').toLowerCase();
  return v === '1' || v === 'true';
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const auth = assertProxyKey(event);
  if (!auth.ok) return auth.response;

  connectBlobs(event);

  const billNumber = readBillNumber(event);
  if (!billNumber) {
    return jsonResponse(400, { error: 'billNumber is required' });
  }

  try {
    /* Matched PolicyNote record plus the normalized result, for checking normalize.mjs */
    if (flag(event, 'raw')) {
      const { record, matched, query } = await searchLegislation(billNumber);
      let appData = null;
      try {
        const { raw, rows } = await fetchAppData(record.id);
        appData = { rows, normalized: normalizeAppData(raw), raw };
      } catch (err) {
        appData = { error: err.message, code: err.code || 'ERROR', status: err.status || null, details: err.details || null };
      }
      return jsonResponse(200, { bill: billNumber, matched, query, normalized: normalizeLegislationRecord(record, billNumber), appData, record });
    }

    const ttlHours = process.env.POLICY_NOTE_CACHE_TTL_HOURS || '168';
    if (isExecutiveOrder(billNumber)) {
      const order = await resolveExecutiveOrder(billNumber, ttlHours, flag(event, 'refresh'));
      if (order && order.notFound) {
        return jsonResponse(404, { error: `No executive order found for "${billNumber}"`, code: 'NOT_FOUND', cache: order.cache || 'miss' });
      }
      return jsonResponse(200, order);
    }
    if (isFederalBill(billNumber)) {
      const federal = await resolveCongressBill(billNumber, ttlHours, flag(event, 'refresh'));
      if (federal && federal.notFound) {
        return jsonResponse(404, { error: `No federal bill found for "${billNumber}"`, code: 'NOT_FOUND', cache: federal.cache || 'miss' });
      }
      return jsonResponse(200, federal);
    }
    if (!flag(event, 'refresh')) {
      const cached = await getCachedLookup(billNumber);
      if (cached && isCacheFresh(cached, ttlHours)) {
        if (cached.notFound) {
          const notPermitted = cached.reason === 'not-in-subscription';
          return jsonResponse(404, {
            error: notPermitted ? 'This jurisdiction is not included in the PolicyNote API subscription' : `No legislation found for "${billNumber}"`,
            code: notPermitted ? 'NOT_PERMITTED' : 'NOT_FOUND',
            cache: 'hit',
          });
        }
        return jsonResponse(200, { ...cached, cache: 'hit' });
      }
    }

    try {
      const normalized = await lookupLegislation(billNumber);
      const saved = await setCachedLookup(billNumber, normalized);
      return jsonResponse(200, { ...saved, cache: 'miss' });
    } catch (err) {
      if (err.code === 'NOT_FOUND' || err.code === 'NOT_PERMITTED') {
        await setCachedLookup(billNumber, { billNumber, notFound: true, reason: err.code === 'NOT_PERMITTED' ? 'not-in-subscription' : 'not-found' });
      }
      throw err;
    }
  } catch (err) {
    return errorResponse(err);
  }
}
