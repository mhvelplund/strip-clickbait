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

```text
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
| --- | --- |
| **OpenAI API Key** | Your personal [OpenAI API key](https://platform.openai.com/api-keys). Stored in `browser.storage.local`. **Do not share.** |
| **OpenAI Model** | Model used for summarization (default: `gpt-4o-mini`). |
| **Diagnostic logging** | When enabled, `[SCB:DEBUG]` / `[SCB:INFO]` messages appear in the browser console. Warnings and errors are always logged. |

### Cache management

The options page shows a count of cached URLs (success / pending / failed) and provides a **Clear all cached titles**
button to wipe the cache.

> **Security note**: The API key is stored in browser local storage for this MVP. It is not encrypted. Do not use this
> extension on a shared or untrusted machine with a production API key.

## Branch layout

| Branch | Contents |
| --- | --- |
| `main` | Phase 1 — Extension scaffold, context-menu wiring |
| `phase2` | Phase 2 — URL canonicalization, cache schema, in-flight dedupe |
| `phase3` | Phase 3 — Article fetch + OpenAI summarize pipeline |
| `phase4` | Phase 4 — Page link mutation + on-load restore |
| `phase5` | Phase 5 — Diagnostics logger, settings UX, cache management |
| `phase6` | Phase 6 — Timeouts, retry/backoff, provider abstraction seam |

## Architecture

```text
src/background/
   index.js                 — orchestrator: context menu, pipeline, message bus
   cache.js                 — URL canonicalization, storage CRUD, in-flight dedupe
   articleExtractor.js      — fetch + DOM extraction of article body text
   openaiClient.js          — OpenAI chat/completions API call
   summarizationProvider.js — provider abstraction seam (selects active AI backend)
   asyncUtils.js            — withTimeout / withRetry helpers
   logger.js                — gated diagnostic logger ([SCB:*] console output)

src/content/
   index.js                 — classic script: DOM mutation, on-load restore, live updates

src/options/
   index.html               — settings UI
   index.js                 — settings persistence + cache management
```
