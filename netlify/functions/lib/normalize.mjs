/** US state name → Highcharts hc-key */
export const STATE_NAME_TO_KEY = {
  Alabama: 'us-al',
  Alaska: 'us-ak',
  Arizona: 'us-az',
  Arkansas: 'us-ar',
  California: 'us-ca',
  Colorado: 'us-co',
  Connecticut: 'us-ct',
  Delaware: 'us-de',
  'District of Columbia': 'us-dc',
  Florida: 'us-fl',
  Georgia: 'us-ga',
  Hawaii: 'us-hi',
  Idaho: 'us-id',
  Illinois: 'us-il',
  Indiana: 'us-in',
  Iowa: 'us-ia',
  Kansas: 'us-ks',
  Kentucky: 'us-ky',
  Louisiana: 'us-la',
  Maine: 'us-me',
  Maryland: 'us-md',
  Massachusetts: 'us-ma',
  Michigan: 'us-mi',
  Minnesota: 'us-mn',
  Mississippi: 'us-ms',
  Missouri: 'us-mo',
  Montana: 'us-mt',
  Nebraska: 'us-ne',
  Nevada: 'us-nv',
  'New Hampshire': 'us-nh',
  'New Jersey': 'us-nj',
  'New Mexico': 'us-nm',
  'New York': 'us-ny',
  'North Carolina': 'us-nc',
  'North Dakota': 'us-nd',
  Ohio: 'us-oh',
  Oklahoma: 'us-ok',
  Oregon: 'us-or',
  Pennsylvania: 'us-pa',
  'Rhode Island': 'us-ri',
  'South Carolina': 'us-sc',
  'South Dakota': 'us-sd',
  Tennessee: 'us-tn',
  Texas: 'us-tx',
  Utah: 'us-ut',
  Vermont: 'us-vt',
  Virginia: 'us-va',
  Washington: 'us-wa',
  'West Virginia': 'us-wv',
  Wisconsin: 'us-wi',
  Wyoming: 'us-wy',
};

const STATE_ALIASES = {
  DC: 'District of Columbia',
  'D.C.': 'District of Columbia',
  'Washington DC': 'District of Columbia',
  'Washington D.C.': 'District of Columbia',
};

/** Sitefinity Bill_status choice values */
export const STATUS_LABEL_TO_KEY = {
  Introduced: 'introduced',
  'In Committee': 'in-committee',
  'On Floor': 'on-floor',
  'Passed One Chamber': 'passed-one',
  'Passed Both Chambers': 'passed-both',
  Enacted: 'enacted',
  'Failed / Vetoed': 'failed',
  'n/a': 'na',
};

export const STATUS_KEY_TO_SF_VALUE = {
  introduced: 1,
  'in-committee': 2,
  'on-floor': 3,
  'passed-one': 4,
  'passed-both': 5,
  enacted: 6,
  failed: 7,
  na: 8,
};

export function normalizeBillKey(billNumber) {
  return String(billNumber || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/\./g, '');
}

export function resolveStateName(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  if (STATE_ALIASES[text]) return STATE_ALIASES[text];
  if (STATE_NAME_TO_KEY[text]) return text;
  const lower = text.toLowerCase();
  for (const name of Object.keys(STATE_NAME_TO_KEY)) {
    if (name.toLowerCase() === lower) return name;
  }
  // Abbreviation: "CO" / "co"
  if (/^[a-z]{2}$/i.test(text)) {
    const abbr = text.toLowerCase();
    for (const [name, key] of Object.entries(STATE_NAME_TO_KEY)) {
      if (key === `us-${abbr}`) return name;
    }
  }
  return '';
}

/**
 * Map Policy Note / free-text status into Sitefinity labels.
 */
