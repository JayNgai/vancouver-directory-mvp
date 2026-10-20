#!/usr/bin/env node
/**
 * The checkpoint number, and the unit it is quoted in.
 *
 *   node src/scripts/analytics-sessions.js            # this month
 *   node src/scripts/analytics-sessions.js --all      # every month on record
 *
 * "Sessions" is defined in src/lib/analytics.js, next to the count, not in a README.
 */
const { PrismaClient } = require('@prisma/client');
const { sessionsThisMonth, humanTraffic, internalTraffic } = require('../lib/analytics');
const prisma = new PrismaClient();

(async () => {
  if (process.argv.includes('--all')) {
    const events = await prisma.event.findMany({ select: { createdAt: true, visitorHash: true, internal: true } });
    const months = new Map();
    for (const e of events) {
      const m = new Date(e.createdAt).toISOString().slice(0, 7);
      if (!months.has(m)) months.set(m, { human: [], internal: 0 });
      if (e.internal) months.get(m).internal += 1;
      else months.get(m).human.push(e);
    }
    const { sessionsFrom } = require('../lib/analytics');
    console.log('month      human sessions   human events   internal events');
    for (const m of [...months.keys()].sort()) {
      const d = months.get(m);
      console.log(`${m}   ${String(sessionsFrom(d.human)).padStart(12)}   ${String(d.human.length).padStart(12)}   ${String(d.internal).padStart(15)}`);
    }
  } else {
    const r = await sessionsThisMonth(prisma);
    console.log(`Checkpoint: ${r.month}`);
    console.log(`  human sessions : ${r.sessions}  ${r.met ? '>= 500' : '(target 500 by 2026-12-31)'}`);
    console.log(`  human events   : ${r.events}`);
    console.log(`  human visitors : ${r.visitors}`);
    console.log(`  internal rows  : ${r.internal}  (excluded)`);
    console.log(`  definition     : ${r.definition}`);
  }
  const t = await internalTraffic(prisma, {});
  console.log(`\nall time: internal rows kept for audit: ${t.events}`);
  await prisma.$disconnect();
})();
