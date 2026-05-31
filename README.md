# Strip Clickbait

A Firefox WebExtension (Manifest V2) that translates clickbait article link text into plain, descriptive AI summaries —
right from the context menu.

## What it does

**Phase 3 (current):**
1. Right-click any link → **Translate Clickbait**
2. The extension fetches the linked article in the background.
3. [OpenAI](https://platform.openai.com/) generates a concise, factual replacement title (≤ 1.5× the original title length).
4. Results are cached in local storage for future visits to the same link.

**Phase 4 (planned):**
- The link text on the current page will update immediately to show the AI title, prefixed with 🤖.
- Cached titles will be reapplied automatically on page load — no extra API calls needed.

## Project structure

```
strip-clickbait/
├── manifest.json                  # Extension manifest (MV2)
├── src/
│   ├── background/
│   │   ├── index.js               # Context-menu registration + click handler
│   │   └── cache.js               # URL canonicalization, storage helpers, in-flight dedupe
│   ├── content/
│   │   └── index.js               # DOM link-text replacement + page-load restore
│   └── options/
│       ├── index.html             # Settings page UI
│       └── index.js               # Settings persistence (browser.storage.local)
└── README.md
```

## Local development

### Prerequisites

- Firefox (any recent release)
- No build step required — plain ES modules loaded directly by the browser

### Load the extension in Firefox

1. Open `about:debugging` in Firefox.
2. Click **This Firefox** → **Load Temporary Add-on…**
3. Select `manifest.json` from this directory.
4. The extension is now active for the current browser session.

### Reload after changes

In `about:debugging`, click the **Reload** button next to the extension entry.  
Content scripts take effect on the next page load.

### Inspect logs

- **Background script**: `about:debugging` → Inspect → Console
- **Content script**: DevTools Console on any page (filter by extension name)
- **Storage**: `about:debugging` → Inspect → Storage → Extension Storage

## Configuration

Open the extension options page (toolbar icon → Manage Extension → Preferences, or navigate directly to
`src/options/index.html` in `about:debugging`).

| Setting | Description |
|---|---|
| **OpenAI API Key** | Your personal [OpenAI API key](https://platform.openai.com/api-keys). Stored in `browser.storage.local`. **Do not share.** |
| **OpenAI Model** | Model used for summarization (default: `gpt-4o-mini`). |

> **Security note**: The API key is stored in browser local storage for this MVP. It is not encrypted. Do not use this
> extension on a shared or untrusted machine with a production API key.

## Known issues

- **`src/background/cache.js:canonicalizeUrl()` — Default port stripping ineffective (line 72)**  
  The protocol is normalized to HTTPS before checking for default ports, so URLs like `http://example.com:80/` become `https://example.com:80/` (port not removed). *Proposed fix:* Strip ports before or during protocol normalization to ensure stable cache keys.

- **`src/background/cache.js:canonicalizeUrl()` — Query parameter order affects cache key (line 84)**  
  URLs with identical query params in different orders (e.g., `?a=1&b=2` vs `?b=2&a=1`) produce different canonical URLs, causing unnecessary cache misses. *Proposed fix:* Sort query parameters alphabetically before building the canonical URL.

- **`src/background/cache.js:setEntry()` — Concurrent cache writes can lose entries (line 146)**  
  The function performs a read-modify-write of the entire cache object in `browser.storage.local`. If `setEntry()` is called concurrently for different URLs, the last writer can overwrite earlier updates from stale snapshots. *Proposed fix:* Serialize cache writes or store entries under separate storage keys to avoid race conditions. (This helper is not used by the current extension flow, so it is non-blocking for Phase 2.)

- **`src/background/index.js:summarizeAndCache()` — Stale error messages on success regeneration (line 68)**  
  When `setEntry()` is called with `{ status: "success", aiTitle }` after a previous failure, the function merges the update into the existing entry but does not clear the `error` field. This leaves old error messages in the cached entry. *Proposed fix:* Explicitly clear the `error` field when setting status to "success".

- **`src/background/index.js:summarizeAndCache()` — Stale aiTitle on failure (line 75)**  
  When `setEntry()` is called after a failure, it merges the update into the existing entry but does not clear `aiTitle`, leaving stale generated titles in failed entries. This makes the cache state ambiguous for consumers. *Proposed fix:* Clear `aiTitle` when status is set to "failed".

## Branch layout

| Branch | Contents |
|---|---|
| `main` | Phase 1 — Extension scaffold, context-menu wiring |
| `phase2` | Phase 2 — URL canonicalization, cache schema, in-flight dedupe |
| `phase3` | Phase 3 — Article fetch + OpenAI summarize pipeline |
| `phase4` | Phase 4 — Page link mutation + on-load restore |
| `phase5` | Phase 5 — Settings UX + local testing docs |
| `phase6` | Phase 6 — Hardening, retries, provider abstraction |
