#!/usr/bin/env node
/**
 * Category variety, and the duration actually being honoured.
 *
 * WHY: the baseline returned four cafés in a row for a three-hour request, and
 * ran 3h20m doing it. Two separate defects with one shared cause — the planner
 * took the nearest matching venue every time and budgeted dwell without ever
 * paying for the walking, so the route drifted into repetition and overshoot.
 *
 * Both are pure functions, so this needs no database and no browser.
 *
 * Run: node src/scripts/check-concierge-variety.js
 */
const { diversifyRoute, formatClock } = require('../lib/concierge');

let fails = 0;
const ok = (c, label, detail) => {
  console.log(`  ${c ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
  if (!c) fails++;
};

// ---------------------------------------------------------------------------
// a synthetic cluster: cafés and restaurants interleaved, all walkable
// ---------------------------------------------------------------------------
const at = (i) => ({ latitude: 49.283 + i * 0.0006, longitude: -123.108 + i * 0.0004 });
const biz = (id, name, category, i) => ({ id, name, category, primaryCategory: category, ...at(i) });

const pool = [
  biz('c1', 'Cafe One', 'Cafe', 0),
  biz('c2', 'Cafe Two', 'Cafe', 1),
  biz('c3', 'Cafe Three', 'Cafe', 2),
  biz('c4', 'Cafe Four', 'Cafe', 3),
  biz('r1', 'Restaurant One', 'Restaurant', 4),
  biz('b1', 'Bar One', 'Bar / Pub', 5),
];

console.log('--- 1. three repeats in a row get broken up ---');
const allCafes = [pool[0], pool[1], pool[2], pool[3]];
const broken = diversifyRoute(allCafes, pool, false);
const categories = broken.map((b) => b.category);
let longestRun = 1;
let run = 1;
for (let i = 1; i < categories.length; i += 1) {
  run = categories[i] === categories[i - 1] ? run + 1 : 1;
  longestRun = Math.max(longestRun, run);
}
ok(broken.length === allCafes.length, 'the route keeps the same number of stops', `${broken.length}`);
ok(longestRun <= 2, 'no more than 2 consecutive stops share a category', categories.join(' → '));
ok(new Set(broken.map((b) => b.id)).size === broken.length, 'no venue appears twice after the swap');

console.log('\n--- 2. an explicit crawl is left alone ---');
const crawl = diversifyRoute(allCafes, pool, true);
ok(crawl.map((b) => b.category).join(',') === 'Cafe,Cafe,Cafe,Cafe',
  'a "coffee crawl" stays four cafés — repetition is the request', crawl.map((b) => b.category).join(' → '));

console.log('\n--- 3. it degrades instead of throwing ---');
const twoStops = diversifyRoute([pool[0], pool[1]], pool, false);
ok(twoStops.length === 2, 'a 2-stop route is returned untouched');
const sameOnly = [pool[0], pool[1], pool[2]];
const onlyCafes = diversifyRoute(sameOnly, [pool[0], pool[1], pool[2]], false);
ok(onlyCafes.length === 3, 'when nothing else exists, the repeat is kept rather than dropping a stop', `${onlyCafes.length} stops`);
ok(Array.isArray(diversifyRoute([], pool, false)), 'an empty route returns an empty array');

console.log('\n--- 4. the clock formatter the reasons quote is sane ---');
ok(formatClock(0) === '12:00 AM', 'midnight formats as 12:00 AM', formatClock(0));
ok(formatClock(13 * 60) === '1:00 PM', '13:00 formats as 1:00 PM', formatClock(13 * 60));
ok(formatClock(1440 + 65) === '1:05 AM', 'a past-midnight time wraps', formatClock(1505));

console.log(`\n${fails === 0 ? 'OK' : 'FAILED'} — ${fails} problem(s)`);
process.exit(fails === 0 ? 0 : 1);