export function normalizeStatus(raw) {
  const text = String(raw || '').trim();
  if (!text) {
    return { status: '', statusKey: '', statusValue: null };
  }
  const lower = text.toLowerCase();

  if (lower.includes('enact') || lower.includes('signed') || lower.includes('became law')) {
    return { status: 'Enacted', statusKey: 'enacted', statusValue: 6 };
  }
  if (lower.includes('veto') || lower.includes('failed') || lower.includes('dead') || lower.includes('withdrawn')) {
    return { status: 'Failed / Vetoed', statusKey: 'failed', statusValue: 7 };
  }
  if (lower.includes('both chamber') || lower.includes('passed both') || lower.includes('enrolled')) {
    return { status: 'Passed Both Chambers', statusKey: 'passed-both', statusValue: 5 };
  }
  if (
    lower.includes('passed one') ||
    lower.includes('first chamber') ||
    lower.includes('passed house') ||
    lower.includes('passed senate') ||
    lower.includes('engrossed')
  ) {
    return { status: 'Passed One Chamber', statusKey: 'passed-one', statusValue: 4 };
  }
  if (lower.includes('floor') || lower.includes('calendar') || lower.includes('third reading')) {
    return { status: 'On Floor', statusKey: 'on-floor', statusValue: 3 };
  }
  if (lower.includes('committee')) {
    return { status: 'In Committee', statusKey: 'in-committee', statusValue: 2 };
  }
  if (lower.includes('introduc') || lower.includes('filed') || lower.includes('prefile')) {
    return { status: 'Introduced', statusKey: 'introduced', statusValue: 1 };
  }

  return { status: 'Introduced', statusKey: 'introduced', statusValue: 1 };
}

function text(value) {
  return value == null ? '' : String(value).trim();
}

function isoDate(value) {
  const t = Date.parse(text(value));
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : '';
}

function plain(html, max) {
  let s = text(html).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  if (max && s.length > max) s = `${s.slice(0, max - 3).trimEnd()}...`;
  return s;
}

const STATE_ABBRS = new Set(Object.values(STATE_NAME_TO_KEY).map((k) => k.slice(3).toUpperCase()).concat(['PR', 'GU', 'VI', 'AS', 'MP']));

/** Federal bill prefixes used without a locality, e.g. "H.R. 906", "S. 1379", "H.Res. 12" */
const FEDERAL_PREFIX = /^(HR|S|HRES|SRES|HJRES|SJRES|HCONRES|SCONRES)\s+\d/;

/**
 * Comparable id: uppercase, no dots/spaces/hyphens, "US-OR" → "OR", no leading zeros in the number.
 * "OR HB 4144" → "orhb4144", "US-OR HB4144" → "orhb4144", "H.R. 0906" → "hr906"
 */
