const SETTINGS_KEY = "settings";
const DIAGNOSTICS_KEY = "diagnosticsEnabled";
const CACHE_KEY = "cache";

function setStatus(text, isError = false) {
  const status = document.getElementById("status");
  status.textContent = text;
  status.style.color = isError ? "#b00020" : "#1b5e20";
}

async function loadSettings() {
  const stored = await browser.storage.local.get([SETTINGS_KEY, DIAGNOSTICS_KEY]);
  const settings = stored[SETTINGS_KEY] || {};

  document.getElementById("openai-api-key").value = settings.openaiApiKey || "";
  document.getElementById("openai-model").value =
    settings.openaiModel || "gpt-4o-mini";
  document.getElementById("diagnostics").checked =
    Boolean(stored[DIAGNOSTICS_KEY]);
}

async function saveSettings(event) {
  event.preventDefault();

  const openaiApiKey = document.getElementById("openai-api-key").value.trim();
  const openaiModel =
    document.getElementById("openai-model").value.trim() || "gpt-4o-mini";
  const diagnosticsEnabled = document.getElementById("diagnostics").checked;

  await browser.storage.local.set({
    [SETTINGS_KEY]: { openaiApiKey, openaiModel },
    [DIAGNOSTICS_KEY]: diagnosticsEnabled,
  });

  setStatus("Settings saved.");
}

async function updateCacheCount() {
  const stored = await browser.storage.local.get(CACHE_KEY);
  const cache = stored[CACHE_KEY] ?? {};
  const entries = Object.values(cache);
  const total = entries.length;
  const success = entries.filter((e) => e.status === "success").length;
  const pending = entries.filter((e) => e.status === "pending").length;
  const failed  = entries.filter((e) => e.status === "failed").length;

  document.getElementById("cache-count").textContent =
    total === 0
      ? "Cache is empty."
      : `${total} cached URL${total !== 1 ? "s" : ""}: `
        + `${success} success, ${pending} pending, ${failed} failed.`;
}

async function clearCache() {
  await browser.storage.local.remove(CACHE_KEY);
  setStatus("Cache cleared.");
  updateCacheCount();
}

document.getElementById("settings-form").addEventListener("submit", async (event) => {
  try {
    await saveSettings(event);
  } catch (error) {
    console.error(error);
    setStatus("Failed to save settings.", true);
  }
});

document.getElementById("clear-cache").addEventListener("click", async () => {
  try {
    await clearCache();
  } catch (error) {
    console.error(error);
    setStatus("Failed to clear cache.", true);
  }
});

loadSettings().catch((error) => {
  console.error(error);
  setStatus("Failed to load settings.", true);
});

updateCacheCount().catch(console.error);

