#!/usr/bin/env node
/**
 * THE TEST A STUB CANNOT DO: a REAL browser drives a drag-and-drop swap.
 *
 * It launches its own headless Chrome with its OWN profile dir, so it never touches the profile a human
 * is using (a locked profile is why this went unverified once already). It generates an itinerary
 * through the real form, then performs a swap with Chrome's real DragEvent + real DataTransfer against
 * the real delegated listeners, and checks the itinerary, the export URL and the route canvas.
 *
 * Needs: the app running, and Chrome installed. Held out of `npm test` on purpose - the default suite
 * stays offline-safe and fast.
 *
 * Run:  node src/scripts/browser-swap-e2e.js
 */

const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = path.join(os.tmpdir(), 'vd-chrome-proof');
const PORT = 9236, BASE = process.env.VD_BASE || 'http://127.0.0.1:5050';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, l, d) => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${l}${d ? '  ' + d : ''}`); if (!c) fails++; };

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--disable-gpu', '--disable-extensions', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch { await sleep(250); } }
  let page = null;
  for (let i = 0; i < 40; i++) { const ts = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); page = ts.find(t => t.type === 'page' && !/^chrome-extension/.test(t.url)); if (page) break; await sleep(250); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const events = []; const msgs = [];
  const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    if (m.method === 'Log.entryAdded') msgs.push(`[${m.params.entry.level}] ${m.params.entry.text}`);
  });
  await new Promise((r) => ws.addEventListener('open', r));
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  await send('Page.navigate', { url: BASE + '/concierge' });
  for (let i = 0; i < 60; i++) { if (events.includes('Page.loadEventFired')) break; await sleep(200); }
  await sleep(600);
  const ev = async (expr, ap = false) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: ap }); return r.exceptionDetails ? { __err: (r.exceptionDetails.exception || {}).description } : r.result.value; };
  await ev(`window.__errs=[]; window.addEventListener('error',e=>window.__errs.push(String(e.message))); window.__warns=[]; const _w=console.warn; console.warn=(...a)=>{window.__warns.push(a.join(' '));}; true`);

  await ev(`(()=>{const p=document.getElementById('prompt');p.value='coffee gastown';p.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('generateBtn').click();return true})()`);
  for (let i = 0; i < 50; i++) { if (await ev(`document.querySelectorAll('#swapOptions .swap-card').length`) > 0) break; await sleep(400); }
  await sleep(1000);

  const snap = async () => JSON.parse(await ev(`JSON.stringify({
    steps: [...document.querySelectorAll('#itinerarySteps .step-card strong')].map(s=>s.textContent).filter(t=>!/Est\\. time|Why here/.test(t)),
    exportHref: document.getElementById('exportGoogle').href,
    appleHref: document.getElementById('exportApple').href,
    pins: document.querySelectorAll('#routeMap .pin-badge').length,
    polyline: !!document.querySelector('#routeMap path.leaflet-interactive')
  })`));

  console.log('=== A. the map, after the getBounds fix ===');
  const a = await snap();
  console.log('  steps:', a.steps.join(' | '));
  ok(a.pins > 0, 'numbered pins render', `${a.pins}`);
  ok(a.polyline, 'the dashed polyline renders');
  ok(/google\.com\/maps/.test(a.exportHref), 'export URL populated');

  console.log('\n=== B. the DRAG path, through the real delegated listeners ===');
  const drag = JSON.parse(await ev(`(()=>{
    const card=document.querySelector('#swapOptions .swap-card');
    const step=document.querySelector('#itinerarySteps .step-card');
    const dt=new DataTransfer();
    const mk=(t,el)=>{const e=new DragEvent(t,{bubbles:true,cancelable:true});Object.defineProperty(e,'dataTransfer',{value:dt});return e;};
    card.dispatchEvent(mk('dragstart',card));
    const carried=[...dt.types];
    step.dispatchEvent(mk('dragover',step));
    step.dispatchEvent(mk('drop',step));
    card.dispatchEvent(mk('dragend',card));
    return JSON.stringify({carried, val:dt.getData('text/plain')});
  })()`));
  console.log('  dataTransfer after dragstart:', JSON.stringify(drag));
  await sleep(1000);
  const b = await snap();
  console.log('  steps now:', b.steps.join(' | '));
  ok(JSON.stringify(b.steps) !== JSON.stringify(a.steps), 'DRAG SWAP CHANGED THE ITINERARY');
  ok(b.exportHref !== a.exportHref, 'DRAG SWAP CHANGED THE EXPORT URL');
  ok(b.pins > 0 && b.polyline, 'THE MAP REDREW after the swap', `${b.pins} pins, polyline ${b.polyline}`);
  ok((await ev(`window.__warns`)).length === 0, 'no "drop carried no index" warning - the read succeeded');

  console.log('\n=== C. the TAP path ===');
  await ev(`(()=>{document.querySelector('#swapOptions .swap-card').dispatchEvent(new MouseEvent('click',{bubbles:true}));document.querySelector('#itinerarySteps .step-card').dispatchEvent(new MouseEvent('click',{bubbles:true}));return true})()`);
  await sleep(1000);
  const c = await snap();
  console.log('  steps now:', c.steps.join(' | '));
  ok(JSON.stringify(c.steps) !== JSON.stringify(b.steps), 'TAP SWAP CHANGED THE ITINERARY');
  ok(c.exportHref !== b.exportHref, 'and updated the export URL');

  console.log('\n=== D. hygiene ===');
  const csp = msgs.filter((m) => /script-src|inline event handler/i.test(m));
  ok(csp.length === 0, 'no CSP inline-handler violations', csp.length ? JSON.stringify(csp[0]).slice(0, 90) : '');
  console.log('  page errors:', JSON.stringify(await ev(`window.__errs`)));

  console.log('\n=== E. the OTHER consumer: the homepage Experience Studio dock ===');
  // studio.js is shared by /concierge and the homepage dock, so the swap must work on both.
  await send('Page.navigate', { url: BASE + '/' });
  events.length = 0;
  for (let i = 0; i < 80; i++) { if (events.includes('Page.loadEventFired')) break; await sleep(200); }
  await sleep(800);
  ok(await ev(`!!document.getElementById('studioDock')`), 'the dock is present on the homepage');
  await ev(`(()=>{const i=document.getElementById('dockPrompt');i.value='coffee gastown';i.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('dockPlan').click();return true})()`);
  for (let i = 0; i < 50; i++) { if (await ev(`document.querySelectorAll('#swapOptions .swap-card').length`) > 0) break; await sleep(400); }
  await sleep(900);
  const d0 = await ev(`JSON.stringify([...document.querySelectorAll('#itinerarySteps .step-card strong')].map(s=>s.textContent).filter(t=>!/Est\. time|Why here/.test(t)))`);
  const dh0 = await ev(`document.getElementById('exportGoogle').href`);
  ok(JSON.parse(d0).length > 0, 'the dock renders an itinerary through the shared surface', d0);
  await ev(`(()=>{
    const card=document.querySelector('#swapOptions .swap-card'); const step=document.querySelector('#itinerarySteps .step-card');
    const dt=new DataTransfer();
    const mk=(t,el)=>{const e=new DragEvent(t,{bubbles:true,cancelable:true});Object.defineProperty(e,'dataTransfer',{value:dt});return e;};
    card.dispatchEvent(mk('dragstart',card)); step.dispatchEvent(mk('dragover',step)); step.dispatchEvent(mk('drop',step)); card.dispatchEvent(mk('dragend',card)); return true;
  })()`);
  await sleep(900);
  const d1 = await ev(`JSON.stringify([...document.querySelectorAll('#itinerarySteps .step-card strong')].map(s=>s.textContent).filter(t=>!/Est\. time|Why here/.test(t)))`);
  const dh1 = await ev(`document.getElementById('exportGoogle').href`);
  ok(d1 !== d0, 'A DRAG SWAP WORKS ON THE HOMEPAGE DOCK');
  ok(dh1 !== dh0, 'and the dock export URL follows');

  // the live CSP header, which is what makes inline handlers inert
  const hdrs = await (await fetch(BASE + '/concierge')).headers;
  const cspHeader = hdrs.get('content-security-policy') || '';
  ok(/script-src-attr 'none'/.test(cspHeader), "the served CSP still carries script-src-attr 'none'",
    (cspHeader.match(/script-src-attr[^;]*/) || [''])[0]);

  console.log('\n=== F. the webfonts, under a CSP that blocks remote stylesheets ===');
  await send('Page.navigate', { url: BASE + '/concierge' });
  events.length = 0;
  for (let i = 0; i < 80; i++) { if (events.includes('Page.loadEventFired')) break; await sleep(200); }
  await sleep(1200);
  // NOTE ON THE ASSERTION: `document.fonts.check('600 ...')` is the WRONG probe here - a browser loads
  // only the faces a page actually uses, so a weight the CSS never asks for is legitimately "unloaded".
  // Assert the family the heading ASKS for, then prove the glyph is the real font by measuring: the
  // webfont and the fallback cannot have identical advance widths.
  const fontState = JSON.parse(await ev(`(async () => {
    await document.fonts.ready;
    // which families does the rendered page actually ASK for?
    const wanted = new Set();
    for (const el of document.querySelectorAll('body *')) {
      const fam = getComputedStyle(el).fontFamily || '';
      for (const name of ['Playfair Display', 'Outfit']) if (fam.includes(name)) wanted.add(name);
    }
    const sheet = [...document.styleSheets].map(s => s.href).filter(Boolean);
    const remoteSheets = sheet.filter(href => !href.startsWith(location.origin));
    const faces = [...document.fonts].length;
    const loadedFamilies = [...new Set([...document.fonts].filter(f => f.status === 'loaded').map(f => f.family))];
    // glyph proof: same string, same size, webfont vs a forced fallback
    await document.fonts.load('800 40px "Playfair Display"');
    const mk = (family) => {
      const sp = document.createElement('span');
      sp.textContent = 'Vancouver Directory';
      sp.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font-size:40px;font-weight:800;font-family:' + family;
      document.body.appendChild(sp);
      const w = Math.round(sp.getBoundingClientRect().width * 100) / 100;
      sp.remove();
      return w;
    };
    const webfont = mk("'Playfair Display', monospace");
    const fallback = mk('monospace');
    return JSON.stringify({ faces, wanted: [...wanted], loadedFamilies, remoteSheets, webfont, fallback,
                            differs: Math.abs(webfont - fallback) > 1 });
  })()`, true));
  console.log('  @font-face rules registered:', fontState.faces);
  console.log('  families the page asks for:', fontState.wanted.join(', ') || '(none)');
  console.log('  families the browser loaded:', fontState.loadedFamilies.join(', ') || '(none)');
  console.log('  remote stylesheets loaded:', fontState.remoteSheets.length ? fontState.remoteSheets : '(none - all same-origin)');
  console.log(`  glyph width: webfont ${fontState.webfont} vs fallback ${fontState.fallback}`);
  ok(fontState.faces > 0, 'the vendored faces are registered with the document');
  ok(fontState.wanted.includes('Playfair Display') && fontState.wanted.includes('Outfit'),
    'the page still ASKS for both intended families', fontState.wanted.join(', '));
  const neverLoaded = fontState.wanted.filter((f) => !fontState.loadedFamilies.includes(f));
  ok(neverLoaded.length === 0, 'every family the page asks for is actually LOADED (not silently falling back)',
    neverLoaded.length ? 'missing: ' + neverLoaded.join(', ') : 'all loaded');
  ok(fontState.loadedFamilies.length > 0, 'the browser actually loaded a vendored family', fontState.loadedFamilies.join(','));
  ok(fontState.differs, 'the rendered glyph is the VENDORED font, not a system fallback', `${fontState.webfont} vs ${fontState.fallback}`);
  ok(fontState.remoteSheets.length === 0, 'no third-party stylesheet is fetched for fonts');
  const fontViol = msgs.filter((m) => /fonts\.googleapis|fonts\.gstatic/.test(m));
  ok(fontViol.length === 0, 'no Google Fonts CSP violation in the console', fontViol.length ? JSON.stringify(fontViol[0]).slice(0, 80) : '');
  const res = await send('Performance.getMetrics').catch(() => null);
  const woof = await ev(`(() => { const e = performance.getEntriesByType('resource').filter(r => r.name.includes('/vendor/fonts/')); return JSON.stringify({ count: e.length, bytes: e.reduce((a,b)=>a+(b.transferSize||0),0) }); })()`);
  console.log('  vendored font requests:', woof);
  ok(JSON.parse(woof).count > 0, 'the page actually fetches the vendored .woff2 files');

  console.log('\n=== G. the search filter that was ALSO dead (onchange) ===');
  await send('Page.navigate', { url: BASE + '/search?q=coffee' });
  events.length = 0;
  for (let i = 0; i < 80; i++) { if (events.includes('Page.loadEventFired')) break; await sleep(200); }
  await sleep(600);
  const sel = await ev(`(() => { const s = document.querySelector('select[data-autosubmit]'); if (!s) return JSON.stringify({none:true}); return JSON.stringify({ options: s.options.length, second: s.options[1] ? s.options[1].value : '' }); })()`);
  console.log('  select:', sel);
  const selInfo = JSON.parse(sel);
  ok(!selInfo.none, 'the category select is marked data-autosubmit');
  if (!selInfo.none && selInfo.second) {
    await ev(`(() => { const s = document.querySelector('select[data-autosubmit]'); s.value = ${JSON.stringify(selInfo.second)}; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await sleep(1500);
    const url = await ev(`location.search`);
    console.log('  url now:', url);
    ok(url.includes('category='), 'changing the filter NAVIGATES (the autosubmit actually fires)', url);
  }
  const searchViol = msgs.filter((m) => /inline event handler/i.test(m));
  ok(searchViol.length === 0, 'no inline-handler CSP violation on the search page');

  console.log(`\nRESULT: ${fails === 0 ? 'ALL PASS' : fails + ' FAILURE(S)'}`);
  ws.close(); try { chrome.kill('SIGKILL'); } catch {}
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {}
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
setTimeout(() => { console.error('HARD TIMEOUT'); process.exit(2); }, 110000);
