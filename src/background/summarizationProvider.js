/**
 * Summarization provider abstraction.
 *
 * All summarization calls in the extension flow through `summarize()`.  The
 * active provider is selected at call time based on the settings stored in
 * browser.storage.local.  Adding a new provider (e.g. a self-hosted proxy or
 * a local Ollama endpoint) requires only:
 *   1. Implementing the `SummarizationProvider` interface below.
 *   2. Adding a branch in `getProvider()`.
 *   3. Exposing the selection in the options page.
 *
 * Current providers
 * -----------------
 *   "openai-direct"  (default) — calls api.openai.com directly using the
 *                                 user's API key stored in local storage.
 *
 * Future providers (not yet implemented)
 * -----------------------------------------
 *   "proxy"          — forwards requests to a user-configured backend URL.
 *   "local"          — calls a local model endpoint (e.g. Ollama on localhost).
 */

import { generateTitle as openaiGenerateTitle } from "./openaiClient.js";

/**
 * @typedef {Object} SummarizationProvider
 * @property {string} id
 * @property {(articleText: string, originalTitle: string, articleLanguage?: string) => Promise<string>} generateTitle
 */

/** @type {SummarizationProvider} */
const openaiDirectProvider = {
  id: "openai-direct",
  generateTitle: openaiGenerateTitle,
};

/**
 * Return the active provider based on the current settings.
 * Falls back to openai-direct if no provider is configured.
 *
 * @returns {Promise<SummarizationProvider>}
 */
async function getProvider() {
  const stored = await browser.storage.local.get("settings");
  const provider = stored?.settings?.provider ?? "openai-direct";

  switch (provider) {
    case "openai-direct":
      return openaiDirectProvider;
    default:
      // Unknown provider — fall back gracefully.
      return openaiDirectProvider;
  }
}

/**
 * Generate a descriptive replacement title using the active provider.
 *
 * @param {string} articleText
 * @param {string} originalTitle
 * @returns {Promise<string>}
 */
export async function summarize(articleText, originalTitle) {
  const provider = await getProvider();
  return provider.generateTitle(articleText, originalTitle);
}
