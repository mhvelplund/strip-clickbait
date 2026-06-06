import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..");
const cacheModuleUrl = pathToFileURL(
  path.join(repoRoot, "src/background/cache.js"),
).href;
const contentScriptPath = path.join(repoRoot, "src/content/index.js");

function clone(value) {
  return structuredClone(value);
}

function createBrowserStorage(initialCache = {}) {
  let cacheState = clone(initialCache);

  return {
    browser: {
      storage: {
        local: {
          async get() {
            const snapshot = clone(cacheState);
            await Promise.resolve();
            return { cache: snapshot };
          },
          async set(payload) {
            await Promise.resolve();
            cacheState = clone(payload.cache ?? {});
          },
        },
      },
    },
    readCache() {
      return clone(cacheState);
    },
  };
}

async function importCacheModule(browser) {
  globalThis.browser = browser;
  return import(`${cacheModuleUrl}?t=${Date.now()}-${Math.random()}`);
}

async function loadContentCanonicalize(URLSearchParamsImpl = URLSearchParams) {
  const source = await fs.readFile(contentScriptPath, "utf8");
  const match = source.match(
    /const TRACKING_PARAMS = new Set\(\[[\s\S]*?\]\);\n\nfunction canonicalizeUrl\(rawUrl\) \{[\s\S]*?\n\}/,
  );

  if (!match) {
    throw new Error("Could not locate content canonicalizeUrl()");
  }

  return vm.runInNewContext(`${match[0]}\ncanonicalizeUrl;`, {
    Set,
    URL,
    URLSearchParams: URLSearchParamsImpl,
  });
}

class NonIterableURLSearchParams extends URLSearchParams {
  keys() {
    const iterator = super.keys();
    return { next: () => iterator.next() };
  }

  entries() {
    const iterator = super.entries();
    return { next: () => iterator.next() };
  }
}

test("content script parses as a single classic script", async () => {
  const source = await fs.readFile(contentScriptPath, "utf8");

  assert.doesNotThrow(() => {
    new vm.Script(source);
  });
});

test("canonicalizeUrl strips default ports after scheme normalization", async () => {
  const storage = createBrowserStorage();
  const { canonicalizeUrl } = await importCacheModule(storage.browser);
  const contentCanonicalize = await loadContentCanonicalize();
  const rawUrl = "http://WWW.Example.com:80/path/";
  const expected = "https://example.com/path";

  assert.equal(canonicalizeUrl(rawUrl), expected);
  assert.equal(contentCanonicalize(rawUrl), expected);
});

test("canonicalizeUrl sorts surviving query parameters consistently", async () => {
  const storage = createBrowserStorage();
  const { canonicalizeUrl } = await importCacheModule(storage.browser);
  const contentCanonicalize = await loadContentCanonicalize();
  const rawUrl =
    "https://www.example.com/article/?b=2&utm_source=newsletter&a=1&fbclid=tracking";
  const expected = "https://example.com/article?a=1&b=2";

  assert.equal(canonicalizeUrl(rawUrl), expected);
  assert.equal(contentCanonicalize(rawUrl), expected);
});

test("canonicalizeUrl works when URLSearchParams iterators are not iterable", async () => {
  const storage = createBrowserStorage();
  const originalURLSearchParams = globalThis.URLSearchParams;
  globalThis.URLSearchParams = NonIterableURLSearchParams;

  try {
    const { canonicalizeUrl } = await importCacheModule(storage.browser);
    const contentCanonicalize = await loadContentCanonicalize(
      NonIterableURLSearchParams,
    );
    const rawUrl =
      "https://www.example.com/article/?b=2&utm_source=newsletter&a=1&fbclid=tracking";
    const expected = "https://example.com/article?a=1&b=2";

    assert.equal(canonicalizeUrl(rawUrl), expected);
    assert.equal(contentCanonicalize(rawUrl), expected);
  } finally {
    globalThis.URLSearchParams = originalURLSearchParams;
  }
});

test("setEntry preserves both entries across concurrent writes", async () => {
  const storage = createBrowserStorage();
  const { setEntry, canonicalizeUrl } = await importCacheModule(storage.browser);

  const firstUrl = "https://example.com/first?b=2&a=1";
  const secondUrl = "https://example.com/second?a=1&b=2";

  await Promise.all([
    setEntry(firstUrl, { status: "success", aiTitle: "First" }),
    setEntry(secondUrl, { status: "success", aiTitle: "Second" }),
  ]);

  const cache = storage.readCache();

  assert.deepEqual(Object.keys(cache).sort(), [
    canonicalizeUrl(firstUrl),
    canonicalizeUrl(secondUrl),
  ]);
});

test("setEntry clears stale error fields when an entry becomes successful", async () => {
  const storage = createBrowserStorage();
  const { setEntry, getEntry } = await importCacheModule(storage.browser);
  const url = "https://example.com/article";

  await setEntry(url, { status: "failed", error: "timeout" });
  await setEntry(url, { status: "success", aiTitle: "Explained title" });

  const entry = await getEntry(url);

  assert.equal(entry.targetUrl, "https://example.com/article");
  assert.equal(entry.aiTitle, "Explained title");
  assert.equal(entry.status, "success");
  assert.equal(entry.error, null);
  assert.equal(typeof entry.createdAt, "number");
  assert.equal(typeof entry.updatedAt, "number");
  assert.ok(entry.updatedAt >= entry.createdAt);
});

test("setEntry clears stale aiTitle fields when an entry becomes failed", async () => {
  const storage = createBrowserStorage();
  const { setEntry, getEntry } = await importCacheModule(storage.browser);
  const url = "https://example.com/article";

  await setEntry(url, { status: "success", aiTitle: "Old title" });
  await setEntry(url, { status: "failed", error: "timeout" });

  const entry = await getEntry(url);

  assert.equal(entry.status, "failed");
  assert.equal(entry.aiTitle, "");
  assert.equal(entry.error, "timeout");
});
