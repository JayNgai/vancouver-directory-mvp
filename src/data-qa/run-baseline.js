'use strict';
/**
 * CLI: run the deterministic baseline data-QA scorer over the live directory DB.
 *
 *   node src/data-qa/run-baseline.js            # all records
 *   node src/data-qa/run-baseline.js --limit 500
 *   node src/data-qa/run-baseline.js --json      # machine-readable summary only
 */
const { loadBusinesses, DB_PATH } = require('./load');
const { runBaseline, detectDuplicates } = require('./baseline');
const { normalizeName } = require('./normalize');

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

/** Self-test: inject two synthetic duplicate clones and prove the detector fires on them. */
function detectorSelfTest(records) {
  const template = records.find((r) => r.latitude && r.longitude) || records[0];
  const cloneA = { ...template, id: 'selftest-clone-a' };
  const cloneB = { ...template, id: 'selftest-clone-b', latitude: template.latitude + 0.0001 };
  const flagged = detectDuplicates([...records, cloneA, cloneB]);
  const caught = flagged.duplicateIds.has('selftest-clone-a') && flagged.duplicateIds.has('selftest-clone-b');
  return { caught, name: template.name, pairs: flagged.pairs.filter((p) => p.a.startsWith('selftest') || p.b.startsWith('selftest')).length };
}

/** Review candidates: same normalised name but NOT flagged as duplicates (chains / ambiguous). */
function reviewCandidates(records) {
  const byName = new Map();
  for (const r of records) {
    const key = normalizeName(r.name);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(r);
  }
  const dupIds = detectDuplicates(records).duplicateIds;
  const groups = [];
  for (const [, g] of byName) {
    if (g.length < 2) continue;
    if (g.every((r) => dupIds.has(r.id))) continue;
    groups.push(g);
  }
  return groups;
}

const limit = arg('limit') ? Number(arg('limit')) : null;
const asJson = Boolean(arg('json'));

const records = loadBusinesses({ limit });
const result = runBaseline(records);
const { summary, duplicates, scored } = result;

if (asJson) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

console.log(`Baseline data-QA over ${DB_PATH}`);
console.log(`records scored:            ${summary.records}`);
console.log(`mean quality score (0-100): ${summary.meanScore}`);
console.log(`score distribution:         ${JSON.stringify(summary.distribution)}`);
console.log(`duplicate pairs found:      ${summary.duplicatePairs}`);
console.log(`records in a dup pair:      ${summary.recordsInDuplicatePairs}`);
console.log(`non-canonical categories:   ${summary.nonCanonicalCategoryCount}`);
console.log(`primaryCategory mismatches: ${summary.primaryCategoryMismatchCount}`);
console.log(`coords outside Vancouver:   ${summary.coordsOutsideVancouverCount}`);

console.log('\n-- lowest-scoring records --');
for (const s of [...scored].sort((a, b) => a.score - b.score).slice(0, 5)) {
  const fails = s.reasons.filter((r) => !r.ok).map((r) => r.code).join(', ');
  console.log(`  ${String(s.score).padStart(3)}  ${s.name}  [${fails}]`);
}

console.log('\n-- duplicate pair examples --');
const addrById = new Map(records.map((r) => [r.id, r.address]));
if (duplicates.pairs.length === 0) {
  console.log('  (none — no same-name pair shares a real street address or sits within 30m)');
}
for (const p of duplicates.pairs.slice(0, 10)) {
  console.log(`  "${p.aName}" (${p.a}) @ ${addrById.get(p.a)}`);
  console.log(`    == "${p.bName}" (${p.b}) @ ${addrById.get(p.b)}`);
  console.log(`    ${p.reason}`);
}

// Honest sanity: prove the detector is not silently broken by injecting two synthetic clones.
const st = detectorSelfTest(records);
console.log(`\ndetector self-test: injected 2 clones of "${st.name}" -> ` +
  `${st.caught ? `CAUGHT (${st.pairs} pair flagged)` : 'NOT CAUGHT — detector is broken'}`);

// The ambiguity set a classifier could add value on: same name, NOT a deterministic duplicate.
const candidates = reviewCandidates(records);
console.log(`\nreview candidates (same name, not deterministic dupes): ${candidates.length} groups`);
for (const g of candidates.slice(0, 3)) {
  console.log(`  "${g[0].name}" x${g.length}: ${g.slice(0, 4).map((r) => r.address).join(' | ')}`);
}

// Honest sanity: a duplicate must visibly cost points.
const dupExample = scored.find((s) => s.flags.isDuplicate);
if (dupExample) {
  const dupReason = dupExample.reasons.find((r) => r.code === 'DUPLICATE');
  console.log(`\nexample duplicate penalty: "${dupExample.name}" scored ${dupExample.score} ` +
    `(-${Math.abs(dupReason.delta)} for DUPLICATE: ${dupReason.detail})`);
}