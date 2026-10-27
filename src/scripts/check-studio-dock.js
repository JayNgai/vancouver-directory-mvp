/**
 * Guards the homepage Experience Studio dock.
 *
 * The chips are read from the SERVED PAGE, not from a copy of the payloads - so a chip that is
 * mistyped in the template, or a neighbourhood slug that stops resolving, fails here.
 *
 * The guard starts its OWN server and shuts it down, so `npm test` is self-contained. It used to
 * default to port 5050 and quietly tested whatever happened to be listening there - which meant a
 * green run proved something about a stale process, and a red run could mean nothing at all.
 * Set STUDIO_BASE to point it at an already-running instance instead.
 *
 * Run:  node src/scripts/check-studio-dock.js
 */
const fs = require('fs'), path = require('path');
const { spawn } = require('child_process');

let serverChild = null;
let BASE = process.env.STUDIO_BASE || '';

async function ensureServer() {
  if (BASE) return BASE;
  const port = 4900 + Math.floor(Math.random() * 90);
  const root = path.join(__dirname, '..', '..');
  serverChild = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test' },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`${base}/`);
      if (r.status === 200) { BASE = base; return base; }
    } catch (error) { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server did not become ready on ${port}`);
}

function shutdown(code) {
  if (serverChild) { try { serverChild.kill('SIGKILL'); } catch (error) { /* already gone */ } }
  process.exit(code);
}

let failures = 0;
const check = (cond, label, detail) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
  if (!cond) failures++;
};

(async () => {
  await ensureServer();
  const html = await (await fetch(`${BASE}/`)).text();

  console.log('--- the dock is on the homepage ---');
  check(/id="studioDock"/.test(html), 'the dock is present');
  const modes = [...html.matchAll(/class="dock-mode"[^>]*data-mode="([^"]+)"/g)].map((m) => m[1]);
  check(modes.length === 3, 'three modes', modes.join(', '));
  check(['curate', 'search', 'browse'].every((m) => modes.includes(m)), 'curate / search / browse all present');
  check(/id="dockSearch"[\s\S]*?action="\/search"/.test(html), 'Search Directory mode still holds the classic search form');

  console.log('\n--- the results surface is inlined and NOT duplicated ---');
  for (const id of ['resultsArea', 'routeMap', 'exportRow', 'swapOptions']) {
    const n = (html.match(new RegExp(`id="${id}"`, 'g')) || []).length;
    check(n === 1, `exactly one #${id}`, `${n}`);
  }
  check(/\/studio\.js/.test(html), 'the shared renderer is loaded');

  console.log('\n--- every SERVED chip returns a real, in-neighbourhood itinerary ---');
  const chips = [...html.matchAll(/data-activity="([^"]*)" data-hood="([^"]*)" data-duration="([^"]*)" data-time="([^"]*)"/g)]
    .map((m) => ({ activity: m[1], neighborhoodId: m[2], duration: m[3], timeOfDay: m[4] }));
  check(chips.length === 4, 'four chips found in the served markup', String(chips.length));

  for (const chip of chips) {
    const r = await fetch(`${BASE}/api/concierge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(chip),
    });
    const json = await r.json();
    const steps = (json.data && json.data.steps) || [];
    check(r.status === 200 && steps.length >= 1, `"${chip.activity}" @ ${chip.neighborhoodId} -> ${steps.length} step(s)`,
      steps.map((s) => s.business && s.business.name).join(' -> '));
    if (steps.length) {
      const coords = steps.filter((s) => s.business && s.business.latitude != null).length;
      check(coords === steps.length, '  every stop has coordinates (the map needs them)', `${coords}/${steps.length}`);
      // A chip must return the neighbourhood it advertises, or it is decoration.
      const hoods = [...new Set(steps.map((s) => s.business.neighborhood && s.business.neighborhood.slug).filter(Boolean))];
      if (hoods.length) {
        check(hoods.includes(chip.neighborhoodId), `  all stops are inside ${chip.neighborhoodId}`, hoods.join(', '));
      }
    }
  }


  // ---- the dock's own inline script, which a 200 response does not prove is even valid JS ----
  console.log('\n--- the served dock script parses and resolves ---');
  const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const inline = inlineScripts.length ? inlineScripts[inlineScripts.length - 1] : '';
  check(inline.length > 0, 'the dock ships an inline script');
  const tmp = path.join(require('os').tmpdir(), `dock-guard-${process.pid}.js`);
  fs.writeFileSync(tmp, inline);
  let parses = true, parseErr = '';
  try { require('child_process').execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); }
  catch (e) { parses = false; parseErr = String(e.stderr || e.message).split('\n')[0]; }
  fs.rmSync(tmp, { force: true });
  check(parses, 'node --check accepts it (a syntax error still returns HTTP 200)', parseErr);

  const usedIds = [...new Set([...inline.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]))];
  const declaredIds = [...new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]))];
  check(usedIds.every((i) => declaredIds.includes(i)), 'every id the dock script looks up exists on the page',
    usedIds.filter((i) => !declaredIds.includes(i)).join(', ') || usedIds.length + ' checked');

  const usedSel = [...new Set([...inline.matchAll(/querySelector(?:All)?\('\.([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1]))];
  for (const cls of usedSel) {
    check(new RegExp(`class="[^"]*\\b${cls}\\b`).test(html), `  ".${cls}" matches real markup`);
  }


  // ---- THE ACTUAL REQUIREMENT: never two search inputs on one screen ----
  // The dock replaces the hero search; the navbar keeps its own form for sub-pages. What satisfies the
  // requirement is that the navbar copy is HIDDEN while the dock is on screen. Testing that the dock
  // renders does not test this - so drive the real inline code with a stubbed IntersectionObserver and
  // assert the visibility it sets.
  console.log('\n--- the real requirement: one search input on screen at a time ---');
  const ioCallbacks = [];
  class IOStub { constructor(cb) { ioCallbacks.push(cb); } observe() {} }
  const stubEls = {};
  const anyEl = (id) => (stubEls[id] = stubEls[id] || {
    id, style: {}, dataset: {}, value: '', hidden: false, disabled: false, textContent: '',
    addEventListener() {}, setAttribute() {}, getAttribute() { return null; },
    scrollIntoView() {}, classList: { add() {}, remove() {}, contains() { return false; } },
  });
  const navSearchEl = { style: {} };
  const stubDoc = {
    getElementById: anyEl,
    querySelector: (sel) => (sel === '.nav-search' ? navSearchEl : null),
    querySelectorAll: () => [],
    addEventListener() {},
  };
  const stubWindow = { IntersectionObserver: IOStub };
  const stubStudio = { setData() {}, show() {}, render() {} };

  let ran = true, runErr = '';
  try {
    // eslint-disable-next-line no-new-func
    new Function('document', 'IntersectionObserver', 'fetch', 'window', 'Studio', inline + '\nreturn true;')(
      stubDoc, IOStub, () => new Promise(() => {}), stubWindow, stubStudio);
  } catch (e) { ran = false; runErr = e.message; }
  check(ran, 'the served dock script executes without throwing', runErr);

  check(ioCallbacks.length === 1, 'the dock observes itself for visibility', `${ioCallbacks.length} observer(s)`);
  if (ioCallbacks.length === 1) {
    ioCallbacks[0]([{ isIntersecting: true }]);
    check(navSearchEl.style.visibility === 'hidden',
      'navbar search is HIDDEN while the dock is in view  <-- the requirement');
    ioCallbacks[0]([{ isIntersecting: false }]);
    check(navSearchEl.style.visibility === 'visible',
      'and returns once the dock scrolls away (sub-page behaviour preserved)');
  }

  // Structurally: the page holds exactly TWO search forms - the navbar's and the dock's - and the
  // dock's sits inside a panel that is hidden by default, so only one is ever on screen at rest.
  // (The dock's form living inside the hero is correct; it is the DEFAULT that matters.)
  const forms = (html.match(/action="\/search"/g) || []).length;
  check(forms === 2, 'exactly two search forms exist: the navbar copy and the dock\'s', `${forms} found`);
  check(/id="dockSearch"[^>]*\shidden/.test(html) || /id="dockSearch"[^>]*hidden>/.test(html),
    'the dock\'s Search Directory panel is hidden by DEFAULT (so it is not a second search box at rest)');

  console.log(`\nRESULT: ${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
  shutdown(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR:', e.message); shutdown(1); });
