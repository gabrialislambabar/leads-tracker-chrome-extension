const els = {
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
    viewUsageBtn: document.getElementById("view-usage-btn")
};

let links = [];
let linksReady = false;
let linksBusy = false;
let searchQuery = "";
let statusTimer = null;

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

    // Icon container
    const iconWrap = document.createElement("div");
    iconWrap.className = "link-icon-wrap";
    const globeSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    globeSvg.setAttribute("class", "link-domain-icon");
    globeSvg.setAttribute("width", "13");
    globeSvg.setAttribute("height", "13");
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
    removeButton.title = "Delete link";
    removeButton.setAttribute("aria-label", `Delete ${link.title || domain}`);

    const trashSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    trashSvg.setAttribute("class", "trash-icon");
    trashSvg.setAttribute("width", "12");
    trashSvg.setAttribute("height", "12");
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
    els.deleteAllBtn.disabled = links.length === 0;
    els.linkList.replaceChildren();

    if (links.length === 0) {
        els.deleteConfirm.hidden = true;
        els.deleteAllBtn.hidden = false;
        els.linkEmpty.hidden = false;
        els.linkEmpty.innerHTML = `
            <svg class="empty-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            <p class="empty-title">No saved links yet</p>
            <p class="empty-subtitle">Paste a URL above or click "Save current tab"</p>
        `;
        return;
    }

    if (filtered.length === 0) {
        els.linkEmpty.hidden = false;
        els.linkEmpty.innerHTML = `
            <svg class="empty-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <p class="empty-text">No saved links match <strong class="match-query">"${escapeHtml(searchQuery.trim())}"</strong></p>
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
            showStatus("That link is already saved.", "error");
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
            showStatus("That link is already saved.", "error");
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

        const label = link ? link.title || domainFromUrl(link.url) || "link" : "link";
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
        showStatus("All saved links deleted.", "success");
        els.urlInput.focus();
    });
}

function openUsageDashboard() {
    if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.create) {
        const usageUrl = chrome.runtime.getURL("usage.html");
        chrome.tabs.create({ url: usageUrl });
    } else {
        window.open("usage.html", "_blank");
    }
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

    if (els.viewUsageBtn) {
        els.viewUsageBtn.addEventListener("click", openUsageDashboard);
    }

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !els.deleteConfirm.hidden) {
            event.preventDefault();
            hideDeleteConfirm();
        }
    });
}

function init() {
    bindEvents();
    loadLinks();
}

init();
