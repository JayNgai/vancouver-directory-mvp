/**
 * Exposure controls for the tunnelled soft launch:
 *  - a global rate limiter (per daily visitor hash, never a raw IP)
 *  - a tighter limiter for the endpoints that cost work or write data
 *  - site-wide noindex (X-Robots-Tag) with one switch to turn indexing on later
 *  - helper for /robots.txt
 */
const { visitorHash } = require('../lib/tracking');

const WINDOWS = new Map();

function limit(name, max, windowMs) {
  return (req, res, next) => {
    const key = `${name}:${visitorHash(req) || req.socket?.remoteAddress || 'anon'}`;
    const now = Date.now();
    const store = WINDOWS.get(key) || [];
    const recent = store.filter((time) => now - time < windowMs);
    recent.push(now);
    WINDOWS.set(key, recent);
    if (WINDOWS.size > 20000) WINDOWS.clear();
    if (recent.length > max) {
      res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
      return res.status(429).send('Too many requests. Please slow down and try again shortly.');
    }
    return next();
  };
}

/** 300 requests per minute per visitor for the whole site. */
const globalLimiter = limit('global', 300, 60 * 1000);
/** 60 outbound clicks per minute: a person cannot click faster than that. */
const outboundLimiter = limit('outbound', 60, 60 * 1000);
// POST /claim has its own tighter limiter (5 per 15 minutes) inside src/routes/claims.js so it
// can render the friendly form error instead of a bare 429.

function indexingDisabled() {
  // Default TRUE during the soft launch: one switch (SITE_NOINDEX=false) turns indexing on.
  return String(process.env.SITE_NOINDEX || 'true').toLowerCase() !== 'false';
}

function noindexMiddleware(req, res, next) {
  if (indexingDisabled()) {
    res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  }
  next();
}

const ROBOTS_DISALLOW = `User-agent: *
Disallow: /

# Soft launch: the directory is not open to search engines yet.
# Flip SITE_NOINDEX=false in the site's .env to allow indexing and replace this file's content.
`;

const ROBOTS_ALLOW = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /out/
`;

module.exports = { globalLimiter, outboundLimiter, noindexMiddleware, indexingDisabled, robotsBody: () => (indexingDisabled() ? ROBOTS_DISALLOW : ROBOTS_ALLOW) };
