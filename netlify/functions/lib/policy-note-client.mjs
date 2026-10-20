import {
  normalizeLegislationRecord,
  normalizeRegulationRecord,
  normalizeTeamData,
  overviewText,
  parseBillNumber,
  recordBillKeys,
  STATE_NAME_TO_KEY,
} from './normalize.mjs';

const DEFAULT_BASE = 'https://data.policynote.com';

/** Access tokens last 30 minutes; refresh a little early */
const TOKEN_REFRESH_MARGIN_MS = 2 * 60 * 1000;

let tokenCache = { token: '', expiresAt: 0 };
let tokenRequest = null;

/** The PolicyNote API key (key_prod_...); older deploys stored it as POLICY_NOTE_BEARER_TOKEN */
export function getApiKey() {
  return String(process.env.POLICY_NOTE_API_KEY || process.env.POLICY_NOTE_BEARER_TOKEN || '').trim();
}

/** App-data requests take the key_id half of a `key_id.secret` API key as `authentication_token` */
export function getKeyId() {
  const configured = String(process.env.POLICY_NOTE_KEY_ID || '').trim();
  if (configured) return configured;
  const apiKey = getApiKey();
  const dot = apiKey.indexOf('.');
  return dot > 0 ? apiKey.slice(0, dot) : apiKey;
}

export function getBaseUrl() {
  const configured = String(process.env.POLICY_NOTE_BASE_URL || '').trim().replace(/\/$/, '');
  /* api.fiscalnote.com no longer resolves; ignore it if it's still set in Netlify */
  if (!configured || /api\.fiscalnote\.com/i.test(configured)) return DEFAULT_BASE;
  return configured;
}

function fail(message, code, extra = {}) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

async function networkFetch(url, options, what) {
  try {
    return await fetch(url, options);
  } catch (e) {
    const cause = e && e.cause ? e.cause.code || e.cause.message : '';
    throw fail(`Could not reach PolicyNote (${what})${cause ? `: ${cause}` : ''}`, 'UPSTREAM', { status: null, details: url });
  }
}

/** Batch lookups run in parallel; share one token request between them */
async function getAccessToken(force) {
  if (!force && tokenCache.token && Date.now() < tokenCache.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
    return tokenCache.token;
  }
  if (!tokenRequest) {
    tokenRequest = requestAccessToken().finally(() => {
      tokenRequest = null;
    });
  }
  return tokenRequest;
}

/** Exchange the API key for a short-lived bearer token (POST /v1/auth/token, x-api-key header) */
async function requestAccessToken() {
  const apiKey = getApiKey();
  if (!apiKey) throw fail('POLICY_NOTE_API_KEY is not configured', 'CONFIG');

  const res = await networkFetch(
    `${getBaseUrl()}/v1/auth/token`,
    { method: 'POST', headers: { Accept: 'application/json', 'x-api-key': apiKey } },
    'auth',
  );
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    throw fail(`PolicyNote rejected the API key (${res.status})`, res.status === 401 || res.status === 403 ? 'AUTH' : 'UPSTREAM', {
      status: res.status,
      details: text.slice(0, 500),
    });
  }
  let body = {};
  try {
    body = JSON.parse(text);
  } catch {
    /* handled below */
  }
  if (!body.access_token) throw fail('PolicyNote auth response had no access_token', 'UPSTREAM', { status: res.status, details: text.slice(0, 500) });

  const seconds = Number(body.expires_in) > 0 ? Number(body.expires_in) : 1800;
  tokenCache = { token: body.access_token, expiresAt: Date.now() + seconds * 1000 };
  return tokenCache.token;
}

/** GET a PolicyNote endpoint with a bearer token; re-authenticates once on 401 */
async function apiGet(path, params) {
  const url = new URL(`${getBaseUrl()}${path}`);
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  return apiRequest(url.toString(), { method: 'GET' }, 'search');
}

