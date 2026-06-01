import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..");
const contentScriptPath = path.join(repoRoot, "src/content/index.js");

function createAnchor(href, textContent) {
  const attributes = new Map();

  return {
    href,
    textContent,
    title: "",
    dataset: {},
    hasAttribute(name) {
      return attributes.has(name);
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
    querySelectorAll() {
      return [];
    },
  };
}

async function loadContentScript(anchors, cacheEntries = {}) {
  let messageListener = null;

  const browser = {
    runtime: {
      async sendMessage(message) {
        if (message.type !== "get-cache-entries") {
          throw new Error(`Unexpected message type: ${message.type}`);
        }

        return { entries: cacheEntries };
      },
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        },
      },
    },
  };

  const context = {
    browser,
    document: {
      body: {},
      querySelectorAll(selector) {
        if (selector === "a[href]") {
          return anchors;
        }

        return [];
      },
    },
    MutationObserver: class {
      observe() {}
    },
    Node: { ELEMENT_NODE: 1 },
    URL,
    Set,
    URLSearchParams,
    console,
  };

  const source = await fs.readFile(contentScriptPath, "utf8");
  new vm.Script(source, { filename: contentScriptPath }).runInNewContext(context);

  return { messageListener };
}

function flushAsync() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("content script restores cached titles only on text links", async () => {
  const textLink = createAnchor("https://example.com/story", "Original headline");
  const imageLink = createAnchor("https://example.com/photo", "");

  await loadContentScript([textLink, imageLink], {
    "https://example.com/story": {
      status: "success",
      aiTitle: "Rewritten headline",
    },
    "https://example.com/photo": {
      status: "success",
      aiTitle: "Should not replace",
    },
  });

  await flushAsync();

  assert.equal(textLink.textContent, "🤖 Rewritten headline");
  assert.equal(imageLink.textContent, "");
  assert.equal(imageLink.title, "");
});

test("content script only marks text links as eligible for translation", async () => {
  const textLink = createAnchor("https://example.com/story", "Original headline");
  const imageLink = createAnchor("https://example.com/photo", "");

  const { messageListener } = await loadContentScript([textLink, imageLink]);

  const textResponse = await messageListener({
    type: "can-translate-link",
    payload: { linkUrl: "https://example.com/story" },
  });
  const imageResponse = await messageListener({
    type: "can-translate-link",
    payload: { linkUrl: "https://example.com/photo" },
  });

  assert.equal(textResponse.eligible, true);
  assert.equal(imageResponse.eligible, false);
});

test("content script ignores live updates for image links", async () => {
  const textLink = createAnchor("https://example.com/story", "Original headline");
  const imageLink = createAnchor("https://example.com/photo", "");

  const { messageListener } = await loadContentScript([textLink, imageLink]);

  await messageListener({
    type: "translate-clickbait-result",
    payload: {
      linkUrl: "https://example.com/photo",
      entry: { status: "success", aiTitle: "Image replacement" },
    },
  });

  assert.equal(imageLink.textContent, "");
  assert.equal(imageLink.title, "");
});