export function billIdKey(id) {
  return text(id)
    .toUpperCase()
    .replace(/\./g, '')
    .replace(/^US-([A-Z]{2})(?=[\s\d-]|[A-Z]{2,})/, '$1 ')
    .replace(/[^A-Z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/([A-Z])\s?0+(\d)/g, '$1$2')
    .replace(/\s/g, '')
    .toLowerCase();
}

/**
 * Split a CMS bill number into PolicyNote search parts.
 * "OR HB 4144" → { locality: "US-OR", number: "HB 4144" }; "H.R. 906" → { locality: "US", number: "HR 906" }
 */
export function parseBillNumber(raw) {
  let s = text(raw).toUpperCase().replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
  let locality = '';
  for (const [name, hc] of Object.entries(STATE_NAME_TO_KEY)) {
    const upper = name.toUpperCase();
    if (s.startsWith(`${upper} `)) {
      s = `${hc.slice(3).toUpperCase()} ${s.slice(upper.length + 1)}`;
      break;
    }
  }
  const pref = s.match(/^(?:US-)?([A-Z]{2})[\s-]+([A-Z].*)$/);
  if (pref && (pref[1] === 'US' || STATE_ABBRS.has(pref[1]))) {
    locality = pref[1] === 'US' ? 'US' : `US-${pref[1]}`;
    s = pref[2];
  }
  /* "HB4144" → "HB 4144"; "H R 906" → "HR 906" */
  let number = s.replace(/([A-Z])(?=\d)/g, '$1 ').replace(/\s+/g, ' ').trim();
  const m = number.match(/^([A-Z ]+?)\s*(\d.*)$/);
  if (m) number = `${m[1].replace(/\s/g, '')} ${m[2].replace(/^0+(?=\d)/, '')}`;
  if (!locality && FEDERAL_PREFIX.test(number)) locality = 'US';
  const loc = locality === 'US' ? 'US' : locality.replace(/^US-/, '');
  const key = billIdKey(loc ? `${loc} ${number}` : number);
  const keys = [key];
  /* PolicyNote may list federal bills as HB/SB as well as HR/S */
  if (locality === 'US') {
    const swap = number.replace(/^HR(?= )/, 'HB').replace(/^S(?= )/, 'SB');
    const back = number.replace(/^HB(?= )/, 'HR').replace(/^SB(?= )/, 'S');
    for (const n of [swap, back]) {
      const k = billIdKey(`US ${n}`);
      if (!keys.includes(k)) keys.push(k);
    }
  }
  return { locality, number, numberKey: billIdKey(number), key, keys };
}

/** Every comparable id PolicyNote lists for a bill (primary id plus source ids) */
export function recordBillKeys(bill) {
  const ids = [bill?.primary_external_id].concat(Array.isArray(bill?.source_ids) ? bill.source_ids : []);
  return [...new Set(ids.map(billIdKey).filter(Boolean))];
}

const JURISDICTION_LABELS = {
  national: 'National',
  state: 'State/Regional',
  international: 'International/Global',
};

/** locality_code: "US" → national, "US-OR" → state, anything else → international */
function fromLocality(localityCode) {
  const code = text(localityCode).toUpperCase();
  if (code === 'US') return { jurisdiction: 'national', state: '' };
  const m = code.match(/^US-([A-Z]{2})$/);
  if (m) return { jurisdiction: 'state', state: resolveStateName(m[1]) };
  return { jurisdiction: code ? 'international' : '', state: '' };
}

function resolveChamber(chamberOfOrigin, localityCode) {
  const c = text(chamberOfOrigin).toUpperCase();
  if (c === 'UPPER' || c.includes('SENATE')) return 'Senate';
  if (c === 'LOWER' || c.includes('HOUSE')) return text(localityCode).toUpperCase() === 'US-CA' ? 'Assembly' : 'House';
  if (c.includes('ASSEMBLY')) return 'Assembly';
  if (c.includes('JOINT')) return 'Joint';
  return c ? c.charAt(0) + c.slice(1).toLowerCase() : '';
}

const STATUS = {
  introduced: { status: 'Introduced', statusKey: 'introduced', statusValue: 1 },
  'in-committee': { status: 'In Committee', statusKey: 'in-committee', statusValue: 2 },
  'on-floor': { status: 'On Floor', statusKey: 'on-floor', statusValue: 3 },
  'passed-one': { status: 'Passed One Chamber', statusKey: 'passed-one', statusValue: 4 },
  'passed-both': { status: 'Passed Both Chambers', statusKey: 'passed-both', statusValue: 5 },
  enacted: { status: 'Enacted', statusKey: 'enacted', statusValue: 6 },
  failed: { status: 'Failed / Vetoed', statusKey: 'failed', statusValue: 7 },
};

/** Furthest stage reached, from PolicyNote's standardized timeline, then its status fields */
function resolveStatus(bill) {
  const t = bill.timeline || {};
  const normalized = text(bill.status_normalized).toLowerCase();
  if (t.enacted) return STATUS.enacted;
  if (t.vetoed || t.failed || t.conference_committee_report_failed || normalized === 'failed' || normalized === 'inactive') return STATUS.failed;
  if (t.passed_second_chamber || (t.passed_upper && t.passed_lower) || t.conference_committee_report_passed) return STATUS['passed-both'];
  if (t.passed_first_chamber || t.passed_upper || t.passed_lower) return STATUS['passed-one'];
  if (t.reported_from_committee_first_chamber || t.reported_from_committee_second_chamber) return STATUS['on-floor'];
  if (t.referred_to_committee_first_chamber || t.referred_to_committee_second_chamber) return STATUS['in-committee'];

  /* PolicyNote status codes, e.g. ENACTED, PASSED_FIRST_CHAMBER, IN_COMMITTEE */
  const raw = text(bill.status).replace(/_/g, ' ').toLowerCase();
  if (raw) {
    if (/enact|signed|chapter|became law|adopted/.test(raw)) return STATUS.enacted;
    if (/veto|fail|dead|withdrawn|died/.test(raw)) return STATUS.failed;
    if (/second chamber|both chamber|enrolled|to governor|to executive|to president|concurrence/.test(raw)) return STATUS['passed-both'];
    if (/first chamber|passed|engrossed/.test(raw)) return STATUS['passed-one'];
    if (/floor|calendar|reading|reported/.test(raw)) return STATUS['on-floor'];
    if (/committee|referred/.test(raw)) return STATUS['in-committee'];
    if (/introduc|filed|prefile/.test(raw)) return STATUS.introduced;
  }
  if (normalized === 'passed') return STATUS['passed-one'];
  return STATUS.introduced;
}

/** "20262026r" → "2026 Regular Session", "20252026r" → "2025–2026 Regular Session", "20262026s1" → "2026 Special Session 1" */
function formatSession(code, name) {
  if (text(name)) return text(name);
  const m = text(code).toLowerCase().match(/^(\d{4})(\d{4})?([a-z]*)(\d*)$/);
  if (!m) return text(code);
  const years = m[2] && m[2] !== m[1] ? `${m[1]}–${m[2]}` : m[1];
  const kind = m[3] === 'r' || m[3] === '' ? 'Regular Session' : /^(s|x|e)/.test(m[3]) ? 'Special Session' : 'Session';
  return `${years} ${kind}${m[4] ? ` ${m[4]}` : ''}`;
}

function normalizeSponsors(bill) {
  const primary = Array.isArray(bill.primary_sponsors) ? bill.primary_sponsors : [];
  const list = primary.length ? primary : Array.isArray(bill.sponsors) ? bill.sponsors : [];
  return list
    .map((s) => ({ name: text(s && s.name), party: '' }))
    .filter((s) => s.name)
    .slice(0, 5);
}

function officialUrl(bill) {
  const sources = Array.isArray(bill.sources) ? bill.sources : [];
  const ordered = sources.filter((s) => text(s && s.type).toUpperCase() === 'DEFAULT').concat(sources);
  for (const s of ordered) {
    const url = text(s && s.url);
    if (/^https?:\/\//i.test(url)) return url;
  }
  return '';
}

/** "Short Title as Introduced Affordable Care Act" → "Affordable Care Act" */
function shortTitle(bill) {
  const alts = Array.isArray(bill.alternate_titles) ? bill.alternate_titles : [];
  const hit = alts.map(text).find((t) => /^short title/i.test(t));
  return hit ? hit.replace(/^short titles?(\s+as\s+(introduced|reported|passed|enacted)(\s+to\s+\w+)?(\s+\w+)?)?\s*/i, '').trim() : '';
}

const POSITION_LABELS = { support: 'Support', oppose: 'Oppose', monitor: 'Monitoring' };
const PRIORITY_LABELS = { high: 'High', med: 'Medium', medium: 'Medium', low: 'Low' };

function namedList(list, idKeys, nameKeys) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const entry of list) {
    if (!entry) continue;
    const id = text(idKeys.map((k) => entry[k]).find(Boolean));
    const name = text(nameKeys.map((k) => entry[k]).find(Boolean));
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ id, name });
  }
  return out;
}

