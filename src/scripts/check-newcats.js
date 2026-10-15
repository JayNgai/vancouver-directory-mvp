/** Concierge check for Alfred's new category queries, plus route and dup checks. */
const http = require('http');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const post = (activity, duration = '4h', timeOfDay = 'flexible') => new Promise((resolve, reject) => {
  const data = JSON.stringify({ activity, duration, timeOfDay });
  const req = http.request({ host: '127.0.0.1', port: 5050, path: '/api/concierge', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
    let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => resolve(JSON.parse(s)));
  });
  req.on('error', reject); req.write(data); req.end();
});
const get = (p) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: 5050, path: p }, (res) => {
    let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => resolve({ status: res.statusCode, body: s }));
  }).on('error', reject);
});
(async () => {
  for (const q of ['museum downtown', 'spa kitsilano', 'park', 'shopping', 'dog-friendly patio']) {
    const r = await post(q);
    const d = r.data;
    console.log(`\n"${q}" -> success=${r.success} stops=${d.steps.length} fallback=${d.meta.usedFallback} matched=${d.meta.matchedKeywords.join(',') || '-'} note=${d.meta.note || '-'}`);
    d.steps.slice(0, 4).forEach((s) => console.log(`  ${s.time} ${s.business.name} [${s.business.category}] (${s.business.neighborhood.name})`));
  }
  const routes = ['/', '/neighborhoods', '/neighborhoods/gastown', '/concierge', '/search?q=museum', '/itineraries/gastown-coffee', '/privacy', '/api/health'];
  for (const r of routes) console.log(r, (await get(r)).status);
  const db = new DatabaseSync(path.join(__dirname, '..', '..', 'prisma', 'dev.db'), { readOnly: true });
  console.log('events/claims/revenue:', db.prepare('select (select count(*) from events) e, (select count(*) from claims) c, (select count(*) from revenue_entries) r').get());
})().catch((e) => { console.error(e.message); process.exit(1); });
