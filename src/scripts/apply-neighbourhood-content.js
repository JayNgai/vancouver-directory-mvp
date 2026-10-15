/**
 * Applies editorial text and the title-verified Commons images to the neighbourhoods table.
 * Archives the previous description / photoUrl values to data/ first.
 * Usage: node src/scripts/apply-neighbourhood-content.js [--apply]   (dry run without --apply)
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..', '..');
const DB = path.join(ROOT, 'prisma', 'dev.db');
const APPLY = process.argv.includes('--apply');

// Chosen by Commons file title (exact prefix). Photos were NOT visually confirmed (the image
// host rate-limited the review), so each title must name the neighbourhood or a landmark in it.
// Null means no image: no genuine, licence-clean match was found.
const PICKS = {
  'Gastown': 'File:Gastown-8.JPG',
  'Kitsilano': 'File:Vine Street in Kitsilano.JPG',
  'Downtown Vancouver': 'File:A Street Scene on Robson street',
  'Yaletown': 'File:Yaletown–Roundhouse station 19.jpg',
  'West End': 'File:DenmanArena Vancouver.jpg',
  'Mount Pleasant': 'File:Moods of Mount Pleasant - Street Scenes - Vancouver BC - Canada - 01.jpg',
  'Commercial Drive': 'File:Commercial Drive (8110991970).jpg',
  'Strathcona': 'File:Strathcona, Vancouver, BC, Canada - panoramio.jpg',
  'Chinatown': 'File:Millennium Gate, Vancouver',
  'Coal Harbour': 'File:Coal Harbour Vancouver 01.jpg',
  'Point Grey': 'File:Regent College in Vancouver Point Grey 2011.jpg',
  'Kerrisdale': 'File:Vancouver Public Library - Kerrisdale Branch.jpg',
  'Marpole': 'File:2013-01 Marpole Granville Street.jpg',
  'South Granville': 'File:South Granville station',
  'False Creek': 'File:Burrard bridge-false creek-vancouver.jpg',
  'Fairview': null,
  'Grandview-Woodland': 'File:Italian Days at Grandview Park.jpg',
  'Hastings-Sunrise': 'File:Tree and building in Hastings-Sunrise, Vancouver.jpg',
  'Killarney': 'File:Killarney Community Centre, 7 April 2007.jpg',
  'Oakridge': 'File:Oakridge aerial view 2018.jpg',
  'Renfrew-Collingwood': 'File:Collingwood Station on the B.C.E.R.',
  'Sunset': null,
  'Victoria-Fraserview': null
};

const editorial = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'neighbourhood-editorial.json'), 'utf8'));
const candidates = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'neighbourhood-image-candidates.json'), 'utf8'));

const words = (t) => t.trim().split(/\s+/).length;
const problems = [];
const plan = [];

for (const [name, text] of Object.entries(editorial)) {
  const n = words(text.description);
  const m = text.metaDescription.length;
  if (n < 80 || n > 150) problems.push(`${name}: ${n} words`);
  if (m < 140 || m > 160) problems.push(`${name}: meta ${m} chars`);
}
const names = Object.keys(PICKS);
const missing = names.filter((n) => !editorial[n]);
if (missing.length || names.length !== 23) problems.push(`coverage: ${names.length} neighbourhoods, missing text: ${missing.join(', ')}`);

for (const name of names) {
  let image = { url: null, attribution: null };
  const key = PICKS[name];
  if (key) {
    const hit = (candidates[name] || []).find((c) => c.title.startsWith(key));
    if (!hit) problems.push(`${name}: pick not found in candidates`);
    else {
      image = {
        url: hit.thumb,
        attribution: `Photo: ${hit.artist || 'unknown'} / ${hit.licence}`
      };
    }
  }
  plan.push({ name, description: editorial[name].description, metaDescription: editorial[name].metaDescription, ...image });
}

console.log(`plan: ${plan.length} neighbourhoods; with image ${plan.filter((p) => p.url).length}; without ${plan.filter((p) => !p.url).length}`);
if (problems.length) {
  console.log('PROBLEMS:\n  ' + problems.join('\n  '));
  process.exit(1);
}
if (!APPLY) {
  console.log('dry run only. Re-run with --apply.');
  process.exit(0);
}

// Archive the values being replaced before writing anything.
const db = new DatabaseSync(DB);
const old = db.prepare('SELECT id, name, description, photoUrl FROM neighborhoods ORDER BY name').all();
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
const archive = path.join(ROOT, 'data', `neighbourhood-content-replaced-${stamp}.csv`);
const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
fs.writeFileSync(archive, ['id,name,previous_description,previous_photoUrl']
  .concat(old.map((r) => [r.id, q(r.name), q(r.description), q(r.photoUrl)].join(',')))
  .join('\n') + '\n', 'utf8');

const update = db.prepare(`UPDATE neighborhoods SET description = ?, metaDescription = ?, imageUrl = ?, imageAttribution = ?, photoUrl = NULL WHERE name = ?`);
db.exec('BEGIN');
try {
  for (const p of plan) update.run(p.description, p.metaDescription, p.url, p.attribution, p.name);
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}
const after = db.prepare('SELECT COUNT(*) AS n, SUM(imageUrl IS NOT NULL) AS img, SUM(metaDescription IS NOT NULL) AS meta FROM neighborhoods').get();
console.log(`archived ${old.length} rows to ${archive}`);
console.log(`applied: rows=${after.n} with imageUrl=${after.img} with metaDescription=${after.meta}`);
db.close();
