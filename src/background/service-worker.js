const SUMMARY_ENDPOINT = "http://127.0.0.1:8787/summarize";
const HEALTH_ENDPOINT = "http://127.0.0.1:8787/health";

chrome.runtime.onInstalled.addListener(() => {
  console.log("Reddit Accessibility Overlay installed.");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "PING") {
    sendResponse({
      ok: true,
      tabId: sender.tab?.id ?? null
    });
    return;
  }

  if (message?.type === "SUMMARIZE_THREAD") {
    summarizeThread(message.payload)
      .then((result) => {
        sendResponse({
          ok: true,
          summary: result.summary
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Unable to summarize this thread."
        });
      });

    return true;
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

async function summarizeThread(payload) {
  let response;

  try {
    response = await fetch(SUMMARY_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    const healthStatus = await checkSummaryServerHealth();
    if (!healthStatus.ok) {
      throw new Error("Cannot reach the local summary server at http://127.0.0.1:8787. Make sure `node server/summarize-server.js` is running, then reload the extension.");
    }

    throw new Error(`The extension reached the local summary server, but the summarize request still failed: ${describeError(error)}`);
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error ?? "Summarization request failed.");
  }

  if (typeof data.summary !== "string" || !data.summary.trim()) {
    throw new Error("The summarization server returned an empty result.");
  }

  return data;
}

async function checkSummaryServerHealth() {
  try {
    const response = await fetch(HEALTH_ENDPOINT);
    return {
      ok: response.ok
    };
  } catch {
    return {
      ok: false
    };
  }
}

function describeError(error) {
  if (!(error instanceof Error)) {
    return "Unknown error.";
  }

  const causeCode = error.cause && typeof error.cause === "object" && "code" in error.cause
    ? String(error.cause.code)
    : "";

  return causeCode ? `${error.message} (${causeCode})` : error.message;
}
