import {
  DEFAULT_SETTINGS, countdown, googleCalendarUrl, isVisible, shouldNotify, toICS, upcoming,
} from './lib.js';

const $ = (id) => document.getElementById(id);

let state = { events: [], settings: { ...DEFAULT_SETTINGS } };

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  for (const c of children) if (c != null && c !== false) node.append(c);
  return node;
}

async function load() {
  const data = await chrome.storage.local.get(['events', 'settings', 'fetchedAt', 'authError', 'lastError']);
  state = {
    events: data.events || [],
    settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
    fetchedAt: data.fetchedAt || 0,
    authError: !!data.authError,
    lastError: data.lastError || '',
  };
  renderStatus();
  renderSettings();
  renderList();
}

function renderStatus() {
  const s = $('status');
  s.className = 'status';
  s.replaceChildren();
  if (state.authError) {
    s.classList.add('error');
    s.append('Logged out of SkyCastle. ',
      el('a', { href: 'https://skycastle.ai/login', target: '_blank', textContent: 'Log in' }),
      ', then refresh.');
  } else if (state.lastError) {
    s.classList.add('error');
    s.textContent = `Couldn't refresh: ${state.lastError}`;
  } else if (state.fetchedAt) {
    const age = Date.now() - state.fetchedAt;
    s.textContent = `Updated ${age < 60000 ? 'just now' : `${countdown(age)} ago`} · checks every 15 min`;
  } else {
    s.textContent = 'Loading…';
  }
  $('tz').textContent = Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function renderSettings() {
  const { settings } = state;
  $('leadMinutes').value = String(settings.leadMinutes);
  $('notifyAtStart').checked = settings.notifyAtStart;
  $('includeRoutine').checked = settings.includeRoutine;
  if (document.activeElement !== $('keywords')) $('keywords').value = settings.keywords;
}

const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

function dayLabel(ms) {
  const d = new Date(ms); d.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((d - today) / 86400000);
  const base = dayFmt.format(ms).toUpperCase();
  return diff === 0 ? `TODAY · ${base}` : diff === 1 ? `TOMORROW · ${base}` : base;
}

function renderList() {
  const now = Date.now();
  const list = $('list');
  const events = upcoming(state.events, now).filter((e) => isVisible(e, state.settings));
  list.replaceChildren();

  if (!events.length) {
    list.append(el('div', { className: 'empty',
      textContent: state.fetchedAt ? 'No upcoming sessions.' : 'Fetching the bulletin…' }));
    return;
  }

  const nextId = events.find((e) => shouldNotify(e, state.settings))?.id;
  let lastDay = '';
  for (const ev of events) {
    const day = dayLabel(ev.start);
    if (day !== lastDay) { list.append(el('div', { className: 'day', textContent: day })); lastDay = day; }

    const live = ev.start <= now;
    const notifying = shouldNotify(ev, state.settings);
    const muted = !!state.settings.muted[ev.id];

    const tags = [];
    if (live) tags.push(el('span', { className: 'tag live', textContent: 'LIVE' }));
    else if (ev.id === nextId) tags.push(el('span', { className: 'tag', textContent: `IN ${countdown(ev.start - now).toUpperCase()}` }));
    if (ev.source === 'vibeschool') tags.push(el('span', { className: 'tag vs', textContent: 'VIBESCHOOL' }));

    const bell = el('button', {
      textContent: muted ? '🔕' : notifying ? '🔔' : '·',
      title: muted ? 'Muted — click to unmute' : notifying ? 'Click to mute this session' : 'Not matching your keyword filter',
      onclick: () => toggleMute(ev.id),
    });

    list.append(el('div', { className: `ev${ev.id === nextId && !live ? ' next' : ''}${live ? ' live' : ''}${muted ? ' muted' : ''}` },
      el('div', { className: 'time', textContent: timeFmt.format(ev.start) }),
      el('div', {},
        el('div', { className: 'title', textContent: ev.title }),
        ev.host && el('div', { className: 'host', textContent: `with ${ev.host}` }),
        tags.length ? el('div', {}, ...tags.flatMap((t, i) => (i ? [' ', t] : [t]))) : null),
      el('div', { className: 'actions' },
        el('a', { href: googleCalendarUrl(ev), target: '_blank', textContent: '+ Cal', title: 'Add to Google Calendar' }),
        bell)));
  }

  list.querySelector('.ev.next, .ev.live')?.scrollIntoView({ block: 'nearest' });
}

async function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  await chrome.storage.local.set({ settings: state.settings });
  await chrome.runtime.sendMessage({ type: 'reschedule' });
  renderList();
}

function toggleMute(id) {
  const muted = { ...state.settings.muted };
  if (muted[id]) delete muted[id]; else muted[id] = true;
  saveSettings({ muted });
}

$('toggle-settings').onclick = () => { $('settings').hidden = !$('settings').hidden; };
$('leadMinutes').onchange = (e) => saveSettings({ leadMinutes: Number(e.target.value) });
$('notifyAtStart').onchange = (e) => saveSettings({ notifyAtStart: e.target.checked });
$('includeRoutine').onchange = (e) => saveSettings({ includeRoutine: e.target.checked });
let kwTimer;
$('keywords').oninput = (e) => { clearTimeout(kwTimer); kwTimer = setTimeout(() => saveSettings({ keywords: e.target.value }), 400); };

$('refresh').onclick = async () => {
  $('refresh').classList.add('spin');
  await chrome.runtime.sendMessage({ type: 'refresh' });
  $('refresh').classList.remove('spin');
};

$('test').onclick = () => chrome.runtime.sendMessage({ type: 'test-notification' });

$('export').onclick = () => {
  const events = upcoming(state.events).filter((e) => isVisible(e, state.settings) && !state.settings.muted[e.id]);
  const blob = new Blob([toICS(events, state.settings.leadMinutes)], { type: 'text/calendar' });
  const a = el('a', { href: URL.createObjectURL(blob), download: 'skycastle-sessions.ics' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};

chrome.storage.onChanged.addListener(load);
setInterval(renderList, 30000);
load();
// Refresh on open if the cached data is older than 5 minutes.
chrome.storage.local.get('fetchedAt').then(({ fetchedAt = 0 }) => {
  if (Date.now() - fetchedAt > 5 * 60000) $('refresh').click();
});