/**
 * Your organization's PolicyNote data for an item (fiscalnote_app_data / pn_app_data):
 * projects (formerly "issues"), tags (formerly "labels"), team position / priority / summary / links.
 */
export function normalizeTeamData(data) {
  const d = data || {};
  const position = text(d.position).toLowerCase();
  const priority = text(d.priority).toLowerCase();
  const links = (Array.isArray(d.links) ? d.links : [])
    .map((l) => {
      let url = text(l && (l.url || l.normalized_url));
      if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
      return url ? { url, label: text(l && (l.title || l.name)) || url.replace(/^https?:\/\/(www\.)?/i, '').split('/')[0] } : null;
    })
    .filter(Boolean);
  return {
    projects: namedList(d.projects || d.issues, ['project_id', 'issue_id', 'id'], ['project_name', 'issue_name', 'name']),
    tags: namedList(d.tags || d.labels, ['tag_id', 'label_id', 'id'], ['tag_name', 'label_name', 'name']),
    teamPosition: POSITION_LABELS[position] || '',
    teamPositionKey: POSITION_LABELS[position] ? position : '',
    teamPriority: PRIORITY_LABELS[priority] || '',
    teamPriorityKey: PRIORITY_LABELS[priority] ? (priority === 'medium' ? 'med' : priority) : '',
    teamSummary: plain(d.summary, 1200),
    teamLinks: links,
  };
}

/** Overview order: the GA team's own summary, then PolicyNote's AI overview, then the source description */
export function overviewText(team, record) {
  return (team && team.teamSummary) || plain(record && record.overview, 1200) || plain(record && record.description, 1200);
}

