# Ledger — Habit Tracker

A minimal, self-hosted habit tracker. Build good daily/weekly habits, track streaks
on habits you're quitting, and see your daily progress as a graph. No backend, no
build step, no account — just static files and your browser's local storage.

## Running it

You don't need to install anything. Pick whichever is easiest:

**Option A — just open it**
Double-click `index.html`. It works directly in the browser. (A few browsers
restrict local file access slightly; if anything looks off, use Option B.)

**Option B — quick local server (recommended)**
From this folder, run one of:
```
python3 -m http.server 8080
```
or
```
npx serve .
```
Then open `http://localhost:8080` in your browser.

**Option C — host it anywhere**
This is a plain static site (`index.html`, `style.css`, `app.js`). Drop the
folder onto any static host — Netlify, Vercel, GitHub Pages, an S3 bucket, a
Raspberry Pi running nginx, whatever you've got. No server-side code required.

## How it works

- **Good habits** — daily ones show up as a checklist on "Today's entry."
  Weekly ones (e.g. "gym, 3x a week") live under "This week" with a progress
  bar toward your target.
- **Habits to quit** — tracked as a streak of clean days. You don't check
  anything off; you only log it when you slip. The streak resets from there.
- **Progress tab** — a 30-day line graph of daily completion rate, a
  12-week bar chart of overall weekly completion, a streak bar chart across
  every habit, and a 30-day calendar (one square per day) for each
  individual habit so you can see exactly which days you hit and missed.
- **Manage tab** — add, edit, and remove habits, and export/import your
  data as a `.json` file. Editing a habit updates its name, type, and
  frequency going forward without touching its logged history.
- **Light / dark mode** — the moon/sun icon in the top right switches themes.
  It remembers your choice and otherwise follows your system preference.

## Your data

Everything is stored in `localStorage`, in this browser, on this device —
nothing is sent anywhere. That means:

- Clearing your browser data will erase your habit history.
- Your data won't automatically show up on another device or browser.

Use **Manage → Export data** regularly to keep a backup, and **Import data**
to restore it or move it to another device/browser.

## Customizing

Everything is plain HTML/CSS/JS, so it's easy to tweak:
- Colors, fonts, spacing: `style.css` (see the `:root` variables at the top)
- Habit logic, streak math, graphs: `app.js`
- Page structure and copy: `index.html`
