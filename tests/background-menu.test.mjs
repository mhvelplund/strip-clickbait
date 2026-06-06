import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..");

function moduleUrl(relativePath) {
  return `${pathToFileURL(path.join(repoRoot, relativePath)).href}?t=${Date.now()}-${Math.random()}`;
}

function createBrowserMock() {
  const listeners = {};
  const createCalls = [];
  const removeCalls = [];
  const updateCalls = [];
  let refreshCalls = 0;
  let sendMessageImpl = async () => ({ eligible: true });

  globalThis.browser = {
    contextMenus: {
      create(details) {
        createCalls.push(details);
      },
      remove(menuId) {
        removeCalls.push(menuId);
        return Promise.resolve();
      },
      update(menuId, details) {
        updateCalls.push({ menuId, details });
        return Promise.resolve();
      },
      refresh() {
        refreshCalls += 1;
      },
      onClicked: {
        addListener(listener) {
          listeners.onMenuClicked = listener;
        },
      },
      onShown: {
        addListener(listener) {
          listeners.onMenuShown = listener;
        },
      },
    },
    runtime: {
      onInstalled: {
        addListener(listener) {
          listeners.onInstalled = listener;
        },
      },
      onStartup: {
        addListener(listener) {
          listeners.onStartup = listener;
        },
      },
      onMessage: {
        addListener(listener) {
          listeners.onMessage = listener;
        },
      },
    },
    storage: {
      local: {
        async get() {
          return {};
        },
        async set() {},
      },
      onChanged: {
        addListener(listener) {
          listeners.onStorageChanged = listener;
        },
      },
    },
    tabs: {
      async sendMessage(...args) {
        return sendMessageImpl(...args);
      },
    },
  };

  return {
    createCalls,
    removeCalls,
    updateCalls,
    listeners,
    getRefreshCalls: () => refreshCalls,
    setSendMessageImpl(fn) {
      sendMessageImpl = fn;
    },
  };
}

test("background registers context menu immediately when loaded", async () => {
  const { createCalls, removeCalls } = createBrowserMock();

  await import(moduleUrl("src/background/index.js"));

  // Let the remove(...).finally(...) callback run.
  await Promise.resolve();

  assert.equal(removeCalls.length, 2);
  assert.equal(createCalls.length, 2);
  assert.deepEqual(createCalls[0], {
    id: "translate-clickbait",
    title: "Translate Clickbait",
    contexts: ["link"],
  });
  assert.deepEqual(createCalls[1], {
    id: "translate-clickbait-all",
    title: "Translate Clickbait (All)",
    contexts: ["link"],
  });
});

test("background shows context menu item for eligible text links", async () => {
  const { listeners, updateCalls, getRefreshCalls, setSendMessageImpl } =
    createBrowserMock();
  setSendMessageImpl(async () => ({ eligible: true }));

  await import(moduleUrl("src/background/index.js"));
  await Promise.resolve();

  await listeners.onMenuShown({ linkUrl: "https://example.com/article" }, { id: 7 });

  assert.deepEqual(updateCalls[0], {
    menuId: "translate-clickbait",
    details: { visible: true },
  });
  assert.deepEqual(updateCalls[1], {
    menuId: "translate-clickbait-all",
    details: { visible: false },
  });
  assert.equal(getRefreshCalls(), 1);
});

test("background hides context menu item for ineligible links", async () => {
  const { listeners, updateCalls, getRefreshCalls, setSendMessageImpl } =
    createBrowserMock();
  setSendMessageImpl(async () => ({ eligible: false }));

  await import(moduleUrl("src/background/index.js"));
  await Promise.resolve();

  await listeners.onMenuShown({ linkUrl: "https://example.com/image" }, { id: 9 });

  assert.deepEqual(updateCalls[0], {
    menuId: "translate-clickbait",
    details: { visible: false },
  });
  assert.deepEqual(updateCalls[1], {
    menuId: "translate-clickbait-all",
    details: { visible: false },
  });
  assert.equal(getRefreshCalls(), 1);
});

test("background shows bulk menu only when eligible link has class attribute", async () => {
  const { listeners, updateCalls, getRefreshCalls, setSendMessageImpl } =
    createBrowserMock();
  setSendMessageImpl(async () => ({
    eligible: true,
    hasClassAttribute: true,
  }));

  await import(moduleUrl("src/background/index.js"));
  await Promise.resolve();

  await listeners.onMenuShown({ linkUrl: "https://example.com/article" }, { id: 10 });

  assert.deepEqual(updateCalls[0], {
    menuId: "translate-clickbait",
    details: { visible: true },
  });
  assert.deepEqual(updateCalls[1], {
    menuId: "translate-clickbait-all",
    details: { visible: true },
  });
  assert.equal(getRefreshCalls(), 1);
});

test("background caches source-page language detection per page", async () => {
  const { listeners, setSendMessageImpl } = createBrowserMock();
  let sourceContextCalls = 0;

  setSendMessageImpl(async (_tabId, message) => {
    if (message.type === "get-source-page-language-context") {
      sourceContextCalls += 1;
      return { sourcePageText: "" };
    }
    if (message.type === "can-translate-link") {
      return { eligible: false };
    }
    return {};
  });

  await import(moduleUrl("src/background/index.js"));
  await Promise.resolve();

  await listeners.onMenuClicked(
    {
      menuItemId: "translate-clickbait",
      linkUrl: "https://example.com/article-1",
      pageUrl: "https://example.com/frontpage",
    },
    { id: 42, url: "https://example.com/frontpage" },
  );
  await listeners.onMenuClicked(
    {
      menuItemId: "translate-clickbait",
      linkUrl: "https://example.com/article-2",
      pageUrl: "https://example.com/frontpage",
    },
    { id: 42, url: "https://example.com/frontpage" },
  );

  assert.equal(sourceContextCalls, 1);
});
