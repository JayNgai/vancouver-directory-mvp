/**
 * The traffic numbers the business is sold on — and the definition of the unit they are quoted in.
 *
 * WHY THIS FILE EXISTS: the charter's checkpoint is ">=500 sessions/month by 2026-12-31", and traffic
 * is the sponsorship model's kill signal #1 — it is the one asset a sponsor actually buys. Two things
 * made that number unquotable: the events table could not tell a person from a process, and "session"
 * was nowhere defined. This file defines it, next to the count, in code rather than in a document,
 * because a checkpoint evaluated against an undefined unit is not a measurement.
 */
const { INTERNAL_HEADER, INTERNAL_TOKEN } = require('./tracking');

/**
 * SESSION — the unit, defined here.
 *
 * A session is one visitor's continuous activity: events sharing a `visitorHash`, grouped into a run
 * and split whenever the gap to the next event exceeds SESSION_IDLE_MS (30 minutes of inactivity).
 * A visitor returning after a longer gap starts a new session; a visitor whose events are seconds
 * apart stays in one.
 *
 * `visitorHash` is a daily-rotating salted hash, so a session can never span a day and cannot follow
 * anyone across days — that is a privacy property, not an accident, and it also means "sessions per
 * month" is the sum of independent daily sessions.
 */
const SESSION_IDLE_MS = 30 * 60 * 1000;

/** Pure: sessions from an array of { visitorHash, createdAt }. Testable without a database. */
function sessionsFrom(events) {
  const byVisitor = new Map();
  for (const e of events) {
    if (!e || !e.visitorHash) continue;
    if (!byVisitor.has(e.visitorHash)) byVisitor.set(e.visitorHash, []);
    byVisitor.get(e.visitorHash).push(+new Date(e.createdAt));
  }
  let sessions = 0;
  for (const times of byVisitor.values()) {
    times.sort((a, b) => a - b);
    let prev = null;
    for (const t of times) {
      if (prev === null || t - prev > SESSION_IDLE_MS) sessions += 1;
      prev = t;
    }
  }
  return sessions;
}

function rangeWhere(since, until) {
  const where = {};
  if (since || until) {
    where.createdAt = {};
    if (since) where.createdAt.gte = new Date(since);
    if (until) where.createdAt.lte = new Date(until);
  }
  return where;
}

/**
 * HUMAN activity only: `internal: false`, exactly. Rows marked internal are excluded here and
 * nowhere else, so there is one place that decides what counts as a person.
 */
async function humanTraffic(prisma, { since, until } = {}) {
  const events = await prisma.event.findMany({
    where: { ...rangeWhere(since, until), internal: false, visitorHash: { not: null } },
    select: { visitorHash: true, createdAt: true },
    orderBy: { createdAt: 'asc' }
  });
  return {
    sessions: sessionsFrom(events),
    events: events.length,
    visitors: new Set(events.map((e) => e.visitorHash)).size,
    since: since || null,
    until: until || null,
    definition: `session = one visitorHash's events with no gap over ${SESSION_IDLE_MS / 60000} min; internal traffic excluded`
  };
}

/** The internal rows, counted separately so they are visible rather than merely absent. */
async function internalTraffic(prisma, { since, until } = {}) {
  const events = await prisma.event.findMany({
    where: { ...rangeWhere(since, until), internal: true },
    select: { visitorHash: true, createdAt: true }
  });
  return { events: events.length, sessions: sessionsFrom(events) };
}

/** The checkpoint: sessions in the current calendar month, human traffic only. */
async function sessionsThisMonth(prisma, now = new Date()) {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const traffic = await humanTraffic(prisma, { since });
  const internal = await internalTraffic(prisma, { since });
  return {
    month: since.toISOString().slice(0, 7),
    target: 500,
    ...traffic,
    internal: internal.events,
    met: traffic.sessions >= 500
  };
}

module.exports = { SESSION_IDLE_MS, sessionsFrom, humanTraffic, internalTraffic, sessionsThisMonth, INTERNAL_HEADER, INTERNAL_TOKEN };
