const els = {
    datePicker: document.getElementById("date-picker"),
    prevDay: document.getElementById("prev-day"),
    nextDay: document.getElementById("next-day"),
    todayBtn: document.getElementById("today-btn"),
    dayLabel: document.getElementById("day-label"),
    dayTotal: document.getElementById("day-total"),
    timeList: document.getElementById("time-list"),
    timeEmpty: document.getElementById("time-empty"),
    trackingStatus: document.getElementById("tracking-status"),
    trackingText: document.getElementById("tracking-text"),
    urlInput: document.getElementById("url-input"),
    saveUrlBtn: document.getElementById("save-url-btn"),
    saveTabBtn: document.getElementById("save-tab-btn"),
    urlStatus: document.getElementById("url-status"),
    linkSearch: document.getElementById("link-search"),
    linkList: document.getElementById("link-list"),
    linkEmpty: document.getElementById("link-empty"),
    linkCount: document.getElementById("link-count"),
    deleteAllBtn: document.getElementById("delete-all-btn"),
    deleteConfirm: document.getElementById("delete-confirm"),
    cancelDeleteAll: document.getElementById("cancel-delete-all"),
    confirmDeleteAll: document.getElementById("confirm-delete-all"),
    headerStatus: document.getElementById("header-status"),
    headerStatusText: document.getElementById("header-status-text"),
    overviewTime: document.getElementById("overview-time"),
    overviewLinks: document.getElementById("overview-links"),
    overviewStatus: document.getElementById("overview-status")
};

const LIVE_REFRESH_MS = 5000;

let selectedDate = todayKey();
let stats = null;
let timeState = "loading";
let timeRequestId = 0;
let links = [];
let linksReady = false;
let linksBusy = false;
let searchQuery = "";
let statusTimer = null;

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
        return `Today · ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
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

function domainFromUrl(rawUrl) {
    if (typeof rawUrl !== "string" || rawUrl.length === 0) {
        return null;
    }

    try {
        const url = new URL(rawUrl);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
            return null;
        }

        let host = url.hostname.toLowerCase().replace(/\.$/, "");
        if (host.startsWith("www.")) {
            host = host.slice(4);
        }

        return host || null;
    } catch {
        return null;
    }
}

function prettyUrl(rawUrl) {
    try {
        const url = new URL(rawUrl);
        let readable = `${url.hostname}${url.pathname}${url.search}${url.hash}`;
        if (readable.endsWith("/")) {
            readable = readable.slice(0, -1);
        }
        return readable || url.hostname;
    } catch {
        return rawUrl;
    }
}

function normalizeUserUrl(rawValue) {
    let value = String(rawValue || "").trim();
    if (!value) {
        return null;
    }

    if (/^https?:\/\//i.test(value)) {
        // Already an http(s) URL.
    } else if (value.startsWith("//")) {
        value = `https:${value}`;
    } else if (
        /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ||
        /^(?:mailto|javascript|data|file|chrome|chrome-extension|about|ftp):/i.test(value)
    ) {
        return null;
    } else {
        value = `https://${value}`;
    }

    try {
        const url = new URL(value);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
            return null;
        }
        if (!url.hostname) {
            return null;
        }
        return url.href;
    } catch {
        return null;
    }
}

function makeId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function cleanTitle(value, fallback) {
    const title = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
    return title ? title.slice(0, 240) : fallback;
}

