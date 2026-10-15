const express = require('express');
const nunjucks = require('nunjucks');
const helmet = require('helmet');
const path = require('path');
// .env holds secrets; config/site.env holds non-secret site settings (loaded second, so values
// already present in the environment or .env win).
require('dotenv').config();
require('dotenv').config({ path: path.join(__dirname, 'config', 'site.env') });

const exposure = require('./src/middleware/exposure');
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
      // Templates use small inline scripts (Smart Concierge) and inline styles.
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
  referrerPolicy: { policy: 'no-referrer' }
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

// Configure Nunjucks view engine
nunjucks.configure(path.join(__dirname, 'templates'), {
  autoescape: true,
  express: app,
  noCache: process.env.NODE_ENV !== 'production'
});
app.set('view engine', 'html');
app.locals.noindex = indexingDisabled();
app.locals.contactEmail = process.env.CONTACT_EMAIL || 'contact@example.com';
app.locals.publicBaseUrl = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

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
app.use((err, req, res, next) => {
  console.error('Server error:', err.stack);
  res.status(500).send('Internal Server Error');
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Vancouver Directory MVP running at http://${HOST}:${PORT}`);
  console.log(`Health check: http://${HOST}:${PORT}/api/health`);
  console.log(`Bound to ${HOST}; admin is loopback-only and refuses proxied requests.`);
  console.log(`Indexing ${indexingDisabled() ? 'disabled (SITE_NOINDEX)' : 'allowed'}.`);
});

module.exports = app;
