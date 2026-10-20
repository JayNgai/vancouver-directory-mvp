'use strict';
/**
 * Deterministic baseline data-QA scorer for the Vancouver Directory.
 *
 * Three jobs, all explainable from a record's own fields — no model, no black box:
 *   1. duplicate / near-duplicate detection across the corpus
 *   2. category-correctness checks
 *   3. a quality score 0-100, built additively so every point has a named reason
 *
 * This is the reference the JEV pilot is measured against (see ../README.md). Rounding:
 * the score is an integer sum of integer weights, so it is exactly reproducible.
 */

const n = require('./normalize');

// --- quality score weights (sum to 100 before the duplicate penalty) ----------------------------
const WEIGHTS = {
  NAME_OK: 5,
  ADDRESS_OK: 10,
  COORDS_OK: 15,
  CATEGORY_OK: 10,
  PRIMARYCAT_OK: 10,
  TAGS_OK: 10,
  PHONE_OK: 10,
  WEBSITE_OK: 15,
  HOURS_OK: 5,
  DESCRIPTION_OK: 5,
  IMAGE_OK: 5
};
const DUPLICATE_PENALTY = 20;
const DESCRIPTION_MIN_CHARS = 40;

/**
 * Score one record 0-100 from its own fields. Returns the score plus a per-check breakdown
 * so any number can be justified. The duplicate penalty is applied by runBaseline, which
 * alone can see the whole corpus.
 */
function scoreRecord(record) {
  const reasons = [];
  let score = 0;
  const add = (code, ok, detail) => {
    reasons.push({ code, ok, delta: ok ? WEIGHTS[code] : 0, detail: detail || null });
    if (ok) score += WEIGHTS[code];
  };

  const name = (record.name || '').trim();
  add('NAME_OK', name.length >= 2, name ? `name="${name}"` : 'name missing');

  add('ADDRESS_OK', n.addressLooksStructured(record.address), record.address || 'address missing');

  const coordsOk = n.coordsInsideVancouver(record);
  add(
    'COORDS_OK',
    coordsOk,
    n.coordsPresent(record)
      ? `(${record.latitude}, ${record.longitude})`
      : 'coordinates missing'
  );

  const categoryCanonical = n.CANONICAL_CATEGORIES.includes(record.category);
  add('CATEGORY_OK', categoryCanonical, `category="${record.category}"`);

  const primaryOk = Boolean(record.primaryCategory) && record.primaryCategory === record.category;
  add(
    'PRIMARYCAT_OK',
    primaryOk,
    primaryOk ? record.primaryCategory : `primaryCategory="${record.primaryCategory}" vs category="${record.category}"`
  );

  const tags = n.tagsParse(record.tags);
  add('TAGS_OK', tags !== null, tags !== null ? `${tags.length} tag(s)` : 'tags is not a JSON array');

  add('PHONE_OK', n.phoneLooksValid(record.phone), record.phone || 'phone missing');
  add('WEBSITE_OK', n.websiteLooksValid(record.website), record.website || 'website missing');

  const hoursOk = Boolean(record.hours && String(record.hours).trim());
  add('HOURS_OK', hoursOk, hoursOk ? 'hours present' : 'hours missing');

  const descOk = Boolean(record.description) && record.description.trim().length >= DESCRIPTION_MIN_CHARS;
  add('DESCRIPTION_OK', descOk, descOk ? `${record.description.trim().length} chars` : 'description missing/too short');

  add('IMAGE_OK', Boolean(record.imageUrl), record.imageUrl ? 'image present' : 'image missing');

  return {
    id: record.id,
    name: record.name,
    score,
    reasons,
    flags: {
      categoryCanonical,
      primaryMatchesCategory: primaryOk,
      coordsInsideVancouver: coordsOk,
      phoneValid: n.phoneLooksValid(record.phone),
      websiteValid: n.websiteLooksValid(record.website)
    }
  };
}

