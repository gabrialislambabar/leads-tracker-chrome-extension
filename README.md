# Lead Tracker — Links & Time

A small Manifest V3 Chrome extension for saving useful links and seeing how much active time you spend on each website, day by day. Everything is stored locally in the browser.

## Features

- **Time spent** — tracks the active website while Chrome is focused and the user is active.
- **Daily totals** — shows today's sites from most time to least, with previous/next day controls and a date picker.
- **Readable durations** — for example `youtube.com — 1h 24m`, with a simple bar for each site.
- **Saved links** — save a typed URL or the current tab, search saved links, open them in a new tab, delete one link, or delete all links with a confirmation step.
- **Local only** — no accounts, analytics, servers, or external requests.

## Install (unpacked)

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this project folder (the folder containing `manifest.json`).
5. Optional: pin **Lead Tracker** from the extensions toolbar menu.

No build step or `npm install` is required. After changing files, click the **Reload** button for the extension on `chrome://extensions`.

Existing links from the previous version's `localStorage` (`myLeads`) are migrated to `chrome.storage.local` the first time the new popup opens.

## Usage

### Time spent

- The popup opens on today's totals.
- Use the arrow buttons or the date field to view another day.
- Use **Back to today** to return to the current day.
- The status line shows whether a site is currently being tracked or tracking is paused.

### Saved links

- Type a URL in the input and press **Enter** or click **Save**. A missing `https://` is added automatically.
- Click **Save current tab** to save the page you are viewing.
- Use the search box to filter by title, URL, or domain.
- Click a link to open it in a new tab.
- Use the `×` button to delete one link.
- **Delete all links** asks for confirmation first. It never deletes time data.

## How tracking works

The extension uses a Manifest V3 service worker (`background.js`) and keeps one active tracking segment at a time.

- Time is counted only when all of these are true:
  - Chrome has a focused window.
  - The active tab is a normal `http://` or `https://` page.
  - The computer is not idle or locked, according to `chrome.idle`.
- Tracking is recalculated when:
  - the active tab changes,
  - a tab's URL changes,
  - a Chrome window gains or loses focus,
  - the idle/locked state changes,
  - Chrome starts or the extension is installed/updated,
  - a one-minute alarm fires,
  - a short interval runs while the service worker happens to be alive.
- Totals are stored as milliseconds under `timeData.days[YYYY-MM-DD][domain]` in `chrome.storage.local`.
- Segments that cross local midnight are split into the correct local dates.
- The current segment start is persisted with the totals, so elapsed time is added exactly once.
- `chrome.storage.session` is used to tell a browser restart apart from a service-worker restart. Time while Chrome was closed is not credited.
- If a gap between saves is longer than five minutes (for example, the computer slept), that gap is treated as inactive and is not added to totals.
- The popup adds the few seconds since the last save to today's live display.

Domains are stored as the page hostname with a leading `www.` removed. Other subdomains remain separate (for example, `m.youtube.com` and `youtube.com` are different).

## Permissions

| Permission | Why it is needed |
| --- | --- |
| `tabs` | Read the active tab's URL and title so the current tab can be saved and its domain can be tracked. |
| `storage` | Store saved links and daily time totals locally in `chrome.storage.local`; use `chrome.storage.session` to distinguish browser restarts. |
| `idle` | Pause tracking when the computer is idle or locked. |
| `alarms` | Wake the service worker about once a minute so active time is saved even when the worker is suspended. |

There are no host permissions and no content scripts. The extension does not read page contents.

## Privacy

- All data stays on this device in Chrome extension storage.
- Saved: links you explicitly save, active-time totals grouped by date and domain, and the current tracking segment.
- Not collected: page contents, form input, keystrokes, or a full browsing-history log. Only the active tab is queried, and only its domain is stored for tracking.
- There are no network requests, accounts, telemetry, or third-party services.
- Removing the extension or clearing its site/extension data removes the stored links and time totals.

A short version of this note is shown at the bottom of the popup.

## Limitations

- `chrome.idle` is based on user input with a 60-second detection interval. Long passive activities such as watching a video may be treated as idle and pause tracking.
- Time is grouped by exact hostname (minus `www.`), not by registrable domain, so subdomains can appear separately.
- Browser-internal pages (`chrome://`, `about:`, extension pages, etc.), `file://` pages, and non-HTTP tabs are not tracked or saved.
- Service-worker suspension and computer sleep can lose a small amount of time. Normal saves happen every 15 seconds while the worker is alive and at least once a minute via the alarm.
- There is no sync, export, or account support. Data does not transfer between Chrome profiles or devices.
- Dates use the computer's local timezone.
- The included `package.json` and `vite.config.js` are optional starter scaffolding; they are not needed to load or run the extension.

## Files

- `manifest.json` — Manifest V3 configuration and permissions.
- `background.js` — service worker that tracks active time and persists totals.
- `index.html` — popup layout.
- `index.css` — compact light/dark popup styling.
- `index.js` — popup logic for time display and saved links.
- `icon.png` — extension icon.
