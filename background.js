const TIME_KEY = "timeData";
const TRACKER_KEY = "trackerState";
const SESSION_KEY = "trackerBrowserSession";
const TICK_ALARM = "lead-tracker-tick";

const IDLE_DETECTION_SECONDS = 60;
const ACTIVE_TICK_MS = 15 * 1000;

// A gap larger than this is treated as sleep/suspension/browser downtime
// rather than active browsing time, so it is not added to the totals.
const MAX_TRUSTED_GAP_MS = 5 * 60 * 1000;

let timeData = { days: {} };
let tracker = { domain: null, startedAt: 0, tracking: false };
let lastFocusedWindowId = null;
let initPromise = null;
let initialized = false;
let operationQueue = Promise.resolve();

chrome.idle.setDetectionInterval(IDLE_DETECTION_SECONDS);

function pad(value) {
    return String(value).padStart(2, "0");
}

function dateKey(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function isDateKey(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function endOfLocalDay(timestamp) {
    const date = new Date(timestamp);
    date.setHours(24, 0, 0, 0);
    return date.getTime();
}

function domainFromUrl(rawUrl) {
    if (typeof rawUrl !== "string" || rawUrl.length === 0) {
        return null;
    }

    let url;
    try {
        url = new URL(rawUrl);
    } catch {
        return null;
    }

    // Only regular web pages are tracked. Browser-internal pages, extension
    // pages, file URLs, etc. all pause the timer.
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        return null;
    }

    let host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (host.startsWith("www.")) {
        host = host.slice(4);
    }

    return host || null;
}

function normalizeTimeData(raw) {
    const normalized = { days: {} };

    if (!raw || typeof raw !== "object" || !raw.days || typeof raw.days !== "object") {
        return normalized;
    }

    for (const [date, domains] of Object.entries(raw.days)) {
        if (!isDateKey(date) || !domains || typeof domains !== "object") {
            continue;
        }

        const cleanDomains = {};
        for (const [domain, milliseconds] of Object.entries(domains)) {
            if (
                typeof domain === "string" &&
                domain.length > 0 &&
                typeof milliseconds === "number" &&
                Number.isFinite(milliseconds) &&
                milliseconds > 0
            ) {
                cleanDomains[domain] = Math.round(milliseconds);
            }
        }

        if (Object.keys(cleanDomains).length > 0) {
            normalized.days[date] = cleanDomains;
        }
    }

    return normalized;
}

function normalizeTracker(raw) {
    if (!raw || typeof raw !== "object") {
        return { domain: null, startedAt: Date.now(), tracking: false };
    }

    const domain = typeof raw.domain === "string" && raw.domain.length > 0 ? raw.domain : null;
    const startedAt = Number.isFinite(raw.startedAt) ? raw.startedAt : Date.now();
    const tracking = Boolean(raw.tracking && domain);

    return { domain, startedAt, tracking };
}

function addTime(domain, startTimestamp, durationMs) {
    if (!domain || durationMs <= 0) {
        return;
    }

    let cursor = startTimestamp;
    let remaining = durationMs;

    while (remaining > 0) {
        const dayEnd = endOfLocalDay(cursor);
        const chunk = Math.min(remaining, dayEnd - cursor);

        if (chunk <= 0) {
            break;
        }

        const key = dateKey(new Date(cursor));
        if (!timeData.days[key]) {
            timeData.days[key] = {};
        }

        timeData.days[key][domain] = (timeData.days[key][domain] || 0) + chunk;
        cursor += chunk;
        remaining -= chunk;
    }
}

async function persist() {
    await chrome.storage.local.set({
        [TIME_KEY]: timeData,
        [TRACKER_KEY]: tracker
    });
}

function accrueTo(endTimestamp) {
    if (!tracker.tracking || !tracker.domain || !tracker.startedAt) {
        return false;
    }

    const end = Math.min(endTimestamp, Date.now());
    const start = tracker.startedAt;

    if (!Number.isFinite(start) || end <= start) {
        tracker.startedAt = Math.max(end, start);
        return false;
    }

    const elapsed = end - start;

    if (elapsed > MAX_TRUSTED_GAP_MS) {
        // The service worker or computer was likely asleep. Move the segment
        // start forward without crediting the suspicious gap.
        tracker.startedAt = end;
        return false;
    }

    addTime(tracker.domain, start, elapsed);
    tracker.startedAt = end;
    return true;
}

async function isChromeFocused() {
    if (lastFocusedWindowId === chrome.windows.WINDOW_ID_NONE) {
        return false;
    }

    try {
        const window = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
        if (!window) {
            return false;
        }

        return Boolean(window.focused);
    } catch {
        return false;
    }
}

async function getActiveDomain() {
    try {
        const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        const tab = tabs.find((candidate) => candidate.active);
        if (!tab) {
            return null;
        }

        return domainFromUrl(tab.url || tab.pendingUrl || "");
    } catch {
        return null;
    }
}

async function ensureAlarm() {
    try {
        const alarm = await chrome.alarms.get(TICK_ALARM);
        if (!alarm) {
            chrome.alarms.create(TICK_ALARM, { periodInMinutes: 1 });
        }
    } catch {
        // The alarm is a safety net, not the only way time is recorded.
    }
}

async function initialize() {
    const [stored, session] = await Promise.all([
        chrome.storage.local.get([TIME_KEY, TRACKER_KEY]),
        chrome.storage.session.get(SESSION_KEY).catch(() => ({}))
    ]);

    timeData = normalizeTimeData(stored[TIME_KEY]);

    const isNewBrowserSession = !session || !session[SESSION_KEY];
    let shouldRecoverSegment = false;

    if (isNewBrowserSession) {
        // On a fresh browser session, do not credit time between the last
        // save and this launch. That gap is time with the browser closed.
        tracker = { domain: null, startedAt: Date.now(), tracking: false };
        try {
            await chrome.storage.session.set({ [SESSION_KEY]: true });
        } catch {
            // If session storage is unavailable, still continue tracking.
        }
    } else {
        tracker = normalizeTracker(stored[TRACKER_KEY]);
        shouldRecoverSegment = Boolean(tracker.tracking && tracker.domain);
    }

    await ensureAlarm();

    try {
        const lastWindow = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
        lastFocusedWindowId = lastWindow && lastWindow.focused ? lastWindow.id : chrome.windows.WINDOW_ID_NONE;
    } catch {
        lastFocusedWindowId = chrome.windows.WINDOW_ID_NONE;
    }

    const idleState = await chrome.idle.queryState(IDLE_DETECTION_SECONDS);
    const recoveryTime = Date.now();

    if (shouldRecoverSegment) {
        // Recover the short segment since the service worker was suspended.
        // If the worker is waking because the machine went idle/locked, do
        // not credit the final detection interval.
        const cutoff = recoveryTime - IDLE_DETECTION_SECONDS * 1000;
        accrueTo(
            idleState === "active"
                ? recoveryTime
                : Math.max(tracker.startedAt, cutoff)
        );
        await persist();
    }

    let desiredDomain = null;

    if (idleState === "active" && (await isChromeFocused())) {
        desiredDomain = await getActiveDomain();
    }

    tracker = {
        domain: desiredDomain,
        startedAt: Date.now(),
        tracking: Boolean(desiredDomain)
    };

    await persist();
    initialized = true;
}

function ensureInitialized() {
    if (!initPromise) {
        initPromise = initialize().catch((error) => {
            initPromise = null;
            initialized = false;
            throw error;
        });
    }

    return initPromise;
}

function queueTask(task) {
    const run = operationQueue.then(task, task);
    operationQueue = run.then(
        () => undefined,
        () => undefined
    );
    return run;
}

async function refreshTracking() {
    const idleState = await chrome.idle.queryState(IDLE_DETECTION_SECONDS);
    const now = Date.now();

    if (tracker.tracking) {
        // If the user became idle/locked, do not credit the final detection
        // interval, which likely had no input.
        const cutoff = now - IDLE_DETECTION_SECONDS * 1000;
        accrueTo(
            idleState === "active"
                ? now
                : Math.max(tracker.startedAt, cutoff)
        );
    }

    let desiredDomain = null;

    if (idleState === "active" && (await isChromeFocused())) {
        desiredDomain = await getActiveDomain();
    }

    tracker = {
        domain: desiredDomain,
        startedAt: Date.now(),
        tracking: Boolean(desiredDomain)
    };

    await persist();
}

async function handleIdleState(state) {
    if (state === "active") {
        await refreshTracking();
        return;
    }

    const now = Date.now();

    if (tracker.tracking) {
        // Idle/locked is reported after the detection interval has passed.
        // Do not credit the final interval, which likely had no input.
        const cutoff = now - IDLE_DETECTION_SECONDS * 1000;
        accrueTo(Math.max(tracker.startedAt, cutoff));
    }

    tracker = { domain: null, startedAt: now, tracking: false };
    await persist();
}

function buildStats(date) {
    const safeDate = isDateKey(date) ? date : dateKey(new Date());
    const totals = timeData.days[safeDate] || {};

    return {
        date: safeDate,
        totals: { ...totals },
        tracking: Boolean(tracker.tracking && tracker.domain),
        activeDomain: tracker.tracking ? tracker.domain : null,
        activeSince: tracker.tracking ? tracker.startedAt : null,
        now: Date.now()
    };
}

function scheduleRefresh() {
    queueTask(async () => {
        await ensureInitialized();
        await refreshTracking();
    }).catch((error) => {
        console.error("[Lead Tracker] Could not refresh tracking state:", error);
    });
}

chrome.runtime.onInstalled.addListener(() => {
    scheduleRefresh();
});

chrome.runtime.onStartup.addListener(() => {
    scheduleRefresh();
});

chrome.tabs.onActivated.addListener(() => {
    scheduleRefresh();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url) {
        scheduleRefresh();
    }
});