/** Normalize a PolicyNote legislation `bill` object (search, v1 fetch or v2 fetch) into our cache shape */
export function normalizeLegislationRecord(record, requestedBill, appData, searchId) {
  const b = record || {};
  const { jurisdiction, state } = fromLocality(b.locality_code);
  const statusInfo = resolveStatus(b);
  const lastAction = b.last_action || {};
  const team = normalizeTeamData(appData);

  return {
    kind: 'legislation',
    billNumber: text(b.primary_external_id) || text(requestedBill),
    identifier: text(b.primary_external_id) || text(requestedBill),
    policyNoteId: text(searchId) || text(b.id),
    title: text(b.title) || text(b.primary_external_id),
    shortTitle: shortTitle(b),
    state,
    hcKey: state ? STATE_NAME_TO_KEY[state] || '' : '',
    jurisdiction,
    jurisdictionLabel: JURISDICTION_LABELS[jurisdiction] || '',
    jurisdictionName: text(b.locality_code),
    chamber: resolveChamber(b.chamber_of_origin, b.locality_code),
    session: formatSession(b.session, b.session_name),
    status: statusInfo.status,
    statusKey: statusInfo.statusKey,
    statusValue: statusInfo.statusValue,
    statusRaw: [text(b.status), text(b.status_normalized)].filter(Boolean).join(' / '),
    introducedDate: isoDate(b.introduction_date),
    lastAction: plain(lastAction.text, 240),
    lastActionDate: isoDate(lastAction.date),
    sponsors: normalizeSponsors(b),
    summary: plain(b.description, 600),
    overview: overviewText(team, b),
    officialUrl: officialUrl(b),
    ...team,
    cachedAt: new Date().toISOString(),
    source: 'policy-note',
  };
}

function slug(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Normalize a PolicyNote regulation object (search, v1 fetch or v2 fetch) into our cache shape */
export function normalizeRegulationRecord(record, appData, searchId) {
  const r = record || {};
  const { jurisdiction, state } = fromLocality(r.locality_code);
  const team = normalizeTeamData(appData);
  const orgs = Array.isArray(r.organizations) ? r.organizations : [];
  const agencies = [
    ...(Array.isArray(r.agencies) ? r.agencies.map(text) : []),
    ...orgs.map((o) => text(o && (o.name || o.filter_name))),
  ].filter((a, i, all) => a && all.indexOf(a) === i);
  const deadlines = (Array.isArray(r.comment_deadlines) ? r.comment_deadlines : []).map(isoDate).filter(Boolean).sort();
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = deadlines.find((dt) => dt >= today) || '';
  const hearings = (Array.isArray(r.hearings) ? r.hearings : []).map((h) => isoDate(h && (h.datetime || h.date))).filter(Boolean).sort();
  const sourceUrl = text(r.source_url) || text(r.publication && r.publication.url);
  const status = text(r.status);

  return {
    kind: 'regulation',
    identifier: text(r.primary_identifier) || (Array.isArray(r.source_ids) ? text(r.source_ids[0]) : '') || text(r.entity_id),
    policyNoteId: text(searchId) || text(r.id),
    entityId: text(r.entity_id),
    title: text(r.title) || text(r.primary_identifier),
    regulationType: text(r.type),
    noticeType: text(r.notice_type),
    state,
    hcKey: state ? STATE_NAME_TO_KEY[state] || '' : '',
    jurisdiction,
    jurisdictionLabel: JURISDICTION_LABELS[jurisdiction] || '',
    jurisdictionName: text(r.locality_code),
    status,
    statusKey: slug(status),
    agencies: agencies.slice(0, 5),
    publicationDate: isoDate(r.publication_date || r.initial_date || r.generic_date),
    effectiveDate: isoDate(r.effective_date),
    lastUpdateDate: isoDate(r.last_update_date),
    commentDeadline: upcoming || isoDate(r.latest_comment_deadline) || deadlines[deadlines.length - 1] || '',
    commentOpen: Boolean(upcoming),
    nextHearing: hearings.find((dt) => dt >= today) || '',
    summary: plain(r.description, 600),
    overview: overviewText(team, r),
    officialUrl: /^https?:\/\//i.test(sourceUrl) ? sourceUrl : '',
    ...team,
    cachedAt: new Date().toISOString(),
    source: 'policy-note',
  };
}
