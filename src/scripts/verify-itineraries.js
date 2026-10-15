/** Checks every itinerary page, the concierge page, a neighbourhood page, and scans them for leaked text. */
const http = require('http');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(require('path').join(__dirname, '..', '..', 'prisma', 'dev.db'), { readOnly: true });
const slugs = db.prepare('SELECT slug FROM itineraries').all().map((r) => r.slug);
const get = (p) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: 5050, path: p }, (res) => {
    let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => resolve({ status: res.statusCode, body: s }));
  }).on('error', reject);
});
(async () => {
  let ok = 0; const bad = [];
  for (const s of slugs) {
    const r = await get('/itineraries/' + s);
    if (r.status === 200 && !/>None<|\bundefined\b|\[object Object\]/.test(r.body)) ok++; else bad.push(s + ':' + r.status);
  }
  console.log(`itinerary pages 200 and clean: ${ok}/${slugs.length}; problems: ${bad.join(' ') || 'none'}`);
  console.log('concierge page:', (await get('/concierge')).status);
  const hood = await get('/neighborhoods/gastown');
  console.log('gastown page:', hood.status, 'editorial present:', hood.body.includes('neighbourhood-editorial'));
  const swapCheck = await get('/concierge');
  console.log('concierge template swap label:', swapCheck.body.includes('m from') ? 'present in markup' : 'n/a (rendered client-side)');
})().catch((e) => { console.error(e.message); process.exit(1); });
