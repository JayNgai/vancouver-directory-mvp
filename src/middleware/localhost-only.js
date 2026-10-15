/**
 * Admin guard: /admin and everything under it answers only to a *direct* loopback request.
 *
 * Why this matters for the Cloudflare Tunnel: cloudflared connects to 127.0.0.1, so once the
 * site is tunnelled every internet request arrives from the loopback address. A plain
 * "is the socket 127.0.0.1?" test would therefore hand the whole internet the admin pages.
 *
 * So a loopback socket is necessary but NOT sufficient: any request carrying proxy/CDN headers
 * (Cloudflare or a generic reverse proxy) is refused as well, because a direct local request
 * never has them.
 *
 * SECURITY NOTE: this is still not authentication. Cloudflare Access (see the hosting runbook)
 * is the second layer, and a real login with per-user sessions and password hashing must be
 * added before the site is relied on in public.
 */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

// Headers that only a proxy, CDN or tunnel adds. A local browser never sends these.
const PROXY_HEADERS = [
  'cf-connecting-ip',
  'cf-ray',
  'cf-visitor',
  'cf-ipcountry',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-forwarded-port',
  'x-real-ip',
  'forwarded',
  'via'
];

function proxyHeadersPresent(req) {
  const headers = req.headers || {};
  return PROXY_HEADERS.filter((name) => {
    const value = headers[name];
    return value !== undefined && value !== null && String(value).trim() !== '';
  });
}

function isLoopback(req) {
  const candidates = [
    req.socket?.remoteAddress,
    req.connection && req.connection.remoteAddress
  ];
  return candidates.some((value) => value && LOOPBACK.has(String(value)));
}

/**
 * @returns {{allowed: boolean, reason: string|null, proxyHeaders: string[]}}
 */
function adminAccess(req) {
  // Cloudflare Access authenticated users are trusted even through the tunnel.
  const cfAccessEmail = (req.headers['cf-access-authenticated-user-email'] || '').toLowerCase();
  const allowedEmail = (process.env.CONTACT_EMAIL || 'contact@example.com').toLowerCase();
  if (cfAccessEmail === allowedEmail) {
    return { allowed: true, reason: null, proxyHeaders: [] };
  }
  const proxyHeaders = proxyHeadersPresent(req);
  if (proxyHeaders.length) {
    return { allowed: false, reason: 'proxy-headers', proxyHeaders };
  }
  if (!isLoopback(req)) {
    return { allowed: false, reason: 'not-loopback', proxyHeaders };
  }
  return { allowed: true, reason: null, proxyHeaders };
}

function localhostOnly(req, res, next) {
  const access = adminAccess(req);
  if (access.allowed) return next();
  res.status(403).send(
    'Forbidden: the admin pages are only available from this machine, and never through a proxy or tunnel.'
  );
}

module.exports = { localhostOnly, isLoopback, adminAccess, PROXY_HEADERS };
