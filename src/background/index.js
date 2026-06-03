import {
  canonicalizeUrl,
  getEntry,
  setEntry,
  withDedup,
  isInFlight,
  getEntries,
} from "./cache.js";
import { extractArticle } from "./articleExtractor.js";
import { summarize } from "./summarizationProvider.js";
import { detectLanguageFromSourcePage } from "./openaiClient.js";
import { log } from "./logger.js";

const MENU_ID = "translate-clickbait";
const MENU_ALL_ID = "translate-clickbait-all";
const sourcePageLanguageCache = new Map();

function createContextMenu() {
  Promise.allSettled([
    browser.contextMenus.remove(MENU_ID),
    browser.contextMenus.remove(MENU_ALL_ID),
  ]).finally(() => {
    browser.contextMenus.create({
      id: MENU_ID,
      title: "Translate Clickbait",
      contexts: ["link"],
    });
    browser.contextMenus.create({
      id: MENU_ALL_ID,
      title: "Translate Clickbait (All)",
      contexts: ["link"],
    });
  });
}

createContextMenu();

browser.runtime.onInstalled.addListener(() => {
  createContextMenu();
});

browser.runtime.onStartup.addListener(() => {
  createContextMenu();
});

browser.contextMenus.onShown.addListener(async (info, tab) => {
  let visible = false;
  let visibleAll = false;

  if (info.linkUrl && tab && typeof tab.id === "number") {
    try {
      const response = await browser.tabs.sendMessage(tab.id, {
        type: "can-translate-link",
        payload: { linkUrl: info.linkUrl },
      });
      visible = Boolean(response?.eligible);
      visibleAll = visible && Boolean(response?.hasClassAttribute);
    } catch (error) {
      log.debug("Skipping menu visibility eligibility check", tab.id, error?.message);
      visible = false;
      visibleAll = false;
    }
  }

  await browser.contextMenus.update(MENU_ID, { visible });
  await browser.contextMenus.update(MENU_ALL_ID, { visible: visibleAll });
  browser.contextMenus.refresh();
});

/**
 * Notify the content script in a tab about a cache entry update.
 * Silently ignores errors (e.g. tab closed, content script not injected).
 *
 * @param {number} tabId
 * @param {string} linkUrl
 * @param {import('./cache.js').CacheEntry} entry
 */
async function notifyTab(tabId, linkUrl, entry) {
  try {
    await browser.tabs.sendMessage(tabId, {
      type: "translate-clickbait-result",
      payload: { linkUrl, entry },
    });
  } catch (err) {
    log.debug("notifyTab: tab not reachable", tabId, err?.message);
    // Tab may have been closed or the content script may not be ready.
  }
}

/**
 * Fetch, summarize, and cache the article at `linkUrl`.
 * Sends status updates to the originating tab at each stage.
 *
 * @param {string} linkUrl       - Raw link URL from context-menu click.
 * @param {string} originalTitle - Visible link text at click time.
 * @param {number} tabId         - Tab to notify.
 */
async function summarizeAndCache(linkUrl, originalTitle, tabId, sourceLanguage) {
  log.info("summarizeAndCache: started", linkUrl);
  // Mark as pending immediately so the content script can show a spinner.
  const pending = await setEntry(linkUrl, { status: "pending" });
  await notifyTab(tabId, linkUrl, pending);

  try {
    // Fetch the raw URL, but use canonicalized URL as the cache key.
    // (canonicalizeUrl rewrites scheme to https: and strips www., which may fail on HTTP-only or host-specific content)
    const { text, title: pageTitle, language } = await extractArticle(linkUrl);
    // Use the page's <title> as a fallback if the link text is empty.
    const titleForPrompt = originalTitle.trim() || pageTitle || linkUrl;
    const targetLanguage = sourceLanguage || language;
    const aiTitle = await summarize(text, titleForPrompt, targetLanguage);
    log.info("summarizeAndCache: success", { linkUrl, aiTitle });
    const success = await setEntry(linkUrl, { status: "success", aiTitle });
    await notifyTab(tabId, linkUrl, success);
  } catch (error) {
    log.error("summarizeAndCache: failed", linkUrl, error);
    const failed = await setEntry(linkUrl, {
      status: "failed",
      error: error.message ?? String(error),
    });
    await notifyTab(tabId, linkUrl, failed);
  }
}

