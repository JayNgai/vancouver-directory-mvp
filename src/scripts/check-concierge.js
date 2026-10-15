/** Exercises the concierge endpoint with fixed inputs and prints the itinerary for review. */
const http = require('http');
const CASES = [
  { activity: 'coffee', duration: '4h', timeOfDay: 'morning' },
  { activity: 'sushi', duration: '2h', timeOfDay: 'evening' },
  { activity: 'shopping books', duration: '4h', timeOfDay: 'afternoon' },
  { activity: '', duration: '8h', timeOfDay: 'flexible' }
];
function post(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: 5050, path: '/api/concierge', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(s) }));
    });
    req.on('error', reject); req.write(data); req.end();
  });
}
(async () => {
  for (const c of CASES) {
    const { status, body } = await post(c);
    console.log(`\n=== ${JSON.stringify(c)} -> HTTP ${status}`);
    if (!body.success) { console.log('ERROR', body.error); continue; }
    const d = body.data;
    console.log(`stops=${d.steps.length} fallback=${d.meta.usedFallback} note=${d.meta.note || '-'}`);
    d.steps.forEach((s) => console.log(`  ${s.time} | ${s.business.name} [${s.business.neighborhood && s.business.neighborhood.name}] walk->next ${s.walkToNextMinutes ?? '-'}min`));
    d.steps.forEach((s) => console.log(`    why: ${s.why.slice(0, 170)}`));
    console.log('  swaps: ' + d.swapOptions.map((o) => `${o.name} (${o.distanceFromStopMetres} m from ${o.swapForStop})`).join('; '));
  }
})().catch((e) => { console.error('failed:', e.message); process.exit(1); });
