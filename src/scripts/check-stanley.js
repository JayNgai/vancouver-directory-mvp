/** Alfred's checks: routes, the Stanley Park concierge test, and the multi-intent prompt. */
const http = require('http');
const post = (activity) => new Promise((resolve) => {
  const d = JSON.stringify({ activity, duration: '2h', timeOfDay: 'afternoon', categories: [] });
  const r = http.request({ host: '127.0.0.1', port: 5050, path: '/api/concierge', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } }, (x) => {
    let s = ''; x.on('data', (c) => { s += c; }); x.on('end', () => resolve(JSON.parse(s)));
  });
  r.write(d); r.end();
});
const get = (p) => new Promise((resolve) => http.get({ host: '127.0.0.1', port: 5050, path: p }, (x) => { x.resume(); resolve(x.statusCode); }));
(async () => {
  for (const p of ['/', '/concierge', '/neighborhoods', '/neighborhoods/west-end', '/search?q=stanley', '/businesses?category=Outdoors%20%26%20Recreation', '/api/health']) {
    console.log(p, await get(p));
  }
  for (const a of ['walk in stanley park', 'coffee date then walk then dinner']) {
    const r = await post(a);
    const stops = r.data.steps.map((s) => `${s.time} ${s.business.name} [${s.business.category}]`).join(' -> ') || '(none)';
    console.log(`"${a}" -> ${stops}`);
  }
})();
