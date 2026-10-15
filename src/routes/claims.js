/**
 * Claim flow, outbound-click redirects, privacy page and the localhost-only admin screens.
 *
 * Nothing here marks a listing as verified: a claim is a request to be contacted, and the
 * status stays internal (new / contacted / verified / rejected) and is never shown publicly.
 */
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { record } = require('../lib/tracking');
const { localhostOnly } = require('../middleware/localhost-only');
const { decorate, formatPhone } = require('../lib/format');

const prisma = new PrismaClient();
const router = express.Router();
const adminRouter = express.Router();

const ROLES = new Set(['owner', 'manager', 'other']);
const STATUSES = ['new', 'contacted', 'verified', 'rejected'];
const LIMITS = { name: 80, email: 120, phone: 40, message: 1000 };

// Simple in-memory rate limit, keyed by a daily hash so no raw IP is kept in memory either.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const hits = new Map();
const { visitorHash } = require('../lib/tracking');

function rateLimited(req) {
  const key = visitorHash(req) || 'anon';
  const now = Date.now();
  const entries = (hits.get(key) || []).filter((time) => now - time < WINDOW_MS);
  entries.push(now);
  hits.set(key, entries);
  if (hits.size > 5000) hits.clear();
  return entries.length > MAX_PER_WINDOW;
}

function validateClaim(body) {
  const errors = [];
  const name = String(body.name || '').trim();
  const role = String(body.role || '').trim().toLowerCase();
  const email = String(body.email || '').trim();
  const phone = String(body.phone || '').trim();
  const message = String(body.message || '').trim();
  if (!name) errors.push('Please enter your name.');
  if (name.length > LIMITS.name) errors.push(`Name must be ${LIMITS.name} characters or fewer.`);
  if (!ROLES.has(role)) errors.push('Please choose owner, manager or other.');
  if (!email) errors.push('Please enter an email address.');
  else if (email.length > LIMITS.email || !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) errors.push('Please enter a valid email address.');
  if (phone.length > LIMITS.phone) errors.push(`Phone must be ${LIMITS.phone} characters or fewer.`);
  if (phone && phone.replace(/\D/g, '').length < 7) errors.push('That phone number looks too short.');
  if (message.length > LIMITS.message) errors.push(`Message must be ${LIMITS.message} characters or fewer.`);
  if (body.consent !== 'yes') errors.push('Please tick the consent box so we may contact you about this listing.');
  // Honeypot: a real person never fills this hidden field.
  if (String(body.website_url || '').trim() !== '') errors.push('Submission rejected.');
  return { errors, values: { name, role, email, phone, message } };
}

// ---------------------------------------------------------------- public pages

router.get('/claim', async (req, res) => {
  const slug = String(req.query.business || '').trim();
  let business = null;
  if (slug) {
    business = await prisma.business.findFirst({
      where: { slug },
      include: { neighborhood: true }
    });
    if (!business) {
      business = await prisma.business.findFirst({
        where: { slugAliases: { contains: `"${slug}"` } },
        include: { neighborhood: true }
      });
    }
    if (business) await record(prisma, req, 'click_claim', { businessId: business.id });
  }
  res.render('claim.html', { business, errors: [], values: {}, previous: false });
});

router.post('/claim', async (req, res) => {
  const slug = String(req.body.business || '').trim();
  const business = slug
    ? await prisma.business.findFirst({ where: { slug }, include: { neighborhood: true } })
    : null;
  if (!business) {
    return res.status(400).render('claim.html', {
      business: null,
      errors: ['We could not find that listing. Please open the listing page and use the claim link there.'],
      values: req.body,
      previous: false
    });
  }
  if (rateLimited(req)) {
    return res.status(429).render('claim.html', {
      business,
      errors: ['Too many claim submissions from this connection. Please try again later.'],
      values: req.body,
      previous: false
    });
  }
  const { errors, values } = validateClaim(req.body);
  if (errors.length) {
    return res.status(400).render('claim.html', { business, errors, values, previous: false });
  }
  const claim = await prisma.claim.create({
    data: {
      businessId: business.id,
      name: values.name,
      role: values.role,
      email: values.email,
      phone: values.phone || null,
      message: values.message || null,
      status: 'new',
      consentAt: new Date()
    }
  });
  await record(prisma, req, 'claim_submit', { businessId: business.id, path: `/claim?business=${slug}` });
  res.render('claim-thanks.html', { business, claimId: claim.id });
});

router.get('/privacy', (req, res) => res.render('privacy.html', {}));

