/**
 * Merge same-venue duplicates. Dry run unless --apply.
 * Rule: same normalised name AND same normalised address AND within 50 m of each other.
 * Keep the most complete row; fill its empty fields from the removed row; repoint itinerary steps;
 * add the removed slug to the kept row's slugAliases; archive every removed row to CSV first.
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const APPLY = process.argv.includes('--apply');
const ROOT = path.join(__dirname, '..', '..');
const db = new DatabaseSync(path.join(ROOT, 'prisma', 'dev.db'));

const norm = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const metres = (a, b) => {
  const R = 6371000, r = Math.PI / 180;
  const dl = (b.latitude - a.latitude) * r, dn = (b.longitude - a.longitude) * r;
  const x = Math.sin(dl / 2) ** 2 + Math.cos(a.latitude * r) * Math.cos(b.latitude * r) * Math.sin(dn / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
const FIELDS = ['neighborhoodId', 'category', 'primaryCategory', 'address', 'latitude', 'longitude', 'phone', 'website', 'hours', 'priceRange', 'description', 'liquorLicenceType', 'liquorServiceHours', 'cityLicenceStatus', 'cityLicenceDataDate', 'dataSources', 'overtureConfidence', 'imageUrl', 'imageAttribution'];
const completeness = (r) => FIELDS.filter((f) => r[f] != null && String(r[f]).trim() !== '').length;

const rows = db.prepare('SELECT * FROM businesses').all();
const groups = new Map();
for (const r of rows) {
  const key = norm(r.name) + '|' + norm(r.address);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}
const plan = []; // {keep, removes:[row]}
for (const members of groups.values()) {
  if (members.length < 2) continue;
  const used = new Set();
  for (const m of members) {
    if (used.has(m.id)) continue;
    const cluster = members.filter((o) => !used.has(o.id) && o.latitude != null && m.latitude != null && metres(m, o) <= 50);
    cluster.forEach((c) => used.add(c.id));
    if (cluster.length < 2) continue;
    cluster.sort((a, b) => completeness(b) - completeness(a) || a.id.localeCompare(b.id));
    plan.push({ keep: cluster[0], removes: cluster.slice(1) });
  }
}
const removedCount = plan.reduce((n, p) => n + p.removes.length, 0);
console.log(`groups to merge: ${plan.length}; rows removed: ${removedCount}`);
for (const p of plan) console.log(`  keep ${p.keep.name} [${p.keep.address}] (${completeness(p.keep)} fields) <- drop ${p.removes.length}`);
if (!APPLY) { console.log('dry run only; pass --apply'); process.exit(0); }

const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
const csvFile = path.join(ROOT, 'data', `duplicates-merged-${stamp}.csv`);
const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const cols = Object.keys(rows[0]);
const out = [cols.join(',')];
for (const p of plan) for (const r of p.removes) out.push(cols.map((c) => esc(r[c])).join(','));
fs.writeFileSync(csvFile, out.join('\n') + '\n', 'utf8');

const repoint = db.prepare('UPDATE itinerary_steps SET businessId = ? WHERE businessId = ?');
const fill = db.prepare('UPDATE businesses SET ' + FIELDS.map((f) => `${f} = COALESCE(NULLIF(${f}, ''), ?)`).join(', ') + ', slugAliases = ? WHERE id = ?');
const del = db.prepare('DELETE FROM businesses WHERE id = ?');
db.exec('BEGIN');
try {
  for (const p of plan) {
    let aliases = [];
    try { aliases = JSON.parse(p.keep.slugAliases || '[]'); } catch { aliases = []; }
    for (const r of p.removes) {
      repoint.run(p.keep.id, r.id);
      aliases.push(r.slug);
      // Fill gaps in the kept row from the removed one (never overwrite a non-empty value).
      const values = FIELDS.map((f) => (p.keep[f] == null || String(p.keep[f]).trim() === '') ? r[f] : p.keep[f]);
      fill.run(...FIELDS.map((f, i) => values[i]), JSON.stringify([...new Set(aliases)]), p.keep.id);
      Object.assign(p.keep, Object.fromEntries(FIELDS.map((f, i) => [f, values[i]])));
      del.run(r.id);
    }
  }
  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  throw e;
}
console.log(`merged: removed ${removedCount} rows; archived to ${csvFile}`);
console.log('businesses now:', db.prepare('SELECT COUNT(*) n FROM businesses').get().n);
