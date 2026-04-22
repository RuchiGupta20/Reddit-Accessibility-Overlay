import { getSettings, saveSettings } from "../shared/storage.js";

//Time awareness elements
const sessionGoalInput = document.getElementById("session-goal");
const sessionDurationInput = document.getElementById("session-duration");
const reminderIntervalInput = document.getElementById("reminder-interval");
const sessionDurationValue = document.getElementById("session-duration-value");
const reminderIntervalValue = document.getElementById("reminder-interval-value");
const sessionStartBtn = document.getElementById("session-start");
const sessionStopBtn = document.getElementById("session-stop");
const sessionStatusEl = document.getElementById("session-status");

//Reading aids elements
const enabledInput = document.getElementById("enabled");
const reducedStimulationInput = document.getElementById("reduced-stimulation");
const fontPresetInput = document.getElementById("font-preset");
const fontScaleInput = document.getElementById("font-scale");
const lineHeightInput = document.getElementById("line-height");
const letterSpacingInput = document.getElementById("letter-spacing");
const wordSpacingInput = document.getElementById("word-spacing");
const fontScaleValue = document.getElementById("font-scale-value");
const lineHeightValue = document.getElementById("line-height-value");
const letterSpacingValue = document.getElementById("letter-spacing-value");
const wordSpacingValue = document.getElementById("word-spacing-value");
const status = document.getElementById("status");

let currentSettings = null;
let persistTimer = null;
let sessionTickInterval = null;

function setStatus(message) {
  if (status) {
    status.textContent = message;
  }
}

function formatPercent(value) {
  return `${Math.round(Number(value) * 100)}%`;
}

function formatEm(value) {
  return `${Number(value).toFixed(2)}em`;
}

function syncForm(settings) {
  currentSettings = settings;

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

  //Sync time awareness defaults from settings
  if (sessionDurationInput instanceof HTMLInputElement) {
    sessionDurationInput.value = String(settings.sessionDuration ?? 25);
    if (sessionDurationValue) sessionDurationValue.textContent = `${settings.sessionDuration ?? 25} min`;
  }
  if (reminderIntervalInput instanceof HTMLInputElement) {
    reminderIntervalInput.value = String(settings.reminderInterval ?? 10);
    if (reminderIntervalValue) reminderIntervalValue.textContent = `${settings.reminderInterval ?? 10} min`;
  }
  if (sessionGoalInput instanceof HTMLInputElement) {
    sessionGoalInput.value = settings.sessionGoal ?? "";
  }
}

async function updateSettings(partialSettings) {
  if (!currentSettings) {
    return;
  }

  const nextSettings = await saveSettings({
    ...currentSettings,
    ...partialSettings
  });

  syncForm(nextSettings);
  setStatus("Saved.");
}

function previewSettings(partialSettings) {
  if (!currentSettings) {
    return;
  }

  syncForm({
    ...currentSettings,
    ...partialSettings
  });
}

function scheduleSettingsSave(partialSettings) {
  if (!currentSettings) {
    return;
  }

  currentSettings = {
    ...currentSettings,
    ...partialSettings
  };

  if (persistTimer) {
    window.clearTimeout(persistTimer);
  }

  setStatus("Saving...");

  persistTimer = window.setTimeout(async () => {
    persistTimer = null;
    await updateSettings({});
  }, 250);
}

//Session UI
function setSessionUI(active, session = null) {
  if (sessionStartBtn) sessionStartBtn.disabled = active;
  if (sessionStopBtn) sessionStopBtn.disabled = !active;

  if (!active) {
    clearInterval(sessionTickInterval);
    sessionTickInterval = null;
    if (sessionStatusEl) sessionStatusEl.textContent = "";
    return;
  }

  // Live elapsed timer
  function tick() {
    if (!session?.startedAt) return;
    const elapsed = Math.floor((Date.now() - session.startedAt) / 60000);
    const remaining = Math.max(0, session.duration - elapsed);
    if (sessionStatusEl) {
      sessionStatusEl.textContent =
          `⏱ Session active — "${session.goal || "No goal set"}" · ${elapsed}m elapsed · ${remaining}m remaining`;
    }
  }

  tick();
  sessionTickInterval = setInterval(tick, 15000);
}

async function refreshSessionState() {
  const response = await chrome.runtime.sendMessage({ type: "SESSION_GET" }).catch(() => null);
  if (response?.active) {
    setSessionUI(true, response);
  } else {
    setSessionUI(false);
  }
}

