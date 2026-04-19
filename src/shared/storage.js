import { DEFAULT_SETTINGS, STORAGE_KEY } from "./constants.js";

export async function getSettings() {
  const result = await chrome.storage.sync.get(STORAGE_KEY);
  return {
    ...DEFAULT_SETTINGS,
    ...(result[STORAGE_KEY] ?? {})
  };
}

export async function saveSettings(nextSettings) {
  const settings = {
    ...DEFAULT_SETTINGS,
    ...nextSettings
  };

  await chrome.storage.sync.set({
    [STORAGE_KEY]: settings
  });

  return settings;
}
