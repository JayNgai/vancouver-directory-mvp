/**
 * Verification for the claim flow, click tracking, privacy page and admin guard.
 * Usage: node src/scripts/verify-claims-tracking.js
 */
const http = require('http');
const path = require('path');
const assert = require('assert');
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(path.join(__dirname, '..', '..', 'prisma', 'dev.db'), { readOnly: true });
const target = db.prepare("SELECT slug, name, website, phone FROM businesses WHERE website IS NOT NULL AND phone IS NOT NULL AND slug IS NOT NULL LIMIT 1").get();
const noSite = db.prepare("SELECT slug FROM businesses WHERE website IS NULL AND slug IS NOT NULL LIMIT 1").get();

function request(method, urlPath, { body = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? new URLSearchParams(body).toString() : null;
    // A unique simulated client address per run: the rate limiters key on the daily visitor
    // hash, and a tunnelled request is identified by CF-Connecting-IP, so this both mimics real
    // traffic and keeps one test run from exhausting the bucket another test uses.
    const simulated = urlPath.startsWith('/admin') ? {} : { 'cf-connecting-ip': CLIENT_IP };
    const req = http.request({
      host: '127.0.0.1', port: 5050, method, path: urlPath,
      headers: payload
        ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(payload), ...simulated, ...headers }
        : { ...simulated, ...headers }
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location, body: data }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// 198.51.100.0/24 is TEST-NET-2, reserved for documentation: never a real visitor.
const CLIENT_IP = `198.51.100.${1 + Math.floor(Math.random() * 250)}`;

const eventCount = (type) => db.prepare('SELECT COUNT(*) AS n FROM events WHERE type = ?').get(type).n;
const claimCount = () => db.prepare('SELECT COUNT(*) AS n FROM claims').get().n;

(async () => {
  let failures = 0;
  const check = (label, ok, detail = '') => {
    if (!ok) failures++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`);
  };

  // ---- localhost guard unit check (a non-loopback request must be refused) ----
  const { localhostOnly } = require('../middleware/localhost-only');
  let guardStatus = null;
  localhostOnly({ socket: { remoteAddress: '203.0.113.5' }, headers: {}, path: '/admin' },
    { status(code) { guardStatus = code; return { send: () => {} }; } }, () => { guardStatus = 'next'; });
  check('admin guard returns 403 for a non-loopback address', guardStatus === 403, `got ${guardStatus}`);

  // ---- privacy page ----
  const privacy = await request('GET', '/privacy');
  check('/privacy returns 200', privacy.status === 200);
  check('/privacy explains the daily hash', /changes every day/.test(privacy.body));
  check('/privacy says no IP stored', /not<\/strong> store your IP address/.test(privacy.body));

  // ---- claim page ----
  const claimPage = await request('GET', `/claim?business=${target.slug}`);
  check('claim page 200 with the listing name shown', claimPage.status === 200 && claimPage.body.includes(target.name));
  check('claim page has a honeypot field', /name="website_url"/.test(claimPage.body));
  check('claim page has the consent checkbox', /name="consent"/.test(claimPage.body));

  const before = claimCount();
  const good = await request('POST', '/claim', {
    body: { business: target.slug, name: 'Test Owner', role: 'owner', email: 'owner@example.com', phone: '604 555 0100', message: 'Please contact me.', consent: 'yes' }
  });
  check('valid claim returns the thank-you page', good.status === 200 && /Thank you/.test(good.body));
  check('thank-you page promises a call, no auto-verification', /contact you to confirm/.test(good.body));
  check('thank-you page contains no "verified" wording', !/verif/i.test(good.body.replace(/not marked|Nothing has been changed/gi, '')));
  check('claim was stored', claimCount() === before + 1);

  const bad = await request('POST', '/claim', { body: { business: target.slug, name: '', role: 'nope', email: 'bad', consent: '' } });
  check('invalid claim returns 400 with errors', bad.status === 400 && /Please fix/.test(bad.body));

  const honey = await request('POST', '/claim', {
    body: { business: target.slug, name: 'Bot', role: 'owner', email: 'bot@example.com', consent: 'yes', website_url: 'http://spam.example' }
  });
  check('honeypot submission rejected', honey.status === 400);

  let limited = false;
  for (let i = 0; i < 8; i += 1) {
    const res = await request('POST', '/claim', {
      body: { business: target.slug, name: `Flood ${i}`, role: 'owner', email: `flood${i}@example.com`, consent: 'yes' }
    });
    if (res.status === 429) { limited = true; break; }
  }
  check('rate limit returns 429 after repeated posts', limited);

  // ---- outbound click relay ----
  const site = await request('GET', `/out/click_website/${target.slug}`);
  check('/out/click_website redirects to the stored website', site.status === 302 && site.location === target.website,
    `${site.status} -> ${site.location}`);
  const evil = await request('GET', `/out/click_website/${target.slug}?next=https://evil.example/steal`);
  check('no open redirect via query string', evil.status === 302 && evil.location === target.website, `${evil.location}`);
  const phone = await request('GET', `/out/click_phone/${target.slug}`);
  check('/out/click_phone redirects to tel:', phone.status === 302 && String(phone.location).startsWith('tel:'));
  const maps = await request('GET', `/out/click_maps_reviews/${target.slug}`);
  check('/out/click_maps_reviews redirects to Google Maps search',
    maps.status === 302 && String(maps.location).startsWith('https://www.google.com/maps/search/?api=1&query='));
  if (noSite) {
    const none = await request('GET', `/out/click_website/${noSite.slug}`);
    check('/out with no stored target returns 404', none.status === 404);
  }

  // ---- detail page views and events ----
  await request('GET', `/businesses/${target.slug}`);
  await request('GET', '/search?q=sushi');
  const counts = {
    page_view_detail: eventCount('page_view_detail'),
    click_website: eventCount('click_website'),
    click_phone: eventCount('click_phone'),
    click_maps_reviews: eventCount('click_maps_reviews'),
    click_claim: eventCount('click_claim'),
    claim_submit: eventCount('claim_submit'),
    search: eventCount('search')
  };
  check('every event type has been recorded', Object.values(counts).every((n) => n > 0), JSON.stringify(counts));

  const sample = db.prepare('SELECT * FROM events ORDER BY createdAt DESC LIMIT 1').get();
  check('stored events carry no raw IP or user agent', !/user.?agent|ip/i.test(Object.keys(sample).join(',')));

  const dntBefore = eventCount('page_view_detail');
  await request('GET', `/businesses/${target.slug}`, { headers: { DNT: '1' } });
  check('Do-Not-Track requests are not recorded', eventCount('page_view_detail') === dntBefore);

  const botBefore = eventCount('page_view_detail');
  await request('GET', `/businesses/${target.slug}`, { headers: { 'User-Agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)' } });
  check('known bots are not recorded', eventCount('page_view_detail') === botBefore);

  // ---- admin screens (loopback only) ----
  const adminClaims = await request('GET', '/admin/claims');
  check('/admin/claims returns 200 locally', adminClaims.status === 200 && /Claims \(local only\)/.test(adminClaims.body));
  const filter = await request('GET', '/admin/claims?status=new');
  check('/admin/claims filters by status', filter.status === 200);
  const claimId = db.prepare('SELECT id FROM claims ORDER BY createdAt DESC LIMIT 1').get().id;
  const changed = await request('POST', `/admin/claims/${claimId}/status`, { body: { status: 'contacted', return_status: '' } });
  check('claim status can be changed', changed.status === 302);
  const newStatus = db.prepare('SELECT status FROM claims WHERE id = ?').get(claimId).status;
  check('status persisted as contacted', newStatus === 'contacted', newStatus);
  const csv = await request('GET', '/admin/claims.csv');
  check('claims CSV export works', csv.status === 200 && /"email"/.test(csv.body));
  const adminHome = await request('GET', '/admin');
  check('/admin index returns 200 locally', adminHome.status === 200);
  const revenuePage = await request('GET', '/admin/revenue');
  check('/admin/revenue returns 200 with CAD wording', revenuePage.status === 200 && /CAD/.test(revenuePage.body));
  const added = await request('POST', '/admin/revenue', { body: { date: '2026-10-14', source: 'sponsorship', amountCad: '150', note: 'verification test' } });
  check('revenue entry can be added', added.status === 302);
  const revenue = db.prepare('SELECT COUNT(*) AS n, SUM(amountCad) AS total FROM revenue_entries').get();
  check('revenue stored in CAD only', revenue.n > 0 && revenue.total > 0, JSON.stringify(revenue));
  const revenueCsv = await request('GET', '/admin/revenue.csv');
  check('revenue CSV export works', revenueCsv.status === 200 && /amountCad/.test(revenueCsv.body));

  console.log(failures === 0 ? 'CLAIMS/TRACKING VERIFICATION OK' : `CLAIMS/TRACKING FAILURES=${failures}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
  console.error('verification crashed:', error.message);
  process.exit(1);
});
