const ROOT_ID = "rao-root";
const STORAGE_KEY = "redditAccessibilitySettings";
const DEFAULT_SETTINGS = {
  enabled: true,
  reducedStimulation: false,
  fontPreset: "dyslexia",
  fontScale: 1,
  lineHeight: 1.6,
  letterSpacing: 0,
  wordSpacing: 0,
  ttsRate: 1,
  ttsVoice: "",
  ttsHighlight: true,
  attentionPrompt: true,
  attentionTimerMinutes: 0,
  autoPauseFeed: true
};
const FONT_STACKS = {
  default: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  dyslexia: '"OpenDyslexic", "Atkinson Hyperlegible", "Lexend", Verdana, Tahoma, Arial, sans-serif'
};
var currentSettings = { ...DEFAULT_SETTINGS };
var overlayElements = null;
let persistTimer = null;
let summaryState = {
  loading: false,
  status: "",
  summary: ""
};
let attentionState = {
  intention: "",
  prompted: false,
  timerId: null,
  countdownId: null,
  timerEndsAt: 0,
  reminderTimer: null,
  startedAt: 0,
  lastPauseY: 0,
  paused: false,
  previousOverflow: "",
  previousBodyOverflow: ""
};
const ATTENTION_PAUSE_DISTANCE = 5200;

function isRedditPage() {
  return window.location.hostname === "www.reddit.com";
}

function isThreadPage() {
  return /\/r\/[^/]+\/comments\//.test(window.location.pathname);
}

function createRoot() {
  const existingRoot = document.getElementById(ROOT_ID);
  if (existingRoot) {
    return existingRoot;
  }

  const root = document.createElement("div");
  root.id = ROOT_ID;
  document.documentElement.appendChild(root);
  return root;
}

async function getSettings() {
  const result = await chrome.storage.sync.get(STORAGE_KEY);
  return {
    ...DEFAULT_SETTINGS,
    ...(result[STORAGE_KEY] ?? {})
  };
}

async function saveSettings(nextSettings) {
  const settings = {
    ...DEFAULT_SETTINGS,
    ...nextSettings
  };

  await chrome.storage.sync.set({
    [STORAGE_KEY]: settings
  });

  return settings;
}

function scheduleSave(nextSettings) {
  currentSettings = {
    ...DEFAULT_SETTINGS,
    ...nextSettings
  };

  if (persistTimer) {
    window.clearTimeout(persistTimer);
  }

  persistTimer = window.setTimeout(async () => {
    persistTimer = null;
    const savedSettings = await saveSettings(currentSettings);
    applySettings(savedSettings);
  }, 250);
}

/* TTS start */
var speedSyncRegistry = [];

function syncAllSpeedControls() {
  speedSyncRegistry.forEach(fn => fn());
}

function buildSpeedControls(onRestart) {
  const row = document.createElement("div");
  row.className = "rao-speed-row";
  row.innerHTML = [0.5, 1, 1.5, 2].map(r =>
    `<button class="rao-speed-btn" data-rate="${r}" type="button">${r}×</button>`
  ).join("");

  const btns = row.querySelectorAll(".rao-speed-btn");
  const sync = () => {
    const rate = currentSettings.ttsRate ?? 1;
    btns.forEach(b => b.classList.toggle("rao-speed-active", Number(b.dataset.rate) === rate));
  };
  speedSyncRegistry.push(sync);

  btns.forEach(btn => btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const nextSettings = { ...currentSettings, ttsRate: Number(btn.dataset.rate) };
    applySettings(nextSettings);
    scheduleSave(nextSettings);
    onRestart?.();
  }));

  sync();
  return row;
}

function buildPostSegments(post) {
  const segs = [];
  const titleEl = post.querySelector("h1, [slot='title']");
  const flairEl = post.querySelector("faceplate-pill, [slot='flair']");
  const bodyEl  = post.querySelector("[slot='text-body'], .RichTextJSON-root");
  if (titleEl) segs.push({ label: "Title", el: titleEl });
  if (flairEl) {
    const t = (flairEl.innerText || "").trim();
    if (t) segs.push({ label: "Flair", el: null, staticText: t });
  }
  if (bodyEl) segs.push({ label: "Body", el: bodyEl });
  return segs;
}

function createPostPlayer(post) {
  const player = document.createElement("div");
  player.className = "rao-post-player";
  player.dataset.ttsState = "idle";

  player.innerHTML = `
    <div class="rao-player-row rao-player-header">
      <span class="rao-player-title">🔊 Listen to this post</span>
      <div class="rao-player-btns">
        <button class="rao-ctrl rao-ctrl-back" type="button" title="Restart">⏮</button>
        <button class="rao-ctrl rao-ctrl-play" type="button" aria-label="Play">▶</button>
        <button class="rao-ctrl rao-ctrl-stop" type="button" title="Stop">⏹</button>
      </div>
    </div>
    <div class="rao-player-progress-track">
      <div class="rao-player-progress-fill"></div>
    </div>
  `;
  player.appendChild(buildSpeedControls(() => { if (ttsSession?.player === player) play(); }));

  const playBtn = player.querySelector(".rao-ctrl-play");
  const backBtn = player.querySelector(".rao-ctrl-back");
  const stopBtn = player.querySelector(".rao-ctrl-stop");

  const play = () => startTTS(player, buildPostSegments(post), currentSettings.ttsHighlight ?? true);

  playBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const state = player.dataset.ttsState;
    if (state === "playing") {
      window.speechSynthesis.pause();
      setPlayerState(player, "paused");
    } else if (state === "paused") {
      window.speechSynthesis.resume();
      setPlayerState(player, "playing");
    } else {
      play();
    }
  });

  backBtn.addEventListener("click", (e) => { e.stopPropagation(); play(); });
  stopBtn.addEventListener("click", (e) => { e.stopPropagation(); if (ttsSession?.player === player) stopTTS(); });

  return player;
}

