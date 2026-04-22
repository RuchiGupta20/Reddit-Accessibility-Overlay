export const STORAGE_KEY = "redditAccessibilitySettings";
export const SESSION_KEY = "raoSession";

export const DEFAULT_SETTINGS = {
  enabled: true,
  reducedStimulation: false,
  fontPreset: "dyslexia",
  fontScale: 1,
  lineHeight: 1.6,
  letterSpacing: 0,
  wordSpacing: 0,
  //Time awareness
  sessionGoal: "",
  sessionDuration: 25, // minutes
  reminderInterval: 10  // minutes
};

export const DEFAULT_SESSION = {
  active: false,
  goal: "",
  duration: 25,
  reminderInterval: 10,
  startedAt: null // timestamp ms
};
