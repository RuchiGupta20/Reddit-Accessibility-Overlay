import {SESSION_KEY, DEFAULT_SESSION} from "../shared/constants.js";

const ALARM_REMINDER = "rao-reminder";
const ALARM_SESSION_END = "rao-session-end";

chrome.runtime.onInstalled.addListener(() => {
    console.log("Reddit Accessibility Overlay installed.");
});

//Session helpers
async function getSession() {
    const result = await chrome.storage.session.get(SESSION_KEY).catch(() => ({}));
    return {...DEFAULT_SESSION, ...(result[SESSION_KEY] ?? {})};
}

async function saveSession(data) {
    await chrome.storage.session.set({[SESSION_KEY]: data}).catch(() => {
    });
    return data;
}

//Message Handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "PING") {
        sendResponse({
            ok: true,
            tabId: sender.tab?.id ?? null
        });
        return
    }
    if (message?.type === "SESSION_START") {
        handleSessionStart(message.payload).then(sendResponse);
        return true; // async
    }

    if (message?.type === "SESSION_STOP") {
        handleSessionStop().then(sendResponse);
        return true;
    }

    if (message?.type === "SESSION_GET") {
        getSession().then(sendResponse);
        return true;
    }
});

//Session start/stop

async function handleSessionStart({goal, duration, reminderInterval}) {
    // Clear any existing alarms
    await chrome.alarms.clearAll();

    const session = await saveSession({
        active: true,
        goal,
        duration,
        reminderInterval,
        startedAt: Date.now()
    });

    // Repeating reminder alarm
    chrome.alarms.create(ALARM_REMINDER, {
        delayInMinutes: reminderInterval,
        periodInMinutes: reminderInterval
    });

    // One-shot session-end alarm
    chrome.alarms.create(ALARM_SESSION_END, {
        delayInMinutes: duration
    });

    return {ok: true, session};
}

async function handleSessionStop() {
    await chrome.alarms.clearAll();
    const session = await saveSession({...DEFAULT_SESSION});
    return {ok: true, session};
}

//Alarm fired

chrome.alarms.onAlarm.addListener(async (alarm) => {
    const session = await getSession();
    if (!session.active) return;

    const elapsed = Math.round((Date.now() - session.startedAt) / 60000);

    const tabs = await chrome.tabs.query({url: "https://www.reddit.com/*"});

    for (const tab of tabs) {
        if (!tab.id) continue;

        if (alarm.name === ALARM_REMINDER) {
            chrome.tabs.sendMessage(tab.id, {
                type: "REMINDER_NUDGE",
                payload: {goal: session.goal, elapsed, duration: session.duration}
            }).catch(() => {
            });
        }

        if (alarm.name === ALARM_SESSION_END) {
            chrome.tabs.sendMessage(tab.id, {
                type: "SESSION_ENDED",
                payload: {goal: session.goal, duration: session.duration}
            }).catch(() => {
            });
        }
    }

    if (alarm.name === ALARM_SESSION_END) {
        await handleSessionStop();
    }
});