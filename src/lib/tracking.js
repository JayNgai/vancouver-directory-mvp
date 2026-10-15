/**
 * Privacy-respecting interaction tracking.
 *
 * Rules (see /privacy):
 *  - no raw IP addresses and no user-agent strings are ever stored
 *  - visitorHash is a daily-rotating salted hash: it cannot be reversed to an IP and it
 *    changes every day, so it cannot follow anyone over time
 *  - Do-Not-Track and known bots are ignored entirely
 *  - admin traffic is ignored
 */
const crypto = require('crypto');

const BOT_PATTERN = /bot|crawler|spider|crawl|slurp|bingpreview|facebookexternalhit|python-requests|curl|wget|headless|monitor|preview|lighthouse|pingdom|uptime/i;

const EVENT_TYPES = new Set([
  'page_view_detail',
  'click_website',
  'click_phone',
  'click_maps_reviews',
  'click_claim',
  'claim_submit',
  'search'
]);

function clientIp(req) {
  const socket = req.socket?.remoteAddress || '';
  const loopback = /^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(socket);
  // Only trust Cloudflare's client-IP header when the request actually came from loopback
  // (i.e. through cloudflared). The raw IP is used for the hash and never stored.
  if (loopback) {
    const cf = req.headers['cf-connecting-ip'];
    if (cf && String(cf).trim()) return String(cf).split(',')[0].trim();
  }
  return socket;
}

/** Daily salt: the hash for the same visitor differs every day by design. */
function dailySalt() {
  const secret = process.env.VISITOR_HASH_SECRET || 'vancouver-directory-local';
  const day = new Date().toISOString().slice(0, 10);
  return crypto.createHash('sha256').update(`${secret}|${day}`).digest('hex');
}

function visitorHash(req) {
  const ip = clientIp(req);
  if (!ip) return null;
  const ua = req.headers['user-agent'] || '';
  return crypto.createHash('sha256').update(`${dailySalt()}|${ip}|${ua}`).digest('hex').slice(0, 32);
}

function shouldIgnore(req) {
  if (req.headers.dnt === '1') return 'dnt';
  if (BOT_PATTERN.test(req.headers['user-agent'] || '')) return 'bot';
  if ((req.path || req.originalUrl || '').startsWith('/admin')) return 'admin';
  return null;
}

function referrerHost(req) {
  const value = req.headers.referer || req.headers.referrer;
  if (!value) return null;
  try {
    const host = new URL(value).host;
    if (!host || /(^|\.)localhost(:\d+)?$/.test(host) || /^127\.0\.0\.1/.test(host)) return null;
    return host.slice(0, 120);
  } catch (error) {
    return null;
  }
}

/**
 * Records one event. Never throws: tracking must not break a page.
 * @param {object} prisma Prisma client
 */
async function record(prisma, req, type, { businessId = null, path = null } = {}) {
  try {
    if (!EVENT_TYPES.has(type)) return false;
    if (shouldIgnore(req)) return false;
    await prisma.event.create({
      data: {
        type,
        businessId: businessId || null,
        path: (path || req.originalUrl || req.path || '').slice(0, 300),
        referrerHost: referrerHost(req),
        visitorHash: visitorHash(req)
      }
    });
    return true;
  } catch (error) {
    return false;
  }
}

module.exports = { record, visitorHash, shouldIgnore, referrerHost, EVENT_TYPES, BOT_PATTERN };
