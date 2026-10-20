import { connectLambda, getStore } from '@netlify/blobs';
import { normalizeBillKey } from './normalize.mjs';

const STORE_NAME = 'ga-policy-note-cache';

/** "Not found" answers are cached briefly so a typo'd bill number doesn't hit Policy Note on every page view */
const NOT_FOUND_TTL_HOURS = 12;

/** Bump when the cached record shape changes so older entries are fetched again (2 = projects / tags, 3 = overview / team fields) */
const CACHE_VERSION = 3;

/**
 * Lambda-style handlers (export async function handler) must hand the event to Blobs
 * before getStore() can find the site's credentials.
 */
export function connectBlobs(event) {
  try {
    if (event && event.blobs) connectLambda(event);
  } catch {
    /* cache becomes a no-op; lookups still work */
  }
}

function getCacheStore() {
  try {
    return getStore({ name: STORE_NAME, consistency: 'strong' });
  } catch {
    return null;
  }
}

function cacheKey(billNumber) {
  return `bill:${normalizeBillKey(billNumber)}`;
}

export async function getCachedLookup(billNumber) {
  if (!normalizeBillKey(billNumber)) return null;
  const store = getCacheStore();
  if (!store) return null;
  try {
    return await store.get(cacheKey(billNumber), { type: 'json' });
  } catch {
    return null;
  }
}

export async function setCachedLookup(billNumber, payload) {
  const entry = { ...payload, cachedAt: payload.cachedAt || new Date().toISOString(), cacheVersion: CACHE_VERSION };
  if (!normalizeBillKey(billNumber)) return entry;
  const store = getCacheStore();
  if (!store) return entry;
  try {
    await store.setJSON(cacheKey(billNumber), entry);
  } catch {
    /* fail soft: return the fresh lookup even if it couldn't be cached */
  }
  return entry;
}

/** Non-bill values (e.g. the project / tag list) */
export async function getCachedValue(key) {
  const store = getCacheStore();
  if (!store) return null;
  try {
    return await store.get(`value:${key}`, { type: 'json' });
  } catch {
    return null;
  }
}

export async function setCachedValue(key, payload) {
  const entry = { ...payload, cachedAt: new Date().toISOString(), cacheVersion: CACHE_VERSION };
  const store = getCacheStore();
  if (!store) return entry;
  try {
    await store.setJSON(`value:${key}`, entry);
  } catch {
    /* fail soft */
  }
  return entry;
}

export function isCacheFresh(entry, ttlHours) {
  if (!entry || !entry.cachedAt || entry.cacheVersion !== CACHE_VERSION) return false;
  const hours = entry.notFound ? NOT_FOUND_TTL_HOURS : Number(ttlHours);
  const ttlMs = (Number.isFinite(hours) && hours > 0 ? hours : 168) * 60 * 60 * 1000;
  const age = Date.now() - Date.parse(entry.cachedAt);
  return Number.isFinite(age) && age >= 0 && age < ttlMs;
}
