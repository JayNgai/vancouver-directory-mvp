/** End-to-end display spot-check on real pages: attribution, plain-English hours, phone format. */
const http = require('http');

function get(path) {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:5050' + path, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

(async () => {
  const page = await get('/neighborhoods/gastown');
  const attribution = /Business listings &copy; <a href="https:\/\/www\.openstreetmap\.org\/copyright"[^>]*>OpenStreetMap contributors<\/a>,\s*available under the <a href="https:\/\/www\.openstreetmap\.org\/copyright"[^>]*>Open Database Licence<\/a>/.test(page);
  const hours = [...page.matchAll(/🕒 ([^<]+)</g)].map((m) => m[1].trim());
  const phones = [...page.matchAll(/📞 ([^<]+)</g)].map((m) => m[1].trim());
  const pager = /Showing \d+–\d+ of \d+ results/.exec(page);
  const pages = /Page \d+ of \d+/.exec(page);
  const nextHref = /href="\?(&amp;)?page=2"/.exec(page);
  console.log('attribution rendered exactly as required:', attribution);
  console.log('pager:', pager && pager[0], '|', pages && pages[0], '| next link present:', Boolean(nextHref));
  console.log('raw hours codes leaking (Mo-Fr style):', hours.filter((h) => /\bMo\b|\bSu\b|\bPH\b|\d{2}:\d{2}-\d{2}:\d{2}/.test(h)).length);
  console.log('example formatted hours:', hours.slice(0, 3));
  console.log('example phones:', phones.slice(0, 3));

  const business = await get('/businesses?page=3');
  const searchPage = await get('/search?q=OpenStreetMap');
  console.log('businesses page 3 pager:', (/Showing \d+–\d+ of \d+ results/.exec(business) || [''])[0], (/(Page \d+ of \d+)/.exec(business) || [''])[0]);
  console.log('provenance tag hidden from users:', !/#source-openstreetmap/.test(business) && !/#source-openstreetmap/.test(page));
  console.log('search page returns 200 content:', searchPage.length > 1000);
})();
