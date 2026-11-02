const express = require('express');
const nunjucks = require('nunjucks');
const helmet = require('helmet');
const path = require('path');
// .env holds secrets; config/site.env holds non-secret site settings (loaded second, so values
// already present in the environment or .env win).
require('dotenv').config();
require('dotenv').config({ path: path.join(__dirname, 'config', 'site.env') });

const exposure = require('./src/middleware/exposure');
const { failText } = require('./src/lib/errors');
const { globalLimiter, outboundLimiter, noindexMiddleware, indexingDisabled } = exposure;

const app = express();
const PORT = (process.env.PORT && process.env.PORT !== '3000') ? Number(process.env.PORT) : 5050;
// Bind to loopback only. The Cloudflare Tunnel (cloudflared) runs on this PC and reaches the
// site through 127.0.0.1, so nothing needs to listen on 0.0.0.0.
const HOST = process.env.HOST || '127.0.0.1';

// A tunnelled request reaches us from loopback, so trusting X-Forwarded-* would let anyone
// claim any address: never trust a proxy for security decisions here.
app.set('trust proxy', false);
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      // The optional Google Maps Embed iframe (feature-flagged) must be allowed.
      frameSrc: ["'self'", 'https://www.google.com'],
      childSrc: ["'self'", 'https://www.google.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      // Templates use small inline <script> blocks and inline styles.
      // ⚠️ 'unsafe-inline' HERE COVERS <script> BLOCKS ONLY - it does NOT enable inline handler
      // ATTRIBUTES. helmet's defaults (useDefaults: true) separately send `script-src-attr 'none'`,
      // which makes onclick=/ondrop=/ondragstart= INERT: the attribute still reads correctly in the
      // DOM, so the page looks wired and does nothing. That is how drag-to-swap shipped broken.
      // Do NOT add scriptSrcAttr here to "fix" it - attach handlers with addEventListener instead.
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false, // allow the Maps embed
  // Origin only, not the full URL. Two things need a Referer to exist:
  //  - a Google Maps API key restricted to websites refuses a request with no
  //    Referer at all, so 'no-referrer' silently disabled the business-page embed;
  //  - OpenStreetMap's tile policy expects a client it can identify.
  // 'strict-origin-when-cross-origin' sends the origin over https and nothing over
  // http-to-https downgrades, which is the privacy-preserving choice that still
  // lets both services see where a request came from.
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

app.use(noindexMiddleware);
app.use(globalLimiter);
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: true, limit: '32kb' }));

// Serve static assets correctly
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'public')));

// Search-engine switch: SITE_NOINDEX=false turns indexing on (default is noindex).
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(exposure.robotsBody());
});

// Sitemap. Only meaningful once SITE_NOINDEX flips to false — while indexing is off the
// robots.txt disallows everything, so this is published but unused. It lists real rows
// from the database rather than a hand-written list, so it cannot drift from the site.
app.get('/sitemap.xml', async (req, res) => {
  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    const [neighborhoods, businesses, itineraries] = await Promise.all([
      prisma.neighborhood.findMany({ select: { slug: true } }),
      prisma.business.findMany({ select: { slug: true } }),
      prisma.itinerary.findMany({ select: { slug: true } }),
    ]);
    await prisma.$disconnect();

    const base = app.locals.publicBaseUrl;
    const urls = [
      '/', '/neighborhoods', '/businesses', '/itineraries', '/concierge', '/claim', '/privacy', '/about',
      ...neighborhoods.map((n) => `/neighborhoods/${n.slug}`),
      ...businesses.map((b) => `/businesses/${b.slug}`),
      ...itineraries.map((i) => `/itineraries/${i.slug}`),
    ];
    // Two escapes, for two different grammars. encodeURI handles the URL (accents,
    // spaces), then the XML escape handles the ampersands and brackets the URL
    // grammar leaves alone. Without both, 51 slugs containing "&" made the whole
    // 3,014-URL file fail to parse, which would have handed search engines nothing.
    const xmlEscape = (value) => String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
    const body = ['<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...urls.map((u) => `  <url><loc>${xmlEscape(base + encodeURI(u))}</loc></url>`),
      '</urlset>'].join('\n');
    res.type('application/xml').send(body);
  } catch (error) {
    res.status(500).type('text/plain').send('sitemap unavailable');
  }
});

