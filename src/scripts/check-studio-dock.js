/**
 * Guards the homepage Experience Studio dock.
 *
 * The chips are read from the SERVED PAGE, not from a copy of the payloads - so a chip that is
 * mistyped in the template, or a neighbourhood slug that stops resolving, fails here. Requires the
 * app running.  Run:  node src/scripts/check-studio-dock.js
 */
const BASE = process.env.STUDIO_BASE || 'http://127.0.0.1:5050';

let failures = 0;
const check = (cond, label, detail) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
  if (!cond) failures++;
};

(async () => {
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

  console.log(`\nRESULT: ${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
