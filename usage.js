const els = {
    prevDay: document.getElementById("prev-day"),
    nextDay: document.getElementById("next-day"),
    todayBtn: document.getElementById("today-btn"),
    dayLabel: document.getElementById("day-label"),
    dayTotal: document.getElementById("day-total"),
    timeList: document.getElementById("time-list"),
    timeEmpty: document.getElementById("time-empty"),
    trackingStatus: document.getElementById("tracking-status"),
    trackingText: document.getElementById("tracking-text"),
    siteCount: document.getElementById("site-count")
};

const LIVE_REFRESH_MS = 5000;

let selectedDate = todayKey();
let stats = null;
let timeState = "loading";
let timeRequestId = 0;

function pad(value) {
    return String(value).padStart(2, "0");
}

function dateKey(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function isDateKey(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function todayKey() {
    return dateKey(new Date());
}

function parseDateKey(key) {
    const [year, month, day] = key.split("-").map(Number);
    return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function shiftDate(key, days) {
    const date = parseDateKey(key);
    date.setDate(date.getDate() + days);
    return dateKey(date);
}

function formatDateLabel(key, isToday) {
    const date = parseDateKey(key);
    const now = new Date();

    if (isToday) {
        return `Today · ${date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
    }

    const options = { weekday: "short", month: "short", day: "numeric" };
    if (date.getFullYear() !== now.getFullYear()) {
        options.year = "numeric";
    }

    return date.toLocaleDateString(undefined, options);
}

function formatDuration(milliseconds) {
    const totalSeconds = Math.floor(Math.max(0, milliseconds) / 1000);

    if (totalSeconds < 60) {
        return totalSeconds > 0 ? "<1m" : "0m";
    }

    const totalMinutes = Math.floor(totalSeconds / 60);
    if (totalMinutes < 60) {
        return `${totalMinutes}m`;
    }

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function sendRuntimeMessage(message) {
    return new Promise((resolve) => {
        try {
            if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) {
                resolve(null);
                return;
            }
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) {
                    resolve(null);
                    return;
                }
                resolve(response || null);
            });
        } catch {
            resolve(null);
        }
    });
}

function getMockStats(date) {
    return {
        date,
        tracking: true,
        activeDomain: "github.com",
        activeSince: Date.now() - 145000,
        totals: {
            "github.com": 2840000,
            "linear.app": 1920000,
            "google.com": 940000,
            "raycast.com": 620000,
            "docs.google.com": 480000
        }
    };
}

async function loadTime() {
    const requestedDate = selectedDate;
    const requestId = ++timeRequestId;
    const response = await sendRuntimeMessage({ type: "get-time-stats", date: requestedDate });

    if (requestId !== timeRequestId || requestedDate !== selectedDate) {
        return;
    }

    if (!response || response.error || response.date !== requestedDate) {
        if (!stats) {
            if (typeof chrome === "undefined" || !chrome.runtime) {
                stats = getMockStats(requestedDate);
                timeState = "ready";
                renderTime();
                return;
            }
            timeState = "error";
            renderTime();
        }
        return;
    }

    stats = response;
    timeState = "ready";
    renderTime();
}

function updateDateControls() {
    const today = todayKey();
    els.nextDay.disabled = selectedDate >= today;
    els.todayBtn.hidden = selectedDate === today;
}

function setDate(key) {
    if (!isDateKey(key)) {
        return;
    }

    const today = todayKey();
    selectedDate = key > today ? today : key;
    stats = null;
    timeState = "loading";
    timeRequestId += 1;
    renderTime();
    loadTime();
}

function createRankedRow(rank, domain, milliseconds, maxMilliseconds) {
    const item = document.createElement("li");
    item.className = "ranked-item";

    const formattedDuration = formatDuration(milliseconds);
    const label = `#${rank} ${domain} — ${formattedDuration}`;
    item.title = label;
    item.setAttribute("aria-label", label);

    const head = document.createElement("div");
    head.className = "ranked-row-head";

    const domainWrap = document.createElement("div");
    domainWrap.className = "ranked-domain-wrap";

    const rankBadge = document.createElement("span");
    rankBadge.className = "rank-index";
    rankBadge.textContent = String(rank);

    const domainEl = document.createElement("span");
    domainEl.className = "ranked-domain";
    domainEl.textContent = domain;
    domainEl.title = domain;

    domainWrap.append(rankBadge, domainEl);

    const durationEl = document.createElement("span");
    durationEl.className = "ranked-duration";
    durationEl.textContent = formattedDuration;

    head.append(domainWrap, durationEl);

    const bar = document.createElement("div");
    bar.className = "ranked-bar";

    const fill = document.createElement("div");
    fill.className = "ranked-bar-fill";
    const percent = Math.max(2, Math.min(100, Math.round((milliseconds / maxMilliseconds) * 100)));
    fill.style.width = `${percent}%`;

    bar.appendChild(fill);
    item.append(head, bar);

    return item;
}

function renderTime() {
    const today = todayKey();
    const isToday = selectedDate === today;

    updateDateControls();
    els.dayLabel.textContent = formatDateLabel(selectedDate, isToday);

    if (timeState === "loading") {
        els.dayTotal.textContent = "—";
        els.siteCount.textContent = "Loading…";
        els.timeList.replaceChildren();
        els.timeEmpty.hidden = false;
        els.timeEmpty.innerHTML = `
            <svg class="empty-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <p class="empty-title">Loading time data…</p>
        `;
        return;
    }

    if (timeState === "error" || !stats) {
        els.dayTotal.textContent = "—";
        els.siteCount.textContent = "0 websites";
        els.timeList.replaceChildren();
        els.timeEmpty.hidden = false;
        els.timeEmpty.innerHTML = `
            <svg class="empty-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>
            <p class="empty-title">Could not load time data</p>
            <p class="empty-subtitle">Please reload this tab to try again</p>
        `;
        return;
    }

    const totals = new Map();
    for (const [domain, milliseconds] of Object.entries(stats.totals || {})) {
        if (typeof milliseconds === "number" && milliseconds > 0) {
            totals.set(domain, milliseconds);
        }
    }

    if (isToday && stats.tracking && stats.activeDomain && stats.activeSince) {
        const liveMilliseconds = Math.max(0, Date.now() - stats.activeSince);
        if (liveMilliseconds > 0) {
            totals.set(
                stats.activeDomain,
                (totals.get(stats.activeDomain) || 0) + liveMilliseconds
            );
        }
    }

    const entries = [...totals.entries()]
        .filter(([, milliseconds]) => milliseconds > 0)
        .sort((a, b) => b[1] - a[1]);

    const totalMilliseconds = entries.reduce((sum, [, milliseconds]) => sum + milliseconds, 0);
    els.dayTotal.textContent = formatDuration(totalMilliseconds);
    els.siteCount.textContent = `${entries.length} website${entries.length === 1 ? "" : "s"}`;
    els.timeList.replaceChildren();

    if (entries.length === 0) {
        els.timeEmpty.hidden = false;
        els.timeEmpty.innerHTML = `
            <svg class="empty-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <p class="empty-title">${isToday ? "No time tracked yet today" : "No tracked time for this day"}</p>
            <p class="empty-subtitle">${isToday ? "Open and browse normal web pages to record active time" : "Use Previous day to review past dates"}</p>
        `;
    } else {
        els.timeEmpty.hidden = true;
        const maxMilliseconds = entries[0][1];

        let rank = 1;
        for (const [domain, milliseconds] of entries) {
            els.timeList.appendChild(createRankedRow(rank++, domain, milliseconds, maxMilliseconds));
        }
    }

    if (isToday) {
        const isActive = Boolean(stats.tracking && stats.activeDomain);
        els.trackingStatus.classList.toggle("is-active", isActive);
        els.trackingText.textContent = isActive
            ? `Tracking ${stats.activeDomain} now`
            : "Tracking paused — active web tab needed";
    } else {
        els.trackingStatus.classList.remove("is-active");
        els.trackingText.textContent = "Viewing past day";
    }
}

function bindEvents() {
    els.prevDay.addEventListener("click", () => {
        setDate(shiftDate(selectedDate, -1));
    });

    els.nextDay.addEventListener("click", () => {
        if (selectedDate < todayKey()) {
            setDate(shiftDate(selectedDate, 1));
        }
    });

    els.todayBtn.addEventListener("click", () => {
        setDate(todayKey());
    });
}

function init() {
    bindEvents();
    renderTime();
    loadTime();

    setInterval(() => {
        if (!document.hidden) {
            loadTime();
        }
    }, LIVE_REFRESH_MS);
}

init();
