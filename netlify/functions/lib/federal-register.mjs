import { getCachedLookup, isCacheFresh, setCachedLookup } from './cache.mjs';

function text(value) {
  return value == null ? '' : String(value).trim();
}

function plain(value, max) {
  let s = text(value).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  if (max && s.length > max) s = `${s.slice(0, max - 3).trimEnd()}...`;
  return s;
}

/**
 * Bill_number values that are a Federal Register document number, or an executive order number.
 * "2026-21599", "FR 2026-21599", "EO 14436", "Executive Order 14436".
 * "H.R. 906" and "OR HB 4144" return null.
 */
export function parseExecutiveOrder(raw) {
  const compact = text(raw).replace(/\./g, '').replace(/\s+/g, ' ').trim();
  const document = compact.match(/^(?:FR|DOC|DOCUMENT|EO|EXECUTIVE ORDER)?\s*(\d{4}-\d{3,6})$/i);
  if (document) return { documentNumber: document[1], eoNumber: '' };
  const order = compact.match(/^(?:EO|EXECUTIVE ORDER)\s+(\d{4,5})$/i);
  if (order) return { documentNumber: '', eoNumber: order[1] };
  return null;
}

export function isExecutiveOrder(raw) {
  return parseExecutiveOrder(raw) != null;
}

async function frGet(path) {
  const res = await fetch(`https://www.federalregister.gov/api/v1${path}`, {
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

async function documentByNumber(documentNumber) {
  return frGet(`/documents/${encodeURIComponent(documentNumber)}.json`);
}

async function documentByOrderNumber(eoNumber) {
  const params = new URLSearchParams();
  params.set('conditions[presidential_document_type]', 'executive_order');
  params.set('conditions[term]', eoNumber);
  params.set('per_page', '20');
  params.append('fields[]', 'document_number');
  params.append('fields[]', 'executive_order_number');
  const body = await frGet(`/documents.json?${params.toString()}`);
  const rows = body && Array.isArray(body.results) ? body.results : [];
  const match = rows.find((row) => text(row.executive_order_number) === eoNumber) || rows[0];
  if (!match || !match.document_number) return null;
  return documentByNumber(match.document_number);
}

function isOrder(doc) {
  if (!doc) return false;
  if (text(doc.subtype).toLowerCase() === 'executive order') return true;
  return text(doc.executive_order_number) !== '';
}

function normalizeOrder(doc) {
  const eo = text(doc.executive_order_number);
  const documentNumber = text(doc.document_number);
  const display = eo ? `EO ${eo}` : documentNumber;
  const agencies = (Array.isArray(doc.agencies) ? doc.agencies : [])
    .map((agency) => ({ name: text(agency && (agency.name || agency.raw_name)) }))
    .filter((agency) => agency.name);
  const president = text(doc.president && doc.president.name);
  const summary = plain(doc.abstract, 700);
  return {
    kind: 'executive-order',
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
    chamber: '',
    session: text(doc.citation),
    citation: text(doc.citation),
    status: 'Signed',
    statusKey: 'signed',
    statusValue: '',
    statusRaw: 'Signed',
    introducedDate: text(doc.signing_date).slice(0, 10),
    publicationDate: text(doc.publication_date).slice(0, 10),
    effectiveDate: text(doc.effective_on).slice(0, 10),
    lastAction: '',
    lastActionDate: text(doc.publication_date).slice(0, 10),
    sponsors: president ? [{ name: president, party: '' }] : [],
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
}

/**
 * Executive orders are answered from the Federal Register. Returns null when the
 * bill number is not a document number or EO number, so Congress.gov and PolicyNote still run.
 */
export async function resolveExecutiveOrder(bill, ttlHours, refresh) {
  if (!isExecutiveOrder(bill)) return null;
  if (!refresh) {
    const cached = await getCachedLookup(bill);
    if (cached && cached.source === 'federal-register' && isCacheFresh(cached, ttlHours)) {
      return { ...cached, cache: 'hit' };
    }
  }
  try {
    const parsed = parseExecutiveOrder(bill);
    const doc = parsed.documentNumber
      ? await documentByNumber(parsed.documentNumber)
      : await documentByOrderNumber(parsed.eoNumber);
    if (!doc || !isOrder(doc)) {
      const saved = await setCachedLookup(bill, { billNumber: bill, notFound: true, reason: 'not-found', source: 'federal-register' });
      return { ...saved, cache: 'miss' };
    }
    const saved = await setCachedLookup(bill, normalizeOrder(doc));
    return { ...saved, cache: 'miss' };
  } catch (err) {
    if (err.code === 'NOT_FOUND') {
      const saved = await setCachedLookup(bill, { billNumber: bill, notFound: true, reason: 'not-found', source: 'federal-register' });
      return { ...saved, cache: 'miss' };
    }
    throw err;
  }
}