// ------------------------------------------------------- outbound click relay
// The redirect target is always rebuilt from our own data, never taken from the request,
// so this endpoint can never be used as an open redirect.
router.get('/out/:type/:slug', async (req, res) => {
  const type = String(req.params.type);
  const business = await prisma.business.findFirst({ where: { slug: req.params.slug } });
  if (!business) return res.status(404).send('Listing not found');

  let target = null;
  if (type === 'click_website' && business.website) target = business.website;
  if (type === 'click_phone' && business.phone) {
    target = `tel:${business.phone.replace(/[^\d+]/g, '')}`;
  }
  if (type === 'click_maps_reviews') {
    target = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${business.name} ${business.address}`)}`;
  }
  if (!target) return res.status(404).send('Nothing to redirect to');
  if (!/^(https?:\/\/|tel:)/i.test(target)) return res.status(400).send('Unsupported target');

  await record(prisma, req, type, { businessId: business.id, path: `/businesses/${business.slug}` });
  res.redirect(302, target);
});

// ---------------------------------------------------------------- admin (local)

adminRouter.get('/claims', async (req, res) => {
  const status = String(req.query.status || '').trim();
  const where = status && STATUSES.includes(status) ? { status } : {};
  const claims = await prisma.claim.findMany({
    where,
    include: { business: { select: { name: true, slug: true, neighborhood: { select: { name: true } } } } },
    orderBy: { createdAt: 'desc' },
    take: 500
  });
  const counts = await prisma.claim.groupBy({ by: ['status'], _count: { _all: true } });
  res.render('admin-claims.html', {
    claims: claims.map((claim) => ({
      ...claim,
      createdAtText: new Date(claim.createdAt).toISOString().slice(0, 16).replace('T', ' ')
    })),
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
    selectedStatus: status,
    statuses: STATUSES,
    formatPhone
  });
});

adminRouter.post('/claims/:id/status', async (req, res) => {
  const status = String(req.body.status || '');
  if (!STATUSES.includes(status)) return res.status(400).send('Unknown status');
  await prisma.claim.update({ where: { id: req.params.id }, data: { status } });
  res.redirect(`/admin/claims?status=${encodeURIComponent(req.body.return_status || '')}`);
});

adminRouter.get('/claims.csv', async (req, res) => {
  const claims = await prisma.claim.findMany({
    include: { business: { select: { name: true, slug: true } } },
    orderBy: { createdAt: 'desc' }
  });
  const rows = [['id', 'createdAt', 'status', 'business', 'slug', 'name', 'role', 'email', 'phone', 'message', 'consentAt']];
  for (const claim of claims) {
    rows.push([claim.id, claim.createdAt.toISOString(), claim.status, claim.business?.name || '',
               claim.business?.slug || '', claim.name, claim.role, claim.email, claim.phone || '',
               (claim.message || '').replace(/\s+/g, ' '), claim.consentAt ? claim.consentAt.toISOString() : '']);
  }
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  res.type('text/csv').attachment(`claims-${new Date().toISOString().slice(0, 10)}.csv`).send(csv);
});

adminRouter.get('/revenue', async (req, res) => {
  const entries = await prisma.revenueEntry.findMany({ orderBy: { date: 'desc' }, take: 500 });
  const byMonth = {};
  let total = 0;
  for (const entry of entries) {
    const month = entry.date.slice(0, 7);
    byMonth[month] = (byMonth[month] || 0) + entry.amountCad;
    total += entry.amountCad;
  }
  const bySource = {};
  for (const entry of entries) bySource[entry.source] = (bySource[entry.source] || 0) + entry.amountCad;
  res.render('admin-revenue.html', {
    entries, byMonth, bySource, total,
    sources: ['sponsorship', 'affiliate', 'adsense', 'other'],
    saved: req.query.saved === '1',
    error: req.query.error || ''
  });
});

adminRouter.post('/revenue', async (req, res) => {
  const date = String(req.body.date || '').trim();
  const source = String(req.body.source || '').trim();
  const amount = Number(req.body.amountCad);
  const note = String(req.body.note || '').trim().slice(0, 300);
  const errors = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push('Date must be YYYY-MM-DD.');
  if (!['sponsorship', 'affiliate', 'adsense', 'other'].includes(source)) errors.push('Unknown source.');
  if (!Number.isFinite(amount) || amount < 0) errors.push('Amount must be a positive number (CAD).');
  if (errors.length) return res.redirect(`/admin/revenue?error=${encodeURIComponent(errors.join(' '))}`);
  await prisma.revenueEntry.create({
    data: { date, source, amountCad: Math.round(amount * 100) / 100, note: note || null }
  });
  res.redirect('/admin/revenue?saved=1');
});

adminRouter.get('/revenue.csv', async (req, res) => {
  const entries = await prisma.revenueEntry.findMany({ orderBy: { date: 'desc' } });
  const rows = [['id', 'date', 'source', 'amountCad', 'note']];
  for (const entry of entries) rows.push([entry.id, entry.date, entry.source, entry.amountCad.toFixed(2), entry.note || '']);
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  res.type('text/csv').attachment(`revenue-cad-${new Date().toISOString().slice(0, 10)}.csv`).send(csv);
});

adminRouter.get('/', (req, res) => res.render('admin.html', { formatPhone }));

module.exports = { publicRouter: router, adminRouter, localhostOnly, prisma };