//Init
async function init() {
  const settings = await getSettings();
  syncForm(settings);
  await refreshSessionState();

  if (enabledInput instanceof HTMLInputElement) {
    enabledInput.addEventListener("change", async () => {
      await updateSettings({
        enabled: enabledInput.checked
      });
    });
  }

  if (reducedStimulationInput instanceof HTMLInputElement) {
    reducedStimulationInput.addEventListener("change", async () => {
      await updateSettings({
        reducedStimulation: reducedStimulationInput.checked
      });
    });
  }

  if (fontPresetInput instanceof HTMLSelectElement) {
    fontPresetInput.addEventListener("change", async () => {
      await updateSettings({
        fontPreset: fontPresetInput.value
      });
    });
  }

  if (fontScaleInput instanceof HTMLInputElement) {
    fontScaleInput.addEventListener("input", async () => {
      const partialSettings = {
        fontScale: Number(fontScaleInput.value)
      };
      previewSettings(partialSettings);
      scheduleSettingsSave(partialSettings);
    });
  }

  if (lineHeightInput instanceof HTMLInputElement) {
    lineHeightInput.addEventListener("input", async () => {
      const partialSettings = {
        lineHeight: Number(lineHeightInput.value)
      };
      previewSettings(partialSettings);
      scheduleSettingsSave(partialSettings);
    });
  }

  if (letterSpacingInput instanceof HTMLInputElement) {
    letterSpacingInput.addEventListener("input", async () => {
      const partialSettings = {
        letterSpacing: Number(letterSpacingInput.value)
      };
      previewSettings(partialSettings);
      scheduleSettingsSave(partialSettings);
    });
  }

  if (wordSpacingInput instanceof HTMLInputElement) {
    wordSpacingInput.addEventListener("input", async () => {
      const partialSettings = {
        wordSpacing: Number(wordSpacingInput.value)
      };
      previewSettings(partialSettings);
      scheduleSettingsSave(partialSettings);
    });
  }

  // Time awareness listeners
  // Session duration input
  if (sessionDurationInput instanceof HTMLInputElement) {
    sessionDurationInput.addEventListener("input", () => {
      const val = Number(sessionDurationInput.value);

      if (sessionDurationValue) {
        sessionDurationValue.textContent = `${val} min`;
      }

      scheduleSettingsSave({ sessionDuration: val });
    });
  }

  // Reminder interval input
  if (reminderIntervalInput instanceof HTMLInputElement) {
    reminderIntervalInput.addEventListener("input", () => {
      const val = Number(reminderIntervalInput.value);

      if (reminderIntervalValue) {
        reminderIntervalValue.textContent = `${val} min`;
      }

      scheduleSettingsSave({ reminderInterval: val });
    });
  }

  // Session goal input
  if (sessionGoalInput instanceof HTMLInputElement) {
    sessionGoalInput.addEventListener("input", () => {
      scheduleSettingsSave({ sessionGoal: sessionGoalInput.value });
    });
  }

  // Start session button
  if (sessionStartBtn instanceof HTMLButtonElement) {
    sessionStartBtn.addEventListener("click", async () => {
      const goal = (sessionGoalInput instanceof HTMLInputElement)
          ? sessionGoalInput.value.trim()
          : "";

      const duration = (sessionDurationInput instanceof HTMLInputElement)
          ? Number(sessionDurationInput.value)
          : 25;

      const reminderInterval = (reminderIntervalInput instanceof HTMLInputElement)
          ? Number(reminderIntervalInput.value)
          : 10;

      const response = await chrome.runtime.sendMessage({
        type: "SESSION_START",
        payload: { goal, duration, reminderInterval }
      }).catch(() => null);

      if (response && response.ok) {
        setSessionUI(true, response.session);
      }
    });
  }

  // Stop session button
  if (sessionStopBtn instanceof HTMLButtonElement) {
    sessionStopBtn.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: "SESSION_STOP" }).catch(() => {});
      setSessionUI(false);
    });
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync" || !changes.redditAccessibilitySettings?.newValue) {
      return;
    }

    syncForm(changes.redditAccessibilitySettings.newValue);
    setStatus("Updated from another extension view.");
  });
}

init().catch(() => {
  setStatus("Unable to load settings.");
});
