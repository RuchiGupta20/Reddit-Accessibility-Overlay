const ROOT_ID = "rao-root";
const STORAGE_KEY = "redditAccessibilitySettings";
const DEFAULT_SETTINGS = {
  enabled: true,
  reducedStimulation: false,
  fontPreset: "dyslexia",
  fontScale: 1,
  lineHeight: 1.6,
  letterSpacing: 0,
  wordSpacing: 0
};
const FONT_STACKS = {
  default: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  dyslexia: '"OpenDyslexic", "Atkinson Hyperlegible", "Lexend", Verdana, Tahoma, Arial, sans-serif'
};
let currentSettings = { ...DEFAULT_SETTINGS };
let overlayElements = null;
let persistTimer = null;

function isRedditPage() {
  return window.location.hostname === "www.reddit.com";
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
      
      /*Reminder toast*/
      .rao-toast {
        position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
        z-index: 2147483647; min-width: 280px; max-width: 420px;
        border-radius: 14px; padding: 14px 18px;
        background: #0f172a; color: #f8fafc;
        font: 14px/1.5 Arial, sans-serif;
        box-shadow: 0 12px 32px rgba(15,23,42,0.32);
        display: flex; flex-direction: column; gap: 8px;
        animation: rao-slide-in 0.25s ease;
      }
      .rao-toast[hidden] { display: none; }
      .rao-toast-title { font-weight: 700; font-size: 15px; }
      .rao-toast-goal { color: #93c5fd; font-style: italic; }
      .rao-toast-body { color: #cbd5e1; }
      .rao-toast-close {
        align-self: flex-end; border: 0; background: transparent;
        color: #94a3b8; font-size: 13px; cursor: pointer; padding: 0;
      }
      .rao-toast-end { background: #7c3aed; }
 
      @keyframes rao-slide-in {
        from { opacity: 0; transform: translateX(-50%) translateY(-8px); }
        to   { opacity: 1; transform: translateX(-50%) translateY(0); }
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
      <a class="rao-link" href="${chrome.runtime.getURL("src/options/options.html")}" target="_blank" rel="noreferrer">
        Open settings
      </a>
    </section>
    <!-- Reminder/end toast (hidden by default) -->
    <div class="rao-toast" hidden role="alert" aria-live="assertive">
      <span class="rao-toast-title"></span>
      <span class="rao-toast-goal"></span>
      <span class="rao-toast-body"></span>
      <button class="rao-toast-close" type="button">Dismiss</button>
    </div>
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
  const fontScaleValue = shadow.querySelector(".rao-font-scale-value");
  const lineHeightValue = shadow.querySelector(".rao-line-height-value");
  const letterSpacingValue = shadow.querySelector(".rao-letter-spacing-value");
  const wordSpacingValue = shadow.querySelector(".rao-word-spacing-value");
  const toast = shadow.querySelector(".rao-toast");
  const toastTitle = shadow.querySelector(".rao-toast-title");
  const toastGoal = shadow.querySelector(".rao-toast-goal");
  const toastBody = shadow.querySelector(".rao-toast-body");
  const toastClose = shadow.querySelector(".rao-toast-close");

  overlayElements = {
    enabledInput,
    reducedStimulationInput,
    fontPresetInput,
    fontScaleInput,
    lineHeightInput,
    letterSpacingInput,
    wordSpacingInput,
    fontScaleValue,
    lineHeightValue,
    letterSpacingValue,
    wordSpacingValue
  };

  // ── Toast helpers ──
  let toastTimer = null;

  function showToast({ title, goal, body, isEnd = false, autoDismissMs = 12000 }) {
    if (!toast) return;
    if (toastTitle) toastTitle.textContent = title;
    if (toastGoal) toastGoal.textContent = goal ? `Goal: ${goal}` : "";
    if (toastBody) toastBody.textContent = body;
    toast.classList.toggle("rao-toast-end", isEnd);
    toast.removeAttribute("hidden");
    if (toastTimer) clearTimeout(toastTimer);
    if (!isEnd) {
      toastTimer = setTimeout(() => toast.setAttribute("hidden", ""), autoDismissMs);
    }
  }

  toastClose?.addEventListener("click", () => {
    toast?.setAttribute("hidden", "");
    if (toastTimer) clearTimeout(toastTimer);
  });

  // Store showToast on the shadow so the message listener can call it
  shadow._showToast = showToast;

  // ── Panel toggle ───────────────────────────────────────────────────────────
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
}

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
}

//Time awareness message listener
function getRootShadow() {
  return document.getElementById(ROOT_ID)?.shadowRoot ?? null;
}

chrome.runtime.onMessage.addListener((message) => {
  const shadow = getRootShadow();
  const showToast = shadow?._showToast;
  if (!showToast) return;

  if (message?.type === "REMINDER_NUDGE") {
    const { goal, elapsed, duration } = message.payload;
    const remaining = Math.max(0, duration - elapsed);
    showToast({
      title: "⏱ Time check",
      goal,
      body: `${elapsed} min elapsed · ${remaining} min remaining. Still on track?`,
      isEnd: false
    });
  }

  if (message?.type === "SESSION_ENDED") {
    const { goal, duration } = message.payload;
    showToast({
      title: "✅ Session complete",
      goal,
      body: `Your ${duration}-minute session is up. Great job staying intentional.`,
      isEnd: true,
      autoDismissMs: 0 // stays until dismissed
    });
  }
});

async function init() {
  if (!isRedditPage()) {
    return;
  }

  const settings = await getSettings().catch(() => DEFAULT_SETTINGS);
  const root = createRoot();
  buildOverlay(root);
  applySettings(settings);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync" || !changes[STORAGE_KEY]?.newValue) {
      return;
    }

    applySettings(changes[STORAGE_KEY].newValue);
  });
}

init();
