import { connectBlobs, getCachedValue, isCacheFresh, setCachedValue } from './lib/cache.mjs';
import {
  docSummary, documentsByNumbers, ordersByNumbers, parseFrIdentifier, parseNotes, proclamationByNumber, searchDocuments,
} from './lib/federal-register.mjs';
import { lookupHeading, parseHtsHeading } from './lib/hts.mjs';
import { assertProxyKey, corsHeaders, errorResponse, jsonResponse } from './lib/http.mjs';

const TTL_HOURS = 6;
const MAX_ENTRIES = 40;
const MAX_HTS = 15;
const SEARCH_RESULTS = 8;

function text(value) {
  return value == null ? '' : String(value).trim();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * One identifier per line or "|"-separated. The first Federal Register identifier is the primary document.
 *   EO 14257 | Proc 10896 | FR 2026-20510       Federal Register documents
 *   HTS 9903.01.25                              current additional duty from the USITC HTS
 *   docket: USTR-2026-0265                      newest documents in a docket
 *   search: "section 301" china                 newest documents matching a search
 *   agency: trade-representative-office-of-united-states   limits search: lines to an agency (repeatable)
 *   status: Paused for 90 days                  shown as the status instead of the computed one
 *   authority: Section 232, Trade Expansion Act of 1962    shown instead of the detected authority
 */
export function parseTracking(raw) {
  const spec = { primary: null, docs: [], hts: [], dockets: [], searches: [], agencies: [], status: '', authority: '', warnings: [] };
  text(raw).split(/\r?\n|\|/).map((s) => s.trim()).filter(Boolean).slice(0, MAX_ENTRIES).forEach((line) => {
    const keyed = line.match(/^(status|authority|docket|search|agency)\s*:\s*(.+)$/i);
    if (keyed) {
      const key = keyed[1].toLowerCase();
      const value = keyed[2].trim();
      if (key === 'status') spec.status = value;
      else if (key === 'authority') spec.authority = value;
      else if (key === 'docket') spec.dockets.push(value);
      else if (key === 'search') spec.searches.push(value);
      else spec.agencies.push(value.toLowerCase());
      return;
    }
    const heading = parseHtsHeading(line);
    if (heading) {
      if (!spec.hts.includes(heading)) spec.hts.push(heading);
      return;
    }
    const id = parseFrIdentifier(line);
    if (id) {
      const entry = { ...id, raw: line };
      if (!spec.primary) spec.primary = entry;
      else spec.docs.push(entry);
      return;
    }
    spec.warnings.push(`Not recognized: "${line}"`);
  });
  return spec;
}

/** Fetch every Federal Register identifier with as few requests as possible; returns Map(raw -> doc) */
async function resolveDocs(entries, warnings) {
  const found = new Map();
  const byNumber = entries.filter((e) => e.type === 'document');
  const byOrder = entries.filter((e) => e.type === 'eo');
  const byProc = entries.filter((e) => e.type === 'proclamation');
  const [docs, orders, procs] = await Promise.all([
    byNumber.length ? documentsByNumbers(byNumber.map((e) => e.documentNumber)) : [],
    byOrder.length ? ordersByNumbers(byOrder.map((e) => e.number)) : [],
    Promise.all(byProc.map((e) => proclamationByNumber(e.number).catch(() => null))),
  ]);
  byNumber.forEach((e) => {
    const doc = docs.find((d) => text(d.document_number) === e.documentNumber);
    if (doc) found.set(e.raw, doc); else warnings.push(`Federal Register document ${e.documentNumber} not found`);
  });
  byOrder.forEach((e) => {
    const doc = orders.find((d) => text(d.executive_order_number) === e.number);
    if (doc) found.set(e.raw, doc); else warnings.push(`Executive Order ${e.number} not found`);
  });
  byProc.forEach((e, i) => {
    if (procs[i]) found.set(e.raw, procs[i]); else warnings.push(`Proclamation ${e.number} not found`);
  });
  return found;
}

const AUTHORITIES = [
  [/international emergency economic powers|\bieepa\b/i, 'International Emergency Economic Powers Act (IEEPA)'],
  [/section 232|trade expansion act/i, 'Section 232, Trade Expansion Act of 1962'],
  [/section 301|trade act of 1974/i, 'Section 301, Trade Act of 1974'],
  [/section 201|safeguard/i, 'Section 201, Trade Act of 1974'],
  [/section 122/i, 'Section 122, Trade Act of 1974'],
  [/reciprocal tariff|imposing duties to address|duties (?:to address|addressing) the/i, 'International Emergency Economic Powers Act (IEEPA)'],
  [/adjust(?:ing)? imports of/i, 'Section 232, Trade Expansion Act of 1962'],
  [/acts, policies,? and practices/i, 'Section 301, Trade Act of 1974'],
];

function detectAuthority(docs) {
  for (const doc of docs) {
    const hay = [doc.title, doc.action, doc.abstract].map(text).join(' ');
    const hit = AUTHORITIES.find(([re]) => re.test(hay));
    if (hit) return hit[1];
  }
  return '';
}

const RELATION_LABELS = {
  amendedBy: 'Amended by', amends: 'Amends', revokedBy: 'Revoked by', revokes: 'Revokes',
  supersededBy: 'Superseded by', supersedes: 'Supersedes', reinstates: 'Reinstates',
  continuedBy: 'Continued by', continues: 'Continues', see: 'Related',
};

function frSearchUrl(label) {
  return `https://www.federalregister.gov/documents/search?conditions%5Bterm%5D=${encodeURIComponent(`"${label.replace(/^Proc\./, 'Proclamation').replace(/^EO /, 'Executive Order ')}"`)}`;
}

/**
 * Status rules: editor's status line > revoked / superseded > modified by a newer tracked document > in effect.
 * reason never contains a date; asOf is the ISO date that goes with it ("In effect since" + asOf).
 */
function computeStatus(spec, primary, notes, timeline) {
  const now = today();
  if (spec.status) {
    return { label: spec.status, key: 'custom', asOf: timeline[0] ? timeline[0].date : '', reason: 'Set by Auto Care Government Affairs' };
  }
  if (!primary) return { label: 'Unknown', key: 'unknown', asOf: '', reason: 'The primary document could not be found' };
  const ended = (notes.revokedBy || []).concat(notes.supersededBy || []).sort((a, b) => b.date.localeCompare(a.date))[0];
  if (ended) {
    const revoked = (notes.revokedBy || []).includes(ended);
    return { label: revoked ? 'Revoked' : 'Superseded', key: revoked ? 'revoked' : 'superseded', asOf: ended.date, reason: `${revoked ? 'Revoked' : 'Superseded'} by ${ended.label}` };
  }
  const start = primary.date;
  const changes = timeline.filter((t) => t.relation !== 'primary' && t.date && t.date > start);
  (notes.amendedBy || []).forEach((a) => { if (a.date && a.date > start) changes.push({ date: a.date, label: a.label, title: '' }); });
  changes.sort((a, b) => b.date.localeCompare(a.date));
  if (changes.length) {
    const latest = changes[0];
    return { label: 'Modified', key: 'modified', asOf: latest.date, reason: `Latest change: ${latest.label}${latest.title ? `, ${latest.title}` : ''}` };
  }
  const effective = primary.effectiveDate || primary.signedDate || primary.publicationDate;
  if (effective && effective > now) {
    return { label: 'Pending', key: 'pending', asOf: effective, reason: 'Takes effect' };
  }
  return { label: 'In effect', key: 'in-effect', asOf: effective, reason: 'In effect since' };
}

export async function buildTracker(raw, refresh) {
  const spec = parseTracking(raw);
  const warnings = [...spec.warnings];
  const allIds = spec.primary ? [spec.primary, ...spec.docs] : spec.docs;
  const searchAgencies = [...new Set(spec.agencies)];

  const [docMap, searchRows, rates] = await Promise.all([
    resolveDocs(allIds, warnings),
    Promise.all([
      ...spec.dockets.map((docket) => searchDocuments({ docket, perPage: SEARCH_RESULTS }).then((rows) => rows.map((r) => [r, `Docket ${docket}`])).catch(() => { warnings.push(`Docket search failed: ${docket}`); return []; })),
      ...spec.searches.map((term) => searchDocuments({ term, agencies: searchAgencies, perPage: SEARCH_RESULTS }).then((rows) => rows.map((r) => [r, `Search: ${term}`])).catch(() => { warnings.push(`Search failed: ${term}`); return []; })),
    ]),
    Promise.all(spec.hts.slice(0, MAX_HTS).map((h) => lookupHeading(h, refresh).catch(() => ({ heading: h, found: false, error: true })))),
  ]);

  const primaryDoc = spec.primary ? docMap.get(spec.primary.raw) || null : null;
  const seen = new Set();
  const timeline = [];
  const add = (doc, relation, via) => {
    const row = docSummary(doc);
    if (!row.documentNumber || seen.has(row.documentNumber)) return;
    seen.add(row.documentNumber);
    timeline.push({ ...row, relation, via: via || '' });
  };
  if (primaryDoc) add(primaryDoc, 'primary');
  spec.docs.forEach((e) => { const d = docMap.get(e.raw); if (d) add(d, 'listed'); });
  searchRows.flat().forEach(([doc, via]) => add(doc, via.startsWith('Docket') ? 'docket' : 'search', via));
  timeline.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const primary = timeline.find((t) => t.relation === 'primary') || null;
  const notes = primaryDoc ? parseNotes(primaryDoc.executive_order_notes) : {};

  /* Related actions from the primary order's notes; executive orders get direct links */
  const related = [];
  Object.keys(RELATION_LABELS).forEach((key) => (notes[key] || []).forEach((n) => related.push({ ...n, relation: RELATION_LABELS[key], relationKey: key })));
  const eoNumbers = related.filter((r) => r.type === 'EO').map((r) => r.number).slice(0, 40);
  let eoDocs = [];
  if (eoNumbers.length) {
    try { eoDocs = await ordersByNumbers(eoNumbers); } catch { warnings.push('Could not load related executive orders'); }
  }
  const relatedActions = related
    .map((r) => {
      const doc = r.type === 'EO' ? eoDocs.find((d) => text(d.executive_order_number) === r.number) : null;
      return {
        label: r.label,
        type: r.type,
        date: r.date,
        relation: r.relation,
        relationKey: r.relationKey,
        title: doc ? text(doc.title) : '',
        url: doc ? text(doc.html_url) : (r.type === 'Proclamation' || r.type === 'EO' ? frSearchUrl(r.label) : ''),
        tracked: doc ? seen.has(text(doc.document_number)) : false,
      };
    })
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const status = computeStatus(spec, primary, notes, timeline);
  const keyDetails = primary
    ? {
        authority: spec.authority || detectAuthority([primaryDoc, ...spec.docs.map((e) => docMap.get(e.raw)).filter(Boolean)]),
        label: primary.label,
        title: primary.title,
        type: primary.type,
        documentNumber: primary.documentNumber,
        signedDate: primary.signedDate,
        publicationDate: primary.publicationDate,
        effectiveDate: primary.effectiveDate,
        citation: primary.citation,
        agencies: primary.agencies,
        president: text(primaryDoc.president && primaryDoc.president.name),
        url: primary.url,
        pdfUrl: primary.pdfUrl,
        summary: primary.summary,
        latestDate: timeline[0] ? timeline[0].date : '',
        latestLabel: timeline[0] ? timeline[0].label : '',
        latestTitle: timeline[0] ? timeline[0].title : '',
        latestUrl: timeline[0] ? timeline[0].url : '',
      }
    : { authority: spec.authority };
  if (!spec.primary) warnings.push('No Federal Register document listed (EO, Proc or FR document number)');

  return {
    ids: raw,
    status,
    keyDetails,
    rates,
    timeline,
    relatedActions,
    sources: [
      { name: 'Federal Register', url: 'https://www.federalregister.gov/' },
      ...(rates.length ? [{ name: 'USITC Harmonized Tariff Schedule', url: 'https://hts.usitc.gov/' }] : []),
    ],
    warnings,
  };
}

/**
 * GET /api/policy-note/tariff?ids=EO 14257|EO 14266|HTS 9903.01.25|status:...
 * POST { "ids": "EO 14257\nEO 14266" } also works. Cached 6 hours; &refresh=1 rebuilds it.
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

  let ids = text(event.queryStringParameters?.ids);
  if (!ids && event.body) {
    try { ids = text(JSON.parse(event.body).ids); } catch { ids = ''; }
  }
  if (!ids) return jsonResponse(400, { error: 'ids is required', code: 'BAD_REQUEST' });

  const refresh = ['1', 'true'].includes(String(event.queryStringParameters?.refresh || '').toLowerCase());
  const cacheKey = `tariff:${ids.toLowerCase().split(/\r?\n|\|/).map((s) => s.trim()).filter(Boolean).join('|')}`;
  try {
    if (!refresh) {
      const cached = await getCachedValue(cacheKey);
      if (cached && isCacheFresh(cached, TTL_HOURS)) return jsonResponse(200, { ...cached, cache: 'hit' });
    }
    const result = await buildTracker(ids, refresh);
    const saved = await setCachedValue(cacheKey, result);
    return jsonResponse(200, { ...saved, cache: 'miss' });
  } catch (err) {
    return errorResponse(err);
  }
}
