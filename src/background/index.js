const MENU_ID = "translate-clickbait";

function createContextMenu() {
  browser.contextMenus.remove(MENU_ID).finally(() => {
    browser.contextMenus.create({
      id: MENU_ID,
      title: "Translate Clickbait",
      contexts: ["link"]
    });
  });
}

browser.runtime.onInstalled.addListener(() => {
  createContextMenu();
});

browser.runtime.onStartup.addListener(() => {
  createContextMenu();
});

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.linkUrl || !tab || typeof tab.id !== "number") {
    return;
  }

  const clickContext = {
    linkUrl: info.linkUrl,
    sourceTabId: tab.id,
    pageUrl: info.pageUrl || tab.url || null
  };

  console.debug("Translate Clickbait requested", clickContext);

  try {
    await browser.tabs.sendMessage(tab.id, {
      type: "translate-clickbait-requested",
      payload: clickContext
    });
  } catch (error) {
    console.debug("Content script not ready for tab", tab.id, error);
  }
});
