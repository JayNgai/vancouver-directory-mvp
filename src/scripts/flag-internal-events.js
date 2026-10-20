#!/usr/bin/env node
/**
 * ONE-OFF, NON-DESTRUCTIVE: flag the contaminated rows that are PROVABLY internal.
 *
 * Nothing is deleted. Rows are marked `internal` with a reason, archived to data/, and excluded from
 * human counts from now on.
 *
 * WHAT IT FLAGS — and the rule is deliberately narrow:
 *   A visitorHash that produced >= 30 events in a single UTC day. No person views thirty detail
 *   pages; the observed cluster is 4 visitors writing 210 of one day's 214 events, 135 of them inside
 *   one minute. That is a harness, and it is provable from the data alone.
 *
 * WHAT IT REFUSES TO FLAG, and this matters more:
 *   Sweep-shaped blocks — one event per distinct visitorHash, spread over hours — are NOT flagged.
 *   On 2026-10-20 that shape covers 188 events from 188 distinct visitors, every one carrying a real
 *   referrer, on a site that is PUBLICLY REACHABLE (https://jayngai.com returns 200). A script can
 *   produce that signature — I reproduced it with curl — but so can real visitors, and one machine
 *   cannot produce 188 distinct visitor hashes. Marking those internal would remove possibly-real
 *   traffic from the one number the business is sold on, which is the worse error. They stay
 *   unflagged and are reported as ambiguous instead.
 *
 * Run:  node src/scripts/flag-internal-events.js
 */
const fs = require('fs'), path = require('path');
const { PrismaClient } = require('@prisma/client');
const { sessionsFrom } = require('../lib/analytics');
const prisma = new PrismaClient();

const MIN_EVENTS_PER_VISITOR_PER_DAY = 30;
// The row my own proof added while confirming the hole existed. Named rather than pattern-matched.
const KNOWN_PROBE_IDS = ['cmvg5hcm5001b5bswc0uvydyr'];

const day = (d) => new Date(d).toISOString().slice(0, 10);

(async () => {
  const all = await prisma.event.findMany({ orderBy: { createdAt: 'asc' } });
  console.log(`events in the table: ${all.length}`);

  const before = sessionsFrom(all);
  console.log(`sessions counted with NO exclusions: ${before}`);

  // group by visitorHash + day
  const groups = new Map();
  for (const e of all) {
    if (!e.visitorHash) continue;
    const key = `${e.visitorHash}|${day(e.createdAt)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }

  const targets = new Map(); // id -> reason
  for (const [key, list] of groups) {
    if (list.length < MIN_EVENTS_PER_VISITOR_PER_DAY) continue;
    const times = list.map((e) => +new Date(e.createdAt)).sort((a, b) => a - b);
    const spanS = Math.round((times[times.length - 1] - times[0]) / 1000);
    const reason = `burst: ${list.length} events in ${spanS}s on ${day(list[0].createdAt)} (>=${MIN_EVENTS_PER_VISITOR_PER_DAY}/day rule)`;
    for (const e of list) targets.set(e.id, reason);
  }
  for (const id of KNOWN_PROBE_IDS) targets.set(id, 'manual-verification probe: proved the tracking hole, flagged by hand');

  console.log(`\nrows the rule flags: ${targets.size}`);
  const byReason = new Map();
  for (const r of targets.values()) byReason.set(r, (byReason.get(r) || 0) + 1);
  for (const [r, n] of byReason) console.log(`   ${n}  ${r}`);

  if (process.argv.includes('--dry-run')) {
    console.log('\n(dry run - nothing written)');
    await prisma.$disconnect();
    return;
  }

  // archive FIRST, so the record of what was flagged survives independently of the database
  const dir = path.join(__dirname, '..', '..', 'data');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const csvPath = path.join(dir, `flagged-internal-events-${stamp}.csv`);
  const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const rows = all.filter((e) => targets.has(e.id));
  fs.writeFileSync(csvPath,
    'id,type,path,createdAt,referrerHost,visitorHash,internalReason\n' +
    rows.map((e) => [e.id, e.type, e.path, new Date(e.createdAt).toISOString(), e.referrerHost, e.visitorHash, targets.get(e.id)].map(esc).join(',')).join('\n') + '\n',
    'utf8');
  console.log(`\narchived ${rows.length} rows -> ${csvPath}`);

  let updated = 0;
  for (const [id, reason] of targets) {
    await prisma.event.update({ where: { id }, data: { internal: true, internalReason: reason } });
    updated++;
  }
  console.log(`flagged ${updated} rows as internal (nothing deleted)`);

  const after = await prisma.event.findMany({ where: { internal: false }, orderBy: { createdAt: 'asc' } });
  const internalRows = await prisma.event.findMany({ where: { internal: true } });
  console.log(`\nsessions before: ${before}`);
  console.log(`sessions after (human only): ${sessionsFrom(after)}`);
  console.log(`internal rows kept: ${internalRows.length}  ·  human rows: ${after.length}`);

  await prisma.$disconnect();
})();
