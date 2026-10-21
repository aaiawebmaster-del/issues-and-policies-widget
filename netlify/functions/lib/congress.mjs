import { getCachedLookup, isCacheFresh, setCachedLookup } from './cache.mjs';
import { parseBillNumber } from './normalize.mjs';

const TYPE_TO_API = {
  HR: 'hr',
  HB: 'hr',
  S: 's',
  SB: 's',
  HRES: 'hres',
  SRES: 'sres',
  HJRES: 'hjres',
  SJRES: 'sjres',
  HCONRES: 'hconres',
  SCONRES: 'sconres',
};

const TYPE_LABEL = {
  hr: 'H.R.',
  s: 'S.',
  hres: 'H.Res.',
  sres: 'S.Res.',
  hjres: 'H.J.Res.',
  sjres: 'S.J.Res.',
  hconres: 'H.Con.Res.',
  sconres: 'S.Con.Res.',
};

const SLUG = {
  hr: 'house-bill',
  s: 'senate-bill',
  hres: 'house-resolution',
  sres: 'senate-resolution',
  hjres: 'house-joint-resolution',
  sjres: 'senate-joint-resolution',
  hconres: 'house-concurrent-resolution',
  sconres: 'senate-concurrent-resolution',
};

const STATUS = {
  introduced: { status: 'Introduced', statusKey: 'introduced', statusValue: 1 },
  'in-committee': { status: 'In Committee', statusKey: 'in-committee', statusValue: 2 },
  'on-floor': { status: 'On Floor', statusKey: 'on-floor', statusValue: 3 },
  'passed-one': { status: 'Passed One Chamber', statusKey: 'passed-one', statusValue: 4 },
  'passed-both': { status: 'Passed Both Chambers', statusKey: 'passed-both', statusValue: 5 },
  enacted: { status: 'Enacted', statusKey: 'enacted', statusValue: 6 },
  failed: { status: 'Failed / Vetoed', statusKey: 'failed', statusValue: 7 },
};

function text(value) {
  return value == null ? '' : String(value).trim();
}

function plain(html, max) {
  let s = text(html).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  if (max && s.length > max) s = `${s.slice(0, max - 3).trimEnd()}...`;
  return s;
}

/** Congress in session on this date. A congress begins January 3 of each odd year. */
export function currentCongress(date = new Date()) {
  let year = date.getUTCFullYear();
  if (date.getUTCMonth() === 0 && date.getUTCDate() < 3) year -= 1;
  return Math.floor((year - 1789) / 2) + 1;
}

function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  if (n % 10 === 1) return `${n}st`;
  if (n % 10 === 2) return `${n}nd`;
  if (n % 10 === 3) return `${n}rd`;
  return `${n}th`;
}

/**
 * A federal bill the editor typed, with no state prefix.
 * "H.R. 906", "HR 906", "S. 1379", "119 HR 906" → Congress.gov parts.
 * "OR HB 4144" is a state bill and returns null.
 */
export function parseFederalBill(raw) {
  const parsed = parseBillNumber(raw);
  if (parsed.locality && parsed.locality !== 'US') return null;
  let number = parsed.number;
  let congress = null;
  const lead = number.match(/^(\d{3})\s+(.+)$/);
  if (lead && Number(lead[1]) >= 93 && Number(lead[1]) <= 200) {
    congress = Number(lead[1]);
    number = lead[2];
  }
  const trail = number.match(/^(.+?)\s+(\d{3})$/);
  if (!congress && trail && Number(trail[2]) >= 93 && Number(trail[2]) <= 200) {
    congress = Number(trail[2]);
    number = trail[1];
  }
  const match = number.match(/^(HR|HB|S|SB|HRES|SRES|HJRES|SJRES|HCONRES|SCONRES)\s+(\d+)$/);
  if (!match) return null;
  if (!parsed.locality && !TYPE_TO_API[match[1]]) return null;
  const billType = TYPE_TO_API[match[1]];
  const billNumber = String(Number(match[2]));
  if (!billType || billNumber === 'NaN' || billNumber === '0') return null;
  return { congress, billType, billNumber, display: `${TYPE_LABEL[billType]} ${billNumber}` };
}

export function isFederalBill(raw) {
  return parseFederalBill(raw) != null;
}

function congressStatus(bill) {
  const laws = Array.isArray(bill.laws) ? bill.laws : [];
  if (laws.length) return STATUS.enacted;
  const action = text(bill.latestAction && bill.latestAction.text).toLowerCase();
  if (/became public law|became private law|signed by president/.test(action)) return STATUS.enacted;
  if (/veto|failed of passage|motion to recommit|failed/.test(action)) return STATUS.failed;
  if (/presented to president|resolving differences|conference/.test(action)) return STATUS['passed-both'];
  if (/passed house|passed senate|passed\/agreed to in house|passed\/agreed to in senate/.test(action)) return STATUS['passed-one'];
  if (/placed on|calendar|ordered to be reported|rule reported/.test(action)) return STATUS['on-floor'];
  if (/referred to|committee/.test(action)) return STATUS['in-committee'];
  return STATUS.introduced;
}