function createCommentPlayer(comment) {
  // Shadow DOM isolates our mutations from Reddit's component observers, preventing flicker
  const host = document.createElement("span");
  host.className = "rao-comment-player-host";
  host.style.cssText = "display:inline-flex;align-items:center;vertical-align:middle;margin-left:6px;";
  const shadow = host.attachShadow({ mode: "open" });

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = chrome.runtime.getURL("src/content/content.css");
  shadow.appendChild(link);

  const wrapper = document.createElement("div");
  wrapper.className = "rao-comment-player";
  wrapper.dataset.ttsState = "idle";

  wrapper.innerHTML = `
    <div class="rao-comment-player-row">
      <button class="rao-ctrl rao-ctrl-back rao-comment-back" type="button" title="Restart" style="display:none">⏮</button>
      <button class="rao-ctrl rao-ctrl-play rao-comment-play" type="button" aria-label="Play">▶</button>
      <button class="rao-ctrl rao-comment-stop" type="button" title="Stop" style="display:none">⏹</button>
      <span class="rao-comment-label">Listen</span>
    </div>
    <div class="rao-comment-progress-track" style="display:none">
      <div class="rao-player-progress-fill"></div>
    </div>
  `;

  const speedRow = buildSpeedControls(() => { if (ttsSession?.player === wrapper) play(); });
  speedRow.style.display = "none";
  wrapper.appendChild(speedRow);
  shadow.appendChild(wrapper);

  const backBtn = wrapper.querySelector(".rao-comment-back");
  const playBtn = wrapper.querySelector(".rao-comment-play");
  const stopBtn = wrapper.querySelector(".rao-comment-stop");
  const label   = wrapper.querySelector(".rao-comment-label");
  const track   = wrapper.querySelector(".rao-comment-progress-track");

  const getSegs = () => {
    const bodyEl = comment.querySelector("[slot='comment'], .md");
    return [{ label: "", el: bodyEl ?? comment }];
  };

  const syncUI = (state) => {
    const active = state === "playing" || state === "paused";
    label.style.display    = active ? "none" : "";
    backBtn.style.display  = active ? "" : "none";
    stopBtn.style.display  = active ? "" : "none";
    track.style.display    = active ? "" : "none";
    speedRow.style.display = active ? "" : "none";
  };

  const play = () => startTTS(wrapper, getSegs(), currentSettings.ttsHighlight ?? true, syncUI);

  backBtn.addEventListener("click", (e) => { e.stopPropagation(); play(); });

  playBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    const state = wrapper.dataset.ttsState;
    if (state === "playing") {
      window.speechSynthesis.pause();
      setPlayerState(wrapper, "paused");
      syncUI("paused");
      return;
    }
    if (state === "paused") {
      window.speechSynthesis.resume();
      setPlayerState(wrapper, "playing");
      syncUI("playing");
      return;
    }
    play();
  });

  stopBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (ttsSession?.player === wrapper) stopTTS();
  });

  return host;
}

function injectTTSButtons() {
  if (!isThreadPage()) return;

  document.querySelectorAll("shreddit-post:not([data-rao-tts])").forEach(post => {
    post.dataset.raoTts = "1";
    const player = createPostPlayer(post);
    const footer = post.querySelector("[slot='post-media-footer'], footer");
    (footer ?? post).insertAdjacentElement("afterbegin", player);
  });

  document.querySelectorAll("shreddit-comment:not([data-rao-tts])").forEach(comment => {
    comment.dataset.raoTts = "1";
    const player = createCommentPlayer(comment);
    const actionBar = comment.querySelector("[slot='comment-actions'], footer");
    (actionBar ?? comment).appendChild(player);
  });
}

function startTTSObserver() {
  let lastUrl = location.href;
  let debounceTimer = null;

  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        stopTTS();
        clearFocusedReading();
        speedSyncRegistry = [];
      }
      injectTTSButtons();
    }, 150);
  });

  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("popstate", stopTTS);
  injectTTSButtons();
}
/* TTS end */

function formatPercent(value) {
  return `${Math.round(Number(value) * 100)}%`;
}

