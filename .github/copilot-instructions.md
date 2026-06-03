# Copilot Instructions for `strip-clickbait`

## Build, test, and lint commands

- **Run all tests:** `node --test`
- **Run one test file:** `node --test tests/cache.test.mjs` (replace with another `tests/*.test.mjs` file as needed)
- **Build distributable zip (AMO upload artifact):** `mise run build` (creates `dist/strip-clickbait-<version>.zip`)
- **Lint:** no lint command is configured in this repository

## High-level architecture

This is a Firefox WebExtension (Manifest V2) with three execution contexts that communicate through WebExtension messaging and shared storage:

1. **Background (`src/background/`, ES modules)**  
   `index.js` is the orchestrator: registers the context-menu action, runs the summarization pipeline, and handles message-based cache reads from content scripts.
2. **Content script (`src/content/index.js`, classic script)**  
   Updates anchor text in-page, restores cached titles on load, listens for background push updates, and observes dynamically inserted links.
3. **Options UI (`src/options/`)**  
   Persists settings and diagnostics toggle, and exposes cache visibility/clear actions.

Pipeline on right-click:

1. Context menu click in background script
2. Eligibility check in content script (`can-translate-link`) so image-only/non-text links are skipped
3. Background fetch/extract (`articleExtractor.js`)
4. Provider-based summarization (`summarizationProvider.js` → currently `openai-direct` via `openaiClient.js`)
5. Cache write/update (`cache.js`)
6. Background notifies content script to update matching links in the active tab

## Key conventions in this codebase

- **Content script must stay non-module.** Do not add `import`/`export` in `src/content/index.js`.
- **Canonicalization logic is duplicated by design.** Keep URL normalization + tracking-param stripping in sync between:
  - `src/background/cache.js`
  - `src/content/index.js`
- **Cache contract is status-driven.** Cache entries are keyed by canonical URL under `browser.storage.local["cache"]` and use `success | pending | failed`; UI behavior in content/options scripts depends on that exact shape.
- **Use central logging helper in background code.** Prefer `log.debug/info/warn/error` from `src/background/logger.js` over direct `console.*` calls (diagnostics flag gates debug/info only).
- **Background concurrency control is explicit.** Reuse `withDedup` / `isInFlight` from `cache.js` for duplicate-request prevention and `withTimeout` / `withRetry` from `asyncUtils.js` for network operations.
- **Provider additions follow the seam.** New AI backends must be wired through `summarizationProvider.js` and options settings, not called directly from pipeline code.
- **Tests run modules in VM sandboxes.** Keep background modules importable in isolation and avoid assumptions about globals beyond what tests stub.

## Claude

There is additional information in the [CLAUDE.md](../CLAUDE.md) file.
