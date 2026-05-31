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

  globalThis.browser = {
    contextMenus: {
      create(details) {
        createCalls.push(details);
      },
      remove(menuId) {
        removeCalls.push(menuId);
        return Promise.resolve();
      },
      onClicked: {
        addListener(listener) {
          listeners.onMenuClicked = listener;
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
      async sendMessage() {},
    },
  };

  return { createCalls, removeCalls, listeners };
}

test("background registers context menu immediately when loaded", async () => {
  const { createCalls, removeCalls } = createBrowserMock();

  await import(moduleUrl("src/background/index.js"));

  // Let the remove(...).finally(...) callback run.
  await Promise.resolve();

  assert.equal(removeCalls.length, 1);
  assert.equal(createCalls.length, 1);
  assert.deepEqual(createCalls[0], {
    id: "translate-clickbait",
    title: "Translate Clickbait",
    contexts: ["link"],
  });
});
