/* ============================================================
   Ledger — Habit Tracker
   Vanilla JS, localStorage persistence, no external runtime deps.
   ============================================================ */

const STORAGE_KEY = 'ledger_habits_v1';

/* ---------- Date helpers ---------- */
function todayStr() {
  return dateToStr(new Date());
}
function dateToStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function strToDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function addDays(dateStr, n) {
  const d = strToDate(dateStr);
  d.setDate(d.getDate() + n);
  return dateToStr(d);
}
function daysBetween(a, b) {
  // b - a, in whole days
  return Math.round((strToDate(b) - strToDate(a)) / 86400000);
}
// Monday-start week key, e.g. "2026-W37"
function weekKey(dateStr) {
  const d = strToDate(dateStr);
  const day = (d.getDay() + 6) % 7; // Mon=0..Sun=6
  const monday = new Date(d);
  monday.setDate(d.getDate() - day);
  const target = new Date(monday);
  target.setDate(monday.getDate() + 3);
  const firstJan = new Date(target.getFullYear(), 0, 1);
  const week = Math.ceil((((target - firstJan) / 86400000) + 1) / 7);
  return `${target.getFullYear()}-W${String(week).padStart(2, '0')}`;
}
function currentWeekDates() {
  const t = todayStr();
  const d = strToDate(t);
  const dow = (d.getDay() + 6) % 7;
  const monday = addDays(t, -dow);
  const dates = [];
  for (let i = 0; i < 7; i++) dates.push(addDays(monday, i));
  return dates;
}
function mondayOf(dateStr) {
  const dow = (strToDate(dateStr).getDay() + 6) % 7; // Mon=0..Sun=6
  return addDays(dateStr, -dow);
}

/* ---------- Theme ---------- */
const THEME_KEY = 'ledger_theme';
function initTheme() {
  let theme;
  try {
    theme = localStorage.getItem(THEME_KEY);
  } catch (e) { /* storage unavailable */ }
  if (!theme) {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  applyTheme(theme);
}
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (e) { /* storage unavailable, theme still applies for this session */ }
}
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

/* ---------- Storage ---------- */
function loadHabits() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to load habits', e);
    return [];
  }
}
function saveHabits(habits) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(habits));
  } catch (e) {
    console.error('Failed to save habits', e);
    showToast('Could not save — your browser is blocking local storage here');
  }
}

let habits = loadHabits();

/* ---------- Habit logic ---------- */
function makeId() {
  return 'h_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function isDoneOn(habit, dateStr) {
  return entryStatus(habit.logs[dateStr]) === 'done';
}
function isSlipOn(habit, dateStr) {
  return entryStatus(habit.logs[dateStr]) === 'slip';
}
// A log entry is either the plain string 'done'/'slip' (legacy/simple case)
// or { status: 'slip', note: '...' } when a slip has a trigger note attached.
function entryStatus(entry) {
  if (!entry) return null;
  return typeof entry === 'string' ? entry : (entry.status || null);
}
function slipNoteOn(habit, dateStr) {
  const entry = habit.logs[dateStr];
  return (entry && typeof entry === 'object' && entry.note) ? entry.note : '';
}

