import { getCachedLookup, isCacheFresh, setCachedLookup } from './cache.mjs';

const FR_BASE = 'https://www.federalregister.gov/api/v1';

/** Fields every Federal Register call asks for, so timeline entries and lookups share one shape */
export const FR_FIELDS = [
  'document_number', 'title', 'type', 'subtype', 'action', 'abstract',
  'executive_order_number', 'proclamation_number', 'executive_order_notes',
  'signing_date', 'publication_date', 'effective_on', 'comments_close_on',
  'html_url', 'pdf_url', 'citation', 'agencies', 'docket_ids', 'president',
];

function text(value) {
  return value == null ? '' : String(value).trim();
}

function plain(value, max) {
  let s = text(value).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  if (max && s.length > max) s = `${s.slice(0, max - 3).trimEnd()}...`;
  return s;
}

function day(value) {
  return text(value).slice(0, 10);
}

/**
 * Federal Register identifiers:
 * "2026-21599", "FR 2026-21599" -> document; "EO 14436", "Executive Order 14436" -> executive order;
 * "Proc 10896", "Proc. 10896", "Proclamation 10896" -> proclamation. "H.R. 906" and "OR HB 4144" return null.
 */
export function parseFrIdentifier(raw) {
  const compact = text(raw).replace(/\./g, '').replace(/\s+/g, ' ').trim();
  const document = compact.match(/^(?:FR|DOC|DOCUMENT|EO|PROC)?\s*(\d{4}-\d{3,6})$/i);
  if (document) return { type: 'document', documentNumber: document[1], number: '' };
  const order = compact.match(/^(?:EO|EXECUTIVE ORDER)\s*(\d{4,5})$/i);
  if (order) return { type: 'eo', documentNumber: '', number: order[1] };
  const proc = compact.match(/^(?:PROC|PROCLAMATION)\s*(\d{4,5})$/i);
  if (proc) return { type: 'proclamation', documentNumber: '', number: proc[1] };
  return null;
}

/** Kept for existing callers: { documentNumber, eoNumber, procNumber } or null */
export function parseExecutiveOrder(raw) {
  const id = parseFrIdentifier(raw);
  if (!id) return null;
  return {
    documentNumber: id.documentNumber,
    eoNumber: id.type === 'eo' ? id.number : '',
    procNumber: id.type === 'proclamation' ? id.number : '',
  };
}

export function isExecutiveOrder(raw) {
  return parseFrIdentifier(raw) != null;
}

