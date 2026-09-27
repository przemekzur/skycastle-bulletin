// Dev-only fake of the chrome.* APIs the popup uses, with sample sessions relative to "now".
(() => {
  const h = 3600000, now = Date.now();
  const at = (offsetH, minute = 0) => { const d = new Date(now + offsetH * h); d.setMinutes(minute, 0, 0); return d.getTime(); };
  const ev = (id, title, host, start, mins = 60, source = 'bulletin') =>
    ({ id: `${source}:${id}`, source, title, host, summary: '', start, end: start + mins * 60000, status: 'scheduled', joinUrl: '' });
  const store = {
    fetchedAt: now - 4 * 60000,
    settings: {},
    events: [
      ev(1, 'Onboarding & Hangout', 'Andrea, Ninfa & Guadi', at(-0.5, 0)),
      ev(2, 'Agentic AI Inflection Point & Weekly Updates', 'Richard Werbe', at(2)),
      ev(3, 'Growth Hack X^2', 'Kayne, Andrea and Troy', at(26)),
      ev(4, 'Onboarding & Hangout', 'Andrea, Guadi, Ninfa', at(22)),
      ev(5, 'The Agentic Tech Corner', '', at(50)),
      ev(6, 'Session 1 — First Magic', 'Richard & Troy', at(73, 30), 45, 'vibeschool'),
      ev(7, 'Review My Social', 'Troy', at(76)),
    ],
  };
  const listeners = [];
  window.chrome = {
    storage: {
      local: {
        get: async (keys) => Object.fromEntries([].concat(keys).map((k) => [k, store[k]])),
        set: async (obj) => { Object.assign(store, obj); listeners.forEach((f) => f()); },
      },
      onChanged: { addListener: (f) => listeners.push(f) },
    },
    runtime: {
      sendMessage: async (m) => {
        if (m.type === 'refresh') { await new Promise((r) => setTimeout(r, 600)); await chrome.storage.local.set({ fetchedAt: Date.now() }); }
        return { ok: true };
      },
    },
  };
})();
