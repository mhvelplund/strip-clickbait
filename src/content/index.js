/**
 * Content script — link text replacement and on-load cache restore.
 *
 * MV2 content scripts run as classic (non-module) scripts, so this file
 * uses no import/export syntax.  Cache reads go through a message to the
 * background script; canonicalizeUrl is inlined here.
 *
 * Responsibilities:
 *   1. On page load: scan all <a> elements, bulk-read the cache via the
 *      background, rewrite links that have a cached entry.
 *   2. Listen for background push messages (pipeline status updates) and
 *      immediately apply them to matching links on this page.
 *   3. MutationObserver catches links inserted after the initial load
 *      (infinite scroll, SPA navigation) and applies cached titles to them.
 */

/* global browser */

const EMOJI_SUCCESS = "🤖";
const EMOJI_PENDING = "⏳";
const EMOJI_FAILED  = "⚠️";

const ATTR_ORIGINAL = "data-scb-original";
const ATTR_KEY      = "data-scb-key";

// ---------- Inline canonicalizeUrl (kept in sync with cache.js) ----------

const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
  "utm_id", "utm_source_platform",
  "gclid", "gclsrc", "dclid",
  "fbclid", "fref",
  "msclkid",
  "mc_cid", "mc_eid",
  "ref", "referrer",
  "click_id", "c_id", "aff_id", "tracking_id",
  "sid", "tid", "visitor_id",
]);

function canonicalizeUrl(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return rawUrl; }
  u.protocol = "https:";
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
  if ((u.port === "80" && u.protocol === "http:") ||
      (u.port === "443" && u.protocol === "https:")) {
    u.port = "";
  }
  u.hash = "";
  const params = new URLSearchParams(u.search);
  for (const key of [...params.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) params.delete(key);
  }
  u.search = params.toString();
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
    u.pathname = u.pathname.slice(0, -1);
  }
  return u.href;
}

// ---------- DOM helpers ----------

function keyFor(a) {
  if (!a.dataset.scbKey) {
    a.dataset.scbKey = canonicalizeUrl(a.href);
  }
  return a.dataset.scbKey;
}

function applyEntry(a, entry) {
  if (!a.hasAttribute(ATTR_ORIGINAL)) {
    a.setAttribute(ATTR_ORIGINAL, a.textContent);
  }
  switch (entry.status) {
    case "success":
      a.textContent = `${EMOJI_SUCCESS} ${entry.aiTitle}`;
      a.title = `AI summary. Original: ${a.getAttribute(ATTR_ORIGINAL)}`;
      break;
    case "pending":
      a.textContent = `${EMOJI_PENDING} ${a.getAttribute(ATTR_ORIGINAL)}`;
      a.title = "Summarizing…";
      break;
    case "failed":
      a.textContent = `${EMOJI_FAILED} ${a.getAttribute(ATTR_ORIGINAL)}`;
      a.title = `Summary failed: ${entry.error ?? "unknown error"}`;
      break;
  }
}

// ---------- Cache read via background message ----------

async function fetchCacheEntries(rawUrls) {
  try {
    const response = await browser.runtime.sendMessage({
      type: "get-cache-entries",
      payload: { urls: rawUrls },
    });
    return response?.entries ?? {};
  } catch {
    return {};
  }
}

// ---------- Batch restore ----------

async function restoreFromCache(anchors) {
  const list = Array.from(anchors).filter(
    (a) => a.href && a.href.startsWith("http")
  );
  if (list.length === 0) return;

  const cached = await fetchCacheEntries(list.map((a) => a.href));

  for (const a of list) {
    const entry = cached[keyFor(a)];
    if (entry) applyEntry(a, entry);
  }
}

restoreFromCache(document.querySelectorAll("a[href]"));

// ---------- MutationObserver ----------

const observer = new MutationObserver((mutations) => {
  const newAnchors = [];
  for (const m of mutations) {
    for (const node of m.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      if (node.tagName === "A") {
        newAnchors.push(node);
      } else {
        newAnchors.push(...node.querySelectorAll("a[href]"));
      }
    }
  }
  if (newAnchors.length > 0) {
    restoreFromCache(newAnchors);
  }
});