function formatEm(value) {
  return `${Number(value).toFixed(2)}em`;
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function limitText(value, maxLength) {
  const text = normalizeText(value);
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1).trim()}...`;
}

function getFirstText(selectors, maxLength = 2200) {
  for (const selector of selectors) {
    const nodes = document.querySelectorAll(selector);
    for (const node of nodes) {
      const text = limitText(node.textContent || node.innerText, maxLength);
      if (text) {
        return text;
      }
    }
  }

  return "";
}

function getTextList(selectors, maxItems = 20, maxLength = 600) {
  const texts = [];
  const seen = new Set();

  for (const selector of selectors) {
    const nodes = document.querySelectorAll(selector);
    for (const node of nodes) {
      const text = limitText(node.textContent || node.innerText, maxLength);
      if (!text || seen.has(text)) {
        continue;
      }

      seen.add(text);
      texts.push(text);

      if (texts.length >= maxItems) {
        return texts;
      }
    }
  }

  return texts;
}

function collectThreadContent() {
  const title = getFirstText(
    [
      "shreddit-post h1",
      "[data-testid='post-container'] h1",
      "main h1"
    ],
    300
  );

  const body = getFirstText(
    [
      "shreddit-post [slot='text-body']",
      "shreddit-post [data-click-id='text']",
      "[data-testid='post-container'] [data-click-id='text']",
      "[data-testid='post-container'] [slot='text-body']",
      "article [data-click-id='text']",
      "article p"
    ],
    4000
  );

  const comments = getTextList(
    [
      "shreddit-comment [slot='comment']",
      "shreddit-comment [data-testid='comment']",
      "[data-testid='comment'] [slot='comment']",
      "[data-testid='comment'] p",
      "[data-testid='comment'] div[style] p"
    ],
    20,
    700
  );

  return {
    url: window.location.href,
    title,
    body,
    comments
  };
}

function setSummaryState(nextState) {
  summaryState = {
    ...summaryState,
    ...nextState
  };

  if (!overlayElements) {
    return;
  }

  const {
    summaryButton,
    summaryStatus,
    summaryOutput
  } = overlayElements;

  if (summaryButton instanceof HTMLButtonElement) {
    summaryButton.disabled = summaryState.loading;
    summaryButton.textContent = summaryState.loading ? "Summarizing..." : "Summarize this thread";
  }

  if (summaryStatus) {
    summaryStatus.textContent = summaryState.status;
  }

  if (summaryOutput) {
    summaryOutput.textContent = summaryState.summary;
    summaryOutput.toggleAttribute("hidden", !summaryState.summary);
  }
}

async function summarizeCurrentThread() {
  const payload = collectThreadContent();

  if (!payload.title && !payload.body && payload.comments.length === 0) {
    setSummaryState({
      loading: false,
      status: "I couldn't find enough post text on this page to summarize.",
      summary: ""
    });
    return;
  }

  setSummaryState({
    loading: true,
    status: "Generating a summary from the post and top comments...",
    summary: ""
  });

  try {
    const response = await chrome.runtime.sendMessage({
      type: "SUMMARIZE_THREAD",
      payload
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Unable to summarize this thread right now.");
    }

    setSummaryState({
      loading: false,
      status: "Summary ready.",
      summary: response.summary
    });
  } catch (error) {
    setSummaryState({
      loading: false,
      status: error instanceof Error ? error.message : "Unable to summarize this thread right now.",
      summary: ""
    });
  }
}

function getAttentionIntent() {
  return attentionState.intention || "your intention";
}

function setAttentionStatus(message) {
  const status = overlayElements?.attentionStatus;
  if (status) {
    status.textContent = message;
  }
}

function updateAttentionTimerLabel() {
  const label = overlayElements?.attentionTimerStatus;
  const minutes = Number(currentSettings.attentionTimerMinutes || 0);
  let text = "No break timer";

  if (minutes > 0 && attentionState.timerEndsAt) {
    const remainingMs = Math.max(0, attentionState.timerEndsAt - Date.now());
    text = `Break in ${formatRemainingTime(remainingMs)}`;
  } else if (minutes > 0) {
    text = `${minutes} min break timer`;
  }

  if (label) {
    label.textContent = text;
  }

  if (overlayElements?.attentionTimerNote) {
    overlayElements.attentionTimerNote.textContent = minutes > 0 ? text : "No break timer";
  }
}

function formatRemainingTime(milliseconds) {
  const totalSeconds = Math.ceil(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes <= 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function formatScrollDistance(pixels) {
  const roundedPixels = Math.max(0, Math.ceil(pixels));

  if (roundedPixels >= 1000) {
    return `${(roundedPixels / 1000).toFixed(1)}k px`;
  }

  return `${roundedPixels}px`;
}

function getScrollDistanceLeft(fromY, threshold) {
  return Math.max(0, threshold - Math.abs(window.scrollY - fromY));
}

function updateAttentionScrollLabels() {
  const pauseLabel = overlayElements?.attentionPauseStatus;

  if (pauseLabel) {
    if (!currentSettings.autoPauseFeed) {
      pauseLabel.textContent = "Scroll pause off";
    } else if (attentionState.paused) {
      pauseLabel.textContent = "Feed is paused";
    } else {
      const pauseLeft = getScrollDistanceLeft(attentionState.lastPauseY, ATTENTION_PAUSE_DISTANCE);
      pauseLabel.textContent = `Pause in ${formatScrollDistance(pauseLeft)}`;
    }
  }
}

function clearAttentionCountdown() {
  if (attentionState.countdownId) {
    window.clearInterval(attentionState.countdownId);
    attentionState.countdownId = null;
  }
}

function scheduleAttentionTimer() {
  if (attentionState.timerId) {
    window.clearTimeout(attentionState.timerId);
    attentionState.timerId = null;
  }
  clearAttentionCountdown();
  attentionState.timerEndsAt = 0;

  const minutes = Number(currentSettings.attentionTimerMinutes || 0);
  if (!minutes || !attentionState.startedAt) {
    updateAttentionTimerLabel();
    return;
  }

  attentionState.timerEndsAt = Date.now() + (minutes * 60 * 1000);
  updateAttentionTimerLabel();
  attentionState.countdownId = window.setInterval(updateAttentionTimerLabel, 1000);
  attentionState.timerId = window.setTimeout(() => {
    clearAttentionCountdown();
    attentionState.timerEndsAt = 0;
    updateAttentionTimerLabel();
    showAttentionToast(`Time check: still here for ${getAttentionIntent()}?`);
    pauseFeed("Break timer finished.");
  }, minutes * 60 * 1000);
}

function showAttentionPrompt() {
  const modal = overlayElements?.attentionModal;
  const input = overlayElements?.attentionIntentInput;
  const timerInput = overlayElements?.attentionPromptTimerInput;

  if (!modal || attentionState.prompted || !currentSettings.attentionPrompt) {
    return;
  }

  attentionState.prompted = true;
  modal.removeAttribute("hidden");

  if (input instanceof HTMLInputElement) {
    input.value = attentionState.intention;
    window.setTimeout(() => input.focus(), 50);
  }

  if (timerInput instanceof HTMLInputElement) {
    timerInput.value = String(currentSettings.attentionTimerMinutes ?? 0);
  }
}

function closeAttentionPrompt() {
  overlayElements?.attentionModal?.setAttribute("hidden", "");
}

function startAttentionSession(intention) {
  attentionState.intention = normalizeText(intention);
  attentionState.startedAt = Date.now();
  attentionState.lastPauseY = window.scrollY;
  updateAttentionScrollLabels();
  closeAttentionPrompt();
  scheduleAttentionTimer();

  const message = attentionState.intention
    ? `Intention set: ${attentionState.intention}`
    : "Session started without an intention.";
  setAttentionStatus(message);
}

async function startAttentionSessionFromPrompt(intention) {
  const timerInput = overlayElements?.attentionPromptTimerInput;

  if (timerInput instanceof HTMLInputElement) {
    const timerMinutes = Math.max(0, Number(timerInput.value) || 0);
    const nextSettings = await saveSettings({
      ...currentSettings,
      attentionTimerMinutes: timerMinutes
    });

    applySettings(nextSettings);
  }

  startAttentionSession(intention);
}

function showAttentionToast(message) {
  const toast = overlayElements?.attentionToast;
  if (!toast) {
    return;
  }

  toast.textContent = message;
  toast.removeAttribute("hidden");

  if (attentionState.reminderTimer) {
    window.clearTimeout(attentionState.reminderTimer);
  }

  attentionState.reminderTimer = window.setTimeout(() => {
    toast.setAttribute("hidden", "");
  }, 5200);
}

function setFeedPaused(paused) {
  if (paused === attentionState.paused) {
    return;
  }

  attentionState.paused = paused;

  if (paused) {
    attentionState.previousOverflow = document.documentElement.style.overflow;
    attentionState.previousBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return;
  }

  document.documentElement.style.overflow = attentionState.previousOverflow;
  document.body.style.overflow = attentionState.previousBodyOverflow;
  attentionState.lastPauseY = window.scrollY;
  updateAttentionScrollLabels();
}

function pauseFeed(reason = "Feed paused.") {
  if (!currentSettings.autoPauseFeed || attentionState.paused) {
    return;
  }

  const pauseCard = overlayElements?.attentionPause;
  const pauseReason = overlayElements?.attentionPauseReason;

  if (pauseReason) {
    pauseReason.textContent = reason;
  }

  pauseCard?.removeAttribute("hidden");
  setFeedPaused(true);
  updateAttentionScrollLabels();
}

function resumeFeed() {
  overlayElements?.attentionPause?.setAttribute("hidden", "");
  setFeedPaused(false);
}

function handleAttentionScroll() {
  if (!currentSettings.enabled || attentionState.paused) {
    return;
  }

  const y = window.scrollY;

  if (currentSettings.autoPauseFeed && Math.abs(y - attentionState.lastPauseY) >= ATTENTION_PAUSE_DISTANCE) {
    pauseFeed("You have been scrolling for a while.");
  }

  updateAttentionScrollLabels();
}

function buildOverlay(root) {
  const shadow = root.shadowRoot ?? root.attachShadow({ mode: "open" });

  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
      }

      :host {
        color-scheme: light dark;
        --rao-panel-bg: #ffffff;
        --rao-panel-text: #0f172a;
        --rao-panel-muted: #475569;
        --rao-panel-border: #cbd5e1;
        --rao-panel-accent: #2563eb;
        --rao-launcher-bg: #0f172a;
        --rao-launcher-text: #f8fafc;
        --rao-panel-shadow: 0 18px 40px rgba(15, 23, 42, 0.2);
      }

      @media (prefers-color-scheme: dark) {
        :host {
          --rao-panel-bg: #18202a;
          --rao-panel-text: #e5edf5;
          --rao-panel-muted: #aeb8c4;
          --rao-panel-border: #314152;
          --rao-panel-accent: #7cb4ff;
          --rao-launcher-bg: #223142;
          --rao-launcher-text: #f8fafc;
          --rao-panel-shadow: 0 18px 40px rgba(0, 0, 0, 0.45);
        }
      }

      .rao-launcher {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483647;
        border: 0;
        border-radius: 999px;
        padding: 12px 16px;
        background: var(--rao-launcher-bg);
        color: var(--rao-launcher-text);
        font: 600 14px/1.2 Arial, sans-serif;
        box-shadow: 0 12px 28px rgba(15, 23, 42, 0.24);
        cursor: pointer;
      }

      .rao-panel {
        position: fixed;
        right: 16px;
        bottom: 72px;
        width: 320px;
        max-height: calc(100vh - 96px);
        z-index: 2147483647;
        border-radius: 16px;
        padding: 16px;
        background: var(--rao-panel-bg);
        color: var(--rao-panel-text);
        font: 14px/1.5 Arial, sans-serif;
        box-shadow: var(--rao-panel-shadow);
        overflow-y: auto;
        overscroll-behavior: contain;
        scrollbar-gutter: stable;
      }

      .rao-panel[hidden] {
        display: none;
      }

      .rao-title {
        margin: 0 0 8px;
        font-size: 16px;
      }

      .rao-copy {
        margin: 0 0 12px;
      }

      .rao-row {
        display: grid;
        gap: 8px;
        margin-bottom: 14px;
      }

      .rao-row-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        font-weight: 600;
      }

      .rao-toggle {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .rao-value {
        min-width: 64px;
        text-align: right;
        color: var(--rao-panel-accent);
        font-variant-numeric: tabular-nums;
      }

      .rao-input,
      .rao-select {
        width: 100%;
      }

      .rao-select {
        border: 1px solid var(--rao-panel-border);
        border-radius: 10px;
        padding: 10px 12px;
        background: var(--rao-panel-bg);
        color: inherit;
        font: inherit;
      }

      .rao-hint {
        color: var(--rao-panel-muted);
        font-size: 12px;
      }

      .rao-link {
        color: var(--rao-panel-accent);
        text-decoration: none;
      }

      .rao-button {
        width: 100%;
        border: 0;
        border-radius: 10px;
        padding: 11px 12px;
        background: var(--rao-panel-accent);
        color: #ffffff;
        font: inherit;
        font-weight: 600;
        cursor: pointer;
      }

      .rao-button:disabled {
        opacity: 0.7;
        cursor: wait;
      }

      .rao-summary-status {
        margin: 10px 0 0;
        color: var(--rao-panel-muted);
        font-size: 12px;
      }

      .rao-summary-output {
        margin: 12px 0 0;
        border: 1px solid var(--rao-panel-border);
        border-radius: 12px;
        padding: 12px;
        max-height: min(320px, 40vh);
        background: color-mix(in srgb, var(--rao-panel-bg) 92%, var(--rao-panel-accent) 8%);
        color: inherit;
        overflow-y: auto;
        white-space: pre-wrap;
      }

      .rao-summary-output[hidden] {
        display: none;
      }

      .rao-divider {
        border: 0;
        border-top: 1px solid var(--rao-panel-border);
        margin: 18px 0 14px;
      }

      .rao-section-label {
        margin: 0 0 12px;
        color: var(--rao-panel-muted);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }

      .rao-number {
        width: 84px;
        border: 1px solid var(--rao-panel-border);
        border-radius: 10px;
        padding: 8px 10px;
        background: var(--rao-panel-bg);
        color: inherit;
        font: inherit;
      }

      .rao-attention-status {
        min-height: 18px;
        margin: 0 0 10px;
        color: var(--rao-panel-muted);
        font-size: 12px;
      }

      .rao-scroll-status {
        margin: -8px 0 12px;
        color: var(--rao-panel-muted);
        font-size: 12px;
        font-variant-numeric: tabular-nums;
      }

      .rao-attention-backdrop,
      .rao-pause-backdrop {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: grid;
        place-items: center;
        padding: 24px;
        background: rgba(15, 23, 42, 0.36);
        backdrop-filter: blur(2px);
      }

      .rao-attention-backdrop[hidden],
      .rao-pause-backdrop[hidden],
      .rao-attention-toast[hidden] {
        display: none;
      }

      .rao-attention-card,
      .rao-pause-card {
        width: min(100%, 360px);
        border: 1px solid var(--rao-panel-border);
        border-radius: 8px;
        padding: 24px;
        background: var(--rao-panel-bg);
        color: var(--rao-panel-text);
        box-shadow: var(--rao-panel-shadow);
        font: 14px/1.5 Arial, sans-serif;
        text-align: center;
      }

      .rao-attention-icon {
        display: block;
        width: 18px;
        height: 18px;
        margin-bottom: 8px;
        margin-inline: auto;
        border-radius: 999px;
        background: radial-gradient(circle at 35% 35%, #fbcfe8, #f472b6 72%);
      }

      .rao-attention-card h2,
      .rao-pause-card h2 {
        margin: 0 0 8px;
        font-size: 22px;
        line-height: 1.2;
      }

      .rao-attention-card p,
      .rao-pause-card p {
        margin: 0 0 16px;
        color: var(--rao-panel-muted);
        font-size: 13px;
      }

      .rao-intention-input {
        box-sizing: border-box;
        width: 100%;
        border: 1px solid var(--rao-panel-border);
        border-radius: 4px;
        padding: 11px 12px;
        background: var(--rao-panel-bg);
        color: inherit;
        font: inherit;
      }

      .rao-prompt-timer-row {
        display: grid;
        gap: 6px;
        margin-top: 12px;
        text-align: left;
      }

      .rao-prompt-timer-row span {
        color: var(--rao-panel-text);
        font-size: 12px;
        font-weight: 700;
      }

      .rao-prompt-timer-input {
        box-sizing: border-box;
        width: 100%;
        border: 1px solid var(--rao-panel-border);
        border-radius: 4px;
        padding: 10px 12px;
        background: var(--rao-panel-bg);
        color: inherit;
        font: inherit;
      }

      .rao-attention-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        margin-top: 12px;
      }

      .rao-pause-actions {
        grid-template-columns: 1fr;
      }

      .rao-secondary-button {
        border: 1px solid var(--rao-panel-border);
        border-radius: 4px;
        padding: 10px 12px;
        background: transparent;
        color: inherit;
        font: inherit;
        font-weight: 600;
        cursor: pointer;
      }

      .rao-primary-button {
        border: 0;
        border-radius: 4px;
        padding: 10px 12px;
        background: #111827;
        color: #ffffff;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }

      .rao-timer-note {
        display: block;
        margin-top: 12px;
        color: var(--rao-panel-muted);
        font-size: 11px;
      }

      .rao-attention-toast {
        position: fixed;
        right: 16px;
        bottom: 84px;
        z-index: 2147483647;
        max-width: 320px;
        border-radius: 8px;
        padding: 12px 14px;
        background: #1d4ed8;
        color: #ffffff;
        font: 700 13px/1.35 Arial, sans-serif;
        box-shadow: 0 12px 28px rgba(15, 23, 42, 0.24);
      }
    </style>
    <button class="rao-launcher" type="button" aria-expanded="false">
      Reading Tools
    </button>
    <section class="rao-panel" hidden>
      <h2 class="rao-title">Accessibility Overlay</h2>
      <p class="rao-copy">Adjust type and spacing to make Reddit easier to read.</p>
      <label class="rao-row rao-toggle">
        <span>Extension enabled</span>
        <input class="rao-enabled" type="checkbox" />
      </label>
      <hr class="rao-divider" />
      <p class="rao-section-label">Reduced Stimulation</p>
      <label class="rao-row">
        <span class="rao-row-head">
          <span>Reduced stimulation mode</span>
          <input class="rao-reduced-stimulation" type="checkbox" />
        </span>
        <span class="rao-hint">Hides sidebars and social metrics where possible, softens colors, and reduces deep nested replies.</span>
      </label>
      <label class="rao-row">
        <span class="rao-row-head">
          <span>Font preset</span>
        </span>
        <select class="rao-select rao-font-preset">
          <option value="default">Default Reddit font</option>
          <option value="dyslexia">Dyslexia-friendly stack</option>
        </select>
        <span class="rao-hint">Choose the dyslexia-friendly option for letter shapes designed to feel clearer and easier to track while reading.</span>
      </label>
      <label class="rao-row">
        <span class="rao-row-head">
          <span>Text size</span>
          <span class="rao-value rao-font-scale-value"></span>
        </span>
        <input class="rao-input rao-font-scale" type="range" min="1" max="1.5" step="0.05" />
      </label>
      <label class="rao-row">
        <span class="rao-row-head">
          <span>Line spacing</span>
          <span class="rao-value rao-line-height-value"></span>
        </span>
        <input class="rao-input rao-line-height" type="range" min="1.4" max="2.2" step="0.05" />
      </label>
      <label class="rao-row">
        <span class="rao-row-head">
          <span>Letter spacing</span>
          <span class="rao-value rao-letter-spacing-value"></span>
        </span>
        <input class="rao-input rao-letter-spacing" type="range" min="0" max="0.12" step="0.01" />
      </label>
      <label class="rao-row">
        <span class="rao-row-head">
          <span>Word spacing</span>
          <span class="rao-value rao-word-spacing-value"></span>
        </span>
        <input class="rao-input rao-word-spacing" type="range" min="0" max="0.3" step="0.02" />
      </label>
      <hr class="rao-divider" />
      <p class="rao-section-label">Attention</p>
      <label class="rao-row rao-toggle">
        <span>Ask why I am here</span>
        <input class="rao-attention-prompt" type="checkbox" />
      </label>
      <label class="rao-row">
        <span class="rao-row-head">
          <span>Break timer</span>
          <span class="rao-value rao-attention-timer-status"></span>
        </span>
        <input class="rao-number rao-attention-timer" type="number" min="0" step="any" inputmode="decimal" />
        <span class="rao-hint">Use 0 for no timer.</span>
      </label>
      <label class="rao-row rao-toggle">
        <span>Scroll pause</span>
        <input class="rao-auto-pause-feed" type="checkbox" />
      </label>
      <p class="rao-scroll-status rao-pause-scroll-status"></p>
      <p class="rao-attention-status" aria-live="polite"></p>
      <div class="rao-row">
        <button class="rao-button rao-summary-button" type="button">Summarize this thread</button>
        <p class="rao-summary-status" aria-live="polite"></p>
        <div class="rao-summary-output" hidden></div>
      </div>
      <hr class="rao-divider" />
      <p class="rao-section-label">Text to Speech</p>
      <label class="rao-row">
        <span class="rao-row-head"><span>Voice</span></span>
        <select class="rao-select rao-tts-voice">
          <option value="">Default voice</option>
        </select>
      </label>
      <label class="rao-row rao-toggle">
        <span>Highlight words while reading</span>
        <input class="rao-tts-highlight" type="checkbox" />
      </label>
      <a class="rao-link" href="${chrome.runtime.getURL("src/options/options.html")}" target="_blank" rel="noreferrer">
        Open settings
      </a>
    </section>
    <div class="rao-attention-backdrop" hidden>
      <form class="rao-attention-card">
        <span class="rao-attention-icon" aria-hidden="true"></span>
        <h2>Why am I here?</h2>
        <p>Take a moment to set an intention before browsing.</p>
        <input class="rao-intention-input" type="text" maxlength="140" placeholder="e.g. Check r/webdev for React tips" />
        <label class="rao-prompt-timer-row">
          <span>Break timer in minutes</span>
          <input class="rao-prompt-timer-input" type="number" min="0" step="any" inputmode="decimal" placeholder="0 for no timer" />
        </label>
        <div class="rao-attention-actions">
          <button class="rao-secondary-button rao-attention-skip" type="button">Skip</button>
          <button class="rao-primary-button" type="submit">Set Intention</button>
        </div>
        <span class="rao-timer-note rao-attention-timer-note"></span>
      </form>
    </div>
    <div class="rao-pause-backdrop" hidden>
      <div class="rao-pause-card" role="dialog" aria-modal="true" aria-labelledby="rao-pause-title">
        <h2 id="rao-pause-title">Pause the feed</h2>
        <p class="rao-pause-reason">You have been scrolling for a while.</p>
        <div class="rao-attention-actions rao-pause-actions">
          <button class="rao-secondary-button rao-pause-break" type="button">Take a break</button>
          <button class="rao-primary-button rao-pause-resume" type="button">Continue</button>
          <button class="rao-secondary-button rao-pause-disable" type="button">Turn off scroll pause</button>
        </div>
      </div>
    </div>
    <div class="rao-attention-toast" role="status" aria-live="polite" hidden></div>
  `;

  const launcher = shadow.querySelector(".rao-launcher");
  const panel = shadow.querySelector(".rao-panel");
  const enabledInput = shadow.querySelector(".rao-enabled");
  const reducedStimulationInput = shadow.querySelector(".rao-reduced-stimulation");
  const attentionPromptInput = shadow.querySelector(".rao-attention-prompt");
  const attentionTimerInput = shadow.querySelector(".rao-attention-timer");
  const autoPauseFeedInput = shadow.querySelector(".rao-auto-pause-feed");
  const fontPresetInput = shadow.querySelector(".rao-font-preset");
  const fontScaleInput = shadow.querySelector(".rao-font-scale");
  const lineHeightInput = shadow.querySelector(".rao-line-height");
  const letterSpacingInput = shadow.querySelector(".rao-letter-spacing");
  const wordSpacingInput = shadow.querySelector(".rao-word-spacing");
  const ttsVoiceInput = shadow.querySelector(".rao-tts-voice");
  const ttsHighlightInput = shadow.querySelector(".rao-tts-highlight");
  const fontScaleValue = shadow.querySelector(".rao-font-scale-value");
  const lineHeightValue = shadow.querySelector(".rao-line-height-value");
  const letterSpacingValue = shadow.querySelector(".rao-letter-spacing-value");
  const wordSpacingValue = shadow.querySelector(".rao-word-spacing-value");
  const summaryButton = shadow.querySelector(".rao-summary-button");
  const summaryStatus = shadow.querySelector(".rao-summary-status");
  const summaryOutput = shadow.querySelector(".rao-summary-output");
  const attentionStatus = shadow.querySelector(".rao-attention-status");
  const attentionPauseStatus = shadow.querySelector(".rao-pause-scroll-status");
  const attentionTimerStatus = shadow.querySelector(".rao-attention-timer-status");
  const attentionModal = shadow.querySelector(".rao-attention-backdrop");
  const attentionForm = shadow.querySelector(".rao-attention-card");
  const attentionIntentInput = shadow.querySelector(".rao-intention-input");
  const attentionPromptTimerInput = shadow.querySelector(".rao-prompt-timer-input");
  const attentionSkip = shadow.querySelector(".rao-attention-skip");
  const attentionTimerNote = shadow.querySelector(".rao-attention-timer-note");
  const attentionToast = shadow.querySelector(".rao-attention-toast");
  const attentionPause = shadow.querySelector(".rao-pause-backdrop");
  const attentionPauseReason = shadow.querySelector(".rao-pause-reason");
  const attentionPauseResume = shadow.querySelector(".rao-pause-resume");
  const attentionPauseBreak = shadow.querySelector(".rao-pause-break");
  const attentionPauseDisable = shadow.querySelector(".rao-pause-disable");

  populateVoiceSelect(ttsVoiceInput);

  overlayElements = {
    enabledInput,
    reducedStimulationInput,
    attentionPromptInput,
    attentionTimerInput,
    autoPauseFeedInput,
    fontPresetInput,
    fontScaleInput,
    lineHeightInput,
    letterSpacingInput,
    wordSpacingInput,
    ttsVoiceInput,
    ttsHighlightInput,
    fontScaleValue,
    lineHeightValue,
    letterSpacingValue,
    wordSpacingValue,
    summaryButton,
    summaryStatus,
    summaryOutput,
    attentionStatus,
    attentionPauseStatus,
    attentionTimerStatus,
    attentionModal,
    attentionForm,
    attentionIntentInput,
    attentionPromptTimerInput,
    attentionSkip,
    attentionTimerNote,
    attentionToast,
    attentionPause,
    attentionPauseReason,
    attentionPauseResume,
    attentionPauseBreak,
    attentionPauseDisable
  };

  launcher?.addEventListener("click", () => {
    const isHidden = panel?.hasAttribute("hidden");
    if (!panel) {
      return;
    }

    if (isHidden) {
      panel.removeAttribute("hidden");
      launcher.setAttribute("aria-expanded", "true");
    } else {
      panel.setAttribute("hidden", "");
      launcher.setAttribute("aria-expanded", "false");
    }
  });

  enabledInput?.addEventListener("change", async (event) => {
    const checked = event.target instanceof HTMLInputElement ? event.target.checked : true;
    const nextSettings = await saveSettings({
      ...currentSettings,
      enabled: checked
    });

    applySettings(nextSettings);
  });

  reducedStimulationInput?.addEventListener("change", async (event) => {
    const checked = event.target instanceof HTMLInputElement ? event.target.checked : false;
    const nextSettings = await saveSettings({
      ...currentSettings,
      reducedStimulation: checked
    });

    applySettings(nextSettings);
  });

  attentionPromptInput?.addEventListener("change", async (event) => {
    const checked = event.target instanceof HTMLInputElement ? event.target.checked : true;
    const nextSettings = await saveSettings({
      ...currentSettings,
      attentionPrompt: checked
    });

    applySettings(nextSettings);
  });

  attentionTimerInput?.addEventListener("change", async (event) => {
    const value = event.target instanceof HTMLInputElement ? Number(event.target.value) : 0;
    const nextSettings = await saveSettings({
      ...currentSettings,
      attentionTimerMinutes: Math.max(0, value || 0)
    });

    applySettings(nextSettings);
    scheduleAttentionTimer();
  });

  autoPauseFeedInput?.addEventListener("change", async (event) => {
    const checked = event.target instanceof HTMLInputElement ? event.target.checked : true;
    const nextSettings = await saveSettings({
      ...currentSettings,
      autoPauseFeed: checked
    });

    applySettings(nextSettings);
    if (!checked) {
      resumeFeed();
    }
    updateAttentionScrollLabels();
  });

  fontPresetInput?.addEventListener("change", async (event) => {
    const value = event.target instanceof HTMLSelectElement ? event.target.value : currentSettings.fontPreset;
    const nextSettings = await saveSettings({
      ...currentSettings,
      fontPreset: value
    });

    applySettings(nextSettings);
  });

  fontScaleInput?.addEventListener("input", async (event) => {
    const value = event.target instanceof HTMLInputElement ? Number(event.target.value) : currentSettings.fontScale;
    const nextSettings = {
      ...currentSettings,
      fontScale: value
    };
    applySettings(nextSettings);
    scheduleSave(nextSettings);
  });

  lineHeightInput?.addEventListener("input", async (event) => {
    const value = event.target instanceof HTMLInputElement ? Number(event.target.value) : currentSettings.lineHeight;
    const nextSettings = {
      ...currentSettings,
      lineHeight: value
    };
    applySettings(nextSettings);
    scheduleSave(nextSettings);
  });

  letterSpacingInput?.addEventListener("input", async (event) => {
    const value = event.target instanceof HTMLInputElement ? Number(event.target.value) : currentSettings.letterSpacing;
    const nextSettings = {
      ...currentSettings,
      letterSpacing: value
    };
    applySettings(nextSettings);
    scheduleSave(nextSettings);
  });

  wordSpacingInput?.addEventListener("input", async (event) => {
    const value = event.target instanceof HTMLInputElement ? Number(event.target.value) : currentSettings.wordSpacing;
    const nextSettings = {
      ...currentSettings,
      wordSpacing: value
    };
    applySettings(nextSettings);
    scheduleSave(nextSettings);
  });

  summaryButton?.addEventListener("click", async () => {
    await summarizeCurrentThread();
  });

  setSummaryState(summaryState);

  ttsVoiceInput?.addEventListener("change", async (event) => {
    const value = event.target instanceof HTMLSelectElement ? event.target.value : currentSettings.ttsVoice;
    const nextSettings = await saveSettings({ ...currentSettings, ttsVoice: value });
    applySettings(nextSettings);
  });

  ttsHighlightInput?.addEventListener("change", async (event) => {
    const checked = event.target instanceof HTMLInputElement ? event.target.checked : true;
    const nextSettings = await saveSettings({ ...currentSettings, ttsHighlight: checked });
    applySettings(nextSettings);
  });

  attentionForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = attentionIntentInput instanceof HTMLInputElement ? attentionIntentInput.value : "";
    startAttentionSessionFromPrompt(value);
  });

  attentionSkip?.addEventListener("click", () => {
    startAttentionSessionFromPrompt("");
  });

  attentionPauseResume?.addEventListener("click", () => {
    resumeFeed();
  });

  attentionPauseBreak?.addEventListener("click", () => {
    resumeFeed();
    window.scrollTo({ top: 0, behavior: "smooth" });
    showAttentionToast("Break started. Come back when you are ready.");
  });

  attentionPauseDisable?.addEventListener("click", async () => {
    const nextSettings = await saveSettings({
      ...currentSettings,
      autoPauseFeed: false
    });

    resumeFeed();
    applySettings(nextSettings);
    updateAttentionScrollLabels();
  });
}
/* TTS inputs ends */

