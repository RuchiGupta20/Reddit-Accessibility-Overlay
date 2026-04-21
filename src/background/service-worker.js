chrome.runtime.onInstalled.addListener(() => {
  console.log("Reddit Accessibility Overlay installed.");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "PING") {
    sendResponse({ ok: true, tabId: sender.tab?.id ?? null });
  }
  if (message?.type === "GET_MUTE_STATE" && message.tabId) {
    chrome.tabs.get(message.tabId)
      .then(tab => sendResponse({ muted: tab.mutedInfo?.muted ?? false }))
      .catch(() => sendResponse({ muted: false }));
    return true;
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.mutedInfo !== undefined) {
    const type = changeInfo.mutedInfo.muted ? "TAB_MUTED" : "TAB_UNMUTED";
    chrome.tabs.sendMessage(tabId, { type }).catch(() => {});
  }
});
