import { getSettings, saveSettings } from "../shared/storage.js";

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

async function init() {
  const settings = await getSettings();
  syncForm(settings);

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