export async function frGet(path) {
  const res = await fetch(`${FR_BASE}${path}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'AutoCare-GovernmentAffairs/1.0 (policy widget)',
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = new Error(`Federal Register returned HTTP ${res.status}`);
    err.code = 'UPSTREAM';
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function withFields(params, fields = FR_FIELDS) {
  fields.forEach((f) => params.append('fields[]', f));
  return params;
}

async function documentByNumber(documentNumber) {
  return frGet(`/documents/${encodeURIComponent(documentNumber)}.json?${withFields(new URLSearchParams()).toString()}`);
}

/** Up to 20 document numbers per request */
export async function documentsByNumbers(numbers) {
  const unique = [...new Set(numbers.map(text).filter(Boolean))];
  const out = [];
  for (let i = 0; i < unique.length; i += 20) {
    const chunk = unique.slice(i, i + 20);
    const body = await frGet(`/documents/${chunk.map(encodeURIComponent).join(',')}.json?${withFields(new URLSearchParams()).toString()}`);
    if (!body) continue;
    if (Array.isArray(body.results)) out.push(...body.results);
    else if (body.document_number) out.push(body);
  }
  return out;
}

/** Executive orders by number, many per request */
export async function ordersByNumbers(eoNumbers) {
  const unique = [...new Set(eoNumbers.map(text).filter(Boolean))];
  const out = [];
  for (let i = 0; i < unique.length; i += 20) {
    const params = new URLSearchParams();
    params.set('conditions[presidential_document_type]', 'executive_order');
    unique.slice(i, i + 20).forEach((n) => params.append('conditions[executive_order_numbers][]', n));
    params.set('per_page', '20');
    const body = await frGet(`/documents.json?${withFields(params).toString()}`);
    if (body && Array.isArray(body.results)) out.push(...body.results);
  }
  return out;
}

async function documentByOrderNumber(eoNumber) {
  const rows = await ordersByNumbers([eoNumber]);
  return rows.find((row) => text(row.executive_order_number) === eoNumber) || null;
}

/** The API has no proclamation-number filter, so search the number and keep the exact match */
export async function proclamationByNumber(procNumber) {
  const params = new URLSearchParams();
  params.set('conditions[presidential_document_type]', 'proclamation');
  params.set('conditions[term]', procNumber);
  params.set('per_page', '20');
  const body = await frGet(`/documents.json?${withFields(params).toString()}`);
  const rows = body && Array.isArray(body.results) ? body.results : [];
  return rows.find((row) => text(row.proclamation_number) === procNumber) || null;
}

/** Newest documents for a docket and/or search term, optionally limited to agency slugs */
export async function searchDocuments({ term = '', docket = '', agencies = [], perPage = 10 } = {}) {
  const params = new URLSearchParams();
  if (term) params.set('conditions[term]', term);
  if (docket) params.set('conditions[docket_id]', docket);
  agencies.filter(Boolean).forEach((a) => params.append('conditions[agencies][]', a));
  params.set('order', 'newest');
  params.set('per_page', String(Math.min(Math.max(Number(perPage) || 10, 1), 20)));
  const body = await frGet(`/documents.json?${withFields(params).toString()}`);
  return body && Array.isArray(body.results) ? body.results : [];
}

/** Resolve one parsed identifier to its Federal Register document */
export async function resolveIdentifier(id) {
  if (!id) return null;
  if (id.type === 'document') return documentByNumber(id.documentNumber);
  if (id.type === 'eo') return documentByOrderNumber(id.number);
  if (id.type === 'proclamation') return proclamationByNumber(id.number);
  return null;
}

const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

function isoFromWords(s) {
  const m = text(s).match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if (!m || !MONTHS[m[1].toLowerCase()]) return '';
  return `${m[3]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

const NOTE_LABELS = {
  'see': 'see',
  'amended by': 'amendedBy',
  'amends': 'amends',
  'revoked by': 'revokedBy',
  'revokes': 'revokes',
  'superseded by': 'supersededBy',
  'supersedes': 'supersedes',
  'reinstates': 'reinstates',
  'continued by': 'continuedBy',
  'continues': 'continues',
};

/**
 * executive_order_notes, e.g.
 * "See: EO 14257, April 2, 2025; Proc. 10962, July 30, 2025; Notice of January 12, 2026 (91 FR 1665)\r\nAmended by: EO 14226, March 2, 2025"
 * -> { see: [{ type: 'EO', number: '14257', date: '2025-04-02', label: 'EO 14257' }, ...], amendedBy: [...] }
 */
export function parseNotes(notes) {
  const out = {};
  text(notes).split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Za-z ]+?):\s*(.+)$/);
    if (!m) return;
    const key = NOTE_LABELS[m[1].trim().toLowerCase()];
    if (!key) return;
    const items = m[2].split(';').map((s) => s.trim()).filter(Boolean).map((s) => {
      const eo = s.match(/^EO\s+(\d{4,5})/i);
      const proc = s.match(/^Proc\.?\s+(\d{4,5})/i);
      const cite = (s.match(/\((\d+\s+FR\s+\d+)\)/) || [])[1] || '';
      const date = isoFromWords(s);
      if (eo) return { type: 'EO', number: eo[1], date, label: `EO ${eo[1]}`, citation: cite };
      if (proc) return { type: 'Proclamation', number: proc[1], date, label: `Proc. ${proc[1]}`, citation: cite };
      const kind = /^memo/i.test(s) ? 'Memorandum' : (/^notice/i.test(s) ? 'Notice' : 'Document');
      return { type: kind, number: '', date, label: s.replace(/\s*\(\d+\s+FR\s+\d+\)\s*$/, ''), citation: cite };
    });
    out[key] = (out[key] || []).concat(items);
  });
  return out;
}

export function docType(doc) {
  const sub = text(doc && doc.subtype);
  if (sub) return sub;
  const t = text(doc && doc.type);
  return t === 'Rule' ? 'Final rule' : (t === 'Proposed Rule' ? 'Proposed rule' : t);
}

export function isPresidential(doc) {
  return text(doc && doc.type) === 'Presidential Document' || text(doc && doc.executive_order_number) !== '' || text(doc && doc.proclamation_number) !== '';
}

