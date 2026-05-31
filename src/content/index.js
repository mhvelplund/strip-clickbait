browser.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "translate-clickbait-requested") {
    return;
  }

  const { linkUrl, sourceTabId, pageUrl } = message.payload || {};
  console.debug("Clickbait translation event captured in content script", {
    linkUrl,
    sourceTabId,
    pageUrl,
  });
});
