/**
 * Guards the neighbourhood-scoping contract of POST /api/concierge.
 *
 * WHY THIS EXISTS — the bug it prevents, and the bug it is NOT:
 * A neighbourhood reaches the endpoint under TWO legitimate names. This site's own <select> sends the
 * row id; a hand-authored payload — the Experience Studio preset chips — sends the slug. The engine
 * scopes on the id. So a SLUG used to scope the pool to nothing, fire the fallback with nothing to
 * fill, and return success=true with ZERO steps: a chip that opens nothing, reported as a success.
 * That silent-empty success is how a broken chip ships unnoticed.
 *
 * The engine was never broken — it returns 4 steps for a real id. The defect was that an unrecognised
 * value was indistinguishable from a legitimately empty result, and that slugs were unusable.
 *
 * Requires the app to be running. Run:  node src/scripts/check-concierge-hoods.js
 */
const BASE = process.env.CONCIERGE_BASE || 'http://127.0.0.1:5050';

// The four preset chips. These are the REVISED single-intent payloads (Gus, slice 3): the original
// drafts carried multi-term activity strings ("beer pizza pub"), and the engine collapses a multi-term
// string to ONE term, so they returned the wrong venues while looking healthy. Single terms resolve
// correctly. Each chip now carries the intent it is named for, plus the one category it must contain.
const CHIPS = [
  { name: 'Gastown Coffee & Bakery', body: { activity: 'coffee', neighborhoodId: 'gastown', duration: '2h', timeOfDay: 'morning' } },
  { name: 'Yaletown Cocktails & Dinner', body: { activity: 'cocktails', neighborhoodId: 'yaletown', duration: '4h', timeOfDay: 'evening' } },
  { name: 'Kitsilano Beach & Ice Cream', body: { activity: 'ice cream', neighborhoodId: 'kitsilano', duration: '4h', timeOfDay: 'afternoon' } },
  { name: 'Commercial Drive Craft Beer', body: { activity: 'beer', neighborhoodId: 'commercial-drive', duration: '4h', timeOfDay: 'evening' }, expectCategory: /bar \/ pub/i },
];

let failures = 0;
const check = (cond, label, detail) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
  if (!cond) failures++;
};

async function post(body) {
  const r = await fetch(`${BASE}/api/concierge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

(async () => {
  console.log(`POST ${BASE}/api/concierge\n`);

  // --- 1. the four chips must return REAL itineraries, not decoration ---
  console.log('--- preset chips (each carries a SLUG) ---');
  for (const chip of CHIPS) {
    const { status, json } = await post(chip.body);
    const steps = (json.data && json.data.steps) || [];
    const stops = steps.map(s => s.business && s.business.name).filter(Boolean);
    const withCoords = steps.filter(s => s.business && s.business.latitude != null && s.business.longitude != null).length;
    check(status === 200 && steps.length >= 1, `${chip.name}  -> ${steps.length} step(s)`,
      steps.length ? `[${stops.join(' -> ')}]` : '');
    if (steps.length) {
      check(withCoords === steps.length, `  every stop has coordinates (the map needs them)`,
        `${withCoords}/${steps.length}`);
      // The chip must deliver the thing it is NAMED for, not merely four rows. A chip called
      // "Craft Beer" that returns four pizzerias is the same defect class as a silent empty result:
      // it looks healthy and is wrong.
      if (chip.expectCategory) {
        const hits = steps.filter(s => chip.expectCategory.test(String((s.business && s.business.category) || ''))).length;
        check(hits >= 1, `  the chip delivers what it is named for`, `${hits}/${steps.length} match ${chip.expectCategory}`);
      }
    }
  }

  // --- 2. the id form must keep working (this is what the live page sends) ---
  console.log('\n--- the id form (what the page\'s own <select> sends) ---');
  const hoodsRes = await fetch(`${BASE}/api/neighborhoods`);
  const hoods = ((await hoodsRes.json()).data) || [];
  const gastown = hoods.find(h => h.slug === 'gastown');
  if (!gastown) {
    check(false, 'could not load /api/neighborhoods to find gastown');
  } else {
    const { json } = await post({ activity: 'coffee bakery art', neighborhoodId: gastown.id, duration: '2h' });
    const steps = (json.data && json.data.steps) || [];
    check(steps.length >= 1, `real id (${gastown.id}) -> ${steps.length} step(s)`);
  }

  // --- 3. an UNKNOWN neighbourhood must FAIL LOUDLY, never return an empty success ---
  console.log('\n--- unknown value must be an ERROR, not a silent empty itinerary ---');
  const bogus = await post({ activity: 'coffee bakery art', neighborhoodId: 'not-a-real-hood', duration: '2h' });
  check(bogus.status === 400, `unknown slug -> HTTP ${bogus.status} (expect 400)`);
  check(bogus.json.success === false, 'success is false, not a cheerful empty result',
    JSON.stringify(bogus.json.error || ''));

  // --- 4. no neighbourhood at all still works ---
  console.log('\n--- no neighbourhood scoping ---');
  const any = await post({ activity: 'coffee bakery art', duration: '2h' });
  const anySteps = (any.json.data && any.json.data.steps) || [];
  check(anySteps.length >= 1, `no neighborhoodId -> ${anySteps.length} step(s)`);

  console.log(`\nRESULT: ${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });