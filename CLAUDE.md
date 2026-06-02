# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Firefox WebExtension (Manifest V2) that replaces clickbait link text with AI-generated
descriptive titles via the right-click context menu. There is **no build step and no
`package.json`** — source is plain ES modules loaded directly by Firefox.

## Commands

- Run all tests: `node --test` (uses the built-in `node:test` runner; test files are `tests/*.test.mjs`)
- Run a single test file: `node --test tests/cache.test.mjs`
- Toolchain is pinned via `mise.toml` (`node = "lts"`, `gh = "latest"`); run `mise install` if needed.

There is no lint or build command — load/reload the extension manually in Firefox `about:debugging`
("This Firefox" → "Load Temporary Add-on…" → select `manifest.json`; click **Reload** after changes,
and reload the page for content-script changes).

## Architecture

Three WebExtension execution contexts, each with different rules:

- **`src/background/`** — module-type background scripts (`"type": "module"` in manifest).
  `index.js` is the orchestrator: registers the context menu, runs the pipeline, owns the message bus.
  Pipeline on click: `articleExtractor.js` (fetch + extract article text) → `summarizationProvider.js`
  (provider seam, selects backend from `settings.provider`, default `openai-direct`) → `openaiClient.js`
  (OpenAI chat call) → `cache.js` (store) → message the content script to update the DOM.
- **`src/content/index.js`** — **classic (non-module) content script. Do NOT add `import`/`export`
  here.** It mutates link text, restores cached titles on page load, and reads cache state only by
  sending `browser.runtime` messages to the background script (it cannot import `cache.js`).
- **`src/options/`** — settings page (`index.html` + `index.js`).

Cross-cutting background helpers: `asyncUtils.js` (`withTimeout`, `withRetry`), `logger.js`
(gated `[SCB:*]` logging via `log.debug/info/warn/error` — debug/info gated on the diagnostics flag,
warn/error always emitted).

## Caching

Entries are keyed by **canonicalized URL** (tracking params like `utm_*`, `click_id`, `mc_cid`, `ref`
are stripped — see the strip list in both `cache.js` and `content/index.js`) under the `"cache"`
namespace in `browser.storage.local`. Each entry has a status of `success` / `pending` / `failed`.
Concurrent/duplicate requests for the same URL are deduplicated in-flight (`withDedup` / `isInFlight`).

## Settings

Persisted in `browser.storage.local`:
- Key `settings`: `openaiApiKey`, `openaiModel` (default `gpt-4o-mini`), `openaiMaxLengthFactor`
  (default `2.0` — title length cap is `floor(originalTitle.length * factor)`), `provider`.
- Key `diagnosticsEnabled` (separate top-level key): toggles `[SCB:DEBUG]`/`[SCB:INFO]` logging.

## Testing conventions

Tests use `node:test` + `node:assert/strict` and load source files into a **`vm` sandbox** with
stubbed `browser.*` APIs and globals (`fetch`, `setTimeout`, etc.). Practical consequences when
editing source:
- Keep background modules importable in isolation and avoid relying on globals that the sandbox
  does not provide.
- The content script must remain a classic script (string-loaded and `eval`'d in the sandbox).
- When adding a feature, add/adjust a matching `tests/*.test.mjs` first (TDD) and keep `node --test` green.
