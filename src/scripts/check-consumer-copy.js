#!/usr/bin/env node
/**
 * The guard for consumer-facing copy.
 *
 * WHY: the itinerary used to explain each stop with a database dump —
 *
 *   matches your request by category "Cafe"; category: Cafe; City of Vancouver
 *   licence Issued (data as of 2026-10-14); phone listed; website listed.
 *
 * "City of Vancouver licence issued" is not a reason to eat somewhere. It is
 * provenance. The spec bans those fields from consumer UI permanently, and a ban
 * with no test is a wish.
 *
 * Two halves:
 *   1. Unit assertions on stopReasons() — the pure generator in src/lib/reasons.js.
 *   2. A sweep of every consumer template for provenance strings.
 *
 * Run: node src/scripts/check-consumer-copy.js        (offline, no DB, no browser)
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');

let fails = 0;
const ok = (c, label, detail) => {
  console.log(`  ${c ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
  if (!c) fails++;
};

// Strings that may never reach a person deciding where to eat. Each one is a
// field name, a compliance artefact, or an internal match explanation.
const BANNED_IN_REASONS = [
  'City of Vancouver licence',
  'data as of',
  'matches your request by category',
  'phone listed',
  'website listed',
  'listed hours:',
  'overture',
  'overtureConfidence',
  'dataSources',
  'cityLicenceStatus',
  'liquorLicenceType',
  'picked for listing completeness',
];

// The template sweep is narrower on purpose. templates/_attribution.html MUST
// credit Overture Maps — that is a licence obligation (CDLA-Permissive-2.0), not
// provenance shown to a diner. Stripping it to satisfy a grep would break the law
// to pass a test. The licence-dump phrasings are still banned everywhere.
const BANNED_IN_TEMPLATES = [
  'City of Vancouver licence',
  'City of Vancouver licensed',
  'data as of',
  'matches your request by category',
  'phone listed',
  'website listed',
  'listed hours:',
  'cityLicenceStatus',
  'picked for listing completeness',
];

// ---------------------------------------------------------------------------
console.log('--- 1. the reason generator returns exactly three honest reasons ---');

let stopReasons = null;
try {
  ({ stopReasons } = require('../lib/reasons'));
  ok(typeof stopReasons === 'function', 'src/lib/reasons.js exports stopReasons()');
} catch (e) {
  ok(false, 'src/lib/reasons.js loads', e.message.split('\n')[0]);
}

const full = {
  name: 'Lee\'s Donuts',
  category: 'Cafe',
  primaryCategory: 'Cafe',
  tags: '["coffee","counter-service"]',
  hours: 'Mo-Su 08:00-20:00',
  priceRange: '$$',
  address: '199 Water Street',
  latitude: 49.2839,
  longitude: -123.1089,
  isVerified: true,
  neighborhood: { name: 'Gastown' },
};

// Nothing but a name and a category: no hours, no coords, no tags, no price.
const bare = {
  name: 'Trees Organic Coffee',
  category: 'Cafe',
  primaryCategory: null,
  tags: '[]',
  hours: null,
  priceRange: null,
  address: null,
  latitude: null,
  longitude: null,
  isVerified: false,
  neighborhood: null,
};

// An apostrophe in the venue name must pass through untouched.
const apostrophe = { ...full, name: "Kafka's", tags: '[]', priceRange: null, isVerified: false };

// Hours that close before the itinerary ever reaches the stop.
const closesEarly = { ...full, name: 'Early Bakery', hours: 'Mo-Su 06:00-11:00' };

const prev = { name: 'Timbertrain Coffee', latitude: 49.2842, longitude: -123.1095 };

const cases = [
  { label: 'full record', b: full, ctx: { nowMinutes: 11 * 60, prev, startMinutes: 11 * 60, requestedHours: 3, dayIndex: 1 } },
  { label: 'bare record (no hours/coords/tags/price)', b: bare, ctx: { nowMinutes: 11 * 60, prev: null, startMinutes: 11 * 60, requestedHours: 3, dayIndex: 1 } },
  { label: 'apostrophe in the name', b: apostrophe, ctx: { nowMinutes: 11 * 60, prev, startMinutes: 11 * 60, requestedHours: 3, dayIndex: 1 } },
  { label: 'closes before arrival', b: closesEarly, ctx: { nowMinutes: 14 * 60, prev, startMinutes: 14 * 60, requestedHours: 3, dayIndex: 1 } },
];

if (stopReasons) {
  for (const { label, b, ctx } of cases) {
    let out;
    try {
      out = stopReasons(b, ctx);
    } catch (e) {
      ok(false, `${label}: does not throw`, e.message.split('\n')[0]);
      continue;
    }
    ok(Array.isArray(out) && out.length === 3, `${label}: exactly 3 reasons`, Array.isArray(out) ? `got ${out.length}` : 'not an array');

    const texts = Array.isArray(out) ? out.map((r) => (r && r.text) || '') : [];
    ok(texts.length === 3 && texts.every((t) => t.length > 0 && t.length <= 90),
      `${label}: every reason 1-90 chars`,
      texts.map((t) => t.length).join('/'));

    const joined = texts.join(' | ');
    ok(!/undefined|\bnull\b|NaN|\[object/i.test(joined), `${label}: no undefined/null/NaN leaking`, joined.slice(0, 70));

    const bannedHit = BANNED_IN_REASONS.find((s) => joined.toLowerCase().includes(s.toLowerCase()));
    ok(!bannedHit, `${label}: no provenance string`, bannedHit || '');

    ok(!/;;|:\s*;/.test(joined), `${label}: no separated-field artefacts`, '');
  }

  // Ordering is part of the contract: the reason that answers "why now" comes first.
  const kinds = stopReasons(full, cases[0].ctx).map((r) => r.kind);
  ok(JSON.stringify(kinds) === JSON.stringify(['timing', 'sequence', 'character']),
    'full record yields kinds timing → sequence → character', kinds.join(','));

  // A bare record has no hours and no coords, so the first two slots must fall back
  // rather than emit nothing. Three reasons is structural, not hoped for.
  const bareOut = stopReasons(bare, cases[1].ctx);
  ok(bareOut.length === 3 && bareOut.every((r) => r.text.trim().length > 0), 'bare record still yields 3 non-empty reasons');

  // The apostrophe survives; it is escaped by the template, not rewritten here.
  const aposOut = stopReasons(apostrophe, cases[2].ctx).map((r) => r.text).join(' ');
  ok(!aposOut.includes("''"), 'apostrophe is not doubled', aposOut.slice(0, 60));
}

// ---------------------------------------------------------------------------
console.log('--- 2. no consumer template carries a provenance string ---');

const templateDir = path.join(root, 'templates');
const templates = fs.readdirSync(templateDir)
  .filter((f) => f.endsWith('.html'))
  .filter((f) => !/^admin/.test(f));

const offenders = [];
for (const f of templates) {
  let src = fs.readFileSync(path.join(templateDir, f), 'utf8');
  // Nunjucks comments are prose, not copy.
  src = src.replace(/\{#[\s\S]*?#\}/g, '').replace(/<!--[\s\S]*?-->/g, '');
  for (const s of BANNED_IN_TEMPLATES) {
    if (src.toLowerCase().includes(s.toLowerCase())) offenders.push(`${f} → "${s}"`);
  }
  // The old whyText separator pattern: semicolon-joined field dumps.
  if (/;\s*category:\s*/i.test(src)) offenders.push(`${f} → "; category:" field dump`);
  if (/licence Issued/i.test(src)) offenders.push(`${f} → "licence Issued"`);
}
ok(offenders.length === 0, `none of ${templates.length} consumer templates carry provenance`,
  offenders.length ? '\n        ' + offenders.slice(0, 8).join('\n        ') : '');

// ---------------------------------------------------------------------------
console.log(`\n${fails === 0 ? 'OK' : 'FAILED'} — ${fails} problem(s)`);
process.exit(fails === 0 ? 0 : 1);
