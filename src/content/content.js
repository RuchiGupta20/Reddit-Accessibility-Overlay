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
  ttsHighlight: true
};
const FONT_STACKS = {
  default: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  dyslexia: '"OpenDyslexic", "Atkinson Hyperlegible", "Lexend", Verdana, Tahoma, Arial, sans-serif'
};
var currentSettings = { ...DEFAULT_SETTINGS };
var overlayElements = null;
let persistTimer = null;

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

function buildOverlay(root) {
  const shadow = root.shadowRoot ?? root.attachShadow({ mode: "open" });

  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
      }

      .rao-launcher {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483647;
        border: 0;
        border-radius: 999px;
        padding: 12px 16px;
        background: #0f172a;
        color: #f8fafc;
        font: 600 14px/1.2 Arial, sans-serif;
        box-shadow: 0 12px 28px rgba(15, 23, 42, 0.24);
        cursor: pointer;
      }

      .rao-panel {
        position: fixed;
        right: 16px;
        bottom: 72px;
        width: 320px;
        max-height: calc(100vh - 100px);
        overflow-y: auto;
        z-index: 2147483647;
        border-radius: 16px;
        padding: 16px;
        background: #ffffff;
        color: #0f172a;
        font: 14px/1.5 Arial, sans-serif;
        box-shadow: 0 18px 40px rgba(15, 23, 42, 0.2);
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
        color: #2563eb;
        font-variant-numeric: tabular-nums;
      }

      .rao-input,
      .rao-select {
        width: 100%;
      }

      .rao-select {
        border: 1px solid #cbd5e1;
        border-radius: 10px;
        padding: 10px 12px;
        background: #ffffff;
        color: inherit;
        font: inherit;
      }

      .rao-hint {
        color: #475569;
        font-size: 12px;
      }

      .rao-link {
        color: #2563eb;
        text-decoration: none;
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
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:4px 0 12px" />
      <p style="margin:0 0 10px;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#64748b">Text to Speech</p>
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
  `;

  const launcher = shadow.querySelector(".rao-launcher");
  const panel = shadow.querySelector(".rao-panel");
  const enabledInput = shadow.querySelector(".rao-enabled");
  const reducedStimulationInput = shadow.querySelector(".rao-reduced-stimulation");
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

  populateVoiceSelect(ttsVoiceInput);

  overlayElements = {
    enabledInput,
    reducedStimulationInput,
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
}
/* TTS inputs ends */

function syncOverlay(settings) {
  if (!overlayElements) {
    return;
  }

  const {
    enabledInput,
    reducedStimulationInput,
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
}

async function init() {
  if (!isRedditPage()) {
    return;
  }

  const settings = await getSettings().catch(() => DEFAULT_SETTINGS);
  const root = createRoot();
  buildOverlay(root);
  applySettings(settings);
  startTTSObserver();
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
  });
}

init();
