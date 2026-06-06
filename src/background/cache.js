/**
 * Cache schema
 * Each entry is keyed by canonical URL in browser.storage.local under
 * the "cache" namespace: { "cache": { [canonicalUrl]: CacheEntry } }
 *
 * @typedef {Object} CacheEntry
 * @property {string} targetUrl  - Canonical URL used for fetch/summarization.
 * @property {string} aiTitle    - Generated descriptive title.
 * @property {"success"|"pending"|"failed"} status
 * @property {number} createdAt  - Epoch ms.
 * @property {number} updatedAt  - Epoch ms.
 * @property {string|null} error - Error message when status === "failed".
 */

const CACHE_STORAGE_KEY = "cache";
let cacheWriteQueue = Promise.resolve();

// ---------- Tracking params stripped during canonicalization ----------
const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "utm_id",
  "utm_source_platform",
  "gclid",
  "gclsrc",
  "dclid",
  "fbclid",
  "fref",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "ref",
  "referrer",
  "click_id",
  "c_id",
  "aff_id",
  "tracking_id",
  "sid",
  "tid",
  "visitor_id",
]);

/**
 * Return a stable canonical URL string suitable for use as a cache key.
 * - Normalises protocol to https
 * - Lowercases hostname, strips leading www.
 * - Removes default ports (80/443)
 * - Removes trailing slash from non-root paths
 * - Strips URL fragment
 * - Removes well-known tracking query params; preserves the rest
 *
 * @param {string} rawUrl
 * @returns {string}
 */
export function canonicalizeUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  u.protocol = "https:";
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");

  if (
    (u.port === "80" && u.protocol === "http:") ||
    (u.port === "443" && u.protocol === "https:")
  ) {
    u.port = "";
  }

  u.hash = "";

  const params = new URLSearchParams(u.search);
  /** @type {Array<[string, string]>} */
  const sortedParams = [];
  params.forEach((value, key) => {
    if (!TRACKING_PARAMS.has(key.toLowerCase())) {
      sortedParams.push([key, value]);
    }
  });
  sortedParams.sort(([leftKey, leftValue], [rightKey, rightValue]) => {
    const keyCompare = leftKey.localeCompare(rightKey);
    if (keyCompare !== 0) {
      return keyCompare;
    }
    return leftValue.localeCompare(rightValue);
  });
  const normalizedParams = new URLSearchParams();
  for (const [key, value] of sortedParams) {
    normalizedParams.append(key, value);
  }
  u.search = normalizedParams.toString();

  if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
    u.pathname = u.pathname.slice(0, -1);
  }

  return u.href;
}

// ---------- Storage helpers ----------

/**
 * Load the full cache map from storage.
 * @returns {Promise<Record<string, import('./cache.js').CacheEntry>>}
 */
async function loadCache() {
  const stored = await browser.storage.local.get(CACHE_STORAGE_KEY);
  return stored[CACHE_STORAGE_KEY] ?? {};
}

/**
 * Persist the full cache map to storage.
 * @param {Record<string, import('./cache.js').CacheEntry>} cache
 */
async function saveCache(cache) {
  await browser.storage.local.set({ [CACHE_STORAGE_KEY]: cache });
}

/**
 * Read a single entry by raw URL (canonicalized internally).
 * @param {string} rawUrl
 * @returns {Promise<import('./cache.js').CacheEntry|null>}
 */
export async function getEntry(rawUrl) {
  const key = canonicalizeUrl(rawUrl);
  const cache = await loadCache();
  return cache[key] ?? null;
}

/**
 * Write a single entry by raw URL.
 * @param {string} rawUrl
 * @param {Partial<import('./cache.js').CacheEntry>} fields
 */
export async function setEntry(rawUrl, fields) {
  const operation = cacheWriteQueue.catch(() => {}).then(async () => {
    const key = canonicalizeUrl(rawUrl);
    const cache = await loadCache();
    const now = Date.now();
    const existing = cache[key];
    const nextEntry = {
      targetUrl: key,
      aiTitle: "",
      status: "pending",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      error: null,
      ...existing,
      ...fields,
      targetUrl: key,
      updatedAt: now,
    };

    if (nextEntry.status === "pending") {
      nextEntry.aiTitle = "";
      nextEntry.error = null;
    } else if (nextEntry.status === "success") {
      nextEntry.error = null;
    } else if (nextEntry.status === "failed") {
      nextEntry.aiTitle = "";
    }

    cache[key] = nextEntry;
    await saveCache(cache);
    return nextEntry;
  });

  cacheWriteQueue = operation.then(
    () => undefined,
    () => undefined,
  );

  return operation;
}

/**
 * Bulk-read multiple URLs at once (single storage round-trip).
 * Returns a map from canonical URL → entry (only for URLs that have an entry).
 * @param {string[]} rawUrls
 * @returns {Promise<Record<string, import('./cache.js').CacheEntry>>}
 */
export async function getEntries(rawUrls) {
  const cache = await loadCache();
  const result = {};
  for (const rawUrl of rawUrls) {
    const key = canonicalizeUrl(rawUrl);
    if (cache[key]) {
      result[key] = cache[key];
    }
  }
  return result;
}

// ---------- In-flight request deduplication ----------

/**
 * Map from canonical URL → Promise<CacheEntry> for requests currently in
 * progress. Prevents duplicate summarization calls for the same URL.
 * @type {Map<string, Promise<import('./cache.js').CacheEntry>>}
 */
const inFlight = new Map();

/**
 * Execute `work` for `rawUrl` exactly once even if called concurrently.
 * Callers that arrive while a request is already running receive the same
 * promise and share the result.
 *
 * @param {string} rawUrl
 * @param {() => Promise<import('./cache.js').CacheEntry>} work
 * @returns {Promise<import('./cache.js').CacheEntry>}
 */
export function withDedup(rawUrl, work) {
  const key = canonicalizeUrl(rawUrl);
  if (inFlight.has(key)) {
    return inFlight.get(key);
  }
  const promise = work().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

/**
 * Return true if a summarization request for this URL is already in flight.
 * @param {string} rawUrl
 * @returns {boolean}
 */
export function isInFlight(rawUrl) {
  return inFlight.has(canonicalizeUrl(rawUrl));
}
