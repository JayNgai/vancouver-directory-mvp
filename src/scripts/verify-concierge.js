/** Functional check of the Smart Concierge API and a search page after the truth pass. */
const http = require('http');

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({ host: 'localhost', port: 5050, method, path,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {} },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

(async () => {
  const concierge = await request('POST', '/api/concierge', { activity: 'coffee', duration: '4h', timeOfDay: 'morning' });
  const parsed = JSON.parse(concierge.body);
  console.log('concierge status', concierge.status, 'steps', parsed.data.steps.length, 'swaps', parsed.data.swapOptions.length);
  const first = parsed.data.steps[0];
  console.log('step1:', JSON.stringify({
    time: first.time, why: first.why, name: first.business.name, address: first.business.address,
    rating: first.business.rating, reviewCount: first.business.reviewCount, priceRange: first.business.priceRange,
    isVerified: first.business.isVerified, photos: first.business.photos, hours: first.business.hours
  }, null, 2));
  console.log('any null-rating leak in why text:', /null|undefined/.test(JSON.stringify(parsed.data)));

  const search = await request('GET', '/search?q=Chinatown');
  const hits = (search.body.match(/Chinatown/g) || []).length;
  const stars = (search.body.match(/★\s*None/g) || []).length;
  const verifiedBadge = (search.body.match(/Verified Local Spot/g) || []).length;
  const priced = (search.body.match(/\$\$\$|\$\$\s|\$\s/g) || []).length;
  console.log(`search Chinatown: status=${search.status} mentions=${hits} star-none=${stars} verified-badge=${verifiedBadge} price-tokens=${priced}`);

  const borough = await request('GET', '/api/businesses?search=Chinatown');
  const list = JSON.parse(borough.body);
  console.log('api businesses for Chinatown:', list.count, 'first:', list.data[0] && list.data[0].name, '| verified flags:', list.data.filter((b) => b.isVerified).length);
})();