/**
 * Deterministic duplicate / near-duplicate detection.
 *
 * Two records are flagged as a duplicate pair when they share a normalised name AND either
 * their (structurally real) addresses match or they sit within `maxMetres` of each other.
 *
 * Deliberate guard: a shared address only counts as corroboration when it is a real street
 * address (contains a number). OSM boilerplate like "Vancouver", "Vancouver, BC" and
 * "<area>, Vancouver, BC (street address not mapped)" is shared by dozens of DISTINCT venues
 * (chains in the same mall, unmapped points) and would otherwise flood us with false positives.
 * Same name with no real corroborating signal is NOT flagged — chains exist on purpose.
 */
function detectDuplicates(records, { maxMetres = 30 } = {}) {
  const byName = new Map();
  for (const r of records) {
    const key = n.normalizeName(r.name);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(r);
  }

  const pairs = [];
  const duplicateIds = new Set();
  const byId = new Map();

  for (const [key, group] of byName) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const a = group[i];
        const b = group[j];
        const aStructured = n.addressLooksStructured(a.address);
        const bStructured = n.addressLooksStructured(b.address);
        const sameAddress =
          aStructured && bStructured &&
          n.normalizeAddress(a.address) === n.normalizeAddress(b.address);
        let distance = null;
        if (n.coordsPresent(a) && n.coordsPresent(b)) {
          distance = n.haversineMetres(a, b);
        }
        const near = distance !== null && distance <= maxMetres;
        if (!sameAddress && !near) continue;

        const reason = sameAddress
          ? `same normalized name + same street address`
          : `same normalized name + ${distance.toFixed(0)}m apart`;
        pairs.push({ a: a.id, aName: a.name, aAddress: a.address, b: b.id, bName: b.name, bAddress: b.address, sameAddress, distance: distance === null ? null : Number(distance.toFixed(1)), reason });
        duplicateIds.add(a.id);
        duplicateIds.add(b.id);
        const rel = { id: b.id, name: b.name, reason, distance: distance === null ? null : Number(distance.toFixed(1)) };
        if (!byId.has(a.id)) byId.set(a.id, []);
        byId.get(a.id).push(rel);
      }
    }
  }

  return { pairs, duplicateIds, byId };
}

/** Run the full baseline over an array of records and summarise. */
function runBaseline(records, opts = {}) {
  const dups = detectDuplicates(records, opts);
  const scored = records.map((r) => {
    const base = scoreRecord(r);
    const isDuplicate = dups.duplicateIds.has(r.id);
    if (isDuplicate) {
      base.score = Math.max(0, base.score - DUPLICATE_PENALTY);
      base.reasons.push({
        code: 'DUPLICATE',
        ok: false,
        delta: -DUPLICATE_PENALTY,
        detail: (dups.byId.get(r.id) || []).map((d) => `${d.name} (${d.reason})`).join('; ')
      });
    }
    base.flags.isDuplicate = isDuplicate;
    return base;
  });

  const scores = scored.map((s) => s.score);
  const mean = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const distribution = { '0-49': 0, '50-69': 0, '70-84': 0, '85-94': 0, '95-100': 0 };
  for (const s of scores) {
    if (s < 50) distribution['0-49'] += 1;
    else if (s < 70) distribution['50-69'] += 1;
    else if (s < 85) distribution['70-84'] += 1;
    else if (s < 95) distribution['85-94'] += 1;
    else distribution['95-100'] += 1;
  }

  return {
    scored,
    duplicates: dups,
    summary: {
      records: records.length,
      meanScore: Number(mean.toFixed(2)),
      distribution,
      duplicatePairs: dups.pairs.length,
      recordsInDuplicatePairs: dups.duplicateIds.size,
      nonCanonicalCategoryCount: scored.filter((s) => !s.flags.categoryCanonical).length,
      primaryCategoryMismatchCount: scored.filter((s) => !s.flags.primaryMatchesCategory).length,
      coordsOutsideVancouverCount: scored.filter((s) => !s.flags.coordsInsideVancouver).length
    }
  };
}

module.exports = { WEIGHTS, DUPLICATE_PENALTY, scoreRecord, detectDuplicates, runBaseline };