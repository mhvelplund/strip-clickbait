import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..");
const optionsScriptPath = path.join(repoRoot, "src/options/index.js");

function createElement() {
  const listeners = new Map();
  return {
    value: "",
    checked: false,
    textContent: "",
    style: {},
    addEventListener(event, handler) {
      listeners.set(event, handler);
    },
    getListener(event) {
      return listeners.get(event);
    },
  };
}

test("options clear cache removes translated links and detected languages", async () => {
  const elements = new Map([
    ["status", createElement()],
    ["openai-api-key", createElement()],
    ["openai-model", createElement()],
    ["openai-max-length-factor", createElement()],
    ["diagnostics", createElement()],
    ["cache-count", createElement()],
    ["settings-form", createElement()],
    ["clear-cache", createElement()],
  ]);
  const removedKeys = [];

  const context = {
    browser: {
      storage: {
        local: {
          async get() {
            return { cache: {}, sourcePageLanguages: {} };
          },
          async set() {},
          async remove(key) {
            removedKeys.push(key);
          },
        },
      },
    },
    document: {
      getElementById(id) {
        return elements.get(id);
      },
    },
    console,
  };

  const source = await fs.readFile(optionsScriptPath, "utf8");
  new vm.Script(source, { filename: optionsScriptPath }).runInNewContext(context);

  const clearHandler = elements.get("clear-cache").getListener("click");
  await clearHandler();

  assert.deepEqual(removedKeys, ["cache", "sourcePageLanguages"]);
});