function escapeHtml(str) {
    return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function normalizeLink(item) {
    if (!item) {
        return null;
    }

    const rawUrl = typeof item === "string" ? item : item.url;
    const url = normalizeUserUrl(rawUrl);
    if (!url) {
        return null;
    }

    const domain = domainFromUrl(url) || url;
    const fallbackTitle = domain;
    const title = cleanTitle(typeof item === "object" ? item.title : "", fallbackTitle);

    return {
        id: typeof item === "object" && typeof item.id === "string" && item.id ? item.id : makeId(),
        url,
        title,
        addedAt: typeof item === "object" && Number.isFinite(item.addedAt) ? item.addedAt : 0
    };
}

function sendRuntimeMessage(message) {
    return new Promise((resolve) => {
        try {
            if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) {
                // Running in browser standalone or preview mode
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

async function loadTime() {
    const requestedDate = selectedDate;
    const requestId = ++timeRequestId;
    const response = await sendRuntimeMessage({ type: "get-time-stats", date: requestedDate });

    if (requestId !== timeRequestId || requestedDate !== selectedDate) {
        return;
    }

    if (!response || response.error || response.date !== requestedDate) {
        if (!stats) {
            // Check if mock or preview data is available in standalone preview mode
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
            "raycast.com": 620000
        }
    };
}

function updateDateControls() {
    const today = todayKey();
    els.datePicker.max = today;
    els.nextDay.disabled = selectedDate >= today;
    els.todayBtn.hidden = selectedDate === today;
}

function setDate(key) {
    if (!isDateKey(key)) {
        return;
    }

    const today = todayKey();
    selectedDate = key > today ? today : key;
    els.datePicker.value = selectedDate;
    stats = null;
    timeState = "loading";
    timeRequestId += 1;
    renderTime();
    loadTime();
}

function createTimeRow(domain, milliseconds, maxMilliseconds) {
    const item = document.createElement("li");
    item.className = "time-row";

    const formattedDuration = formatDuration(milliseconds);
    const label = `${domain} — ${formattedDuration}`;
    item.title = label;
    item.setAttribute("aria-label", label);

    const head = document.createElement("div");
    head.className = "time-row-head";

    const domainWrap = document.createElement("div");
    domainWrap.className = "time-domain-wrap";

    // Lucide Globe SVG
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("class", "domain-icon");
    icon.setAttribute("width", "13");
    icon.setAttribute("height", "13");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("fill", "none");
    icon.setAttribute("stroke", "currentColor");
    icon.setAttribute("stroke-width", "2");
    icon.setAttribute("stroke-linecap", "round");
    icon.setAttribute("stroke-linejoin", "round");
    icon.innerHTML = '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>';

    const domainEl = document.createElement("span");
    domainEl.className = "time-domain";
    domainEl.textContent = domain;
    domainEl.title = domain;

    domainWrap.append(icon, domainEl);

    const durationEl = document.createElement("span");
    durationEl.className = "time-duration";
    durationEl.textContent = formattedDuration;

    head.append(domainWrap, durationEl);

    const bar = document.createElement("div");
    bar.className = "time-bar";

    const fill = document.createElement("div");
    fill.className = "time-bar-fill";
    const percent = Math.max(3, Math.min(100, Math.round((milliseconds / maxMilliseconds) * 100)));
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
    els.trackingStatus.hidden = true;

    if (timeState === "loading") {
        els.dayTotal.textContent = "—";
        if (els.overviewTime) els.overviewTime.textContent = "—";
        els.timeList.replaceChildren();
        els.timeEmpty.hidden = false;
        els.timeEmpty.innerHTML = `
            <svg class="empty-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <p class="empty-title">Loading time data…</p>
        `;
        return;
    }

    if (timeState === "error" || !stats) {
        els.dayTotal.textContent = "—";
        if (els.overviewTime) els.overviewTime.textContent = "—";
        els.timeList.replaceChildren();
        els.timeEmpty.hidden = false;
        els.timeEmpty.innerHTML = `
            <svg class="empty-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>
            <p class="empty-title">Could not load time data</p>
            <p class="empty-subtitle">Try reloading the extension popup</p>
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
    const formattedTotal = formatDuration(totalMilliseconds);
    els.dayTotal.textContent = formattedTotal;
    if (els.overviewTime) {
        els.overviewTime.textContent = formattedTotal;
    }
    els.timeList.replaceChildren();

    if (entries.length === 0) {
        els.timeEmpty.hidden = false;
        els.timeEmpty.innerHTML = `
            <svg class="empty-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <p class="empty-title">${isToday ? "No time tracked yet today" : "No tracked time for this day"}</p>
            <p class="empty-subtitle">${isToday ? "Open any website tab to start tracking" : "Navigate to today or another day"}</p>
        `;
    } else {
        els.timeEmpty.hidden = true;
        const maxMilliseconds = entries[0][1];

        for (const [domain, milliseconds] of entries) {
            els.timeList.appendChild(createTimeRow(domain, milliseconds, maxMilliseconds));
        }
    }

    if (isToday) {
        const isActive = Boolean(stats.tracking && stats.activeDomain);
        els.trackingStatus.hidden = false;
        els.trackingStatus.classList.toggle("is-active", isActive);
        els.trackingText.textContent = isActive
            ? `Tracking ${stats.activeDomain} now`
            : "Tracking paused — active web tab needed";

        if (els.headerStatus) {
            els.headerStatus.classList.toggle("is-tracking", isActive);
            if (els.headerStatusText) {
                els.headerStatusText.textContent = isActive ? `Active: ${stats.activeDomain}` : "Ready";
            }
        }
    }
}

async function migrateLegacyLinks() {
    let legacy = [];

    try {
        const raw = localStorage.getItem("myLeads");
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                legacy = parsed;
            }
        }
    } catch {
        legacy = [];
    }

    const migrated = legacy.map(normalizeLink).filter(Boolean);
    let saved = false;

    try {
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({ savedLinks: migrated });
            saved = true;
        } else {
            localStorage.setItem("savedLinks", JSON.stringify(migrated));
            saved = true;
        }
    } catch {
        // Keep the old localStorage value if migration fails.
    }

    if (saved) {
        try {
            localStorage.removeItem("myLeads");
        } catch {
            // Ignore; links were already copied to storage.
        }
    }

    return migrated;
}

async function loadLinks() {
    try {
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
            const stored = await chrome.storage.local.get("savedLinks");
            if (Array.isArray(stored.savedLinks)) {
                links = stored.savedLinks.map(normalizeLink).filter(Boolean);
            } else {
                links = await migrateLegacyLinks();
            }
        } else {
            // Fallback for preview / standalone
            const stored = localStorage.getItem("savedLinks");
            if (stored) {
                try {
                    const parsed = JSON.parse(stored);
                    links = Array.isArray(parsed) ? parsed.map(normalizeLink).filter(Boolean) : [];
                } catch {
                    links = [];
                }
            } else {
                links = await migrateLegacyLinks();
            }
        }
        linksReady = true;
        els.saveUrlBtn.disabled = false;
        els.saveTabBtn.disabled = false;
    } catch (error) {
        console.error("[Lead Tracker] Could not load saved links:", error);
        links = [];
        showStatus("Could not load saved links. Reopen the popup to try again.", "error");
    }

    renderLinks();
}

async function writeLinks(nextLinks) {
    try {
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({ savedLinks: nextLinks });
        } else {
            localStorage.setItem("savedLinks", JSON.stringify(nextLinks));
        }
        links = nextLinks;
        renderLinks();
        return true;
    } catch (error) {
        console.error("[Lead Tracker] Could not save links:", error);
        showStatus("Could not save changes. Please try again.", "error");
        return false;
    }
}

function runLinkChange(task) {
    if (!linksReady) {
        showStatus("Saved links are still loading. Please wait a moment.", "error");
        return Promise.resolve();
    }

    if (linksBusy) {
        return Promise.resolve();
    }

    linksBusy = true;

    return Promise.resolve()
        .then(task)
        .catch((error) => {
            console.error("[Lead Tracker] Link change failed:", error);
            showStatus("Something went wrong. Please try again.", "error");
        })
        .finally(() => {
            linksBusy = false;
        });
}

function createLinkRow(link) {
    const item = document.createElement("li");
    item.className = "link-row";

    // Icon Container
    const iconWrap = document.createElement("div");
    iconWrap.className = "link-icon-wrap";
    const globeSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    globeSvg.setAttribute("class", "link-domain-icon");
    globeSvg.setAttribute("width", "14");
    globeSvg.setAttribute("height", "14");
    globeSvg.setAttribute("viewBox", "0 0 24 24");
    globeSvg.setAttribute("fill", "none");
    globeSvg.setAttribute("stroke", "currentColor");
    globeSvg.setAttribute("stroke-width", "2");
    globeSvg.setAttribute("stroke-linecap", "round");
    globeSvg.setAttribute("stroke-linejoin", "round");
    globeSvg.innerHTML = '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>';
    iconWrap.appendChild(globeSvg);

    const main = document.createElement("div");
    main.className = "link-main";

    const domain = domainFromUrl(link.url) || link.url;

    const titleRow = document.createElement("div");
    titleRow.className = "link-title-row";

    const anchor = document.createElement("a");
    anchor.className = "link-title";
    anchor.href = link.url;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.title = link.url;

    const titleText = document.createTextNode(link.title || domain);
    anchor.appendChild(titleText);

    // External link arrow icon
    const extSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    extSvg.setAttribute("class", "link-ext-icon");
    extSvg.setAttribute("width", "11");
    extSvg.setAttribute("height", "11");
    extSvg.setAttribute("viewBox", "0 0 24 24");
    extSvg.setAttribute("fill", "none");
    extSvg.setAttribute("stroke", "currentColor");
    extSvg.setAttribute("stroke-width", "2");
    extSvg.setAttribute("stroke-linecap", "round");
    extSvg.setAttribute("stroke-linejoin", "round");
    extSvg.innerHTML = '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>';
    anchor.appendChild(extSvg);

    titleRow.appendChild(anchor);

    const sub = document.createElement("span");
    sub.className = "link-sub";
    sub.textContent = link.title && link.title !== domain ? domain : prettyUrl(link.url);
    sub.title = link.url;

    main.append(titleRow, sub);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "icon-button";
    removeButton.dataset.deleteId = link.id;
    removeButton.title = "Delete lead";
    removeButton.setAttribute("aria-label", `Delete ${link.title || domain}`);

    const trashSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    trashSvg.setAttribute("class", "trash-icon");
    trashSvg.setAttribute("width", "13");
    trashSvg.setAttribute("height", "13");
    trashSvg.setAttribute("viewBox", "0 0 24 24");
    trashSvg.setAttribute("fill", "none");
    trashSvg.setAttribute("stroke", "currentColor");
    trashSvg.setAttribute("stroke-width", "2");
    trashSvg.setAttribute("stroke-linecap", "round");
    trashSvg.setAttribute("stroke-linejoin", "round");
    trashSvg.innerHTML = '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>';
    removeButton.appendChild(trashSvg);

    item.append(iconWrap, main, removeButton);

    return item;
}

function renderLinks() {
    const query = searchQuery.trim().toLowerCase();
    const filtered = query
        ? links.filter((link) => {
              const haystack = `${link.title} ${link.url}`.toLowerCase();
              return haystack.includes(query);
          })
        : links;

    els.linkCount.textContent = query ? `${filtered.length}/${links.length}` : String(links.length);
    if (els.overviewLinks) {
        els.overviewLinks.textContent = String(links.length);
    }
    els.deleteAllBtn.disabled = links.length === 0;
    els.linkList.replaceChildren();

    if (links.length === 0) {
        els.deleteConfirm.hidden = true;
        els.deleteAllBtn.hidden = false;
        els.linkEmpty.hidden = false;
        els.linkEmpty.innerHTML = `
            <svg class="empty-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            <p class="empty-title">No saved leads yet</p>
            <p class="empty-subtitle">Paste a URL above or click "Save current tab"</p>
        `;
        return;
    }

    if (filtered.length === 0) {
        els.linkEmpty.hidden = false;
        els.linkEmpty.innerHTML = `
            <svg class="empty-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <p class="empty-text">No saved leads match <strong class="match-query">"${escapeHtml(searchQuery.trim())}"</strong></p>
        `;
    } else {
        els.linkEmpty.hidden = true;
        for (const link of filtered) {
            els.linkList.appendChild(createLinkRow(link));
        }
    }
}

function showStatus(message, kind) {
    clearTimeout(statusTimer);
    els.urlStatus.hidden = false;

    const iconSvg = kind === "success"
        ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
        : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>';

    els.urlStatus.innerHTML = `${iconSvg}<span>${escapeHtml(message)}</span>`;
    els.urlStatus.className = `status-message${kind ? ` is-${kind}` : ""}`;

    statusTimer = setTimeout(() => {
        els.urlStatus.hidden = true;
        els.urlStatus.textContent = "";
        els.urlStatus.className = "status-message";
    }, 4000);
}

function saveTypedLink() {
    return runLinkChange(async () => {
        const raw = els.urlInput.value;
        const url = normalizeUserUrl(raw);

        if (!url) {
            showStatus("Enter a valid http or https URL.", "error");
            els.urlInput.focus();
            return;
        }

        if (links.some((link) => link.url === url)) {
            showStatus("That lead URL is already saved.", "error");
            els.urlInput.focus();
            return;
        }

        const domain = domainFromUrl(url) || url;
        const link = {
            id: makeId(),
            url,
            title: domain,
            addedAt: Date.now()
        };

        if (!(await writeLinks([...links, link]))) {
            return;
        }

        if (searchQuery) {
            searchQuery = "";
            els.linkSearch.value = "";
            renderLinks();
        }

        els.urlInput.value = "";
        showStatus(`Saved ${domain}.`, "success");
        els.urlInput.focus();
    });
}

function saveCurrentTab() {
    return runLinkChange(async () => {
        let tab = null;

        try {
            if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.query) {
                const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                tab = tabs && tabs[0];
            }
        } catch {
            tab = null;
        }

        if (!tab || !tab.url) {
            try {
                if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.query) {
                    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
                    tab = tabs && tabs[0];
                }
            } catch {
                tab = null;
            }
        }

        if (!tab || !tab.url) {
            // Standalone preview fallback
            if (typeof chrome === "undefined" || !chrome.tabs) {
                tab = { url: window.location.href, title: document.title || "Current Page" };
            } else {
                showStatus("Could not read current tab URL.", "error");
                return;
            }
        }

        const url = normalizeUserUrl(tab.url);
        if (!url) {
            showStatus("Only standard web tabs can be saved.", "error");
            return;
        }

        if (links.some((link) => link.url === url)) {
            showStatus("That lead URL is already saved.", "error");
            return;
        }

        const domain = domainFromUrl(url) || url;
        const title = cleanTitle(tab.title, domain);
        const link = {
            id: makeId(),
            url,
            title,
            addedAt: Date.now()
        };

        if (!(await writeLinks([...links, link]))) {
            return;
        }

        if (searchQuery) {
            searchQuery = "";
            els.linkSearch.value = "";
            renderLinks();
        }

        showStatus(`Saved current tab (${domain}).`, "success");
    });
}

function deleteLink(id) {
    return runLinkChange(async () => {
        const link = links.find((candidate) => candidate.id === id);
        const nextLinks = links.filter((candidate) => candidate.id !== id);

        if (!(await writeLinks(nextLinks))) {
            return;
        }

        const label = link ? link.title || domainFromUrl(link.url) || "lead" : "lead";
        showStatus(`Deleted "${label}".`, "success");
    });
}

function showDeleteConfirm() {
    if (links.length === 0) {
        return;
    }

    els.deleteAllBtn.hidden = true;
    els.deleteConfirm.hidden = false;
    els.confirmDeleteAll.focus();
}

function hideDeleteConfirm(returnFocus = true) {
    els.deleteConfirm.hidden = true;
    els.deleteAllBtn.hidden = false;

    if (returnFocus) {
        els.deleteAllBtn.focus();
    }
}

function deleteAllLinks() {
    return runLinkChange(async () => {
        if (!(await writeLinks([]))) {
            return;
        }

        hideDeleteConfirm(false);
        showStatus("All saved leads deleted.", "success");
        els.urlInput.focus();
    });
}

function bindEvents() {
    els.urlInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            saveTypedLink();
        }
    });

    els.saveUrlBtn.addEventListener("click", saveTypedLink);
    els.saveTabBtn.addEventListener("click", saveCurrentTab);

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

    els.datePicker.addEventListener("change", () => {
        if (isDateKey(els.datePicker.value)) {
            setDate(els.datePicker.value);
        } else {
            els.datePicker.value = selectedDate;
        }
    });

    els.linkSearch.addEventListener("input", () => {
        searchQuery = els.linkSearch.value;
        renderLinks();
    });

    els.linkList.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }

        const button = target.closest("button[data-delete-id]");
        if (!button) {
            return;
        }

        deleteLink(button.dataset.deleteId);
    });

    els.deleteAllBtn.addEventListener("click", showDeleteConfirm);
    els.cancelDeleteAll.addEventListener("click", () => hideDeleteConfirm());
    els.confirmDeleteAll.addEventListener("click", deleteAllLinks);

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !els.deleteConfirm.hidden) {
            event.preventDefault();
            hideDeleteConfirm();
        }
    });
}

function init() {
    els.datePicker.max = todayKey();
    els.datePicker.value = selectedDate;
    bindEvents();
    renderTime();
    loadLinks();
    loadTime();

    setInterval(() => {
        if (!document.hidden) {
            loadTime();
        }
    }, LIVE_REFRESH_MS);
}

init();
