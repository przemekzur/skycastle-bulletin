// Offline checks for src/lib.js against a fixture shaped like GET /api/bulletin.
import assert from 'node:assert/strict';
import {
  findSessions, googleCalendarUrl, isRoutine, normalize, shouldNotify, toICS, upcoming, countdown, DEFAULT_SETTINGS,
} from '../src/lib.js';

const bulletin = {
  sessions: [
    { id: 98, title: 'Agentic AI Inflection Point & Weekly Updates', host: 'Richard Werbe',
      summary: "Our founder Richard is back on the mic, plus this week's updates.",
      startsAt: '2026-09-26T21:00:00.000Z', durationMinutes: 60, joinUrl: null, status: 'scheduled' },
    { id: 76, title: 'Onboarding & Hangout', host: 'Andrea, Guadi, Ninfa',
      startsAt: '2026-12-09T17:00:00.000Z', durationMinutes: 60, joinUrl: null, status: 'scheduled' },
    { id: 12, title: 'Onboarding session + Meet & Greet', host: 'Troy',
      startsAt: '2026-08-01T17:00:00.000Z', durationMinutes: 60, status: 'completed' },
  ],
};
const events = bulletin.sessions.map((s) => normalize(s, 'bulletin'));
const now = Date.parse('2026-09-26T19:00:00Z');
const s = { ...DEFAULT_SETTINGS };

assert.equal(events[0].end - events[0].start, 3600000);
assert.equal(upcoming(events, now).length, 2);
assert.ok(isRoutine(events[1]) && isRoutine(events[2]) && !isRoutine(events[0]));
assert.ok(shouldNotify(events[0], s));
assert.ok(!shouldNotify(events[1], s), 'routine hidden by default');
assert.ok(shouldNotify(events[1], { ...s, includeRoutine: true }));
assert.ok(!shouldNotify(events[0], { ...s, keywords: 'growth' }));
assert.ok(shouldNotify(events[0], { ...s, keywords: 'growth, richard' }));
assert.ok(!shouldNotify(events[0], { ...s, muted: { [events[0].id]: true } }));

const url = new URL(googleCalendarUrl(events[0]));
assert.equal(url.searchParams.get('dates'), '20260926T210000Z/20260926T220000Z');
assert.equal(url.searchParams.get('text'), events[0].title);

const ics = toICS(upcoming(events, now), 10, now);
assert.ok(ics.includes('DTSTART:20260926T210000Z'));
assert.ok(ics.includes('TRIGGER:-PT10M'));
assert.ok(ics.split('\r\n').every((l) => l.length <= 75), 'lines folded');
assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);

// Unknown VibeSchool cohort shape: sessions nested somewhere with a date field.
const cohort = { name: 'Oct A', schedule: { sessions: [{ id: 1, startAt: '2026-10-05T16:00:00Z' }, { id: 2, startAt: '2026-10-08T16:00:00Z' }] } };
const vs = findSessions(cohort).map((x) => normalize(x, 'vibeschool', cohort));
assert.equal(vs.length, 2);
assert.equal(vs[0].title, 'VibeSchool · Oct A');
assert.equal(vs[0].end - vs[0].start, 45 * 60000);
assert.ok(shouldNotify(vs[0], { ...s, keywords: 'nomatch' }), 'vibeschool always notifies');

assert.equal(countdown(45 * 60000), '45m');
assert.equal(countdown(125 * 60000), '2h05');
assert.equal(countdown(30 * 3600000), '1d');

console.log('all lib tests passed');
