const SETTINGS_KEY = "settings";

function setStatus(text, isError = false) {
  const status = document.getElementById("status");
  status.textContent = text;
  status.style.color = isError ? "#b00020" : "#1b5e20";
}

async function loadSettings() {
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  const settings = stored[SETTINGS_KEY] || {};

  document.getElementById("openai-api-key").value = settings.openaiApiKey || "";
  document.getElementById("openai-model").value =
    settings.openaiModel || "gpt-4o-mini";
}

async function saveSettings(event) {
  event.preventDefault();

  const openaiApiKey = document.getElementById("openai-api-key").value.trim();
  const openaiModel =
    document.getElementById("openai-model").value.trim() || "gpt-4o-mini";

  await browser.storage.local.set({
    [SETTINGS_KEY]: {
      openaiApiKey,
      openaiModel,
    },
  });

  setStatus("Settings saved.");
}

document
  .getElementById("settings-form")
  .addEventListener("submit", async (event) => {
    try {
      await saveSettings(event);
    } catch (error) {
      console.error(error);
      setStatus("Failed to save settings.", true);
    }
  });

loadSettings().catch((error) => {
  console.error(error);
  setStatus("Failed to load settings.", true);
});
