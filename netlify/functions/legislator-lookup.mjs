import { connectBlobs, getCachedValue, isCacheFresh, setCachedValue } from './lib/cache.mjs';
import { geocodeAddress } from './lib/geocode.mjs';
import { corsHeaders, errorResponse, jsonResponse } from './lib/http.mjs';
import { groupLawmakers, peopleAt } from './lib/openstates.mjs';

/**
 * GET /api/legislators?street=&city=&state=&zip=   (street plus a ZIP, or street plus city and state)
 * GET /api/legislators?lat=&lng=                   (browser geolocation)
 *
 * Public: the browser calls it directly, so it can't carry GA_POLICY_PROXY_KEY.
 * Only origins in LEGISLATOR_ALLOWED_ORIGINS (comma-separated) may call it. Addresses are never stored or logged;
 * results are cached by coordinates rounded to 4 decimals (about 11 m).
 */

const TTL_HOURS = 24 * 7;
const DEFAULT_ORIGINS = ['https://www.autocare.org', 'https://autocare.org', 'http://127.0.0.1:8770', 'http://localhost:8888'];
const MAX_FIELD = 120;

function text(value) {
  return value == null ? '' : String(value).trim();
}

function allowedOrigins() {
  const raw = text(process.env.LEGISLATOR_ALLOWED_ORIGINS);
  return raw ? raw.split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean) : DEFAULT_ORIGINS;
}

/** Origin header, or the origin of the Referer when a browser leaves Origin off a same-site GET */
function requestOrigin(event) {
  const h = event.headers || {};
  const origin = text(h.origin || h.Origin);
  if (origin) return origin.replace(/\/$/, '');
  const referer = text(h.referer || h.Referer);
  try {
    return referer ? new URL(referer).origin : '';
  } catch {
    return '';
  }
}

function headersFor(origin) {
  return { ...corsHeaders(), 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Cache-Control': 'no-store' };
}

function badRequest(message) {
  const err = new Error(message);
  err.code = 'BAD_REQUEST';
  return err;
}

function parseInput(q) {
  const lat = Number(q.lat);
  const lng = Number(q.lng);
  if (text(q.lat) || text(q.lng)) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 17 || lat > 72 || lng < -180 || lng > -64) {
      throw badRequest('That location is outside the United States.');
    }
    return { lat, lng };
  }

  const street = text(q.street);
  const city = text(q.city);
  const state = text(q.state).toUpperCase();
  const zip = text(q.zip);
  if (!street) throw badRequest('Enter your street address.');
  if ([street, city].some((v) => v.length > MAX_FIELD)) throw badRequest('That address is too long.');
  if (state && !/^[A-Z]{2}$/.test(state)) throw badRequest('Choose a state.');
  if (zip && !/^\d{5}(-?\d{4})?$/.test(zip)) throw badRequest('Enter a 5-digit ZIP code.');
  if (!zip && !(city && state)) throw badRequest('Enter your ZIP code, or your city and state.');
  return { street, city, state, zip };
}

export async function handler(event) {
  const origin = requestOrigin(event);
  const allowed = allowedOrigins().includes(origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: allowed ? 204 : 403, headers: allowed ? headersFor(origin) : corsHeaders(), body: '' };
  }
  if (!allowed) return jsonResponse(403, { error: 'This lookup only works on autocare.org.', code: 'FORBIDDEN' });
  const headers = headersFor(origin);
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Use GET', code: 'BAD_REQUEST' }, headers);

  try {
    const input = parseInput(event.queryStringParameters || {});
    let location = { matchedAddress: '', state: '' };
    let { lat, lng } = input;
    if (lat == null) {
      const geo = await geocodeAddress(input);
      ({ lat, lng } = geo);
      location = { matchedAddress: geo.matchedAddress, state: geo.state };
    }

    connectBlobs(event);
    const key = `lawmakers:${lat.toFixed(4)},${lng.toFixed(4)}`;
    let entry = await getCachedValue(key);
    let cache = 'hit';
    if (!entry || !isCacheFresh(entry, TTL_HOURS)) {
      const grouped = groupLawmakers(await peopleAt(lat, lng));
      entry = await setCachedValue(key, grouped);
      cache = 'miss';
    }

    const count = [...entry.federal, ...entry.state.groups].reduce((n, g) => n + g.people.length, 0);
    return jsonResponse(200, {
      location,
      federal: entry.federal,
      state: entry.state,
      count,
      cache,
      cachedAt: entry.cachedAt,
    }, headers);
  } catch (err) {
    const res = errorResponse(err);
    res.headers = { ...res.headers, ...headers };
    return res;
  }
}
