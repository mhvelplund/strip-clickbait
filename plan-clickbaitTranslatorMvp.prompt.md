# Plan: Firefox Clickbait Translator MVP

Build a Firefox WebExtension (MV2) that adds a right-click “Translate Clickbait” action on links, fetches article
content in the background, generates a descriptive replacement title via direct OpenAI API call (user-configured key),
caches by canonical URL, and reapplies cached titles on future page loads. This prioritizes fastest local MVP while
clearly isolating future migration points for safer key handling.

## Steps

1. Phase 1: Extension skeleton and permissions.
   1. Create manifest and module layout for background, content, and options UI; request menus/contextMenus, storage,
      activeTab/tabs, and host access needed for article fetch + page text updates.
   2. Register right-click menu item visible only in link context and wire click handler to capture selected link URL
      and source tab information.
2. Phase 2: Data model and caching foundations.
   1. Define cache schema keyed by canonical URL with fields: `targetUrl`, `aiTitle`. The `targetUrl` is the
      canonicalized URL used for fetch/summarization, and `aiTitle` is the generated descriptive title. Cached URLs have
      no expiry, but right-clicking the same link will allow the user to regenerate the title.
   2. Implement URL canonicalization: strip fragment, normalize host/protocol, remove common tracking query params;
      preserve content-defining query params.
   3. Add in-flight request deduplication map in background to avoid duplicate summarization for same canonical URL.
      _parallel with step 2.1_
3. Phase 3: Fetch and summarize pipeline.
   1. On context-menu invocation, background fetches article HTML using extension fetch with host permissions.
   2. Extract readable text using a staged approach: Readability parser first, then article/main/body fallback
      heuristics if parse quality is low.
   3. Build prompt with hard output limits where max generated title length = floor(originalLength \* 1.5), and require
      strict JSON response with one title field.
   4. Call OpenAI chat/completions endpoint directly from background using user API key from settings; validate and
      clamp output length if model exceeds limit.
   5. Persist success/failure cache entry; include retry metadata and user-visible status marker.
4. Phase 4: Page mutation and restore behavior.
   1. Send message to content script in source tab to replace the clicked link text immediately with `🤖 <aiTitle>` (or
      configured emoji prefix).
   2. On every page load, content script scans anchors, canonicalizes href, bulk-reads cache, and rewrites matched links
      to cached AI titles.
   3. Add MutationObserver to process newly inserted links for infinite-scroll sites without rescanning full DOM each
      mutation.
5. Phase 5: Settings and local testing UX.
   1. Build options page to configure API key, model, and optional TTL; store the user-provided OpenAI API key in
      browser local storage via browser.storage.local (explicitly documented as MVP-insecure).
   2. Add basic extension-level diagnostics view/log toggle for fetch/summarize/cache events to speed local debugging.
   3. Create local run/test workflow using about:debugging temporary add-on loading and reload cycle.
6. Phase 6: Hardening and forward-compatibility.
   1. Add rate-limit/backoff and timeout guards around OpenAI and article fetch calls.
   2. Add migration seam so summarization provider can switch later from direct OpenAI to proxy/local endpoint with
      minimal code change.

## Relevant files

- /home/mhvelplund/projects/strip-clickbait/manifest.json — extension metadata, permissions, content/background/options
  wiring.
- /home/mhvelplund/projects/strip-clickbait/src/background/index.js — context menu events, orchestration,
  fetch/summarize pipeline.
- /home/mhvelplund/projects/strip-clickbait/src/background/cache.js — canonicalization, schema, TTL, in-flight dedupe.
- /home/mhvelplund/projects/strip-clickbait/src/background/articleExtractor.js — Readability + fallback extraction.
- /home/mhvelplund/projects/strip-clickbait/src/background/openaiClient.js — API request/response validation and
  title-length enforcement.
- /home/mhvelplund/projects/strip-clickbait/src/content/index.js — link replacement, page-load restore, MutationObserver
  updates.
- /home/mhvelplund/projects/strip-clickbait/src/options/index.html — settings UI.
- /home/mhvelplund/projects/strip-clickbait/src/options/index.js — persist/retrieve API key + model settings.
- /home/mhvelplund/projects/strip-clickbait/README.md — local setup, permissions rationale, known security trade-offs.

## Verification

1. Load temporary add-on in Firefox via about:debugging and confirm context menu item appears only when right-clicking a
   link.
2. Trigger Translate Clickbait on a known article link and verify: background fetch succeeds, OpenAI request succeeds,
   link text updates to emoji + descriptive title.
3. Confirm generated title length satisfies max rule: generatedLength <= floor(originalLength \* 1.5).
4. Reload front page and verify cached replacements are reapplied automatically without new API call.
5. Open a page with repeated links to the same article and verify only one summarize request is sent (dedupe).
6. Simulate API failure (bad key/network) and verify graceful fallback marker without breaking original link behavior.
7. Verify MutationObserver updates late-loaded links using existing cache entries.
8. Save API key in options, reload extension/page, and verify the key is retrievable from browser local storage and used
   for subsequent summarize calls.

## Decisions

- Included scope: Firefox-first local MVP, direct OpenAI calls from extension, URL-keyed cache, immediate + persistent
  link rewriting.
- Excluded scope: production-grade secret handling (proxy), Chrome parity, multilingual translation, remote sync,
  publishing to AMO.
- Assumption: rewriting link visible text is acceptable on target sites and may be overridden by site scripts in some
  cases.
- Security note: direct API key storage is accepted for MVP only; migration seam is required for safer future provider
  mode.

## Further Considerations

1. Emoji marker default recommendation: 🤖 for success, ⚠️ for failed summary cache entries.
2. Future upgrade path: provider abstraction interface with implementations for OpenAI-direct, proxy, and local-model
   endpoints.