function getSourcePageLanguageCacheKey(tabId, pageUrl) {
  return `${tabId}:${pageUrl || ""}`;
}

async function getSourcePageLanguage(tabId, pageUrl) {
  const cacheKey = getSourcePageLanguageCacheKey(tabId, pageUrl);
  if (sourcePageLanguageCache.has(cacheKey)) {
    return sourcePageLanguageCache.get(cacheKey);
  }

  const languagePromise = (async () => {
    let sourcePageText = "";
    try {
      const response = await browser.tabs.sendMessage(tabId, {
        type: "get-source-page-language-context",
      });
      sourcePageText = response?.sourcePageText ?? "";
    } catch (error) {
      log.debug("Failed to read source page language context", tabId, error?.message);
      return "";
    }

    if (!sourcePageText.trim()) {
      return "";
    }

    try {
      return await detectLanguageFromSourcePage(sourcePageText);
    } catch (error) {
      log.warn("Source page language detection failed", error?.message);
      return "";
    }
  })();

  sourcePageLanguageCache.set(cacheKey, languagePromise);
  return languagePromise;
}

// ---------- Message handler: cache reads for content scripts ----------

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "get-cache-entries") return false;

  const rawUrls = message.payload?.urls ?? [];
  getEntries(rawUrls).then((entries) => sendResponse({ entries }));
  // Return true to signal we'll call sendResponse asynchronously.
  return true;
});

// ---------- Context menu click ----------

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (
    (info.menuItemId !== MENU_ID && info.menuItemId !== MENU_ALL_ID) ||
    !info.linkUrl ||
    !tab ||
    typeof tab.id !== "number"
  ) {
    return;
  }

  const { linkUrl } = info;
  const tabId = tab.id;
  const pageUrl = info.pageUrl || tab.url || "";
  const sourceLanguage = await getSourcePageLanguage(tabId, pageUrl);
  if (info.menuItemId === MENU_ID) {
    let originalTitle = info.selectionText || "";

    try {
      const response = await browser.tabs.sendMessage(tabId, {
        type: "can-translate-link",
        payload: { linkUrl },
      });
      if (!response?.eligible) {
        return;
      }
      originalTitle = response?.originalTitle?.trim() || originalTitle;
    } catch (error) {
      log.debug("Skipping translation eligibility check", tabId, error?.message);
      return;
    }

    // If already in flight (e.g. double-click), skip a second request.
    if (isInFlight(linkUrl)) {
      return;
    }

    withDedup(linkUrl, () =>
      summarizeAndCache(linkUrl, originalTitle, tabId, sourceLanguage),
    ).catch((error) => {
      console.error("Deduped summarization pipeline failed", linkUrl, error);
    });
    return;
  }

  let response;
  try {
    response = await browser.tabs.sendMessage(tabId, {
      type: "can-translate-link",
      payload: { linkUrl },
    });
  } catch (error) {
    log.debug("Skipping bulk translation eligibility check", tabId, error?.message);
    return;
  }

  if (!response?.eligible || !response?.hasClassAttribute) {
    return;
  }

  let links = [];
  try {
    const candidatesResponse = await browser.tabs.sendMessage(tabId, {
      type: "get-class-link-candidates",
      payload: { linkUrl },
    });
    links = candidatesResponse?.links ?? [];
  } catch (error) {
    log.debug("Failed to fetch class link candidates", tabId, error?.message);
    return;
  }

  for (const candidate of links) {
    if (!candidate?.linkUrl) {
      continue;
    }

    const existing = await getEntry(candidate.linkUrl);
    if (existing?.status === "success") {
      continue;
    }

    if (isInFlight(candidate.linkUrl)) {
      continue;
    }

    const originalTitle = candidate.originalTitle?.trim() || "";
    withDedup(candidate.linkUrl, () =>
      summarizeAndCache(candidate.linkUrl, originalTitle, tabId, sourceLanguage),
    ).catch((error) => {
      console.error(
        "Deduped bulk summarization pipeline failed",
        candidate.linkUrl,
        error,
      );
    });
  }
});