// Good daily habit streak: consecutive days ending today (or yesterday if today not yet done)
function goodDailyStreak(habit) {
  let streak = 0;
  let cursor = todayStr();
  if (!isDoneOn(habit, cursor)) {
    cursor = addDays(cursor, -1);
  }
  while (isDoneOn(habit, cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

// Good weekly habit streak: consecutive weeks (ending last completed week or current) meeting target
function goodWeeklyStreak(habit) {
  const target = habit.target || 1;
  let streak = 0;
  let weekStart = addDays(todayStr(), -((strToDate(todayStr()).getDay() + 6) % 7));
  // check current week first; if not yet met, skip it and start counting from last week
  let count = countLogsInWeek(habit, weekStart);
  if (count < target) {
    weekStart = addDays(weekStart, -7);
  }
  while (true) {
    const c = countLogsInWeek(habit, weekStart);
    if (c >= target) {
      streak++;
      weekStart = addDays(weekStart, -7);
    } else {
      break;
    }
  }
  return streak;
}
function countLogsInWeek(habit, weekStartDate) {
  let count = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStartDate, i);
    if (isDoneOn(habit, d)) count++;
  }
  return count;
}

// Bad habit streak: consecutive clean days since last slip (or since creation)
function badHabitStreak(habit) {
  const last = lastSlipDate(habit);
  const start = last ? addDays(last, 1) : habit.createdAt;
  const diff = daysBetween(start, todayStr());
  return Math.max(0, diff + 1);
}
function lastSlipDate(habit) {
  const slipDates = Object.keys(habit.logs).filter(d => isSlipOn(habit, d)).sort();
  return slipDates.length ? slipDates[slipDates.length - 1] : null;
}
function totalSlips(habit) {
  return Object.keys(habit.logs).filter(d => isSlipOn(habit, d)).length;
}

// Longest clean run ever, independent of the current streak — a relapse
// doesn't erase this, so it stands as a "personal best" to aim back at.
function longestCleanStreak(habit) {
  let max = 0, current = 0;
  let cursor = habit.createdAt;
  const t = todayStr();
  while (daysBetween(cursor, t) >= 0) {
    if (isSlipOn(habit, cursor)) {
      current = 0;
    } else {
      current++;
      if (current > max) max = current;
    }
    cursor = addDays(cursor, 1);
  }
  return max;
}

// Total days since creation that weren't a slip — grows continuously
// (doesn't reset on a slip like the streak does), which is what "money
// saved" should track.
function totalCleanDays(habit) {
  const daysSinceCreation = daysBetween(habit.createdAt, todayStr()) + 1;
  return Math.max(0, daysSinceCreation - totalSlips(habit));
}
function moneySaved(habit) {
  if (!habit.costPerDay) return null;
  return totalCleanDays(habit) * habit.costPerDay;
}

const MILESTONES = [
  { days: 1, label: '1d' },
  { days: 3, label: '3d' },
  { days: 7, label: '1wk' },
  { days: 14, label: '2wk' },
  { days: 30, label: '1mo' },
  { days: 60, label: '2mo' },
  { days: 90, label: '3mo' },
  { days: 180, label: '6mo' },
  { days: 365, label: '1yr' }
];

function currentStreak(habit) {
  if (habit.type === 'bad') return badHabitStreak(habit);
  if (habit.frequency === 'weekly') return goodWeeklyStreak(habit);
  return goodDailyStreak(habit);
}

/* ---------- Rendering: Today panel ---------- */
function checkIcon() {
  return `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7.5L5.5 10.5L11.5 3.5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function renderToday() {
  const goodEl = document.getElementById('goodHabitsToday');
  const badEl = document.getElementById('badHabitsToday');
  const t = todayStr();

  const goodDaily = habits.filter(h => h.type === 'good' && h.frequency === 'daily');
  const badHabits = habits.filter(h => h.type === 'bad');

  goodEl.innerHTML = goodDaily.length ? goodDaily.map(h => {
    const done = isDoneOn(h, t);
    const streak = currentStreak(h);
    return `
      <div class="ledger-row">
        <button class="check-btn ${done ? 'checked' : ''}" data-id="${h.id}" data-action="toggle-good">${checkIcon()}</button>
        <div class="ledger-row-main">
          <div class="ledger-row-name">${escapeHtml(h.name)}</div>
          <div class="ledger-row-meta">daily</div>
        </div>
        <span class="streak-pill ${streak > 0 ? 'good' : 'zero'}">${streak} day${streak === 1 ? '' : 's'}</span>
      </div>`;
  }).join('') : '';

  badEl.innerHTML = badHabits.length ? badHabits.map(h => {
    const slippedToday = isSlipOn(h, t);
    const isDrafting = slipNoteDraftId === h.id;
    const streak = currentStreak(h);
    const best = longestCleanStreak(h);
    const saved = moneySaved(h);
    const metaParts = [`${totalSlips(h)} slip${totalSlips(h) === 1 ? '' : 's'} total`, `best ${best}d`];
    if (saved !== null) metaParts.push(`$${saved.toFixed(0)} saved`);

    let controlHtml;
    if (isDrafting) {
      controlHtml = `
        <div class="slip-note-row">
          <input type="text" class="slip-note-input" id="slipNoteInput-${h.id}" placeholder="what triggered it? (optional)" maxlength="80">
          <button class="btn-mini btn-mini-primary" data-id="${h.id}" data-action="confirm-slip">Log it</button>
          <button class="btn-mini" data-id="${h.id}" data-action="cancel-slip-note">Cancel</button>
        </div>`;
    } else if (slippedToday) {
      controlHtml = `<button class="slip-btn logged" data-id="${h.id}" data-action="toggle-slip">Slipped today</button>`;
    } else {
      controlHtml = `<button class="slip-btn" data-id="${h.id}" data-action="open-slip-note">Log a slip</button>`;
    }

    return `
      <div class="ledger-row">
        <div class="ledger-row-main">
          <div class="ledger-row-name">${escapeHtml(h.name)}</div>
          <div class="ledger-row-meta">${metaParts.join(' · ')}</div>
        </div>
        <span class="streak-pill ${streak > 0 ? 'good' : 'zero'}">${streak} clean day${streak === 1 ? '' : 's'}</span>
        ${controlHtml}
      </div>`;
  }).join('') : '';

  const hasHabits = habits.length > 0;
  document.getElementById('emptyToday').hidden = hasHabits;

  const goodHead = document.querySelector('#panel-today .section-head:not(.section-head--bad)');
  const badHead = document.querySelector('#panel-today .section-head--bad');

  goodHead.style.display = goodDaily.length ? 'flex' : 'none';
  goodEl.style.display = goodDaily.length ? 'block' : 'none';
  badHead.style.display = badHabits.length ? 'flex' : 'none';
  badEl.style.display = badHabits.length ? 'block' : 'none';

  renderMasthead();
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function renderMasthead() {
  const good = habits.filter(h => h.type === 'good');
  const bad = habits.filter(h => h.type === 'bad');
  const totalStreak = good.reduce((sum, h) => sum + currentStreak(h), 0);
  const el = document.getElementById('mastheadStats');
  if (habits.length === 0) { el.textContent = ''; return; }
  el.innerHTML = `<b>${good.length}</b> building &nbsp;·&nbsp; <b>${bad.length}</b> quitting`;
}

/* ---------- Rendering: Week panel ---------- */
function renderWeek() {
  const el = document.getElementById('weeklyHabitsList');
  const weekly = habits.filter(h => h.type === 'good' && h.frequency === 'weekly');
  const weekDates = currentWeekDates();
  const t = todayStr();
  const thisMonday = mondayOf(t);

  el.innerHTML = weekly.map(h => {
    const count = weekDates.filter(d => isDoneOn(h, d)).length;
    const target = h.target || 1;
    const pct = Math.min(100, Math.round((count / target) * 100));
    const doneToday = isDoneOn(h, t);
    const streak = currentStreak(h);

    const history = [];
    for (let i = 7; i >= 0; i--) {
      const ws = addDays(thisMonday, -7 * i);
      const weekEnd = addDays(ws, 6);
      const before = daysBetween(h.createdAt, weekEnd) < 0;
      const c = countLogsInWeek(h, ws);
      history.push({ ws, c, before, met: c >= target });
    }
    const historyHtml = history.map(hh => {
      const cls = hh.before ? 'before' : (hh.met ? 'met' : 'missed');
      return `<span class="week-dot ${cls}" title="week of ${hh.ws}: ${hh.c}/${target}"></span>`;
    }).join('');

    return `
      <div class="weekly-row">
        <button class="week-mark-btn ${doneToday ? 'checked' : ''}" data-id="${h.id}" data-action="toggle-good">${checkIcon()}</button>
        <div class="weekly-row-main">
          <div class="ledger-row-name">${escapeHtml(h.name)}</div>
          <div class="weekly-track"><div class="weekly-fill" style="width:${pct}%"></div></div>
          <div class="week-history-row">${historyHtml}<span class="week-history-label">last 8 weeks</span></div>
        </div>
        <div class="weekly-row-side">
          <span class="streak-pill ${streak > 0 ? 'good' : 'zero'}">${streak} wk streak</span>
          <span class="weekly-count">${count} / ${target} this week</span>
        </div>
      </div>`;
  }).join('');

  document.getElementById('emptyWeek').hidden = weekly.length > 0;
}

/* ---------- Rendering: Progress panel (custom SVG graphs) ---------- */
function renderProgress() {
  const completionEl = document.getElementById('completionGraph');
  const weeklyEl = document.getElementById('weeklyGraph');
  const streakEl = document.getElementById('streakGraph');
  const calendarsEl = document.getElementById('habitCalendars');
  const dailyGood = habits.filter(h => h.type === 'good' && h.frequency === 'daily');

  const hasData = habits.length > 0;
  document.getElementById('emptyProgress').hidden = hasData;
  [completionEl, weeklyEl, streakEl].forEach(el => el.style.display = hasData ? 'block' : 'none');
  calendarsEl.style.display = hasData ? 'block' : 'none';
  if (!hasData) return;

  completionEl.innerHTML = renderCompletionSVG(dailyGood);
  weeklyEl.innerHTML = renderWeeklyCompletionSVG();
  streakEl.innerHTML = renderStreakBars();
  calendarsEl.innerHTML = renderHabitCalendars();
}

function renderCompletionSVG(dailyGoodHabits) {
  const days = 30;
  const t = todayStr();
  const dates = [];
  for (let i = days - 1; i >= 0; i--) dates.push(addDays(t, -i));

  const values = dates.map(d => {
    if (dailyGoodHabits.length === 0) return 0;
    const done = dailyGoodHabits.filter(h => isDoneOn(h, d)).length;
    return Math.round((done / dailyGoodHabits.length) * 100);
  });

  const w = 760, h = 180, padL = 30, padR = 10, padT = 14, padB = 24;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;
  const stepX = chartW / (days - 1);

  const points = values.map((v, i) => {
    const x = padL + i * stepX;
    const y = padT + chartH - (v / 100) * chartH;
    return [x, y];
  });

  const linePath = points.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const areaPath = linePath + ` L${points[points.length - 1][0].toFixed(1)},${padT + chartH} L${points[0][0].toFixed(1)},${padT + chartH} Z`;

  // gridlines at 0/50/100
  const gridLines = [0, 50, 100].map(v => {
    const y = padT + chartH - (v / 100) * chartH;
    return `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="#D8D4C6" stroke-width="1" />
            <text x="${padL - 6}" y="${y + 3}" text-anchor="end" font-size="9" font-family="IBM Plex Mono" fill="#8B948C">${v}</text>`;
  }).join('');

  // month/day labels, every ~5 days
  const labels = dates.map((d, i) => {
    if (i % 5 !== 0 && i !== dates.length - 1) return '';
    const x = padL + i * stepX;
    const dd = strToDate(d);
    const label = `${dd.getMonth() + 1}/${dd.getDate()}`;
    return `<text x="${x}" y="${h - 6}" text-anchor="middle" font-size="9" font-family="IBM Plex Mono" fill="#8B948C">${label}</text>`;
  }).join('');

  const dots = points.map((p, i) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.2" fill="#3F6C51"><title>${dates[i]}: ${values[i]}%</title></circle>`).join('');

  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    ${gridLines}
    <path d="${areaPath}" fill="#3F6C51" opacity="0.08" />
    <path d="${linePath}" fill="none" stroke="#3F6C51" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
    ${dots}
    ${labels}
  </svg>`;
}

function renderWeeklyCompletionSVG() {
  const weeksCount = 12;
  const goodHabits = habits.filter(h => h.type === 'good');
  const currentMonday = mondayOf(todayStr());
  const weekStarts = [];
  for (let i = weeksCount - 1; i >= 0; i--) weekStarts.push(addDays(currentMonday, -7 * i));

  const values = weekStarts.map(ws => {
    if (goodHabits.length === 0) return 0;
    const fractions = goodHabits.map(h => {
      const count = countLogsInWeek(h, ws);
      if (h.frequency === 'weekly') return Math.min(1, count / (h.target || 1));
      return count / 7;
    });
    const avg = fractions.reduce((a, b) => a + b, 0) / fractions.length;
    return Math.round(avg * 100);
  });

  const w = 760, h = 180, padL = 30, padR = 10, padT = 14, padB = 24;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;
  const barGap = 8;
  const barW = (chartW / weeksCount) - barGap;

  const gridLines = [0, 50, 100].map(v => {
    const y = padT + chartH - (v / 100) * chartH;
    return `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="#D8D4C6" stroke-width="1" />
            <text x="${padL - 6}" y="${y + 3}" text-anchor="end" font-size="9" font-family="IBM Plex Mono" fill="#8B948C">${v}</text>`;
  }).join('');

  const bars = values.map((v, i) => {
    const barH = (v / 100) * chartH;
    const x = padL + i * (barW + barGap);
    const y = padT + chartH - barH;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" fill="#3F6C51" rx="1.5"><title>Week of ${weekStarts[i]}: ${v}%</title></rect>`;
  }).join('');

  const labels = weekStarts.map((ws, i) => {
    if (i % 2 !== 0 && i !== weekStarts.length - 1) return '';
    const x = padL + i * (barW + barGap) + barW / 2;
    const dd = strToDate(ws);
    const label = `${dd.getMonth() + 1}/${dd.getDate()}`;
    return `<text x="${x.toFixed(1)}" y="${h - 6}" text-anchor="middle" font-size="9" font-family="IBM Plex Mono" fill="#8B948C">${label}</text>`;
  }).join('');

  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    ${gridLines}
    ${bars}
    ${labels}
  </svg>`;
}

function renderStreakBars() {
  const rows = habits.map(h => {
    const streak = currentStreak(h);
    return { name: h.name, streak, type: h.type };
  });
  const max = Math.max(1, ...rows.map(r => r.streak));

  return `<div class="streak-bars">${rows.map(r => {
    const pct = Math.round((r.streak / max) * 100);
    return `
      <div class="streak-bar-row">
        <div class="streak-bar-label" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</div>
        <div class="streak-bar-track"><div class="streak-bar-fill ${r.type}" style="width:${pct}%"></div></div>
        <div class="streak-bar-value">${r.streak}d</div>
      </div>`;
  }).join('')}</div>`;
}

function renderHabitCalendars() {
  const today = todayStr();
  const rangeStart = addDays(today, -29);
  const gridStart = mondayOf(rangeStart);
  const gridEnd = addDays(mondayOf(today), 6);

  const gridDates = [];
  let cursor = gridStart;
  while (daysBetween(cursor, gridEnd) >= 0) {
    gridDates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  const weekCount = gridDates.length / 7;

  const dowLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const header = `<div class="cal-dow-row">${dowLabels.map(l => `<span>${l}</span>`).join('')}</div>`;

  const blocks = habits.map(h => {
    const cells = gridDates.map(d => {
      const inRange = daysBetween(rangeStart, d) >= 0 && daysBetween(d, today) >= 0;
      if (!inRange) return `<span class="cal-cell pad"></span>`;
      const beforeCreation = daysBetween(h.createdAt, d) < 0;
      let cls, label;
      if (beforeCreation) {
        cls = 'before'; label = 'not tracked yet';
      } else if (h.type === 'bad') {
        cls = isSlipOn(h, d) ? 'slip' : 'clean';
        label = isSlipOn(h, d) ? 'slipped' : 'clean';
      } else {
        cls = isDoneOn(h, d) ? 'done' : 'missed';
        label = isDoneOn(h, d) ? 'done' : 'not done';
      }
      const niceDate = strToDate(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      return `<span class="cal-cell ${cls}" title="${niceDate} — ${label}"></span>`;
    }).join('');

    return `
      <div class="habit-calendar">
        <div class="habit-calendar-name">${escapeHtml(h.name)}</div>
        <div class="cal-grid">${cells}</div>
      </div>`;
  }).join('');

  return `${header}<div class="cal-blocks">${blocks}</div>`;
}

/* ---------- Rendering: Quitting panel ---------- */
function renderQuit() {
  const el = document.getElementById('quitCards');
  const bad = habits.filter(h => h.type === 'bad');
  document.getElementById('emptyQuit').hidden = bad.length > 0;
  el.style.display = bad.length ? '' : 'none';
  if (!bad.length) { el.innerHTML = ''; return; }

  el.innerHTML = bad.map(h => {
    const streak = currentStreak(h);
    const best = longestCleanStreak(h);
    const saved = moneySaved(h);
    const sinceLabel = strToDate(h.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

    // Milestone track: everything reached so far is a filled chip; the very
    // next one gets a mini progress bar toward it; the rest sit dashed and
    // faint out ahead. Based on the current streak, not the best-ever one —
    // so it reflects "how close am I right now," which resets after a slip.
    let nextShown = false;
    const chipsHtml = MILESTONES.map(m => {
      if (best >= m.days) {
        return `<span class="milestone-chip achieved" title="${m.label} reached"><span class="milestone-check">✓</span>${m.label}</span>`;
      } else if (!nextShown) {
        nextShown = true;
        const pct = Math.min(100, Math.round((streak / m.days) * 100));
        return `<span class="milestone-chip next" title="${streak}/${m.days} days toward ${m.label}">
          <span class="milestone-chip-top"><span>${m.label}</span><span>${streak}/${m.days}</span></span>
          <span class="milestone-chip-track"><span class="milestone-chip-fill" style="width:${pct}%"></span></span>
        </span>`;
      } else {
        return `<span class="milestone-chip future">${m.label}</span>`;
      }
    }).join('');

    const slipDates = Object.keys(h.logs).filter(d => isSlipOn(h, d)).sort().reverse().slice(0, 5);
    const slipListHtml = slipDates.length
      ? `<ul class="slip-history">${slipDates.map(d => {
          const note = slipNoteOn(h, d);
          const nice = strToDate(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          return `<li><span class="slip-history-date">${nice}</span>${note ? `<span class="slip-history-note">${escapeHtml(note)}</span>` : '<span class="slip-history-note slip-history-note--empty">no note</span>'}</li>`;
        }).join('')}</ul>`
      : `<p class="slip-history-empty">No slips logged since ${escapeHtml(sinceLabel)}.</p>`;

    return `
      <div class="quit-card">
        <div class="quit-card-head">
          <h3>${escapeHtml(h.name)}</h3>
          <span class="quit-since">quitting since ${sinceLabel}</span>
        </div>
        <div class="quit-stats">
          <div class="quit-stat is-primary">
            <div class="quit-stat-value">${streak}</div>
            <div class="quit-stat-label">day streak</div>
          </div>
          <div class="quit-stat">
            <div class="quit-stat-value">${best}</div>
            <div class="quit-stat-label">best ever</div>
          </div>
          <div class="quit-stat">
            <div class="quit-stat-value">${totalSlips(h)}</div>
            <div class="quit-stat-label">total slips</div>
          </div>
          ${saved !== null ? `<div class="quit-stat">
            <div class="quit-stat-value">$${saved.toFixed(0)}</div>
            <div class="quit-stat-label">saved</div>
          </div>` : ''}
        </div>
        <div class="milestone-track">${chipsHtml}</div>
        <div class="quit-card-section-label">Recent slips</div>
        ${slipListHtml}
      </div>`;
  }).join('');
}

/* ---------- Rendering: Manage panel ---------- */
function renderManage() {
  const el = document.getElementById('manageList');
  if (habits.length === 0) {
    el.innerHTML = `<div class="empty-state" style="padding:24px 0;">No habits yet.</div>`;
    return;
  }
  el.innerHTML = habits.map(h => {
    let metaText;
    if (h.type === 'bad') {
      metaText = 'quitting' + (h.costPerDay ? ` · $${h.costPerDay}/day avoided` : '');
    } else {
      metaText = 'building · ' + (h.frequency === 'weekly' ? `weekly · ${h.target}x` : 'daily');
    }
    return `
      <div class="manage-row">
        <div class="manage-row-main">
          <div class="manage-row-name">${escapeHtml(h.name)}</div>
          <div class="manage-row-meta">${metaText}</div>
        </div>
        <button class="edit-btn" data-id="${h.id}" data-action="edit">Edit</button>
        <button class="delete-btn" data-id="${h.id}" data-action="delete">Remove</button>
      </div>`;
  }).join('');
}

/* ---------- Actions ---------- */
function toggleGoodToday(id) {
  const h = habits.find(x => x.id === id);
  if (!h) return;
  const t = todayStr();
  if (isDoneOn(h, t)) {
    delete h.logs[t];
  } else {
    h.logs[t] = 'done';
  }
  saveHabits(habits);
  renderAll();
}

function toggleSlipToday(id) {
  // Only used to remove an already-logged slip; logging a new one goes
  // through the note-capture flow (openSlipNote → confirmSlip).
  const h = habits.find(x => x.id === id);
  if (!h) return;
  const t = todayStr();
  if (isSlipOn(h, t)) {
    delete h.logs[t];
    saveHabits(habits);
    renderAll();
    showToast('Slip removed');
  }
}

let slipNoteDraftId = null;

function openSlipNote(id) {
  slipNoteDraftId = id;
  renderToday();
  setTimeout(() => {
    const el = document.getElementById('slipNoteInput-' + id);
    if (el) el.focus();
  }, 0);
}
function cancelSlipNote() {
  slipNoteDraftId = null;
  renderToday();
}
function confirmSlip(id) {
  const input = document.getElementById('slipNoteInput-' + id);
  const note = input ? input.value.trim() : '';
  const h = habits.find(x => x.id === id);
  if (!h) return;
  const t = todayStr();
  h.logs[t] = note ? { status: 'slip', note } : 'slip';
  slipNoteDraftId = null;
  saveHabits(habits);
  renderAll();
  showToast('Slip logged — tomorrow is a fresh start');
}

function deleteHabit(id) {
  const h = habits.find(x => x.id === id);
  if (!h) return;
  if (!confirm(`Remove "${h.name}" and all its history? This can't be undone.`)) return;
  habits = habits.filter(x => x.id !== id);
  saveHabits(habits);
  if (editingId === id) exitEditMode();
  renderAll();
}

