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
// The concierge is deterministic and costs nothing per call, so it does not need a
// captcha. It does need its own ceiling: 20 a minute is more than a person builds
// and far less than a loop.
const conciergeLimiter = limit('concierge', 20, 60 * 1000);
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

// Launch body. Three groups, on purpose:
//  - everything is allowed except the four surfaces that must never be crawled;
//  - the named AI search indexers and assistant fetchers repeat those four
//    Disallow lines, because a crawler that matches a named group obeys ONLY that
//    group, and a bare "Allow: /" would open /admin and /api to exactly them;
//  - training-only crawlers are refused. This directory earns its keep by being
//    cited with a link back; training reuse returns neither a citation nor a visit.
// The sitemap line is omitted while indexing is off, since every URL in it is noindex.
const ROBOTS_ALLOW = `# robots.txt — Vancouver Directory
# Emitted by src/middleware/exposure.js. Do not edit by hand.

User-agent: *
Allow: /
Disallow: /admin
Disallow: /out/
Disallow: /search
Disallow: /api/

# AI search indexers and assistant fetchers may read the directory.
User-agent: OAI-SearchBot
User-agent: ChatGPT-User
User-agent: Claude-SearchBot
User-agent: Claude-User
User-agent: PerplexityBot
User-agent: Perplexity-User
User-agent: MistralAI-User
User-agent: DuckAssistBot
User-agent: Applebot
Allow: /
Disallow: /admin
Disallow: /out/
Disallow: /search
Disallow: /api/

# Training-only crawlers.
User-agent: GPTBot
User-agent: ClaudeBot
User-agent: Google-CloudVertexBot
User-agent: CCBot
Disallow: /
`;

module.exports = {
  globalLimiter,
  outboundLimiter,
  conciergeLimiter,
  noindexMiddleware,
  indexingDisabled,
  robotsBody: () => (indexingDisabled() ? ROBOTS_DISALLOW : ROBOTS_ALLOW)
};
