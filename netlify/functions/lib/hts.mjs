import { getCachedValue, isCacheFresh, setCachedValue } from './cache.mjs';

const HTS_TTL_HOURS = 24;

function text(value) {
  return value == null ? '' : String(value).trim();
}

/** "HTS 9903.01.25", "9903.01.25", "9903.01.25.00" -> "9903.01.25"; anything else -> "" */
export function parseHtsHeading(raw) {
  const m = text(raw).replace(/^HTS(?:US)?\s*/i, '').match(/^(\d{4})\.?(\d{2})\.?(\d{2})(?:\.?\d{2})?$/);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : '';
}

/** "The duty provided in the applicable subheading + 10%" -> "+10%"; "...plus 25%" -> "+25%" */
export function additionalRate(general) {
  const s = text(general);
  const plus = s.match(/(?:\+|plus)\s*(\d+(?:\.\d+)?)\s*%/i);
  if (plus) return `+${plus[1]}%`;
  const flat = s.match(/^(\d+(?:\.\d+)?)\s*%$/);
  if (flat) return `${flat[1]}%`;
  if (/^free$/i.test(s)) return 'Free';
  return '';
}

async function fetchHeading(heading) {
  const res = await fetch(`https://hts.usitc.gov/reststop/search?keyword=${encodeURIComponent(heading)}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'AutoCare-GovernmentAffairs/1.0 (policy widget)' },
  });
  if (!res.ok) {
    const err = new Error(`USITC HTS returned HTTP ${res.status}`);
    err.code = 'UPSTREAM';
    err.status = res.status;
    throw err;
  }
  const rows = await res.json();
  return (Array.isArray(rows) ? rows : []).find((row) => text(row.htsno) === heading) || null;
}

/** Current duty text for one Chapter 99 (or any) heading, cached for a day */
export async function lookupHeading(heading, refresh) {
  const key = `hts:${heading}`;
  if (!refresh) {
    const cached = await getCachedValue(key);
    if (cached && isCacheFresh(cached, HTS_TTL_HOURS)) return cached;
  }
  const row = await fetchHeading(heading);
  const record = row
    ? {
        heading,
        rate: additionalRate(row.general),
        general: text(row.general),
        special: text(row.special),
        description: text(row.description).replace(/\s+/g, ' '),
        url: `https://hts.usitc.gov/search?query=${encodeURIComponent(heading)}`,
        found: true,
      }
    : { heading, found: false, url: `https://hts.usitc.gov/search?query=${encodeURIComponent(heading)}` };
  return setCachedValue(key, record);
}
