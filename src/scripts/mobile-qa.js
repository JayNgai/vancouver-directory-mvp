// Mobile QA: drives headless Edge over CDP with a true 375px / 768px viewport.
// Reports horizontal overflow (scrollWidth vs viewport) per page and saves screenshots.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'C:/Users/jayng/AppData/Local/hermes/profiles/engineer/cache/scratch/shots2';
const PORT = 9333;
const BASE = 'http://127.0.0.1:5050';
const PAGES = process.argv.slice(2).length ? process.argv.slice(2) : ['/', '/neighborhoods', '/neighborhoods/west-end', '/businesses', '/businesses/a-bread-affair-node-3698942864', '/search?q=coffee', '/itineraries', '/itineraries/chinatown-bar', '/claim', '/privacy', '/concierge'];
const WIDTHS = [375, 768];
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`, '--user-data-dir=C:/Users/jayng/AppData/Local/hermes/profiles/engineer/cache/scratch/shots-profile2', 'about:blank'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 2500));
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } });
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable');
  const report = [];
  for (const w of WIDTHS) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 600 });
    for (const p of PAGES) {
      await send('Page.navigate', { url: BASE + p });
      await new Promise((r) => setTimeout(r, 1800));
      const r = await send('Runtime.evaluate', { expression: `(() => { const de = document.documentElement; const wide = [...document.querySelectorAll('body *')].filter(e => { const b = e.getBoundingClientRect(); return b.right > innerWidth + 1 && b.width > 0; }).slice(0, 4).map(e => (e.className && e.className.baseVal === undefined ? e.tagName + '.' + String(e.className).split(' ')[0] : e.tagName) + ' right=' + Math.round(e.getBoundingClientRect().right)); return JSON.stringify({ vw: innerWidth, scrollW: de.scrollWidth, overflowPx: de.scrollWidth - innerWidth, wide }); })()`, returnByValue: true });
      const info = JSON.parse(r.result.result.value);
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const name = `w${w}_${p.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'home'}.png`;
      fs.writeFileSync(path.join(OUT, name), Buffer.from(shot.result.data, 'base64'));
      report.push(`${w}px ${p} -> viewport ${info.vw}, scrollWidth ${info.scrollW}, overflow ${info.overflowPx}px${info.wide.length ? ' | wide: ' + info.wide.join('; ') : ''}`);
    }
  }
  console.log(report.join('\n'));
  ws.close(); proc.kill();
  process.exit(0);
})().catch((e) => { console.error('QA ERROR', e); process.exit(1); });
