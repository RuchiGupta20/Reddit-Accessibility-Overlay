chrome.runtime.onInstalled.addListener(() => {
  console.log("Reddit Accessibility Overlay installed.");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "PING") {
    sendResponse({
      ok: true,
      tabId: sender.tab?.id ?? null
    });
  }
});
