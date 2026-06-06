import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..");

function moduleUrl(relativePath) {
  return `${pathToFileURL(path.join(repoRoot, relativePath)).href}?t=${Date.now()}-${Math.random()}`;
}

async function importAsyncUtils() {
  return import(moduleUrl("src/background/asyncUtils.js"));
}

async function importArticleExtractor() {
  return import(moduleUrl("src/background/articleExtractor.js"));
}

async function importOpenAiClient() {
  return import(moduleUrl("src/background/openaiClient.js"));
}

function usePatchedGlobals(overrides) {
  const originals = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    originals.set(key, globalThis[key]);
    globalThis[key] = value;
  }
  return () => {
    for (const [key, value] of originals) {
      globalThis[key] = value;
    }
  };
}

function createAbortAwareFetch(state) {
  return async (_url, init = {}) =>
    new Promise((_, reject) => {
      state.calls += 1;
      state.signals.push(init.signal ?? null);

      init.signal?.addEventListener(
        "abort",
        () => {
          state.abortCount += 1;
          const error = new Error("Aborted");
          error.name = "AbortError";
          reject(error);
        },
        { once: true },
      );
    });
}

function useImmediateTimeouts() {
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (handler, _delay, ...args) =>
    originalSetTimeout(handler, 0, ...args);
  return () => {
    globalThis.setTimeout = originalSetTimeout;
  };
}

test("fetchWithTimeout aborts the underlying fetch on timeout", async () => {
  const state = { calls: 0, abortCount: 0, signals: [] };
  const restoreGlobals = usePatchedGlobals({
    fetch: createAbortAwareFetch(state),
  });

  try {
    const { fetchWithTimeout } = await importAsyncUtils();

    await assert.rejects(
      fetchWithTimeout(
        "https://example.com/article",
        { credentials: "omit" },
        5,
        "article fetch",
      ),
      /article fetch timed out after 5ms/,
    );

    assert.equal(state.calls, 1);
    assert.equal(state.abortCount, 1);
    assert.equal(state.signals[0] instanceof AbortSignal, true);
  } finally {
    restoreGlobals();
  }
});

test("extractArticle aborts a timed-out fetch instead of leaving it running", async () => {
  const state = { calls: 0, abortCount: 0, signals: [] };
  const restoreGlobals = usePatchedGlobals({
    fetch: createAbortAwareFetch(state),
  });
  const restoreTimeouts = useImmediateTimeouts();

  try {
    const { extractArticle } = await importArticleExtractor();

    await assert.rejects(
      extractArticle("https://example.com/article"),
      /article fetch timed out after 15000ms/,
    );

    assert.equal(state.calls, 3);
    assert.equal(state.abortCount, 3);
    assert.equal(state.signals.every((signal) => signal instanceof AbortSignal), true);
  } finally {
    restoreTimeouts();
    restoreGlobals();
  }
});

test("generateTitle aborts a timed-out OpenAI request instead of leaving it running", async () => {
  const state = { calls: 0, abortCount: 0, signals: [] };
  const restoreGlobals = usePatchedGlobals({
    browser: {
      storage: {
        local: {
          async get() {
            return {
              settings: {
                openaiApiKey: "test-key",
                openaiModel: "gpt-4o-mini",
              },
            };
          },
        },
      },
    },
    fetch: createAbortAwareFetch(state),
  });
  const restoreTimeouts = useImmediateTimeouts();

  try {
    const { generateTitle } = await importOpenAiClient();

    await assert.rejects(
      generateTitle("Article text", "Original title"),
      /OpenAI API request timed out after 30000ms/,
    );

    assert.equal(state.calls, 3);
    assert.equal(state.abortCount, 3);
    assert.equal(state.signals.every((signal) => signal instanceof AbortSignal), true);
  } finally {
    restoreTimeouts();
    restoreGlobals();
  }
});