observer.observe(document.body, { childList: true, subtree: true });

// ---------- Live update listener ----------

browser.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "translate-clickbait-result") return;

  const { linkUrl, entry } = message.payload ?? {};
  if (!linkUrl || !entry) return;

  const canonicalKey = canonicalizeUrl(linkUrl);

  for (const a of document.querySelectorAll("a[href]")) {
    if (keyFor(a) === canonicalKey) {
      applyEntry(a, entry);
    }
  }
});


const EMOJI_SUCCESS = "🤖";
const EMOJI_PENDING = "⏳";
const EMOJI_FAILED  = "⚠️";

// Attribute used to mark links that have been processed, storing original text.
const ATTR_ORIGINAL = "data-scb-original";
// Attribute storing the canonical URL (avoids repeated canonicalization).
const ATTR_KEY      = "data-scb-key";

// ---------- DOM helpers ----------

/**
 * Return the canonical URL for an anchor element, caching it in a data attr.
 * @param {HTMLAnchorElement} a
 * @returns {string}
 */
function keyFor(a) {
  if (!a.dataset.scbKey) {
    a.dataset.scbKey = canonicalizeUrl(a.href);
  }
  return a.dataset.scbKey;
}

/**
 * Rewrite a link's text content to show the AI title.
 * Stores the original text the first time so it can be preserved in the DOM.
 *
 * @param {HTMLAnchorElement} a
 * @param {import('../background/cache.js').CacheEntry} entry
 */
function applyEntry(a, entry) {
  if (!a.hasAttribute(ATTR_ORIGINAL)) {
    a.setAttribute(ATTR_ORIGINAL, a.textContent);
  }

  switch (entry.status) {
    case "success":
      a.textContent = `${EMOJI_SUCCESS} ${entry.aiTitle}`;
      a.title = `AI summary. Original: ${a.getAttribute(ATTR_ORIGINAL)}`;
      break;
    case "pending":
      a.textContent = `${EMOJI_PENDING} ${a.getAttribute(ATTR_ORIGINAL)}`;
      a.title = "Summarizing…";
      break;
    case "failed":
      // Restore original text; add a subtle warning indicator.
      a.textContent = `${EMOJI_FAILED} ${a.getAttribute(ATTR_ORIGINAL)}`;
      a.title = `Summary failed: ${entry.error ?? "unknown error"}`;
      break;
  }
}

// ---------- Batch restore on page load ----------

/**
 * Collect all anchor elements and apply any cached titles in a single
 * storage round-trip.
 *
 * @param {NodeList|HTMLAnchorElement[]} anchors
 */
async function restoreFromCache(anchors) {
  const list = Array.from(anchors).filter(
    (a) => a.href && a.href.startsWith("http")
  );
  if (list.length === 0) return;

  const rawUrls = list.map((a) => a.href);
  const cached = await getEntries(rawUrls);

  for (const a of list) {
    const entry = cached[keyFor(a)];
    if (entry) applyEntry(a, entry);
  }
}

// Initial restore when the content script first runs.
restoreFromCache(document.querySelectorAll("a[href]"));

// ---------- MutationObserver for dynamically inserted links ----------

const observer = new MutationObserver((mutations) => {
  const newAnchors = [];
  for (const m of mutations) {
    for (const node of m.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      if (node.tagName === "A") {
        newAnchors.push(node);
      } else {
        newAnchors.push(...node.querySelectorAll("a[href]"));
      }
    }
  }
  if (newAnchors.length > 0) {
    restoreFromCache(newAnchors);
  }
});

observer.observe(document.body, { childList: true, subtree: true });

// ---------- Message listener for live pipeline updates ----------

browser.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "translate-clickbait-result") return;

  const { linkUrl, entry } = message.payload ?? {};
  if (!linkUrl || !entry) return;

  const canonicalKey = canonicalizeUrl(linkUrl);

  // Update every anchor on this page that points to the same canonical URL.
  for (const a of document.querySelectorAll("a[href]")) {
    if (keyFor(a) === canonicalKey) {
      applyEntry(a, entry);
    }
  }
});

