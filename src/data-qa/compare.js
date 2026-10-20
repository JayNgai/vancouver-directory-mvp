'use strict';
/**
 * Comparison harness: score a candidate classifier against the deterministic baseline on the
 * SAME sample of real directory records, and print a clear verdict.
 *
 *   node src/data-qa/compare.js --candidate stub --limit 300
 *   node src/data-qa/compare.js --candidate jev            # needs TYPESAFE_API_KEY in profile .env
 *   node src/data-qa/compare.js --candidate stub --out review.csv
 *   node src/data-qa/compare.js --candidate stub --labels src/data-qa/labels/duplicates.json
 *
 * Verdict metric (agreement with the baseline reference, since we ship no ground-truth labels):
 *   metric = 0.4 * duplicateAgreement + 0.4 * categoryAgreement + 0.2 * scoreCloseness
 * When a --labels file is given we additionally compute duplicate precision/recall/F1 for both
 * classifiers and the verdict becomes "candidate beats baseline" iff candidate F1 > baseline F1.
 */

const fs = require('fs');
const { loadBusinesses, DB_PATH } = require('./load');
const { runBaseline } = require('./baseline');
const { createClassifier } = require('./classifier');

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

async function main() {
  const candidateName = String(arg('candidate', 'stub'));
  const limit = arg('limit') ? Number(arg('limit')) : null;
  const outPath = arg('out') ? String(arg('out')) : null;
  const labelsPath = arg('labels') ? String(arg('labels')) : null;

  const records = loadBusinesses({ limit });
  const baselineRun = runBaseline(records);
  const ctx = { duplicateIds: baselineRun.duplicates.duplicateIds, duplicateById: baselineRun.duplicates.byId };

  const baseline = createClassifier('baseline');
  const candidate = createClassifier(candidateName);

  const agreeDup = { yes: 0, no: 0 };
  const agreeCat = { yes: 0, no: 0 };
  let scoreAbsDiff = 0;
  let scoreCompared = 0;
  const disagreements = [];
  const perRecord = [];

  for (const record of records) {
    const b = baseline.classify(record, ctx);
    const c = await candidate.classify(record, ctx);

    const dupMatch = Boolean(b.isDuplicate) === Boolean(c.isDuplicate);
    const catMatch = Boolean(b.categoryCorrect) === Boolean(c.categoryCorrect);
    if (dupMatch) agreeDup.yes += 1; else agreeDup.no += 1;
    if (catMatch) agreeCat.yes += 1; else agreeCat.no += 1;

    if (typeof c.qualityScore === 'number' && typeof b.qualityScore === 'number') {
      scoreAbsDiff += Math.abs(c.qualityScore - b.qualityScore);
      scoreCompared += 1;
    }

    if (!dupMatch || !catMatch) {
      disagreements.push({
        id: record.id,
        name: record.name,
        baseline_isDuplicate: b.isDuplicate,
        candidate_isDuplicate: c.isDuplicate,
        baseline_categoryCorrect: b.categoryCorrect,
        candidate_categoryCorrect: c.categoryCorrect,
        baseline_score: b.qualityScore,
        candidate_score: c.qualityScore
      });
    }
    perRecord.push({ record, b, c });
  }

  const total = records.length || 1;
  const duplicateAgreement = agreeDup.yes / total;
  const categoryAgreement = agreeCat.yes / total;
  const scoreMAE = scoreCompared ? scoreAbsDiff / scoreCompared : 0;
  const scoreCloseness = Math.max(0, 1 - scoreMAE / 100);
  const metric = 0.4 * duplicateAgreement + 0.4 * categoryAgreement + 0.2 * scoreCloseness;

  console.log(`Comparison: baseline vs "${candidateName}" on ${records.length} records (${DB_PATH})`);
  console.log(`duplicate-decision agreement: ${(duplicateAgreement * 100).toFixed(1)}%  (${agreeDup.yes}/${records.length})`);
  console.log(`category-decision agreement:  ${(categoryAgreement * 100).toFixed(1)}%  (${agreeCat.yes}/${records.length})`);
  console.log(`quality-score MAE:            ${scoreMAE.toFixed(2)} pts over ${scoreCompared} records`);
  console.log(`combined metric (0-1):        ${metric.toFixed(4)}`);
  console.log(`divergent records:            ${disagreements.length}`);

  // Optional ground-truth labels -> real precision/recall/F1 for BOTH classifiers.
  let labelledVerdict = null;
  if (labelsPath) {
    const labels = JSON.parse(fs.readFileSync(labelsPath, 'utf8'));
    const gold = new Set(labels.duplicateIds || labels);
    const prf = (pick) => {
      let tp = 0, fp = 0, fn = 0;
      for (const { record, b, c } of perRecord) {
        const predicted = pick(b, c);
        const actual = gold.has(record.id);
        if (predicted && actual) tp += 1;
        else if (predicted && !actual) fp += 1;
        else if (!predicted && actual) fn += 1;
      }
      const precision = tp + fp ? tp / (tp + fp) : 0;
      const recall = tp + fn ? tp / (tp + fn) : 0;
      const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
      return { tp, fp, fn, precision, recall, f1 };
    };
    const bm = prf((b) => b.isDuplicate);
    const cm = prf((_, c) => c.isDuplicate);
    console.log(`\nlabelled duplicate detection (gold set ${gold.size}):`);
    console.log(`  baseline  P=${bm.precision.toFixed(3)} R=${bm.recall.toFixed(3)} F1=${bm.f1.toFixed(3)}`);
    console.log(`  candidate P=${cm.precision.toFixed(3)} R=${cm.recall.toFixed(3)} F1=${cm.f1.toFixed(3)}`);
    labelledVerdict = cm.f1 > bm.f1 ? 'candidate_beats_baseline' : cm.f1 < bm.f1 ? 'baseline_better' : 'tie';
  }

  // --- verdict ---
  console.log('\nVERDICT');
  if (labelledVerdict) {
    console.log(`  against ground truth: ${labelledVerdict}`);
  } else if (metric >= 0.98) {
    console.log(`  candidate "${candidateName}" TRACKS the baseline (metric ${metric.toFixed(4)}) — no added value detected on this sample.`);
  } else {
    console.log(`  candidate "${candidateName}" DIVERGES from the baseline on ${disagreements.length} records (metric ${metric.toFixed(4)}).`);
    console.log('  Failure of the metric to reach ~0.98 means the candidate makes different calls; adjudicate the divergences below.');
  }
  console.log('  NOTE: "beats the baseline" needs human-labelled ground truth. Pass --labels <file> to measure it.');

  if (outPath) {
    const header = 'id,name,baseline_isDuplicate,candidate_isDuplicate,baseline_categoryCorrect,candidate_categoryCorrect,baseline_score,candidate_score\n';
    const rows = disagreements.map((d) =>
      [d.id, `"${String(d.name).replace(/"/g, "'")}"`, d.baseline_isDuplicate, d.candidate_isDuplicate, d.baseline_categoryCorrect, d.candidate_categoryCorrect, d.baseline_score, d.candidate_score].join(',')
    ).join('\n');
    fs.writeFileSync(outPath, header + rows);
    console.log(`\ndivergent records written to ${outPath}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(`compare failed: ${err.message}`);
  process.exit(1);
});