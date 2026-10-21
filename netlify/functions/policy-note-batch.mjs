import { connectBlobs, getCachedLookup, isCacheFresh, setCachedLookup } from './lib/cache.mjs';
import { resolveCongressBill } from './lib/congress.mjs';
import { resolveExecutiveOrder } from './lib/federal-register.mjs';
import { assertProxyKey, corsHeaders, errorResponse, jsonResponse } from './lib/http.mjs';
import { normalizeBillKey } from './lib/normalize.mjs';
import { lookupLegislation } from './lib/policy-note-client.mjs';

const MAX_BILLS = 50;
const CONCURRENCY = 6;

function readBills(event) {
  const params = event.queryStringParameters || {};
  let raw = params.bills || params.bill || '';
  if (!raw && event.body) {
    try {
      const parsed = JSON.parse(event.body);
      raw = Array.isArray(parsed.bills) ? parsed.bills.join('|') : String(parsed.bills || '');
    } catch {
      raw = '';
    }
  }
  const seen = new Set();
  const bills = [];
  for (const part of String(raw).split(/[|\n]/)) {
    const bill = part.trim();
    const key = normalizeBillKey(bill);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    bills.push(bill);
    if (bills.length >= MAX_BILLS) break;
  }
  return bills;
}

async function resolveBill(bill, ttlHours, refresh) {
  const order = await resolveExecutiveOrder(bill, ttlHours, refresh);
  if (order) return order;
  const federal = await resolveCongressBill(bill, ttlHours, refresh);
  if (federal) return federal;
  if (!refresh) {
    const cached = await getCachedLookup(bill);
    if (cached && isCacheFresh(cached, ttlHours)) return { ...cached, cache: 'hit' };
  }
  try {
    const normalized = await lookupLegislation(bill);
    const saved = await setCachedLookup(bill, normalized);
    return { ...saved, cache: 'miss' };
  } catch (err) {
    if (err.code === 'NOT_FOUND' || err.code === 'NOT_PERMITTED') {
      const reason = err.code === 'NOT_PERMITTED' ? 'not-in-subscription' : 'not-found';
      const saved = await setCachedLookup(bill, { billNumber: bill, notFound: true, reason });
      return { ...saved, cache: 'miss' };
    }
    if (err.code === 'CONFIG' || err.code === 'AUTH') throw err;
    return { billNumber: bill, error: err.message || 'Lookup failed', code: err.code || 'ERROR' };
  }
}

/**
 * GET /api/policy-note/batch?bills=OR HB 4144|H.R. 906
 * → { results: { "<normalized bill>": record | { notFound } | { error } }, count, hits, misses }
 */
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

  const bills = readBills(event);
  if (!bills.length) {
    return jsonResponse(400, { error: 'bills is required (pipe-separated)' });
  }

  const ttlHours = process.env.POLICY_NOTE_CACHE_TTL_HOURS || '168';
  const refresh = ['1', 'true'].includes(String(event.queryStringParameters?.refresh || '').toLowerCase());
  const results = {};
  let hits = 0;
  let misses = 0;

  try {
    let next = 0;
    const worker = async () => {
      while (next < bills.length) {
        const bill = bills[next++];
        const entry = await resolveBill(bill, ttlHours, refresh);
        if (entry.cache === 'hit') hits++;
        else misses++;
        results[normalizeBillKey(bill)] = entry;
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, bills.length) }, worker));
  } catch (err) {
    return errorResponse(err);
  }

  return jsonResponse(200, { results, count: bills.length, hits, misses });
}
