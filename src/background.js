import {
  AuthError, BULLETIN_URL, DEFAULT_SETTINGS, countdown, fetchEvents, shouldNotify, upcoming,
} from './lib.js';

const REFRESH_MINUTES = 15;
const ICON = chrome.runtime.getURL('icons/icon128.png');

async function getState() {
  const { events = [], settings = {}, notified = {}, authError = false, fetchedAt = 0, lastError = '' } =
    await chrome.storage.local.get(['events', 'settings', 'notified', 'authError', 'fetchedAt', 'lastError']);
  return { events, settings: { ...DEFAULT_SETTINGS, ...settings }, notified, authError, fetchedAt, lastError };
}

async function refresh() {
  const prev = await getState();
  try {
    const events = await fetchEvents();
    await chrome.storage.local.set({ events, fetchedAt: Date.now(), authError: false, lastError: '' });
  } catch (e) {
    const authError = e instanceof AuthError;
    await chrome.storage.local.set({ authError, lastError: String(e.message || e) });
    if (authError && !prev.authError) {
      chrome.notifications.create('auth', {
        type: 'basic', iconUrl: ICON, title: 'SkyCastle Bulletin',
        message: 'You are logged out of SkyCastle. Click to log in so reminders keep working.',
        requireInteraction: true,
      });
    }
  }
  await schedule();
  await updateBadge();
}

// One alarm per upcoming notification. Rebuilt from scratch after every refresh or settings change.
async function schedule() {
  const { events, settings } = await getState();
  const existing = await chrome.alarms.getAll();
  await Promise.all(existing.filter((a) => a.name.startsWith('n|')).map((a) => chrome.alarms.clear(a.name)));

  const now = Date.now();
  for (const ev of upcoming(events, now)) {
    if (!shouldNotify(ev, settings)) continue;
    const lead = ev.start - settings.leadMinutes * 60000;
    if (settings.leadMinutes > 0 && lead > now) chrome.alarms.create(`n|lead|${ev.id}`, { when: lead });
    if (settings.notifyAtStart && ev.start > now) chrome.alarms.create(`n|start|${ev.id}`, { when: ev.start });
  }
}

async function notify(kind, id) {
  const { events, settings, notified } = await getState();
  const ev = events.find((e) => e.id === id);
  const key = `${kind}|${id}`;
  if (!ev || notified[key] || !shouldNotify(ev, settings)) return;
  // Chrome may fire late after sleep; skip reminders for sessions already over.
  if (Date.now() > ev.end) return;

  const time = new Date(ev.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  chrome.notifications.create(`ev|${id}|${kind}`, {
    type: 'basic',
    iconUrl: ICON,
    title: kind === 'start' ? `Starting now · ${ev.title}` : `In ${countdown(ev.start - Date.now())} · ${ev.title}`,
    message: [ev.host && `With ${ev.host}`, `${time} · join in Slack`].filter(Boolean).join('\n'),
    contextMessage: ev.source === 'vibeschool' ? 'VibeSchool' : 'SkyCastle Bulletin',
    priority: 2,
    requireInteraction: kind === 'start',
  });

  // Keep the dedupe map small: drop entries for sessions that ended.
  const live = new Set(events.filter((e) => e.end > Date.now()).map((e) => e.id));
  const next = Object.fromEntries(Object.entries(notified).filter(([k]) => live.has(k.split('|').slice(1).join('|'))));
  next[key] = Date.now();
  await chrome.storage.local.set({ notified: next });
}

async function updateBadge() {
  const { events, settings, authError } = await getState();
  if (authError) {
    await chrome.action.setBadgeBackgroundColor({ color: '#d93f3f' });
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setTitle({ title: 'SkyCastle Bulletin — log in to skycastle.ai' });
    return;
  }
  const now = Date.now();
  const next = upcoming(events, now).find((e) => shouldNotify(e, settings));
  const live = next && next.start <= now;
  const soon = next && next.start - now < 24 * 3600000;
  await chrome.action.setBadgeBackgroundColor({ color: live ? '#2fa36b' : '#1d1d1f' });
  await chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
  await chrome.action.setBadgeText({ text: live ? 'LIVE' : soon ? countdown(next.start - now) : '' });
  await chrome.action.setTitle({ title: next ? `Next: ${next.title}` : 'SkyCastle Bulletin' });
}

function ensureAlarms() {
  chrome.alarms.create('refresh', { periodInMinutes: REFRESH_MINUTES });
  chrome.alarms.create('badge', { periodInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(() => { ensureAlarms(); refresh(); });
chrome.runtime.onStartup.addListener(() => { ensureAlarms(); refresh(); });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'refresh') return refresh();
  if (alarm.name === 'badge') return updateBadge();
  if (alarm.name.startsWith('n|')) {
    const [, kind, ...rest] = alarm.name.split('|');
    return notify(kind, rest.join('|')).then(updateBadge);
  }
});

chrome.notifications.onClicked.addListener((id) => {
  chrome.tabs.create({ url: id === 'auth' ? 'https://skycastle.ai/login' : BULLETIN_URL });
  chrome.notifications.clear(id);
});

// Coming back from a login on skycastle.ai: refresh right away instead of waiting 15 minutes.
chrome.tabs.onUpdated.addListener(async (_tabId, info, tab) => {
  if (info.status !== 'complete' || !tab.url?.startsWith('https://skycastle.ai/')) return;
  const { authError } = await getState();
  if (authError && !tab.url.includes('/login')) refresh();
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === 'refresh') { refresh().then(() => reply({ ok: true })); return true; }
  if (msg?.type === 'reschedule') { schedule().then(updateBadge).then(() => reply({ ok: true })); return true; }
  if (msg?.type === 'test-notification') {
    chrome.notifications.create('test', {
      type: 'basic', iconUrl: ICON, title: 'SkyCastle Bulletin',
      message: 'Notifications are working. You will get reminders like this before sessions.',
    });
    reply({ ok: true });
  }
});
