/** US Census Geocoder (free, no key): one US street address -> matched address + lat/lng */

const CENSUS_URL = 'https://geocoding.geo.census.gov/geocoder/locations/address';
const TIMEOUT_MS = 10000;

function text(value) {
  return value == null ? '' : String(value).trim();
}

function fail(code, message, status) {
  const err = new Error(message);
  err.code = code;
  if (status) err.status = status;
  return err;
}

export async function geocodeAddress({ street, city, state, zip }) {
  const params = new URLSearchParams({ street: text(street), benchmark: 'Public_AR_Current', format: 'json' });
  if (text(city)) params.set('city', text(city));
  if (text(state)) params.set('state', text(state));
  if (text(zip)) params.set('zip', text(zip));

  let res;
  try {
    res = await fetch(`${CENSUS_URL}?${params}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'AutoCare-GovernmentAffairs/1.0 (lawmaker lookup)' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw fail('UPSTREAM', `Address lookup failed: ${err.message}`);
  }
  if (!res.ok) throw fail('UPSTREAM', `Address lookup returned HTTP ${res.status}`, res.status);

  const body = await res.json().catch(() => null);
  const match = body?.result?.addressMatches?.[0];
  const lat = Number(match?.coordinates?.y);
  const lng = Number(match?.coordinates?.x);
  if (!match || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw fail('NOT_FOUND', 'We could not find that address. Check the street address and ZIP code, then try again.');
  }
  return {
    lat,
    lng,
    matchedAddress: text(match.matchedAddress),
    state: text(match.addressComponents?.state).toUpperCase(),
  };
}
