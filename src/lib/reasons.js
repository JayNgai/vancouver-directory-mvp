/**
 * Why a stop is on your route — three reasons, for a person deciding where to eat.
 *
 * The itinerary used to explain each stop like this:
 *
 *   matches your request by category "Cafe"; category: Cafe; City of Vancouver
 *   licence Issued (data as of 2026-10-14); phone listed; website listed.
 *
 * Every clause is true and none of it is a reason. "Phone listed" is not why
 * anyone walks into a bakery. This module replaces the field dump with three
 * sentences that answer the three questions a person actually has, in order:
 *
 *   1. TIMING    — will it be open when I get there?
 *   2. SEQUENCE  — how far is it from where I'll be?
 *   3. CHARACTER — what is this place, and why this one?
 *
 * Contract, enforced by src/scripts/check-consumer-copy.js:
 *   - always exactly 3 reasons, in that order, even when the record is empty
 *   - every reason is 1–90 characters
 *   - no field names, no provenance, no undefined/null/NaN
 *
 * Truthfulness: the timing reason is day-aware. It parses the stored OSM-style
 * `hours` string for the day the itinerary actually runs, so "closes at 8 pm"
 * is true for that day rather than a guess from the week's widest window. When
 * the hours cannot be parsed it says so instead of inventing an opening time.
 */

'use strict';

const MAX = 90;

// OSM day codes, indexed by JS getDay(): 0 = Sunday.
const DAY_CODES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const WALK_METRES_PER_MIN = 80;
// The scheduler in concierge.js adds this pad to every leg, so a reason that
// quoted the raw distance would contradict the walk time printed beside it.
const WALK_PADDING_MIN = 5;

// ---------------------------------------------------------------------------
// hours parsing
// ---------------------------------------------------------------------------

function parseHM(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mi) || h > 24 || mi > 59) return null;
  return h * 60 + mi;
}

/** 480 -> "8 am", 1350 -> "10:30 pm". Compact because the budget is 90 chars. */
function formatHM(minutes) {
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h24 = Math.floor(total / 60);
  const mi = total % 60;
  const suffix = h24 >= 12 ? 'pm' : 'am';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return mi === 0 ? `${h12} ${suffix}` : `${h12}:${String(mi).padStart(2, '0')} ${suffix}`;
}

function capitaliseDay(code) {
  const i = DAY_CODES.indexOf(code.slice(0, 1).toUpperCase() + code.slice(1).toLowerCase());
  return i;
}

/** "Mo-Fr" | "Mo,We,Fr" | "Daily" -> Set of day indices, or null if unparseable. */
function parseDaySpec(spec) {
  const raw = String(spec || '').trim();
  if (!raw) return null;
  if (/^daily$/i.test(raw) || /^mo\s*-\s*su$/i.test(raw) || /^mo\s*-\s*su\s*,?\s*ph$/i.test(raw)) {
    return new Set([0, 1, 2, 3, 4, 5, 6]);
  }
  const days = new Set();
  for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const range = /^([A-Za-z]{2})\s*-\s*([A-Za-z]{2})$/.exec(part);
    if (range) {
      const a = capitaliseDay(range[1]);
      const b = capitaliseDay(range[2]);
      if (a < 0 || b < 0) return null;
      let i = a;
      let guard = 0;
      for (;;) {
        days.add(i);
        if (i === b || guard++ > 7) break;
        i = (i + 1) % 7;
      }
      continue;
    }
    const idx = capitaliseDay(part);
    if (idx < 0) return null;
    days.add(idx);
  }
  return days.size ? days : null;
}

/**
 * Parse an OSM-style opening_hours string into windows.
 * Returns [] when the string carries no usable times (e.g. "open", null).
 * Handles: "Mo-Fr 08:00-20:00", "Mo-Su 08:00-20:00; PH off", "24/7",
 * multiple ranges in one rule, and windows that run past midnight (close <= open).
 */
