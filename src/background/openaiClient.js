/**
 * OpenAI summarization client.
 *
 * Calls the chat/completions endpoint to produce a descriptive, non-clickbait
 * replacement title for an article.  The generated title is constrained to at
 * most floor(originalTitle.length * 1.5) characters.  If the model returns a
 * longer string it is hard-clamped here before the result is stored.
 */

import { fetchWithTimeout, withRetry } from "./asyncUtils.js";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const SETTINGS_KEY = "settings";
const API_TIMEOUT_MS = 30_000;

/**
 * Load the user's API key and model from storage.
 * @returns {Promise<{openaiApiKey: string, openaiModel: string}>}
 * @throws {Error} if no API key is configured.
 */
async function loadSettings() {
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  const settings = stored[SETTINGS_KEY] ?? {};
  if (!settings.openaiApiKey) {
    throw new Error(
      "No OpenAI API key configured. Open the extension options page to add one.",
    );
  }
  return {
    openaiApiKey: settings.openaiApiKey,
    openaiModel: settings.openaiModel || "gpt-4o-mini",
  };
}

/**
 * Build the system + user prompt for title generation.
 *
 * @param {string} articleText
 * @param {string} originalTitle
 * @param {number} maxLength
 * @returns {Array<{role: string, content: string}>}
 */
function buildMessages(articleText, originalTitle, maxLength) {
  const system = `You are a professional headline editor. Your job is to replace \
sensationalist or misleading article titles with factual, informative ones.

Rules:
- The replacement title MUST be ≤ ${maxLength} characters (original: ${originalTitle.length}).
- Do NOT use clickbait language, ALL-CAPS words, ellipsis, or rhetorical questions.
- Use active voice and focus on the main factual claim.
- Output ONLY valid JSON — no markdown fences, no extra text.

Required JSON format:
{
  "title": "<your replacement title>"
}`;

  const user = `Original title: "${originalTitle}"

Article text (excerpt):
${articleText.slice(0, 3000)}`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/**
 * Parse and validate the model's JSON response.
 * Returns the title string, hard-clamped to maxLength.
 *
 * @param {string} raw - Raw content string from the model.
 * @param {number} maxLength
 * @returns {string}
 */
function parseTitle(raw, maxLength) {
  let parsed;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    // Model occasionally wraps JSON in markdown fences — strip them.
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      parsed = JSON.parse(match[1].trim());
    } else {
      throw new Error(`Model returned non-JSON response: ${raw.slice(0, 200)}`);
    }
  }

  if (typeof parsed?.title !== "string" || parsed.title.trim() === "") {
    throw new Error(`Unexpected response shape: ${JSON.stringify(parsed)}`);
  }

  const title = parsed.title.trim();
  return title.length <= maxLength
    ? title
    : title.slice(0, maxLength).trimEnd();
}

/**
 * Generate a descriptive replacement title for an article.
 *
 * @param {string} articleText   - Extracted article body text.
 * @param {string} originalTitle - The current (clickbait) link text.
 * @returns {Promise<string>}    - The AI-generated replacement title.
 * @throws {Error}               - On network failure, API error, or missing key.
 */
export async function generateTitle(articleText, originalTitle) {
  const { openaiApiKey, openaiModel } = await loadSettings();
  const maxLength = Math.floor(originalTitle.length * 1.5);

  const messages = buildMessages(articleText, originalTitle, maxLength);

  const response = await withRetry(
    () =>
      fetchWithTimeout(
        OPENAI_API_URL,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openaiApiKey}`,
          },
          body: JSON.stringify({
            model: openaiModel,
            messages,
            temperature: 0.3,
            max_tokens: 120,
            response_format: { type: "json_object" },
          }),
        },
        API_TIMEOUT_MS,
        "OpenAI API request",
      ),
    { maxAttempts: 3, baseDelayMs: 1000 },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `OpenAI API error ${response.status}: ${body.slice(0, 300)}`,
    );
  }

  const data = await response.json();
  const raw = data?.choices?.[0]?.message?.content;

  if (!raw) {
    throw new Error("Empty response from OpenAI API");
  }

  return parseTitle(raw, maxLength);
}