function updateHabit(id, { name, type, frequency, target, costPerDay }) {
  const h = habits.find(x => x.id === id);
  if (!h) return;
  h.name = name.trim();
  h.type = type;
  h.frequency = type === 'bad' ? 'daily' : frequency;
  h.target = type === 'good' && frequency === 'weekly' ? Number(target) : null;
  h.costPerDay = type === 'bad' && costPerDay ? Number(costPerDay) : null;
  // A habit that's no longer "bad" shouldn't keep slip logs, and vice versa —
  // but we leave history alone rather than silently deleting it; only the
  // fields that drive today's view/streak math change.
  saveHabits(habits);
  renderAll();
  showToast(`"${h.name}" updated`);
}

function addHabit({ name, type, frequency, target, costPerDay }) {
  const habit = {
    id: makeId(),
    name: name.trim(),
    type,
    frequency: type === 'bad' ? 'daily' : frequency,
    target: type === 'good' && frequency === 'weekly' ? Number(target) : null,
    costPerDay: type === 'bad' && costPerDay ? Number(costPerDay) : null,
    createdAt: todayStr(),
    logs: {}
  };
  habits.push(habit);
  saveHabits(habits);
  renderAll();
  showToast(`"${habit.name}" added to your ledger`);
}

/* ---------- Toast ---------- */
let toastTimer;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ---------- Render orchestration ---------- */
function renderAll() {
  renderToday();
  renderWeek();
  renderQuit();
  renderProgress();
  renderManage();
}