function sponsorName(person) {
  const full = text(person && person.fullName);
  if (full) return full.replace(/^Rep\.\s+|^Sen\.\s+/i, '');
  const name = [text(person && person.firstName), text(person && person.lastName)].filter(Boolean).join(' ');
  const party = text(person && person.party);
  return name ? (party ? `${name} (${party})` : name) : '';
}

function normalizeCongressBill(bill, requested, summaryHtml) {
  const type = text(bill.type).toLowerCase();
  const congress = Number(bill.congress);
  const number = text(bill.number).replace(/^0+(?=\d)/, '');
  const display = TYPE_LABEL[type] ? `${TYPE_LABEL[type]} ${number}` : text(requested);
  const statusInfo = congressStatus(bill);
  const chamber = /house/i.test(text(bill.originChamber)) || type.startsWith('h') ? 'House' : 'Senate';
  const sponsors = (Array.isArray(bill.sponsors) ? bill.sponsors : [])
    .map((person) => ({ name: sponsorName(person), party: text(person && person.party) }))
    .filter((person) => person.name)
    .slice(0, 5);
  const slug = SLUG[type] || 'house-bill';
    const page = congress && number
    ? `https://www.congress.gov/bill/${ordinal(congress).toLowerCase()}-congress/${slug}/${number}`
    : '';
  const summary = plain(summaryHtml, 1200);

  return {
    kind: 'legislation',
    billNumber: display || text(requested),
    identifier: display || text(requested),
    policyNoteId: '',
    title: text(bill.title) || display,
    shortTitle: text(bill.title),
    state: '',
    hcKey: '',
    jurisdiction: 'national',
    jurisdictionLabel: 'National',
    jurisdictionName: 'US',
    chamber,
    session: congress ? `${ordinal(congress)} Congress` : '',
    status: statusInfo.status,
    statusKey: statusInfo.statusKey,
    statusValue: statusInfo.statusValue,
    statusRaw: text(bill.latestAction && bill.latestAction.text),
    introducedDate: text(bill.introducedDate).slice(0, 10),
    lastAction: plain(bill.latestAction && bill.latestAction.text, 240),
    lastActionDate: text(bill.latestAction && bill.latestAction.actionDate).slice(0, 10),
    sponsors,
    summary: summary.slice(0, 600),
    overview: summary,
    officialUrl: page,
    projects: [],
    tags: [],
    teamPosition: '',
    teamPositionKey: '',
    teamPriority: '',
    teamPriorityKey: '',
    teamSummary: '',
    teamLinks: [],
    cachedAt: new Date().toISOString(),
    source: 'congress',
  };
}

function apiKey() {
  const key = text(process.env.CONGRESS_API_KEY);
  if (!key) {
    const err = new Error('CONGRESS_API_KEY is not set on the proxy');
    err.code = 'CONFIG';
    throw err;
  }
  return key;
}

async function congressGet(path) {
  const url = new URL(`https://api.congress.gov/v3${path}`);
  url.searchParams.set('api_key', apiKey());
  url.searchParams.set('format', 'json');
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (res.status === 404) return null;
  if (res.status === 401 || res.status === 403) {
    const err = new Error('Congress.gov rejected CONGRESS_API_KEY. Confirm the Netlify variable and redeploy.');
    err.code = 'UPSTREAM';
    err.status = res.status;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`Congress.gov returned HTTP ${res.status}`);
    err.code = 'UPSTREAM';
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function fetchCongress(parsed) {
  const congresses = parsed.congress ? [parsed.congress] : [currentCongress(), currentCongress() - 1];
  for (const congress of congresses) {
    const billBody = await congressGet(`/bill/${congress}/${parsed.billType}/${parsed.billNumber}`);
    const bill = billBody && billBody.bill;
    if (!bill) continue;
    let summary = '';
    try {
      const summaryBody = await congressGet(`/bill/${congress}/${parsed.billType}/${parsed.billNumber}/summaries`);
      const rows = summaryBody && Array.isArray(summaryBody.summaries) ? summaryBody.summaries : [];
      const latest = rows.slice().sort((a, b) => text(b.updateDate || b.actionDate).localeCompare(text(a.updateDate || a.actionDate)))[0];
      summary = latest ? latest.text : '';
    } catch {
      summary = '';
    }
    return normalizeCongressBill(bill, parsed.display, summary);
  }
  const err = new Error(`No federal bill found for "${parsed.display}"`);
  err.code = 'NOT_FOUND';
  throw err;
}

/**
 * Federal bills are answered from Congress.gov. Returns null when the bill is not federal
 * so the caller can keep using PolicyNote. Cached PolicyNote misses are not reused.
 */
export async function resolveCongressBill(bill, ttlHours, refresh) {
  if (!isFederalBill(bill)) return null;
  if (!refresh) {
    const cached = await getCachedLookup(bill);
    if (cached && cached.source === 'congress' && isCacheFresh(cached, ttlHours)) {
      return { ...cached, cache: 'hit' };
    }
  }
  try {
    const normalized = await fetchCongress(parseFederalBill(bill));
    const saved = await setCachedLookup(bill, normalized);
    return { ...saved, cache: 'miss' };
  } catch (err) {
    if (err.code === 'NOT_FOUND') {
      const saved = await setCachedLookup(bill, { billNumber: bill, notFound: true, reason: 'not-found', source: 'congress' });
      return { ...saved, cache: 'miss' };
    }
    throw err;
  }
}
