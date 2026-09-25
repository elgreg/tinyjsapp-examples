// Minimal tiny.js bridge stand-in, so the REAL pages (index.html/app.js,
// crumbs.html, poop.html) run in headless Chrome via the puppeteer MCP.
// Load it before the page's own scripts. Query params:
//   ?sp=bear        species boot() reports        &win=main|c0|o0  window id
//   &count=10       crumb/salmon count at boot    &on=1            poop visible
// Drive it from puppeteer_evaluate:
//   push('bird', { who: 'main', state: 'walk' })
//   push('look', { who: 'main', x: 1, y: -0.2, dir: 1, moving: true, fast: false })
//   push('say', { kind: 'coo', pan: 0, vol: 0.6 })  → logs 'play <clip>'
//   push('species', { species: 'finch' }) · push('crumbs', { win: 'c0', count: 5 })
//   logs  → array of 'load <name>' / 'play <name>' / 'ERR …' / 'LOG …'
// Screenshot latency is seconds, so freeze short poses instead of racing them:
//   setInterval(() => { poopT = clock.elapsedTime - 0.5; }, 16)   // hold the squat
const handlers = {}; window.logs = [];
const Q = new URLSearchParams(location.search);
window.tiny = {
  win: { id: Q.get('win') || 'main' },
  log: (m) => logs.push('LOG ' + m),
  api: {
    on: (ev, fn) => { (handlers[ev] ||= []).push(fn); return () => {}; },
    call: async (m) => m === 'boot'
      ? { state: 'idle', species: Q.get('sp') || 'pigeon', env: { sun: { x: 980, y: -520 } },
          count: +(Q.get('count') || 10), fresh: true, on: Q.get('on') === '1' }
      : null,
  },
  audio: { sampler: {
    load: async (n) => { logs.push('load ' + n); },
    play: async (n) => { logs.push('play ' + n); },
  } },
  system: { capabilities: async () => ({}) },
  store: { get: async () => null, set: async () => {} },
  dialog: { confirm: async () => false },
};
window.push = (ev, p) => (handlers[ev] || []).forEach((f) => f(p));
window.onerror = (m) => logs.push('ERR ' + m);
