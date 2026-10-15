/**
 * Exposure-safety verification for the tunnelled soft launch.
 *
 * Proves:
 *  - the server listens on loopback only (not 0.0.0.0)
 *  - /admin, /admin/claims and /admin/revenue return 403 when ANY proxy/CDN header is present,
 *    even though the request arrives from 127.0.0.1 (this is exactly the Cloudflare Tunnel case)
 *  - they still answer 200 for a clean direct loopback request
 *  - robots.txt disallows everything and pages carry X-Robots-Tag + meta robots while SITE_NOINDEX
 *  - security headers: CSP allows the Maps iframe, no x-powered-by, no Set-Cookie
 *  - the global limiter and the /out limiter eventually return 429
 *  - visitorHash uses CF-Connecting-IP only from loopback, and never stores a raw IP
 */
const http = require('http');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const HOST = '127.0.0.1';
const PORT = 5050;
let failures = 0;

function request(urlPath, { headers = {}, method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: HOST, port: PORT, path: urlPath, method, headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`);
};

const PROXY_HEADERS = [
  ['cf-connecting-ip', '203.0.113.9'],
  ['cf-ray', '8a1b2c3d4e5f6g7h-YVR'],
  ['cf-visitor', '{"scheme":"https"}'],
  ['cf-ipcountry', 'CA'],
  ['x-forwarded-for', '203.0.113.9'],
  ['x-forwarded-host', 'directory.example.com'],
  ['x-forwarded-proto', 'https'],
  ['x-forwarded-port', '443'],
  ['x-real-ip', '203.0.113.9'],
  ['forwarded', 'for=203.0.113.9;proto=https'],
  ['via', '1.1 cloudflare']
];

(async () => {
  // ---- 1. listener is loopback only ----
  const { terminal } = require('child_process');
  const netstat = require('child_process').execSync(`netstat -ano | findstr :${PORT}`, { encoding: 'utf8' });
  const listeners = netstat.split('\n').filter((line) => line.includes('LISTENING'));
  const hasWildcard = listeners.some((line) => /(0\.0\.0\.0|\[::\]):(\d+)\s/.test(line) && line.includes(`:${PORT}`) && !line.includes('127.0.0.1'));
  check(`port ${PORT} does not listen on 0.0.0.0/::`, !hasWildcard,
    listeners.map((l) => l.trim().split(/\s+/).slice(0, 2).join(' ')).join(' | '));
  check(`port ${PORT} listens on 127.0.0.1`, listeners.some((line) => line.includes('127.0.0.1')));

  // ---- 2. admin refused for every proxy header (the tunnel case) ----
  for (const [name, value] of PROXY_HEADERS) {
    for (const adminPath of ['/admin', '/admin/claims', '/admin/revenue']) {
      const res = await request(adminPath, { headers: { [name]: value } });
      check(`403 ${adminPath} with ${name}: ${value.slice(0, 24)}`, res.status === 403, `got ${res.status}`);
    }
  }

  // A Cloudflare-like request carrying several headers at once.
  const combined = await request('/admin/claims.csv', {
    headers: {
      'cf-connecting-ip': '203.0.113.9',
      'cf-ray': 'abc-YVR',
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'directory.example.com'
    }
  });
  check('403 /admin/claims.csv with a full Cloudflare header set', combined.status === 403, `got ${combined.status}`);

  // ---- 3. direct loopback still works ----
  for (const adminPath of ['/admin', '/admin/claims', '/admin/revenue']) {
    const res = await request(adminPath);
    check(`200 ${adminPath} for a clean loopback request`, res.status === 200, `got ${res.status}`);
  }

  // ---- 4. noindex controls ----
  const robots = await request('/robots.txt');
  check('robots.txt disallows everything', robots.status === 200 && /Disallow: \/\s*$/m.test(robots.body) && /User-agent: \*/.test(robots.body));
  const home = await request('/');
  check('X-Robots-Tag noindex on pages', /noindex/i.test(home.headers['x-robots-tag'] || ''), String(home.headers['x-robots-tag']));
  check('meta robots noindex in HTML', /<meta name="robots" content="noindex/.test(home.body));

  // ---- 5. security headers ----
  const csp = home.headers['content-security-policy'] || '';
  check('CSP allows the Google Maps iframe', /frame-src[^;]*https:\/\/www\.google\.com/.test(csp), csp.slice(0, 120));
  check('CSP restricts default-src to self', /default-src 'self'/.test(csp));
  check('x-powered-by is not sent', home.headers['x-powered-by'] === undefined);
  check('no Set-Cookie on public pages', home.headers['set-cookie'] === undefined);
  const claimPage = await request('/claim');
  check('no Set-Cookie on the claim form', claimPage.headers['set-cookie'] === undefined);

  // ---- 6. visitor hash behaviour (unit level) ----
  const tracking = require('../lib/tracking');
  const loopbackReq = { socket: { remoteAddress: '127.0.0.1' }, headers: { 'user-agent': 'Mozilla/5.0 test' } };
  const tunnelledReq = { socket: { remoteAddress: '127.0.0.1' }, headers: { 'user-agent': 'Mozilla/5.0 test', 'cf-connecting-ip': '203.0.113.9' } };
  const foreignReq = { socket: { remoteAddress: '198.51.100.7' }, headers: { 'user-agent': 'Mozilla/5.0 test', 'cf-connecting-ip': '203.0.113.9' } };
  const hLocal = tracking.visitorHash(loopbackReq);
  const hTunnelled = tracking.visitorHash(tunnelledReq);
  const hForeign = tracking.visitorHash(foreignReq);
  check('visitorHash differs when CF-Connecting-IP is used from loopback', hLocal !== hTunnelled);
  check('visitorHash ignores CF headers from a non-loopback socket', hForeign !== hTunnelled);
  check('visitorHash is a 32-char hex digest', /^[0-9a-f]{32}$/.test(hTunnelled || ''), String(hTunnelled));

  const db = new DatabaseSync(path.join(__dirname, '..', '..', 'prisma', 'dev.db'), { readOnly: true });
  const columns = db.prepare('PRAGMA table_info(events)').all().map((c) => c.name);
  check('events table has no IP or user-agent column',
    !columns.some((c) => /(^|_)ip($|_)|user.?agent/i.test(c)), columns.join(','));
  const raw = db.prepare('SELECT visitorHash FROM events WHERE visitorHash IS NOT NULL LIMIT 5').all();
  check('stored visitor hashes are hashes, not addresses',
    raw.every((row) => !/^\d+\.\d+\.\d+\.\d+$/.test(row.visitorHash || '')));
  db.close();

  // ---- 7. rate limiters (each run uses its own simulated client address) ----
  const testIp = `198.51.100.${1 + Math.floor(Math.random() * 250)}`;
  let outboundLimited = false;
  for (let i = 0; i < 70; i += 1) {
    const res = await request('/out/click_maps_reviews/medina-cafe', { headers: { 'cf-connecting-ip': testIp } });
    if (res.status === 429) { outboundLimited = true; break; }
  }
  check('/out limiter returns 429 after 60 clicks in a minute', outboundLimited);

  let globalLimited = false;
  for (let i = 0; i < 320; i += 1) {
    // One address, so this bucket is the one under test.
    const res = await request('/api/health', { headers: { 'cf-connecting-ip': testIp } });
    if (res.status === 429) { globalLimited = true; break; }
  }
  check('global limiter returns 429 under a burst', globalLimited);

  console.log(failures === 0 ? 'EXPOSURE VERIFICATION OK' : `EXPOSURE FAILURES=${failures}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
  console.error('exposure verification crashed:', error.message);
  process.exit(1);
});