/* ---------- Event wiring ---------- */
document.addEventListener('click', (e) => {
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;
  const id = actionEl.dataset.id;
  const action = actionEl.dataset.action;
  if (action === 'toggle-good') toggleGoodToday(id);
  if (action === 'toggle-slip') toggleSlipToday(id);
  if (action === 'open-slip-note') openSlipNote(id);
  if (action === 'cancel-slip-note') cancelSlipNote();
  if (action === 'confirm-slip') confirmSlip(id);
  if (action === 'delete') deleteHabit(id);
  if (action === 'edit') enterEditMode(id);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList.contains('slip-note-input')) {
    e.preventDefault();
    confirmSlip(e.target.id.replace('slipNoteInput-', ''));
  }
});

document.getElementById('themeToggle').addEventListener('click', toggleTheme);

// Tabs
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
  });
});

document.getElementById('emptyTodayAddBtn')?.addEventListener('click', () => {
  document.querySelector('.tab[data-tab="manage"]').click();
});

// Form: type / frequency segmented controls, plus add/edit mode
let formState = { type: 'good', frequency: 'daily' };
let editingId = null;

document.getElementById('habitTypeSeg').addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-option');
  if (!btn) return;
  document.querySelectorAll('#habitTypeSeg .seg-option').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  formState.type = btn.dataset.value;
  document.getElementById('freqField').style.display = formState.type === 'bad' ? 'none' : 'block';
  document.getElementById('costField').hidden = formState.type !== 'bad';
  updateTargetVisibility();
});

