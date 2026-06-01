/**
 * Article text extraction.
 *
 * Strategy:
 *   1. Fetch the article HTML from the background (no CORS restrictions).
 *   2. Parse it into a lightweight DOM via DOMParser (available in background
 *      service scripts via Firefox's DOMParser global).
 *   3. Try known semantic containers in priority order; pick the first whose
 *      trimmed text exceeds MIN_CONTENT_LENGTH characters.
 *   4. Fall back to <body> text if nothing else is long enough.
 *
 * We deliberately avoid shipping Readability.js as a dependency for this MVP
 * so the extension requires no build step.  The heuristic extraction covers
 * the vast majority of article pages.  A bundled Readability import can be
 * swapped in at Phase 6 hardening with no API-surface change.
 */

import { fetchWithTimeout, withRetry } from "./asyncUtils.js";

const MIN_CONTENT_LENGTH = 300;
const MAX_CONTENT_LENGTH = 12000; // ~3 000 tokens; keep OpenAI costs low

/** Candidate CSS selectors tried in priority order. */
const CONTENT_SELECTORS = [
  "article",
  '[role="article"]',
  "main article",
  "main",
  '[role="main"]',
  ".post-content",
  ".entry-content",
  ".article-body",
  ".story-body",
  ".content",
  ".post",
  ".entry",
];

/**
 * Fetch and extract the readable text of an article at `url`.
 *
 * @param {string} url - The canonical article URL to fetch.
 * @returns {Promise<{text: string, title: string}>}
 * @throws {Error} if the fetch fails or yields no usable content.
 */
const FETCH_TIMEOUT_MS = 15_000;

export async function extractArticle(url) {
  const response = await withRetry(
    () =>
      fetchWithTimeout(
        url,
        { credentials: "omit", redirect: "follow" },
        FETCH_TIMEOUT_MS,
        "article fetch",
      ),
    { maxAttempts: 3, baseDelayMs: 500 },
  );

  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const doc = new DOMParser().parseFromString(html, "text/html");

  // Remove noise elements that inflate text length without adding content.
  for (const el of doc.querySelectorAll(
    "script, style, noscript, nav, header, footer, aside, [aria-hidden='true']",
  )) {
    el.remove();
  }

  const pageTitle = doc.title?.trim() ?? "";
  const text = extractText(doc);
  const language = detectArticleLanguage(doc);

  if (!text) {
    throw new Error("No readable content found on page");
  }

  return {
    text: text.slice(0, MAX_CONTENT_LENGTH),
    title: pageTitle,
    language,
  };
}

/**
 * Detect the article language from page metadata.
 * Falls back to an empty string when the page does not expose a language hint.
 *
 * @param {Document} doc
 * @returns {string}
 */
export function detectArticleLanguage(doc) {
  const candidates = [
    doc.documentElement?.lang,
    doc.querySelector('meta[http-equiv="content-language"]')?.getAttribute("content"),
    doc.querySelector('meta[name="language"]')?.getAttribute("content"),
    doc.querySelector('meta[property="og:locale"]')?.getAttribute("content"),
  ];

  for (const candidate of candidates) {
    const language = normalizeLanguageTag(candidate);
    if (language) {
      return language;
    }
  }

  return "";
}

/**
 * Walk candidate selectors and return the first sufficiently long text block.
 * Falls back to body text.
 *
 * @param {Document} doc
 * @returns {string}
 */
function extractText(doc) {
  for (const selector of CONTENT_SELECTORS) {
    const el = doc.querySelector(selector);
    if (!el) continue;
    const text = collapseWhitespace(el.textContent);
    if (text.length >= MIN_CONTENT_LENGTH) {
      return text;
    }
  }
  // Last resort
  return collapseWhitespace(doc.body?.textContent ?? "");
}

/**
 * Collapse runs of whitespace / newlines into single spaces.
 * @param {string} raw
 * @returns {string}
 */
function collapseWhitespace(raw) {
  return (raw ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Normalize a language tag so prompt instructions stay compact and readable.
 *
 * @param {string | null | undefined} raw
 * @returns {string}
 */
function normalizeLanguageTag(raw) {
  if (!raw) {
    return "";
  }

  const first = raw.split(",")[0]?.trim().replace(/_/g, "-").toLowerCase();
  return first ?? "";
}