/** POST a JSON body to a PolicyNote endpoint */
async function apiPost(path, body, what) {
  return apiRequest(
    `${getBaseUrl()}${path}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) },
    what || 'request',
  );
}

async function apiRequest(url, options, what) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getAccessToken(attempt > 0);
    const headers = { Accept: 'application/json', ...(options.headers || {}), Authorization: `Bearer ${token}` };
    const res = await networkFetch(url, { ...options, headers }, what);
    if (res.status === 401 && attempt === 0) continue;
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      /* 403 "Access to the following localities is not permitted: US" = outside the subscription, not a bad key */
      const code =
        res.status === 404
          ? 'NOT_FOUND'
          : res.status === 403 && /not permitted/i.test(text)
            ? 'NOT_PERMITTED'
            : res.status === 401 || res.status === 403
              ? 'AUTH'
              : 'UPSTREAM';
      throw fail(`PolicyNote request failed (${res.status})`, code, {
        status: res.status,
        details: text.slice(0, 500),
      });
    }
    try {
      return JSON.parse(text);
    } catch {
      throw fail('PolicyNote returned invalid JSON', 'UPSTREAM', { status: res.status, details: text.slice(0, 500) });
    }
  }
  throw fail('PolicyNote authentication failed', 'AUTH');
}

function billsFrom(payload) {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  return results.map((r) => (r && r.bill ? r.bill : r)).filter(Boolean);
}

/** Exact id match first (newest introduction wins when a number repeats across sessions), then a number-only match */
function chooseBest(bills, parsed) {
  const byNewest = (a, b) => String(b.introduction_date || '').localeCompare(String(a.introduction_date || ''));
  const exact = bills.filter((b) => recordBillKeys(b).some((k) => parsed.keys.includes(k))).sort(byNewest);
  if (exact.length) return { record: exact[0], matched: 'exact' };
  if (!parsed.locality) {
    const loose = bills.filter((b) => recordBillKeys(b).some((k) => k.endsWith(parsed.numberKey))).sort(byNewest);
    if (loose.length === 1) return { record: loose[0], matched: 'number' };
  }
  return null;
}

/**
 * Find a bill by number (e.g. "OR HB 4144", "H.R. 906", "US S 1379").
 * Searches the current session first, then all sessions.
 */
export async function searchLegislation(billNumber) {
  const parsed = parseBillNumber(billNumber);
  if (!parsed.numberKey) throw fail('billNumber is required', 'BAD_REQUEST');

  const base = {
    query_string: `"${parsed.number}"`,
    locality_code: parsed.locality || undefined,
    limit: 25,
  };

  const payloads = [];
  for (const scope of [{}, { is_active: 'false' }]) {
    const payload = await apiGet('/v1/legislation/search', { ...base, ...scope });
    payloads.push(payload);
    const best = chooseBest(billsFrom(payload), parsed);
    if (best) return { ...best, payload, query: { ...base, ...scope } };
  }

  const seen = payloads.flatMap((p) => billsFrom(p).map((b) => b.primary_external_id)).filter(Boolean).slice(0, 10);
  throw fail(`No legislation found for "${billNumber}"`, 'NOT_FOUND', { details: seen.length ? `Closest results: ${seen.join(', ')}` : null });
}

/** Projects (legacy "issues") and tags (legacy "labels") from a fiscalnote_app_data / pn_app_data block */
export function normalizeAppData(data) {
  const team = normalizeTeamData(data);
  return { projects: team.projects, tags: team.tags, orgPriority: team.teamPriorityKey, orgPosition: team.teamPositionKey };
}

/**
 * Your organization's PolicyNote data for one bill (POST /v1/appdata/legislation/fetch).
 * `id` is the short legislation id from search (`bill.id`), not the `bill-...` entity id.
 */
export async function fetchAppData(id) {
  const keyId = getKeyId();
  if (!keyId) throw fail('POLICY_NOTE_API_KEY is not configured', 'CONFIG');
  const payload = await apiPost('/v1/appdata/legislation/fetch', { authentication_token: keyId, ids: [id], fieldset: 'BRIEF' }, 'app data');
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.results) ? payload.results : [];
  const row = rows.find((r) => r && r.bill && String(r.bill.id) === String(id)) || rows[0] || null;
  return { raw: row ? row.fiscalnote_app_data || row.pn_app_data || null : null, rows: rows.length };
}

/** Every project and tag configured on the PolicyNote account (GET /v1/appdata/projects, legacy /issues as fallback) */
export async function listProjects() {
  const params = { authentication_token: getKeyId() };
  let payload;
  try {
    payload = await apiGet('/v1/appdata/projects', params);
  } catch (err) {
    if (err.code === 'CONFIG' || err.code === 'AUTH') throw err;
    payload = await apiGet('/v1/appdata/issues', params);
  }
  return normalizeAppData(payload);
}

export async function lookupLegislation(billNumber) {
  const { record, matched } = await searchLegislation(billNumber);
  const normalized = { ...normalizeLegislationRecord(record, billNumber), matched };
  /* Projects / tags are a bonus: a failed app-data call keeps the bill data */
  if (normalized.policyNoteId) {
    try {
      const { raw } = await fetchAppData(normalized.policyNoteId);
      const team = normalizeTeamData(raw);
      Object.assign(normalized, team, { overview: overviewText(team, record), appData: raw ? 'ok' : 'none' });
    } catch (err) {
      Object.assign(normalized, { projects: [], tags: [], appData: 'error', appDataError: `${err.message}${err.details ? `: ${String(err.details).slice(0, 200)}` : ''}` });
    }
  }
  return normalized;
}

/** Lightweight auth check for /health?check=1 */
export async function checkAuth() {
  await getAccessToken(true);
  return true;
}

/** /health?check=1: proves the key_id is accepted for app data */
export async function checkAppData() {
  const { projects, tags } = await listProjects();
  return { projects: projects.length, tags: tags.length };
}

/* ==== Project-driven lists (Issue pages) ==== */

/** Most items a single project list returns per kind; keeps a project inside the 60 requests/minute limit */
export const PROJECT_ITEM_CAP = 500;
const SEARCH_PAGE_SIZE = 100;
const V2_FETCH_MAX = 200;
const V1_FETCH_MAX = 100;

const KIND_PATHS = {
  legislation: { search: '/v1/appdata/legislation/search', fetch: 'legislation', row: 'bill' },
  regulation: { search: '/v1/appdata/regulations/search', fetch: 'regulations', row: 'regulation' },
};

export function parseKind(value) {
  const k = String(value || '').trim().toLowerCase();
  if (k === '2' || k.startsWith('reg')) return 'regulation';
  if (k === '1' || k.startsWith('leg') || k === 'bill') return 'legislation';
  return '';
}

function projectKey(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** "ADAS, Right to Repair" -> project names; matches by name (case/punctuation-insensitive) or by id */
export async function findProjects(query) {
  const wanted = String(query || '')
    .split(/[,|;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!wanted.length) throw fail('name is required', 'BAD_REQUEST');
  const { projects } = await listProjects();
  const matched = [];
  const missing = [];
  for (const name of wanted) {
    const key = projectKey(name);
    const hit = projects.find((p) => p.id === name || projectKey(p.name) === key);
    if (hit) {
      if (!matched.some((m) => m.id === hit.id)) matched.push(hit);
    } else missing.push(name);
  }
  return { matched, missing, available: projects.map((p) => p.name) };
}

/** "Access to the following localities is not permitted: US, US-DC" -> ['US', 'US-DC'] */
function deniedLocalities(err) {
  const m = /not permitted:\s*([^"}\]]+)/i.exec(String((err && err.details) || ''));
  if (!m) return [];
  return m[1]
    .split(/[,\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z]{2}(-[A-Z0-9]{1,3})?$/.test(s));
}

function allowedUsLocalities(denied) {
  const all = ['US', ...Object.values(STATE_NAME_TO_KEY).map((k) => `US-${k.slice(3).toUpperCase()}`)];
  return all.filter((code, i) => all.indexOf(code) === i && !denied.includes(code));
}

/** Every item in the given projects (search pages until the cap); search rows carry brief metadata only */
async function searchProjectItems(kind, projectIds) {
  const paths = KIND_PATHS[kind];
  const base = { authentication_token: getKeyId(), projects: projectIds, limit: SEARCH_PAGE_SIZE };
  if (kind === 'legislation') Object.assign(base, { is_active: false, fieldset: 'BRIEF' });

  const items = [];
  let token = '';
  let total = null;
  let denied = [];
  let truncated = false;
  for (let page = 0; page < Math.ceil(PROJECT_ITEM_CAP / SEARCH_PAGE_SIZE) + 1; page++) {
    const body = { ...base, ...(token ? { continuation_token: token } : {}) };
    if (denied.length) body.locality_code = allowedUsLocalities(denied);
    let payload;
    try {
      payload = await apiPost(paths.search, body, `${kind} search`);
    } catch (err) {
      const more = err.code === 'NOT_PERMITTED' && !token ? deniedLocalities(err) : [];
      if (more.length && !more.every((l) => denied.includes(l))) {
        denied = [...new Set([...denied, ...more])];
        page--;
        continue;
      }
      throw err;
    }
    if (total === null && Number.isFinite(Number(payload?.estimated_total_results))) total = Number(payload.estimated_total_results);
    const rows = Array.isArray(payload?.results) ? payload.results : [];
    for (const row of rows) {
      const record = row && (row.bill || row.regulation || row);
      if (record && record.id) items.push({ id: String(record.id), record });
    }
    token = payload?.continuation_token || '';
    if (items.length >= PROJECT_ITEM_CAP) {
      truncated = Boolean(token) || items.length > PROJECT_ITEM_CAP;
      break;
    }
    if (!token || !rows.length) break;
  }
  return { items: items.slice(0, PROJECT_ITEM_CAP), total, truncated, deniedLocalities: denied };
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function matchKeys(record) {
  const r = record || {};
  return [r.id, r.entity_id, r.primary_external_id, r.primary_identifier].map((v) => String(v || '').trim().toLowerCase()).filter(Boolean);
}

/** Fetch rows -> Map(search id -> { record, appData }); v2 returns UUIDs, so match on any shared identifier */
function indexFetched(rows, wanted, rowKey) {
  const byKey = new Map();
  for (const w of wanted) for (const k of matchKeys(w.record || { id: w.id })) if (!byKey.has(k)) byKey.set(k, w.id);
  const out = new Map();
  rows.forEach((row, i) => {
    const record = row && (row[rowKey] || row.bill || row.regulation);
    if (!record) return;
    const appData = row.pn_app_data || row.fiscalnote_app_data || null;
    let id = matchKeys(record).map((k) => byKey.get(k)).find(Boolean);
    if (!id && rows.length === wanted.length) id = wanted[i].id;
    if (id && !out.has(id)) out.set(id, { record, appData });
  });
  return out;
}

async function fetchChunk(kind, version, wanted) {
  const paths = KIND_PATHS[kind];
  const ids = wanted.map((w) => w.id);
  const body = version === 'v2' ? { ids } : { authentication_token: getKeyId(), ids, ...(kind === 'legislation' ? { fieldset: 'DEFAULT' } : {}) };
  const payload = await apiPost(`/${version}/appdata/${paths.fetch}/fetch`, body, `${kind} fetch`);
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.results) ? payload.results : [];
  return indexFetched(rows, wanted, paths.row);
}

/**
 * Full records + team data for search rows: v2 fetch (200 per call), falling back to v1 (100 per call).
 * A chunk denied for some localities is retried without them; anything still missing keeps its search row.
 */
async function fetchProjectItems(kind, wanted) {
  const found = new Map();
  let version = 'v2';
  let lastError = null;
  const denied = new Set();

  const runChunk = async (part) => {
    try {
      return await fetchChunk(kind, version, part);
    } catch (err) {
      if (err.code === 'CONFIG' || err.code === 'AUTH') throw err;
      if (err.code === 'NOT_PERMITTED') {
        deniedLocalities(err).forEach((l) => denied.add(l));
        const allowed = part.filter((w) => !denied.has(String(w.record?.locality_code || '').toUpperCase()));
        if (allowed.length && allowed.length < part.length) return fetchChunk(kind, version, allowed);
      }
      throw err;
    }
  };

  for (const part of chunk(wanted, V2_FETCH_MAX)) {
    try {
      for (const [id, v] of await runChunk(part)) found.set(id, v);
    } catch (err) {
      if (err.code === 'CONFIG' || err.code === 'AUTH') throw err;
      lastError = err;
      version = 'v1';
      break;
    }
  }
  if (version === 'v1') {
    for (const part of chunk(wanted.filter((w) => !found.has(w.id)), V1_FETCH_MAX)) {
      try {
        for (const [id, v] of await runChunk(part)) found.set(id, v);
      } catch (err) {
        if (err.code === 'CONFIG' || err.code === 'AUTH') throw err;
        lastError = err;
      }
    }
  }
  const used = found.size ? version : 'search-only';
  return { found, version: used, deniedLocalities: [...denied], error: lastError && !found.size ? describe(lastError) : null };
}

function describe(err) {
  return `${err.message}${err.details ? `: ${String(err.details).slice(0, 200)}` : ''}`;
}

function normalizeItem(kind, record, appData, searchId) {
  return kind === 'regulation'
    ? normalizeRegulationRecord(record, appData, searchId)
    : normalizeLegislationRecord(record, '', appData, searchId);
}

const byDateDesc = (field, fallback) => (a, b) =>
  String(b[field] || b[fallback] || '').localeCompare(String(a[field] || a[fallback] || ''));

async function projectKind(kind, projectIds, withRaw) {
  const search = await searchProjectItems(kind, projectIds);
  const fetched = search.items.length ? await fetchProjectItems(kind, search.items) : { found: new Map(), version: 'none', deniedLocalities: [], error: null };
  const first = search.items[0];
  const sample = withRaw && first ? { search: first.record, fetched: fetched.found.get(first.id) || null } : null;
  const items = search.items.map((w) => {
    const full = fetched.found.get(w.id);
    const item = normalizeItem(kind, full ? full.record : w.record, full ? full.appData : null, w.id);
    if (!full) item.detail = 'brief';
    return item;
  });
  items.sort(kind === 'regulation' ? byDateDesc('lastUpdateDate', 'publicationDate') : byDateDesc('lastActionDate', 'introducedDate'));
  return {
    items,
    total: search.total,
    truncated: search.truncated,
    fetch: fetched.version,
    fetchError: fetched.error,
    deniedLocalities: [...new Set([...search.deniedLocalities, ...fetched.deniedLocalities])],
    sample,
  };
}

/** Every legislation and regulation item in one or more PolicyNote projects ("ADAS, ERP") */
export async function lookupProject(query, options = {}) {
  const project = await findProjects(query);
  const result = {
    query: String(query || '').trim(),
    projects: project.matched,
    missing: project.missing,
    legislation: [],
    regulations: [],
    meta: {},
    errors: {},
    cachedAt: new Date().toISOString(),
    source: 'policy-note',
  };
  if (!project.matched.length) {
    result.available = project.available;
    return result;
  }
  const ids = project.matched.map((p) => p.id).filter(Boolean);
  const kinds = ['legislation', 'regulation'];
  const settled = await Promise.allSettled(kinds.map((kind) => projectKind(kind, ids, options.raw)));
  settled.forEach((s, i) => {
    const listKey = kinds[i] === 'regulation' ? 'regulations' : 'legislation';
    if (s.status === 'fulfilled') {
      const r = s.value;
      result[listKey] = r.items;
      result.meta[listKey] = { count: r.items.length, total: r.total, truncated: r.truncated, fetch: r.fetch, deniedLocalities: r.deniedLocalities };
      if (r.fetchError) result.errors[`${listKey}Fetch`] = r.fetchError;
      if (r.sample) (result.raw = result.raw || {})[listKey] = r.sample;
    } else {
      const err = s.reason || {};
      if (err.code === 'CONFIG' || err.code === 'AUTH') throw err;
      result.errors[listKey] = describe(err);
      result.meta[listKey] = { count: 0, code: err.code || 'UPSTREAM' };
    }
  });
  return result;
}

/** One legislation or regulation item by its PolicyNote id (search id or UUID) */
export async function lookupItem(kind, id) {
  const k = parseKind(kind);
  const pnId = String(id || '').trim();
  if (!k) throw fail('kind must be legislation (1) or regulation (2)', 'BAD_REQUEST');
  if (!pnId) throw fail('id is required', 'BAD_REQUEST');
  const wanted = [{ id: pnId, record: { id: pnId } }];
  let found = null;
  let firstError = null;
  for (const version of ['v2', 'v1']) {
    try {
      const map = await fetchChunk(k, version, wanted);
      found = map.get(pnId) || null;
      if (found) {
        const item = normalizeItem(k, found.record, found.appData, pnId);
        item.fetch = version;
        return item;
      }
    } catch (err) {
      if (err.code === 'CONFIG' || err.code === 'AUTH' || err.code === 'NOT_PERMITTED') throw err;
      if (!firstError) firstError = err;
    }
  }
  if (firstError && firstError.code !== 'NOT_FOUND') throw firstError;
  throw fail(`No ${k} found for id "${pnId}"`, 'NOT_FOUND');
}