function syncOverlay(settings) {
  if (!overlayElements) {
    return;
  }

  const {
    enabledInput,
    reducedStimulationInput,
    attentionPromptInput,
    attentionTimerInput,
    autoPauseFeedInput,
    fontPresetInput,
    fontScaleInput,
    lineHeightInput,
    letterSpacingInput,
    wordSpacingInput,
    ttsVoiceInput,
    ttsHighlightInput,
    fontScaleValue,
    lineHeightValue,
    letterSpacingValue,
    wordSpacingValue
  } = overlayElements;

  if (enabledInput instanceof HTMLInputElement) {
    enabledInput.checked = settings.enabled;
  }

  if (reducedStimulationInput instanceof HTMLInputElement) {
    reducedStimulationInput.checked = settings.reducedStimulation;
  }

  if (attentionPromptInput instanceof HTMLInputElement) {
    attentionPromptInput.checked = settings.attentionPrompt ?? true;
  }

  if (attentionTimerInput instanceof HTMLInputElement) {
    attentionTimerInput.value = String(settings.attentionTimerMinutes ?? 0);
  }

  if (overlayElements.attentionPromptTimerInput instanceof HTMLInputElement) {
    overlayElements.attentionPromptTimerInput.value = String(settings.attentionTimerMinutes ?? 0);
  }

  if (autoPauseFeedInput instanceof HTMLInputElement) {
    autoPauseFeedInput.checked = settings.autoPauseFeed ?? true;
  }

  if (fontPresetInput instanceof HTMLSelectElement) {
    fontPresetInput.value = settings.fontPreset;
  }

  if (fontScaleInput instanceof HTMLInputElement) {
    fontScaleInput.value = String(settings.fontScale);
  }

  if (lineHeightInput instanceof HTMLInputElement) {
    lineHeightInput.value = String(settings.lineHeight);
  }

  if (letterSpacingInput instanceof HTMLInputElement) {
    letterSpacingInput.value = String(settings.letterSpacing);
  }

  if (wordSpacingInput instanceof HTMLInputElement) {
    wordSpacingInput.value = String(settings.wordSpacing);
  }

  if (fontScaleValue) {
    fontScaleValue.textContent = formatPercent(settings.fontScale);
  }

  if (lineHeightValue) {
    lineHeightValue.textContent = settings.lineHeight.toFixed(2);
  }

  if (letterSpacingValue) {
    letterSpacingValue.textContent = formatEm(settings.letterSpacing);
  }

  if (wordSpacingValue) {
    wordSpacingValue.textContent = formatEm(settings.wordSpacing);
  }

  if (ttsVoiceInput instanceof HTMLSelectElement && settings.ttsVoice !== undefined) {
    ttsVoiceInput.value = settings.ttsVoice;
  }

  if (ttsHighlightInput instanceof HTMLInputElement) {
    ttsHighlightInput.checked = settings.ttsHighlight ?? true;
  }

  updateAttentionTimerLabel();
  updateAttentionScrollLabels();
}