document.getElementById('habitFreqSeg').addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-option');
  if (!btn) return;
  document.querySelectorAll('#habitFreqSeg .seg-option').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  formState.frequency = btn.dataset.value;
  updateTargetVisibility();
});

function updateTargetVisibility() {
  const show = formState.type === 'good' && formState.frequency === 'weekly';
  document.getElementById('targetRow').hidden = !show;
}

function setSegValue(containerId, value) {
  document.querySelectorAll(`#${containerId} .seg-option`).forEach(b => {
    b.classList.toggle('active', b.dataset.value === value);
  });
}

function resetForm() {
  document.getElementById('habitForm').reset();
  formState = { type: 'good', frequency: 'daily' };
  setSegValue('habitTypeSeg', 'good');
  setSegValue('habitFreqSeg', 'daily');
  document.getElementById('freqField').style.display = 'block';
  document.getElementById('costField').hidden = true;
  document.getElementById('habitTarget').value = 3;
  document.getElementById('habitCost').value = '';
  updateTargetVisibility();
}

function enterEditMode(id) {
  const h = habits.find(x => x.id === id);
  if (!h) return;
  editingId = id;
  document.getElementById('habitName').value = h.name;
  formState.type = h.type;
  formState.frequency = h.frequency;
  setSegValue('habitTypeSeg', h.type);
  setSegValue('habitFreqSeg', h.frequency);
  document.getElementById('freqField').style.display = h.type === 'bad' ? 'none' : 'block';
  document.getElementById('costField').hidden = h.type !== 'bad';
  document.getElementById('habitTarget').value = h.target || 3;
  document.getElementById('habitCost').value = h.costPerDay || '';
  updateTargetVisibility();

  document.getElementById('formHeading').textContent = 'Edit habit';
  document.getElementById('formSubmitBtn').textContent = 'Save changes';
  document.getElementById('cancelEditBtn').hidden = false;
  document.getElementById('habitForm').classList.add('editing');
  document.querySelector('.tab[data-tab="manage"]').click();
  document.getElementById('habitForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.getElementById('habitName').focus();
}

function exitEditMode() {
  editingId = null;
  document.getElementById('formHeading').textContent = 'Add a habit';
  document.getElementById('formSubmitBtn').textContent = 'Add to ledger';
  document.getElementById('cancelEditBtn').hidden = true;
  document.getElementById('habitForm').classList.remove('editing');
  resetForm();
}

document.getElementById('cancelEditBtn').addEventListener('click', exitEditMode);

document.getElementById('habitForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = document.getElementById('habitName').value.trim();
  if (!name) return;
  const target = document.getElementById('habitTarget').value;
  const costPerDay = document.getElementById('habitCost').value;
  if (editingId) {
    updateHabit(editingId, { name, type: formState.type, frequency: formState.frequency, target, costPerDay });
    exitEditMode();
  } else {
    addHabit({ name, type: formState.type, frequency: formState.frequency, target, costPerDay });
    resetForm();
  }
});

// Export / Import
document.getElementById('exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(habits, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ledger-backup-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('importInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!Array.isArray(imported)) throw new Error('Invalid format');
      if (habits.length > 0 && !confirm('This will replace your current data with the imported file. Continue?')) return;
      habits = imported;
      saveHabits(habits);
      renderAll();
      showToast('Data imported');
    } catch (err) {
      alert('Could not read that file — make sure it\'s a Ledger export.');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

/* ---------- Init ---------- */
function renderDateHeader() {
  const el = document.getElementById('todayDate');
  const d = new Date();
  el.textContent = d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

renderDateHeader();
initTheme();
renderAll();
