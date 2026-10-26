/** OpenStates API v3 (https://docs.openstates.org/api-v3/): state legislators and members of Congress for a point */

const BASE_URL = 'https://v3.openstates.org';
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

export function getOpenStatesKey() {
  return text(process.env.OPENSTATES_API_KEY);
}

export async function peopleAt(lat, lng) {
  const key = getOpenStatesKey();
  if (!key) throw fail('CONFIG', 'OPENSTATES_API_KEY is not set in Netlify');

  const params = new URLSearchParams({ lat: String(lat), lng: String(lng) });
  params.append('include', 'offices');
  params.append('include', 'links');

  let res;
  try {
    res = await fetch(`${BASE_URL}/people.geo?${params}`, {
      headers: { Accept: 'application/json', 'X-API-KEY': key },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw fail('UPSTREAM', `OpenStates request failed: ${err.message}`);
  }
  if (res.status === 401 || res.status === 403) throw fail('CONFIG', `OpenStates rejected OPENSTATES_API_KEY (HTTP ${res.status})`);
  if (res.status === 429) throw fail('UPSTREAM', 'OpenStates rate limit reached', 429);
  if (!res.ok) throw fail('UPSTREAM', `OpenStates returned HTTP ${res.status}`, res.status);

  const body = await res.json().catch(() => null);
  return Array.isArray(body?.results) ? body.results : [];
}

function uniq(list) {
  return [...new Set(list.filter(Boolean))];
}

function person(p) {
  const role = p.current_role || {};
  const offices = (Array.isArray(p.offices) ? p.offices : []).map((o) => ({
    name: text(o.name) || (o.classification === 'capitol' ? 'Capitol Office' : o.classification === 'district' ? 'District Office' : 'Office'),
    address: text(o.address),
    phone: text(o.voice),
    fax: text(o.fax),
  })).filter((o) => o.address || o.phone);
  const links = (Array.isArray(p.links) ? p.links : []).map((l) => ({ url: text(l.url), note: text(l.note) })).filter((l) => /^https?:\/\//i.test(l.url));
  return {
    id: text(p.id),
    name: text(p.name),
    party: text(p.party),
    title: text(role.title),
    chamber: text(role.org_classification),
    district: text(role.district),
    photo: /^https?:\/\//i.test(text(p.image)) ? text(p.image) : '',
    email: text(p.email),
    phones: uniq(offices.map((o) => o.phone)),
    offices,
    website: links[0]?.url || '',
    openstatesUrl: text(p.openstates_url),
  };
}

function byName(a, b) {
  return a.name.localeCompare(b.name);
}

function stateChamberLabel(chamber, people, stateName) {
  const title = people.map((p) => p.title).join(' ');
  if (chamber === 'upper') return 'State Senate';
  if (chamber === 'lower') {
    if (/assembly/i.test(title)) return 'State Assembly';
    if (/delegate/i.test(title)) return 'House of Delegates';
    return 'State House of Representatives';
  }
  return /council/i.test(title) ? `${stateName || 'Local'} Council` : `${stateName || 'State'} Legislature`;
}

/**
 * Group OpenStates people into federal (U.S. Senate, U.S. House) and state chambers.
 * Federal = jurisdiction classification "country"; chambers come from current_role.org_classification.
 */
export function groupLawmakers(results) {
  const federal = { upper: [], lower: [] };
  const state = { upper: [], lower: [], legislature: [] };
  let stateName = '';

  results.forEach((raw) => {
    const p = person(raw);
    if (!p.name) return;
    const isFederal = text(raw.jurisdiction?.classification) === 'country';
    if (isFederal) {
      (p.chamber === 'upper' ? federal.upper : federal.lower).push(p);
      return;
    }
    stateName = stateName || text(raw.jurisdiction?.name);
    (state[p.chamber] || state.legislature).push(p);
  });

  const federalGroups = [
    { key: 'us-senate', label: 'U.S. Senate', people: federal.upper.sort(byName) },
    { key: 'us-house', label: 'U.S. House of Representatives', people: federal.lower.sort(byName) },
  ].filter((g) => g.people.length);

  const stateGroups = ['upper', 'lower', 'legislature']
    .map((c) => ({ key: `state-${c}`, label: stateChamberLabel(c, state[c], stateName), people: state[c].sort(byName) }))
    .filter((g) => g.people.length);

  return { federal: federalGroups, state: { name: stateName, groups: stateGroups } };
}
