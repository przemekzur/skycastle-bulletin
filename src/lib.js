// Shared logic: fetching, normalising, filtering, calendar export.
// Pure functions below `fetch*` have no chrome.* dependency so they run under node for tests.

export const ORIGIN = 'https://skycastle.ai';
export const BULLETIN_URL = `${ORIGIN}/bulletin`;

export const DEFAULT_SETTINGS = {
  leadMinutes: 10,      // heads-up this many minutes before start (0 = off)
  notifyAtStart: true,  // second notification when the session begins
  includeRoutine: false, // daily "Onboarding & Hangout" style sessions
  keywords: '',         // comma-separated; if set, only matching sessions notify
  muted: {},            // { [eventId]: true }
};

export class AuthError extends Error {}

async function getJson(path) {
  const res = await fetch(ORIGIN + path, { credentials: 'include', cache: 'no-store' });
  if (res.status === 401 || res.status === 403) throw new AuthError(`${path} → ${res.status}`);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

export async function fetchEvents() {
  const bulletin = await getJson('/api/bulletin');
  const events = (bulletin.sessions || []).map((s) => normalize(s, 'bulletin')).filter(Boolean);

  // VibeSchool sessions live on the member's cohort, not the bulletin. Shape is unknown
  // until you are in a cohort, so collect anything that looks like a dated session.
  try {
    const { cohort } = await getJson('/api/me/cohort');
    if (cohort) events.push(...findSessions(cohort).map((s) => normalize(s, 'vibeschool', cohort)).filter(Boolean));
  } catch (e) {
    if (e instanceof AuthError) throw e;
  }

  const seen = new Set();
  return events
    .filter((e) => (seen.has(e.id) ? false : seen.add(e.id)))
    .sort((a, b) => a.start - b.start);
}

const DATE_KEYS = ['startsAt', 'startAt', 'start', 'scheduledAt', 'date', 'datetime'];

export function findSessions(node, depth = 0, out = []) {
  if (!node || typeof node !== 'object' || depth > 4) return out;
  if (Array.isArray(node)) {
    for (const x of node) findSessions(x, depth + 1, out);
  } else if (DATE_KEYS.some((k) => typeof node[k] === 'string' && !Number.isNaN(Date.parse(node[k])))) {
    out.push(node);
  } else {
    for (const v of Object.values(node)) findSessions(v, depth + 1, out);
  }
  return out;
}

export function normalize(s, source, cohort) {
  const startRaw = DATE_KEYS.map((k) => s[k]).find((v) => typeof v === 'string');
  const start = Date.parse(startRaw);
  if (Number.isNaN(start)) return null;
  const endRaw = s.endsAt || s.endAt || s.end;
  const minutes = Number(s.durationMinutes || s.duration) || (source === 'vibeschool' ? 45 : 60);
  const end = endRaw && !Number.isNaN(Date.parse(endRaw)) ? Date.parse(endRaw) : start + minutes * 60000;
  const title = s.title || s.name || (source === 'vibeschool' ? `VibeSchool${cohort?.name ? ' · ' + cohort.name : ''}` : 'SkyCastle session');
  return {
    id: `${source}:${s.id ?? start}`,
    source,
    title: String(title).trim(),
    host: s.host || '',
    summary: s.summary || s.description || '',
    start,
    end,
    status: s.status || 'scheduled',
    joinUrl: s.joinUrl || s.location || '',
  };
}

export const ROUTINE_RE = /onboarding|hangout|meet\s*(?:&|and|\+)?\s*greet/i;
export const isRoutine = (ev) => ROUTINE_RE.test(ev.title);

export function parseKeywords(str) {
  return String(str || '').split(',').map((k) => k.trim().toLowerCase()).filter(Boolean);
}

export function isVisible(ev, settings) {
  return settings.includeRoutine || !isRoutine(ev) || ev.source === 'vibeschool';
}

export function shouldNotify(ev, settings) {
  if (settings.muted?.[ev.id] || ev.status === 'cancelled' || !isVisible(ev, settings)) return false;
  const kws = parseKeywords(settings.keywords);
  if (!kws.length || ev.source === 'vibeschool') return true;
  const hay = `${ev.title} ${ev.host} ${ev.summary}`.toLowerCase();
  return kws.some((k) => hay.includes(k));
}

export function upcoming(events, now = Date.now()) {
  return events.filter((e) => e.end > now);
}

// ---- Calendar export ----

const utcStamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

function description(ev) {
  return [ev.host && `With ${ev.host}`, ev.summary, `Join via SkyCastle Slack · ${BULLETIN_URL}`]
    .filter(Boolean).join('\n\n');
}

export function googleCalendarUrl(ev) {
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.title,
    dates: `${utcStamp(ev.start)}/${utcStamp(ev.end)}`,
    details: description(ev),
    location: ev.joinUrl || 'SkyCastle Slack',
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}

const icsEscape = (s) => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

function fold(line) {
  const parts = [];
  while (line.length > 74) { parts.push(line.slice(0, 74)); line = ' ' + line.slice(74); }
  parts.push(line);
  return parts.join('\r\n');
}

export function toICS(events, leadMinutes = 10, now = Date.now()) {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//skycastle-bulletin//EN',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:SkyCastle',
  ];
  for (const ev of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${ev.id.replace(':', '-')}@skycastle.ai`,
      `DTSTAMP:${utcStamp(now)}`,
      `DTSTART:${utcStamp(ev.start)}`,
      `DTEND:${utcStamp(ev.end)}`,
      `SUMMARY:${icsEscape(ev.title)}`,
      `DESCRIPTION:${icsEscape(description(ev))}`,
      `LOCATION:${icsEscape(ev.joinUrl || 'SkyCastle Slack')}`,
      `URL:${BULLETIN_URL}`,
      `STATUS:${ev.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
    );
    if (leadMinutes > 0) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(ev.title)}`,
        `TRIGGER:-PT${leadMinutes}M`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

// ---- Formatting ----

export function countdown(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 && h < 10 ? `${h}h${String(m % 60).padStart(2, '0')}` : `${h}h`;
  return `${Math.round(h / 24)}d`;
}
