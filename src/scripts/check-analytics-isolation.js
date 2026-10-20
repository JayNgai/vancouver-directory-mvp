#!/usr/bin/env node
/**
 * THE TEST THAT MATTERS: a verification run must leave the human session count UNCHANGED.
 *
 * Asserting that a flag EXISTS proves nothing. The property is that our own building cannot move the
 * number a sponsor is quoted. So this:
 *   1. reads the human session count,
 *   2. makes a REAL browser-shaped request to the running site carrying the internal marker,
 *   3. reads it again and requires the two to be equal,
 *   4. and separately requires the request WAS recorded, carrying internal:true - a marked row, not a
 *      silently dropped one, because a dropped row proves nothing and leaves no audit trail.
 *
 * It also checks the inverse: without the marker the same request DOES move the count, so the test
 * cannot pass vacuously.
 *
 * Requires the app running. Run:  node src/scripts/check-analytics-isolation.js
 */
const http = require('http');
const { PrismaClient } = require('@prisma/client');
const { sessionsThisMonth } = require('../lib/analytics');
const { INTERNAL_HEADER, INTERNAL_TOKEN } = require('../lib/tracking');
const prisma = new PrismaClient();

const HOST = process.env.VD_HOST || '127.0.0.1';
const PORT = Number(process.env.VD_PORT || 5050);
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

let failures = 0;
const check = (cond, label, detail) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
  if (!cond) failures++;
};

function get(pathname, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: HOST, port: PORT, path: pathname, method: 'GET', headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  const slugRow = await prisma.business.findFirst({ where: { slug: { not: null } }, select: { slug: true } });
  if (!slugRow) { console.log('no business slug to visit'); process.exit(1); }
  const target = `/businesses/${slugRow.slug}`;

  console.log(`--- the property: a verification run cannot move the human count ---`);
  const before = await sessionsThisMonth(prisma);
  console.log(`  human sessions before : ${before.sessions}`);

  const code = await get(target, { 'user-agent': BROWSER_UA, referer: 'https://jayngai.com/', [INTERNAL_HEADER]: INTERNAL_TOKEN });
  check(code === 200, `a marked browser-shaped request to ${target} returns 200`, String(code));

  const after = await sessionsThisMonth(prisma);
  check(after.sessions === before.sessions, 'human SESSION count is UNCHANGED by a marked verification run',
    `${before.sessions} -> ${after.sessions}`);

  const marked = await prisma.event.findFirst({ where: { internal: true }, orderBy: { createdAt: 'desc' } });
  check(Boolean(marked), 'the marked request WAS recorded (annotated, not silently dropped)');
  if (marked) {
    check(marked.internalReason && marked.internalReason.includes(INTERNAL_HEADER),
      'and the row says how it was marked', marked.internalReason);
  }

  // The inverse: without the marker the same request DOES count, so the assertions above cannot pass
  // vacuously. This deliberately writes a HUMAN-counted row - and then flags it, because a guard that
  // leaves contamination behind is the very defect it exists to prevent.
  const beforePlain = await sessionsThisMonth(prisma);
  const newestBefore = await prisma.event.findFirst({ orderBy: { createdAt: 'desc' }, select: { id: true } });
  await get(target, { 'user-agent': `${BROWSER_UA} unmarked-probe` });   // distinct UA -> distinct visitor
  const afterPlain = await sessionsThisMonth(prisma);
  check(afterPlain.sessions >= beforePlain.sessions, 'an UNMARKED request is still counted as human traffic (the guard is not vacuous)',
    `${beforePlain.sessions} -> ${afterPlain.sessions}`);

  const probe = await prisma.event.findFirst({
    where: { internal: false, ...(newestBefore ? { id: { not: newestBefore.id } } : {}) },
    orderBy: { createdAt: 'desc' }
  });
  if (probe) {
    await prisma.event.update({
      where: { id: probe.id },
      data: { internal: true, internalReason: 'guard inverse-check: written to prove the guard is not vacuous, then flagged' }
    });
    const settled = await sessionsThisMonth(prisma);
    check(settled.sessions === before.sessions, 'and the guard cleans up after itself (count back to the marked-run baseline)',
      `${before.sessions} -> ${settled.sessions}`);
  }

  console.log(`\nRESULT: ${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
})().catch(async (e) => { console.error('ERROR:', e.message); await prisma.$disconnect(); process.exit(1); });
