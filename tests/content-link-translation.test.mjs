import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..");
const contentScriptPath = path.join(repoRoot, "src/content/index.js");

function createAnchor(href, textContent, ariaLabel = "", extraAttributes = {}) {
  const attributes = new Map();
  if (ariaLabel) {
    attributes.set("aria-label", ariaLabel);
  }
  for (const [name, value] of Object.entries(extraAttributes)) {
    attributes.set(name, String(value));
  }

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

async function loadContentScript(anchors, cacheEntries = {}, pageContext = {}) {
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
      title: pageContext.title ?? "Example Page",
      location: { href: pageContext.href ?? "https://example.com/" },
      body: {
        innerText: pageContext.bodyText ?? "Body text",
      },
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
  assert.equal(textResponse.hasClassAttribute, false);
  assert.equal(imageResponse.eligible, false);
});

test("content script reports class metadata for eligible links", async () => {
  const textLink = createAnchor("https://example.com/story", "Original headline", "", {
    class: "teaser-link featured",
  });

  const { messageListener } = await loadContentScript([textLink]);

  const response = await messageListener({
    type: "can-translate-link",
    payload: { linkUrl: "https://example.com/story" },
  });

  assert.equal(response.eligible, true);
  assert.equal(response.hasClassAttribute, true);
  assert.equal(response.classAttributeValue, "teaser-link featured");
});

test("content script treats aria-label links as eligible and exposes original title", async () => {
  const ariaLink = createAnchor(
    "https://example.com/story",
    "",
    "LIGE NU: Har ramt i storby",
  );

  const { messageListener } = await loadContentScript([ariaLink]);

  const response = await messageListener({
    type: "can-translate-link",
    payload: { linkUrl: "https://example.com/story" },
  });

  assert.equal(response.eligible, true);
  assert.equal(response.originalTitle, "LIGE NU: Har ramt i storby");
});

test("content script updates aria-label when a translated title is applied", async () => {
  const ariaLink = createAnchor(
    "https://example.com/story",
    "",
    "Original aria headline",
  );

  await loadContentScript([ariaLink], {
    "https://example.com/story": {
      status: "success",
      aiTitle: "Translated aria headline",
    },
  });

  await flushAsync();

  assert.equal(ariaLink.getAttribute("aria-label"), "Translated aria headline");
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

test("content script returns class-matching eligible links for bulk translation", async () => {
  const clicked = createAnchor("https://example.com/a", "A", "", {
    class: "teaser-link featured",
  });
  const sameClassText = createAnchor("https://example.com/b", "B", "", {
    class: "teaser-link featured",
  });
  const sameClassAria = createAnchor("https://example.com/c", "", "C via aria", {
    class: "teaser-link featured",
  });
  const sameClassImage = createAnchor("https://example.com/d", "", "", {
    class: "teaser-link featured",
  });
  const differentClass = createAnchor("https://example.com/e", "E", "", {
    class: "other-link",
  });

  const { messageListener } = await loadContentScript([
    clicked,
    sameClassText,
    sameClassAria,
    sameClassImage,
    differentClass,
  ]);

  const response = await messageListener({
    type: "get-class-link-candidates",
    payload: { linkUrl: "https://example.com/a" },
  });

  assert.deepEqual(JSON.parse(JSON.stringify(response.links)), [
    { linkUrl: "https://example.com/a", originalTitle: "A" },
    { linkUrl: "https://example.com/b", originalTitle: "B" },
    { linkUrl: "https://example.com/c", originalTitle: "C via aria" },
  ]);
});

test("content script provides source-page language detection context", async () => {
  const { messageListener } = await loadContentScript(
    [],
    {},
    {
      title: "Nyheder i dag",
      href: "https://example.com/frontpage",
      bodyText: "Dette er en dansk forside med flere artikler.",
    },
  );

  const response = await messageListener({
    type: "get-source-page-language-context",
  });

  assert.equal(response.sourcePageUrl, "https://example.com/frontpage");
  assert.match(response.sourcePageText, /Nyheder i dag/);
  assert.match(response.sourcePageText, /dansk forside/);
});