/** Short label: "EO 14257", "Proc. 10896", else the document number */
export function docLabel(doc) {
  if (text(doc.executive_order_number)) return `EO ${text(doc.executive_order_number)}`;
  if (text(doc.proclamation_number)) return `Proc. ${text(doc.proclamation_number)}`;
  return text(doc.document_number);
}

export function agencyNames(doc) {
  return (Array.isArray(doc.agencies) ? doc.agencies : [])
    .map((agency) => text(agency && (agency.name || agency.raw_name)))
    .filter((name, i, all) => name && all.indexOf(name) === i);
}

/** One timeline row */
export function docSummary(doc) {
  return {
    documentNumber: text(doc.document_number),
    label: docLabel(doc),
    type: docType(doc),
    title: text(doc.title),
    action: text(doc.action),
    signedDate: day(doc.signing_date),
    publicationDate: day(doc.publication_date),
    effectiveDate: day(doc.effective_on),
    commentsCloseDate: day(doc.comments_close_on),
    date: day(doc.signing_date) || day(doc.publication_date),
    agencies: agencyNames(doc),
    citation: text(doc.citation),
    url: text(doc.html_url),
    pdfUrl: text(doc.pdf_url),
    summary: plain(doc.abstract, 400),
  };
}

function normalizeDocument(doc) {
  const documentNumber = text(doc.document_number);
  const display = docLabel(doc);
  const agencies = agencyNames(doc).map((name) => ({ name }));
  const summary = plain(doc.abstract, 700);
  const base = {
    billNumber: display,
    identifier: display,
    documentNumber,
    title: text(doc.title) || display,
    shortTitle: text(doc.title),
    state: '',
    hcKey: '',
    jurisdiction: 'national',
    jurisdictionLabel: 'National',
    jurisdictionName: 'US',
    citation: text(doc.citation),
    publicationDate: day(doc.publication_date),
    effectiveDate: day(doc.effective_on),
    agencies,
    summary,
    overview: summary,
    officialUrl: text(doc.html_url),
    pdfUrl: text(doc.pdf_url),
    projects: [],
    tags: [],
    teamPosition: '',
    teamPositionKey: '',
    teamPriority: '',
    teamPriorityKey: '',
    teamSummary: '',
    teamLinks: [],
    cachedAt: new Date().toISOString(),
    source: 'federal-register',
  };
  if (!isPresidential(doc)) {
    const closes = day(doc.comments_close_on);
    return {
      ...base,
      kind: 'regulation',
      regulationType: docType(doc),
      status: docType(doc),
      statusKey: docType(doc).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      commentDeadline: closes,
      commentOpen: Boolean(closes && closes >= new Date().toISOString().slice(0, 10)),
      lastUpdateDate: day(doc.publication_date),
    };
  }
  const president = text(doc.president && doc.president.name);
  return {
    ...base,
    kind: 'executive-order',
    documentType: docType(doc),
    chamber: '',
    session: text(doc.citation),
    status: 'Signed',
    statusKey: 'signed',
    statusValue: '',
    statusRaw: 'Signed',
    introducedDate: day(doc.signing_date),
    lastAction: '',
    lastActionDate: day(doc.publication_date),
    sponsors: president ? [{ name: president, party: '' }] : [],
  };
}

/**
 * Executive orders, proclamations and Federal Register document numbers are answered from the Federal Register.
 * Returns null when the bill number is none of those, so Congress.gov and PolicyNote still run.
 */
export async function resolveExecutiveOrder(bill, ttlHours, refresh) {
  const id = parseFrIdentifier(bill);
  if (!id) return null;
  if (!refresh) {
    const cached = await getCachedLookup(bill);
    if (cached && cached.source === 'federal-register' && isCacheFresh(cached, ttlHours)) {
      return { ...cached, cache: 'hit' };
    }
  }
  const doc = await resolveIdentifier(id);
  if (!doc || !text(doc.document_number)) {
    const saved = await setCachedLookup(bill, { billNumber: bill, notFound: true, reason: 'not-found', source: 'federal-register' });
    return { ...saved, cache: 'miss' };
  }
  const saved = await setCachedLookup(bill, normalizeDocument(doc));
  return { ...saved, cache: 'miss' };
}
