/**
 * Verifies the Directory server serves the pages and that no unverifiable data leaks
 * into the HTML (no "None" ratings, no verified badges, no price placeholders).
 */
const http = require('http');

const BASE = process.env.BASE || 'http://localhost:5050';
const PAGES = [
  '/api/health',
  '/',
  '/neighborhoods',
  '/businesses',
  '/search?q=sushi',
  '/search?q=Gastown',
  '/neighborhoods/gastown',
  '/neighborhoods/commercial-drive',
  '/neighborhoods/kitsilano',
  '/itineraries',
  '/itineraries/gastown-historic-culinary-stroll',
  '/itineraries/kitsilano-beach-lifestyle-day',
  '/itineraries/downtown-culture-waterfront-sushi',
  '/concierge',
  '/claim',
  '/theme/sunset',
  '/api/businesses?search=cafe',
  '/api/itineraries'
];

const FORBIDDEN = [
  [/★\s*None/, 'star with None rating'],
  [/None reviews/, 'None review count'],
  [/Verified Local Spot/, 'verified badge'],
  [/&bull;\s*<span/, 'stray separator markup'],
  [/brand:\s*None/, 'null price range'],
  [/undefined/i, 'literal undefined in HTML']
];

function get(path) {
  return new Promise((resolve, reject) => {
    const request = http.get(BASE + path, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    request.on('error', reject);
    request.setTimeout(30000, () => request.destroy(new Error('timeout')));
  });
}

(async () => {
  let failures = 0;
  const codes = [];
  for (const path of PAGES) {
    try {
      const { status, body } = await get(path);
      const hits = FORBIDDEN.filter(([pattern]) => pattern.test(body)).map(([, label]) => label);
      const placeholders = (body.match(/card-img-placeholder/g) || []).length;
      codes.push(`${status} ${path}`);
      if (status !== 200) failures++;
      if (hits.length) {
        failures++;
        console.log(`LEAK ${path}: ${hits.join(', ')}`);
      }
      if (path === '/neighborhoods/commercial-drive') {
        console.log(`  commercial-drive: placeholders=${placeholders} bytes=${body.length}`);
      }
      if (path === '/businesses' || path === '/search?q=sushi') {
        console.log(`  ${path}: placeholders=${placeholders} bytes=${body.length}`);
      }
    } catch (error) {
      failures++;
      codes.push(`ERROR ${path}: ${error.message}`);
    }
  }
  console.log(codes.join('\n'));
  console.log(failures === 0 ? 'ALL PAGES OK' : `FAILURES=${failures}`);
  process.exit(failures === 0 ? 0 : 1);
})();
