import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..");

function moduleUrl(relativePath) {
  return `${pathToFileURL(path.join(repoRoot, relativePath)).href}?t=${Date.now()}-${Math.random()}`;
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

test("generateTitle uses configured max title length factor", async () => {
  const requests = [];
  const restoreGlobals = usePatchedGlobals({
    browser: {
      storage: {
        local: {
          async get() {
            return {
              settings: {
                openaiApiKey: "test-key",
                openaiModel: "gpt-4o-mini",
                openaiMaxLengthFactor: 2,
              },
            };
          },
        },
      },
    },
    fetch: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return {
        ok: true,
        async json() {
          return {
            choices: [{ message: { content: '{"title":"Clean replacement"}' } }],
          };
        },
      };
    },
  });

  try {
    const { generateTitle } = await importOpenAiClient();
    await generateTitle("Article text", "1234567890");

    assert.equal(requests.length, 1);
    assert.match(
      requests[0].messages[0].content,
      /MUST be ≤ 20 characters \(original: 10\)/,
    );
  } finally {
    restoreGlobals();
  }
});

test("generateTitle defaults max title length factor to 1.5", async () => {
  const requests = [];
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
    fetch: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return {
        ok: true,
        async json() {
          return {
            choices: [{ message: { content: '{"title":"Clean replacement"}' } }],
          };
        },
      };
    },
  });

  try {
    const { generateTitle } = await importOpenAiClient();
    await generateTitle("Article text", "1234567890");

    assert.equal(requests.length, 1);
    assert.match(
      requests[0].messages[0].content,
      /MUST be ≤ 15 characters \(original: 10\)/,
    );
  } finally {
    restoreGlobals();
  }
});
