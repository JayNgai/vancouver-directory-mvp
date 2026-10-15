/**
 * Polish-pass page verification: every route returns 200, attribution is on every page,
 * pagination works, and no unverifiable/raw values leak into the HTML.
 */
const http = require('http');

const BASE = process.env.BASE || 'http://localhost:5050';
const PAGES = [
  '/api/health', '/', '/neighborhoods', '/businesses', '/businesses?page=2',
  '/search?q=sushi', '/search?q=sushi&page=2', '/search?q=Gastown',
  '/neighborhoods/gastown', '/neighborhoods/commercial-drive', '/neighborhoods/mount-pleasant?page=2',
  '/itineraries', '/itineraries/gastown-historic-culinary-stroll',
  '/itineraries/kitsilano-beach-lifestyle-day', '/itineraries/downtown-culture-waterfront-sushi',
  '/concierge', '/claim', '/theme/sunset', '/api/businesses?search=cafe', '/api/itineraries'
];

const FORBIDDEN = [
  [/★\s*None/, 'star with None rating'],
  [/None reviews/, 'None review count'],
  [/Verified Local Spot/, 'verified badge'],
  [/undefined/i, 'literal undefined'],
  [/#source-openstreetmap/i, 'raw provenance tag shown'],
  [/NaN/, 'NaN value'],
  [/\[object Object\]/, 'unrendered object']
];

const REQUIRED_ON_ALL = [
  [/Business listings &copy;/, 'OSM credit line'],
  [/openstreetmap\.org\/copyright/, 'OSM copyright link'],
  [/Open Database Licence/, 'ODbL wording']
];

function get(path) {
  return new Promise((resolve, reject) => {
    const request = http.get(BASE + path, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (c) => { body += c; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    request.on('error', reject);
    request.setTimeout(30000, () => request.destroy(new Error('timeout')));
  });
}

(async () => {
  let failures = 0;
  for (const path of PAGES) {
    try {
      const { status, body } = await get(path);
      const problems = [];
      if (status !== 200) problems.push(`status ${status}`);
      for (const [pattern, label] of FORBIDDEN) if (pattern.test(body)) problems.push(label);
      // JSON API endpoints have no HTML footer, so the credit requirement applies to pages only.
      if (!path.startsWith('/api/')) {
        for (const [pattern, label] of REQUIRED_ON_ALL) if (!pattern.test(body)) problems.push(`missing ${label}`);
      }
      const cards = (body.match(/class="card"/g) || []).length;
      const pagination = /class="pagination-bar"/.test(body);
      const placeholder = (body.match(/card-img-placeholder/g) || []).length;
      if (problems.length) failures++;
      console.log(`${status} ${path} | cards=${cards} placeholders=${placeholder} pagination=${pagination}${problems.length ? ' | PROBLEMS: ' + problems.join(', ') : ''}`);
    } catch (error) {
      failures++;
      console.log(`ERROR ${path}: ${error.message}`);
    }
  }
  console.log(failures === 0 ? 'POLISH PAGES OK' : `POLISH FAILURES=${failures}`);
  process.exit(failures === 0 ? 0 : 1);
})();