function applySettings(settings) {
  currentSettings = {
    ...DEFAULT_SETTINGS,
    ...settings
  };

  document.documentElement.dataset.raoEnabled = String(settings.enabled);
  document.documentElement.dataset.raoReducedStimulation = String(settings.reducedStimulation);
  document.documentElement.style.setProperty("--rao-font-family", FONT_STACKS[settings.fontPreset] ?? FONT_STACKS.dyslexia);
  document.documentElement.style.setProperty("--rao-font-scale", String(settings.fontScale));
  document.documentElement.style.setProperty("--rao-line-height", String(settings.lineHeight));
  document.documentElement.style.setProperty("--rao-letter-spacing", `${settings.letterSpacing}em`);
  document.documentElement.style.setProperty("--rao-word-spacing", `${settings.wordSpacing}em`);
  syncOverlay(currentSettings);
  syncAllSpeedControls();

  if (!currentSettings.enabled || !currentSettings.autoPauseFeed) {
    resumeFeed();
  }
}

async function init() {
  if (!isRedditPage()) {
    return;
  }

  const settings = await getSettings().catch(() => DEFAULT_SETTINGS);
  const root = createRoot();
  buildOverlay(root);
  applySettings(settings);
  attentionState.lastReminderY = window.scrollY;
  attentionState.lastPauseY = window.scrollY;
  showAttentionPrompt();
  startTTSObserver();
  window.addEventListener("scroll", handleAttentionScroll, { passive: true });
  document.addEventListener("click", activateFocusedReading);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") clearFocusedReading(); });
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "TAB_MUTED")   { tabMuted = true;  stopTTS(); }
    if (msg.type === "TAB_UNMUTED") { tabMuted = false; }
  });

  chrome.runtime.sendMessage({ type: "PING" }, (res) => {
    if (!res?.tabId) return;
    chrome.runtime.sendMessage({ type: "GET_MUTE_STATE", tabId: res.tabId }, (r) => {
      tabMuted = r?.muted ?? false;
    });
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync" || !changes[STORAGE_KEY]?.newValue) {
      return;
    }

    applySettings(changes[STORAGE_KEY].newValue);
    scheduleAttentionTimer();
  });
}

init();
