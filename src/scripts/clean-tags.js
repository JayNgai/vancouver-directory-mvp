/**
 * Tag cleanup across all listings. Dry run unless --apply.
 *  (a) normalise case, separators (_ and spaces -> -), split packed values ("japanese;sushi")
 *  (b) drop tags that only repeat a category name, a neighbourhood name, or a plain cuisine
 *      already present as a separate tag (cuisine-x when x exists)
 *  (c) drop noise: empty, 1-2 character fragments, UUIDs, raw OSM key=value / key:value tags
 *  (d) keep cuisine, dietary, amenity and feature tags, and the source-* provenance markers
 * Every removal and every rename is archived to data/ before the database is changed.
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..', '..');
const APPLY = process.argv.includes('--apply');
const CATEGORY_WORDS = new Set(['restaurant', 'cafe', 'bar', 'pub', 'bar-pub', 'bakery', 'dessert', 'fast-food', 'other']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

const db = new DatabaseSync(path.join(ROOT, 'prisma', 'dev.db'));
const neighbourhoods = new Map(db.prepare('SELECT id, name FROM neighborhoods').all().map((n) => [n.id, n.name]));
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const rows = db.prepare('SELECT id, name, neighborhoodId, tags FROM businesses').all();

const removed = [];
const renamed = [];
const summary = { rows: rows.length, changedRows: 0, removed: 0, renamed: 0 };
const updates = [];

for (const row of rows) {
  let original;
  try { original = JSON.parse(row.tags || '[]'); } catch { original = String(row.tags || '').split(','); }
  if (!Array.isArray(original)) original = [];
  const hood = neighbourhoods.get(row.neighborhoodId) || '';
  const hoodSlugs = new Set([slugify(hood), slugify(hood.split(/[ -]/)[0] || '')]);

  // (a) normalise and split
  const normalised = [];
  for (const raw of original) {
    for (const piece of String(raw).split(/[;,]/)) {
      const cleaned = piece.trim().toLowerCase().replace(/[_\s/]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      if (piece.trim() && cleaned !== String(raw).trim()) {
        renamed.push({ businessId: row.id, name: row.name, from: raw, to: cleaned || '' });
      }
      normalised.push({ raw, cleaned });
    }
  }

  const present = new Set(normalised.map((n) => n.cleaned).filter(Boolean));
  const kept = [];
  const seen = new Set();
  for (const { raw, cleaned } of normalised) {
    let reason = null;
    if (!cleaned) reason = 'empty';
    else if (cleaned.length <= 2) reason = 'fragment';
    else if (UUID.test(cleaned)) reason = 'uuid';
    else if (!cleaned.startsWith('source-') && /[=:]/.test(cleaned)) reason = 'raw-osm-key';
    else if (CATEGORY_WORDS.has(cleaned)) reason = 'category-duplicate';
    else if (hoodSlugs.has(cleaned) && cleaned.length > 2) reason = 'neighbourhood-duplicate';
    else if (cleaned.startsWith('cuisine-') && present.has(cleaned.slice('cuisine-'.length))) reason = 'cuisine-duplicate';
    else if (seen.has(cleaned)) reason = 'duplicate-after-normalising';
    if (reason) {
      removed.push({ businessId: row.id, name: row.name, tag: raw, normalised: cleaned, reason });
      continue;
    }
    seen.add(cleaned);
    kept.push(cleaned);
  }

  const before = JSON.stringify(original);
  const after = JSON.stringify(kept);
  if (before !== after) {
    summary.changedRows += 1;
    updates.push({ id: row.id, tags: after });
  }
}
summary.removed = removed.length;
summary.renamed = renamed.length;

const reasons = {};
for (const r of removed) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
console.log(JSON.stringify({ ...summary, removedByReason: reasons }, null, 2));

if (!APPLY) { console.log('dry run only; re-run with --apply'); process.exit(0); }

const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
const removedCsv = path.join(ROOT, 'data', `tags-removed-${stamp}.csv`);
const renamedCsv = path.join(ROOT, 'data', `tags-renamed-${stamp}.csv`);
fs.writeFileSync(removedCsv, ['businessId,name,tag,normalised,reason']
  .concat(removed.map((r) => [r.businessId, q(r.name), q(r.tag), q(r.normalised), r.reason].join(','))).join('\n') + '\n', 'utf8');
fs.writeFileSync(renamedCsv, ['businessId,name,from,to']
  .concat(renamed.map((r) => [r.businessId, q(r.name), q(r.from), q(r.to)].join(','))).join('\n') + '\n', 'utf8');
console.log('archived:', removedCsv, renamedCsv);

const update = db.prepare('UPDATE businesses SET tags = ? WHERE id = ?');
db.exec('BEGIN');
try {
  for (const u of updates) update.run(u.tags, u.id);
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}
console.log(`applied to ${updates.length} rows`);
db.close();
