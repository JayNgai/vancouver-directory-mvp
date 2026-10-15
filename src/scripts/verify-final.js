/**
 * Final verification for the multi-source pass: every route 200, detail pages render,
 * no unverifiable values leak, attribution includes all sources, pagination clamps.
 */
const http = require('http');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB = new DatabaseSync(path.join(__dirname, '..', '..', 'prisma', 'dev.db'), { readOnly: true });

function get(route) {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:5050' + route, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

(async () => {
  // five sample detail pages: licensed + serving hours, venue with opening hours, plain row,
  // a Phase 2 Overture addition, one with a confirmed description.
  const pick = (sql) => DB.prepare(sql).get();
  const samples = [
    pick("SELECT slug, name FROM businesses WHERE cityLicenceStatus='Issued' AND liquorServiceHours IS NOT NULL AND slug IS NOT NULL LIMIT 1"),
    pick("SELECT slug, name FROM businesses WHERE hours IS NOT NULL AND slug IS NOT NULL LIMIT 1"),
    pick("SELECT slug, name FROM businesses WHERE id LIKE 'overture-%' LIMIT 1"),
    pick("SELECT slug, name FROM businesses WHERE description IS NOT NULL AND slug IS NOT NULL LIMIT 1"),
    pick("SELECT slug, name FROM businesses WHERE website IS NOT NULL AND phone IS NOT NULL LIMIT 1")
  ].filter(Boolean);

  const routes = [
    '/api/health', '/', '/neighborhoods', '/businesses', '/businesses?page=2', '/businesses?page=9999',
    '/search?q=sushi', '/search?q=sushi&page=2', '/search?q=Gastown',
    '/neighborhoods/gastown', '/neighborhoods/commercial-drive', '/neighborhoods/mount-pleasant?page=2',
    '/itineraries', '/itineraries/gastown-historic-culinary-stroll',
    '/itineraries/kitsilano-beach-lifestyle-day', '/itineraries/downtown-culture-waterfront-sushi',
    '/concierge', '/claim', '/theme/sunset', '/api/businesses?search=cafe', '/api/itineraries',
    ...samples.map((s) => `/businesses/${s.slug}`)
  ];

  const FORBIDDEN = [
    [/★/, 'star rating glyph'],
    [/None reviews/, 'None review count'],
    [/Verified Local Spot/, 'verified badge wording'],
    [/\bundefined\b/, 'literal undefined'],
    [/#source-/, 'raw provenance tag'],
    [/NaN/, 'NaN'],
    [/\b\d\.\d\s*\(\d+ reviews\)/, 'rating with review count'],
    [/priceRange/, 'price field'],
    [/Mo-Fr\s|\bSu\b\s*\d{2}:\d{2}|\d{2}:\d{2}-\d{2}:\d{2}/, 'raw OSM hours code']
  ];
  const REQUIRED_PAGE = [
    [/Business listings &copy;/, 'OSM credit'],
    [/Open Database Licence/, 'ODbL wording'],
    [/overturemaps\.org/, 'Overture credit'],
    [/Open Government Licence &ndash; Vancouver/, 'City of Vancouver OGL'],
    [/Open Government Licence &ndash; British Columbia/, 'BC OGL']
  ];

  let failures = 0;
  let detailChecked = 0;
  for (const route of routes) {
    const { status, body } = await get(route);
    const problems = [];
    if (status !== 200) problems.push(`status ${status}`);
    for (const [pattern, label] of FORBIDDEN) if (pattern.test(body)) problems.push(label);
    if (!route.startsWith('/api/')) {
      for (const [pattern, label] of REQUIRED_PAGE) if (!pattern.test(body)) problems.push(`missing ${label}`);
    }
    if (route.startsWith('/businesses/') && !route.startsWith('/businesses/?') && !route.includes('page=')) {
      detailChecked++;
      for (const [pattern, label] of [[/See reviews on Google Maps/, 'maps link'],
                                      [/Own this business\? Claim it/, 'claim link'],
                                      [/class="breadcrumb"/, 'breadcrumb'],
                                      [/\/out\/click_maps_reviews\//, 'maps click relay'],
                                      [/\/out\/click_website\//, 'website click relay'],
                                      [/\/claim\?business=/, 'claim link carries the slug']]) {
        if (!pattern.test(body)) problems.push(`detail missing ${label}`);
      }
      if (/City of Vancouver licensed business/.test(body) && !/class="badge-licence"/.test(body)) {
        problems.push('licence badge without issued styling');
      }
    }
    if (route === '/businesses?page=9999') {
      const match = /Page (\d+) of (\d+)/.exec(body);
      if (!match || match[1] !== match[2]) problems.push(`out-of-range page not clamped (${match && match[0]})`);
    }
    if (problems.length) failures++;
    console.log(`${status} ${route}${problems.length ? ' | PROBLEMS: ' + problems.join(', ') : ''}`);
  }
  console.log(`detail pages checked: ${detailChecked}`);
  console.log(failures === 0 ? 'FINAL VERIFICATION OK' : `FINAL FAILURES=${failures}`);
  process.exit(failures === 0 ? 0 : 1);
})();
