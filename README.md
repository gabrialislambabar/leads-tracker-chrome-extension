# Lead Tracker — Links & Time

A Manifest V3 Chrome extension for quickly saving links and privately tracking active time spent on websites, stored locally on your device.

## Features

- **Quick-action popup** — compact extension popup window for saving typed URLs, capturing the active tab with one click, filtering saved links with search, and deleting links.
- **Dedicated Usage Dashboard** — click **View usage** in the popup to open a full, responsive dashboard tab (`usage.html`) showing today's total browsing time and a ranked list of websites with formatted durations (e.g. `1h 24m`).
- **Simple Day Navigation** — review past days using straightforward **Previous day** and **Next day** buttons (no intrusive calendars or date pickers).
- **Quiet, private time tracking** — silently counts active browsing time by domain in the background without notifications, banners, badges, or external network requests.
- **Local storage only** — all links and time totals reside on your computer in `chrome.storage.local`.

---

## Installation & Setup

### Option 1: Load Unpacked (Recommended for development)

1. Open `chrome://extensions` in Google Chrome (or any Chromium browser).
2. Enable **Developer mode** via the toggle switch in the upper-right corner.
3. Click **Load unpacked**.
4. Select this project directory (the folder containing `manifest.json`).
5. Pin **Lead Tracker** from the Chrome extension toolbar for fast access.

*Note: No build step or `npm install` is required for unpacked loading. Any file changes take effect after clicking the reload button on `chrome://extensions`.*

### Option 2: Build with Vite (Optional)

If bundling with Vite:
```bash
npm install
npm run build
```
Vite will compile both `index.html` (the popup) and `usage.html` (the dashboard) into the `dist` directory according to `vite.config.js`.

---

## How Tracking Works

The extension uses a Manifest V3 background service worker (`background.js`) to track active time safely and accurately:

- **Active conditions**: Time is credited only when all of the following are true:
  1. Chrome has a focused window.
  2. The active tab is a normal `http://` or `https://` web page.
  3. The user is actively interacting (not idle or screen-locked, determined via `chrome.idle`).
- **Automatic pause**: Tracking immediately halts when Chrome is minimized/unfocused, when switching to browser-internal pages (`chrome://`, `chrome-extension://`, `about:`), or when the system goes idle.
- **Accurate segmenting**:
  - Tab switches, URL changes, and window focus changes accrue time up to the exact moment of switching.
  - Periods that cross midnight are automatically split across local calendar dates.
  - `chrome.storage.session` identifies fresh browser restarts so time spent while the browser was closed is never double-counted.
  - `chrome.alarms` triggers a wake-up tick once per minute, ensuring active time is safely persisted even when the Manifest V3 service worker suspends.
- **Domain grouping**: Totals are aggregated by domain (e.g. `github.com` with any leading `www.` stripped).

---

## Permissions

| Permission | Purpose |
| --- | --- |
| `tabs` | Read the active tab's URL and title to save the current tab and track active website domains. |
| `storage` | Store saved links and daily time totals locally on your machine via `chrome.storage.local`. |
| `idle` | Detect user inactivity and system lock to pause tracking quietly. |
| `alarms` | Periodically wake the background service worker to ensure accrued time is saved reliably. |

*There are no host permissions, external network permissions, content scripts, or telemetry.*

---

## Practical Tracking Limitations

1. **Passive Media Inactivity**: `chrome.idle` detects user input with a 60-second threshold. Extended passive tasks without mouse or keyboard interaction (such as watching a long video full-screen without interaction) may be flagged as idle and pause tracking.
2. **Subdomain Separation**: Tracking aggregates by hostname (minus `www.`). Different subdomains (such as `docs.google.com` vs `mail.google.com`) are tracked as distinct websites.
3. **Internal & Non-HTTP Pages**: Internal browser pages (`chrome://*`, extensions, PDF viewers, `file://`) are excluded from tracking for privacy and technical reasons.
4. **Machine Sleep / Service Worker Suspension**: If the operating system sleeps, suspicious gaps (>5 minutes) are discarded to avoid crediting downtime.
5. **No Cross-Device Sync**: All data remains on the local browser profile; data does not sync across different devices or profiles.

---

## Project Structure

- `manifest.json` — Manifest V3 extension configuration and permissions.
- `background.js` — Service worker managing silent active-time tracking and persistence.
- `index.html` — Compact extension popup layout (focused on quick link actions).
- `index.css` — Styling for the compact extension popup window.
- `index.js` — Popup controller for link saving, searching, and opening the dashboard.
- `usage.html` — Dedicated, responsive website usage dashboard.
- `usage.css` — Refined dark styling for the usage dashboard.
- `usage.js` — Usage dashboard logic for day navigation and ranked website displays.
- `vite.config.js` — Vite build configuration for multi-page output.
- `icon.png` — Extension icon.