// llms.txt: a plain summary for assistants. It states what exists and what does
// not, rather than promising a Markdown variant the site does not serve.
app.get('/llms.txt', (req, res) => {
  const base = app.locals.publicBaseUrl;
  res.type('text/plain').send([
    '# Vancouver Directory',
    '',
    '> A directory of Vancouver places with a rule-based planner that builds a walking day from real listings.',
    '',
    '## Directory',
    `- [All places](${base}/businesses): 2,958 listings across 23 districts, with category, district and open-now filters.`,
    `- [Districts](${base}/neighborhoods): 23 district pages with an editorial description and local listings.`,
    `- [Itineraries](${base}/itineraries): 26 hand-built walking days.`,
    `- [Concierge](${base}/concierge): describe what you feel like; the planner returns a timed route with swap options.`,
    '',
    '## One listing',
    `${base}/businesses/{slug}: name, address, phone, website, opening hours and tags. Ratings, review counts, prices and "verified" badges are deliberately absent.`,
    '',
    '## For site owners',
    `- [Claim a listing](${base}/claim).`,
    '',
    '## Notes',
    '- HTML only. The site does not serve Markdown.',
    '- Photographs marked "stand-in" are licensed stock images, not the venue.',
    ''
  ].join('\n'));
});

// security.txt, only when a real contact address is configured. A file with
// contact@example.com in it would be worse than no file.
app.get('/.well-known/security.txt', (req, res) => {
  const email = String(process.env.CONTACT_EMAIL || '').trim();
  if (!email || /@example\.(com|org)$/i.test(email)) {
    return res.status(404).type('text/plain').send('no disclosure contact configured');
  }
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  return res.type('text/plain').send([
    `Contact: mailto:${email}`,
    `Expires: ${expires}`,
    'Preferred-Languages: en',
    `Canonical: ${app.locals.publicBaseUrl}/.well-known/security.txt`,
    ''
  ].join('\n'));
});

// Configure Nunjucks view engine
const nunjucksEnv = nunjucks.configure(path.join(__dirname, 'templates'), {
  autoescape: true,
  express: app,
  noCache: process.env.NODE_ENV !== 'production'
});

// Thousands separators for the counting surfaces. A stat that reads "2958" looks
// like a database value; "2,958" looks like a published number.
nunjucksEnv.addFilter('num', (value) => Number(value || 0).toLocaleString('en-CA'));

// ---- responsive images -------------------------------------------------------
// Implementation lives in src/lib/image-filters.js so the template guards render with
// the same filters the server uses.
require('./src/lib/image-filters').registerImageFilters(nunjucksEnv);

app.set('view engine', 'html');
app.locals.noindex = indexingDisabled();
app.locals.contactEmail = process.env.CONTACT_EMAIL || 'contact@example.com';
app.locals.publicBaseUrl = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

// Canonical URL for every request. The query string is stripped on purpose: a filtered
// view like /businesses?category=Cafe is a different view of the same page, and giving it
// its own canonical would split the page across hundreds of near-duplicates.
app.use((req, res, next) => {
  res.locals.canonicalUrl = app.locals.publicBaseUrl + req.path;
  res.locals.siteName = 'Vancouver Directory';
  next();
});

// Mount Routes
const apiRoutes = require('./src/routes/api');
const viewRoutes = require('./src/routes/views');
const { publicRouter: claimRoutes, adminRouter } = require('./src/routes/claims');
const { localhostOnly } = require('./src/middleware/localhost-only');

app.use('/api', apiRoutes);
// Admin screens answer only to a direct loopback request, never through a proxy or tunnel.
app.use('/admin', localhostOnly, adminRouter);
// Outbound click relay: limited, and validated against our own stored data.
app.use('/out', outboundLimiter);
app.use('/', claimRoutes);
app.use('/', viewRoutes);

// Error handling middleware
// Routed through the same helper the routes use, so CR_ERROR_DETAIL=1 explains an
// unhandled render failure too. A bare "Internal Server Error" gives the developer
// nothing: this cost a hunt through a stale process whose real error was
// "filter not found: srcset". Verbose stays OFF by default, as errors.js requires.
app.use((err, req, res, next) => {
  failText(res, 'unhandled', err);
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Vancouver Directory MVP running at http://${HOST}:${PORT}`);
  console.log(`Health check: http://${HOST}:${PORT}/api/health`);
  console.log(`Bound to ${HOST}; admin is loopback-only and refuses proxied requests.`);
  console.log(`Indexing ${indexingDisabled() ? 'disabled (SITE_NOINDEX)' : 'allowed'}.`);
});

module.exports = app;