function parseHoursWindows(raw) {
  const text = String(raw || '').trim();
  if (!text) return [];
  if (/^24\/7$/i.test(text)) return [{ days: parseDaySpec('Daily'), open: 0, close: 1440 }];
  if (/^open$/i.test(text)) return [];

  const windows = [];
  for (const rule of text.split(';').map((r) => r.trim()).filter(Boolean)) {
    if (/^off$/i.test(rule) || /^ph\s+off$/i.test(rule)) continue;

    const firstTime = rule.search(/\d{1,2}:\d{2}/);
    if (firstTime < 0) continue;

    const prefix = rule.slice(0, firstTime).replace(/[,\s]+$/, '');
    const days = prefix ? parseDaySpec(prefix) : parseDaySpec('Daily');
    if (!days) continue;

    const body = rule.slice(firstTime);
    const rangeRe = /(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/g;
    let m;
    while ((m = rangeRe.exec(body)) !== null) {
      const open = parseHM(m[1]);
      const closeRaw = parseHM(m[2]);
      if (open == null || closeRaw == null) continue;
      // "00:00" as an end time means midnight, i.e. end of day — not the start.
      const close = closeRaw === 0 ? 1440 : closeRaw;
      windows.push({ days, open, close: close <= open ? close + 1440 : close });
    }
  }
  return windows;
}

/**
 * The window that governs `minutesOnDay` on day `dayIndex`.
 * Also considers the previous day's window spilling past midnight.
 * Returns { open, close, closesNextDay } or null when closed that day.
 */
function windowFor(windows, dayIndex, minutesOnDay) {
  if (!windows.length) return null;
  const today = windows.filter((w) => w.days.has(dayIndex));
  const yesterday = windows.filter((w) => w.days.has((dayIndex + 6) % 7) && w.close > 1440);

  // A window that started yesterday and is still running.
  for (const w of yesterday) {
    if (minutesOnDay + 1440 < w.close) return { open: w.open, close: w.close - 1440, closesNextDay: true, fromYesterday: true };
  }

  if (!today.length) return null;

  const inside = today.find((w) => minutesOnDay >= w.open && minutesOnDay < w.close);
  if (inside) return { open: inside.open, close: inside.close, closesNextDay: inside.close > 1440 };

  const upcoming = today.filter((w) => minutesOnDay < w.open).sort((a, b) => a.open - b.open)[0];
  if (upcoming) return { open: upcoming.open, close: upcoming.close, closesNextDay: upcoming.close > 1440 };

  const past = today.slice().sort((a, b) => b.close - a.close)[0];
  return { open: past.open, close: past.close, closesNextDay: past.close > 1440, past: true };
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function tagsOf(business) {
  try {
    const parsed = JSON.parse((business && business.tags) || '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** Keep a sentence inside the character budget without truncating a word. */
function fit(text, fallback) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length > 0 && t.length <= MAX) return t;
  return fallback || '';
}

function metresBetween(a, b) {
  if (!a || !b) return null;
  if (a.latitude == null || a.longitude == null || b.latitude == null || b.longitude == null) return null;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const x = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

// ---------------------------------------------------------------------------
// the three slots
// ---------------------------------------------------------------------------

function timingReason(business, ctx) {
  const windows = parseHoursWindows(business.hours);
  const hood = (business.neighborhood && business.neighborhood.name) || null;

  if (!windows.length) {
    // Hours are absent or unparseable. Say that briefly, rather than invent an
    // opening time — and keep it short, because on a thin dataset it repeats.
    return 'Hours not published.';
  }

  const is24 = windows.length === 1 && windows[0].open === 0 && windows[0].close === 1440;
  if (is24) return 'Open around the clock, so timing here is up to you.';

  const now = Number(ctx.nowMinutes);
  const dayIndex = Number.isFinite(ctx.dayIndex) ? ctx.dayIndex : new Date().getDay();
  if (!Number.isFinite(now)) return fit('Opening hours listed on the venue page.');

  const w = windowFor(windows, dayIndex, now);
  if (!w) return fit(`Closed on this day${hood ? ` — check another date for ${hood}` : ''}.`,
    'Closed on this day.');

  const closes = formatHM(w.close);
  const opens = formatHM(w.open);

  if (w.past) {
    return fit(`Shuts at ${closes} — you would need to start earlier to fit it in.`,
      `Shuts at ${closes}.`);
  }
  if (!w.fromYesterday && now < w.open) {
    return fit(`Opens at ${opens} — this one suits a later start.`,
      `Opens at ${opens}.`);
  }
  const minutesLeft = w.close - (w.fromYesterday ? now + 1440 : now);
  if (minutesLeft <= 90) {
    return fit(`Closes at ${closes} — go here first, while it is still open.`,
      `Closes at ${closes}.`);
  }
  return fit(`Open until ${closes} when you arrive.`, `Open until ${closes}.`);
}

function sequenceReason(business, ctx) {
  const prev = ctx.prev || null;
  const hood = (business.neighborhood && business.neighborhood.name) || null;
  const prevName = prev && prev.name ? String(prev.name) : null;

  // Prefer the leg the scheduler actually timed, so "6 min on foot" and
  // "6 min walk to the next stop" can never disagree.
  let minutes = null;
  if (Number.isFinite(ctx.walkFromPrevMinutes)) {
    minutes = Math.max(1, Math.round(ctx.walkFromPrevMinutes));
  } else {
    const metres = prev ? metresBetween(prev, business) : null;
    if (metres != null) minutes = Math.max(1, Math.round(metres / WALK_METRES_PER_MIN) + WALK_PADDING_MIN);
  }

  if (minutes != null) {
    const where = prevName && prevName.length <= 32 ? ` from ${prevName}` : ' from your last stop';
    return fit(`${minutes} min on foot${where}.`, 'Close to your last stop.');
  }

  if (hood) {
    return fit(prev ? `Next stop in ${hood}.` : `Starts your route in ${hood}.`,
      `In ${hood}.`);
  }
  return 'Position set on the route map.';
}

// Tags that describe logistics rather than character. "Listed for takeout" tells
// a diner nothing about whether to go; "Listed for italian" does. Deprioritised,
// never banned — if logistics is all a record has, it still gets used.
const UTILITY_TAGS = new Set([
  'takeout', 'delivery', 'wifi', 'free-wifi', 'wheelchair', 'wheelchair-accessible',
  'parking', 'credit-cards', 'cash-only', 'reservations', 'outdoor-seating',
]);

function characterReason(business, ctx) {
  const hood = (business.neighborhood && business.neighborhood.name) || null;
  const category = business.category || business.primaryCategory || null;
  const tags = tagsOf(business).filter((t) => !/^source-/.test(t) && !/^cuisine-/.test(t));
  const price = business.priceRange || null;

  // A descriptive tag is the most specific, most human thing the record holds.
  const descriptive = tags.filter((t) => !UTILITY_TAGS.has(t.toLowerCase()));
  if (descriptive.length) {
    const tag = descriptive[0].replace(/-/g, ' ');
    return fit(`Listed for ${tag}${hood ? ` in ${hood}` : ''}.`,
      `Listed for ${tag}.`);
  }
  if (business.isVerified) {
    return fit(category ? `Owner-verified ${category.toLowerCase()}${hood ? ` in ${hood}` : ''}.`
      : 'Owner-verified listing.',
      'Owner-verified listing.');
  }
  if (price && category) {
    return fit(`A ${price} ${category.toLowerCase()}${hood ? ` in ${hood}` : ''}.`,
      `A ${price} ${category.toLowerCase()}.`);
  }
  if (category && hood) return fit(`A ${category.toLowerCase()} in ${hood}.`, `${category} in ${hood}.`);
  if (category) return fit(`${category} listing.`);
  if (hood) return fit(`Listed in ${hood}.`);
  if (tags.length) {
    const tag = tags[0].replace(/-/g, ' ');
    return fit(`Listed for ${tag}.`);
  }
  return 'A local listing.';
}

// ---------------------------------------------------------------------------
// public
// ---------------------------------------------------------------------------

/**
 * @param {object} business  a Business row (neighborhood optionally included)
 * @param {object} ctx       { nowMinutes, dayIndex, prev, startMinutes, requestedHours }
 * @returns {{text: string, kind: 'timing'|'sequence'|'character'}[]} always length 3
 */
function stopReasons(business, ctx) {
  const b = business || {};
  const c = ctx || {};
  return [
    { text: timingReason(b, c), kind: 'timing' },
    { text: sequenceReason(b, c), kind: 'sequence' },
    { text: characterReason(b, c), kind: 'character' },
  ];
}

module.exports = {
  stopReasons,
  // exported for tests and for anyone debugging why a sentence came out that way
  parseHoursWindows,
  windowFor,
  parseDaySpec,
  formatHM,
};