chrome.tabs.onRemoved.addListener(() => {
    scheduleRefresh();
});

chrome.tabs.onReplaced.addListener(() => {
    scheduleRefresh();
});

chrome.windows.onFocusChanged.addListener((windowId) => {
    lastFocusedWindowId = windowId;
    scheduleRefresh();
});

chrome.windows.onRemoved.addListener(() => {
    scheduleRefresh();
});

chrome.idle.onStateChanged.addListener((state) => {
    queueTask(async () => {
        await ensureInitialized();
        await handleIdleState(state);
    }).catch((error) => {
        console.error("[Lead Tracker] Could not update idle state:", error);
    });
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === TICK_ALARM) {
        scheduleRefresh();
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== "get-time-stats") {
        return;
    }

    queueTask(async () => {
        await ensureInitialized();
        await refreshTracking();
        return buildStats(message.date);
    })
        .then((stats) => {
            sendResponse(stats);
        })
        .catch((error) => {
            console.error("[Lead Tracker] Could not read time stats:", error);
            sendResponse({ error: true });
        });

    return true;
});

chrome.runtime.onSuspend.addListener(() => {
    if (!initialized) {
        return;
    }

    try {
        accrueTo(Date.now());
        // Best effort only: suspend does not guarantee async work completes.
        chrome.storage.local.set({
            [TIME_KEY]: timeData,
            [TRACKER_KEY]: tracker
        });
    } catch {
        // Ignore; normal ticks and the alarm have already persisted recently.
    }
});

// While the service worker happens to be alive, save more frequently than the
// one-minute alarm. The alarm remains the durable safety net after suspension.
setInterval(() => {
    if (!initialized) {
        return;
    }

    queueTask(async () => {
        await refreshTracking();
    }).catch(() => {
        // A missed tick is harmless; the next alarm/event will catch up.
    });
}, ACTIVE_TICK_MS);
