/** Verifies multi-intent planning through the live API for Alfred's prompts. */
const http = require('http');
const PROMPTS = [
  'coffee date then walk then dinner and movie',
  'sushi then cocktails',
  'bookstore then coffee',
  'coffee'
];
const post = (activity) => new Promise((resolve, reject) => {
  const data = JSON.stringify({ activity, duration: '4h', timeOfDay: 'afternoon', categories: [] });
  const req = http.request({ host: '127.0.0.1', port: 5050, path: '/api/concierge', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
    let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(s) }));
  });
  req.on('error', reject); req.write(data); req.end();
});
(async () => {
  for (const p of PROMPTS) {
    const { status, body } = await post(p);
    console.log(`\n"${p}" -> HTTP ${status} success=${body.success}`);
    if (!body.success) { console.log(body.error); continue; }
    const d = body.data;
    console.log(`  intents: ${d.meta.intents ? d.meta.intents.join(' | ') : '-'}`);
    console.log(`  stops: ${d.steps.map((s) => `${s.time} ${s.business.name} [${s.business.category}]`).join(' -> ') || '(none)'}`);
    if (d.meta.unfilledIntents && d.meta.unfilledIntents.length) console.log(`  no listings for: ${d.meta.unfilledIntents.join(', ')}`);
    if (d.meta.note) console.log(`  note: ${d.meta.note}`);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
