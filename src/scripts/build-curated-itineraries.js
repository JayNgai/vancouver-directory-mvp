/**
 * Builds one curated itinerary per neighbourhood from real listings. Dry run unless --apply.
 * Theme is the first of THEMES that has >= 3 contactable, geo-located listings in one 1.5 km cluster.
 * Titles and descriptions are generated from the chosen stops only (no invented claims).
 * Adds rows to itineraries and itinerary_steps. Existing itineraries are left untouched.
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { haversine, completeness, formatClock } = require('../lib/concierge');

const ROOT = path.join(__dirname, '..', '..');
const APPLY = process.argv.includes('--apply');
const THEMES = [
  { key: 'coffee', label: 'Coffee Walk', test: (b) => b.category === 'Cafe' },
  { key: 'bar', label: 'Bar Crawl', test: (b) => b.category === 'Bar / Pub' },
  { key: 'sushi', label: 'Sushi Trail', test: (b) => tagsOf(b).includes('sushi') },
  { key: 'brunch', label: 'Brunch Tour', test: (b) => tagsOf(b).includes('breakfast') },
  { key: 'sweets', label: 'Sweet Stops', test: (b) => ['Bakery', 'Dessert'].includes(b.category) },
  { key: 'food', label: 'Food Tour', test: (b) => ['Restaurant', 'Bakery', 'Dessert', 'Cafe'].includes(b.category) }
];
function tagsOf(b) { try { return JSON.parse(b.tags || '[]'); } catch { return []; } }
const slugify = (s) => String(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const id = () => 'it' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);

const db = new DatabaseSync(path.join(ROOT, 'prisma', 'dev.db'));
const hoods = db.prepare('SELECT id, name, slug FROM neighborhoods ORDER BY name').all();
const all = db.prepare('SELECT id, name, slug, neighborhoodId, category, primaryCategory, tags, phone, website, address, latitude, longitude, cityLicenceStatus, hours FROM businesses').all();
const eligible = all.filter((b) => (b.phone || b.website) && b.latitude != null && b.longitude != null);

const plan = [];
const skipped = [];
for (const hood of hoods) {
  const local = eligible.filter((b) => b.neighborhoodId === hood.id);
  let picked = null;
  for (const theme of THEMES) {
    const matches = local.filter(theme.test);
    if (matches.length < 3) continue;
    // Anchor on the densest cluster and walk the nearest-neighbour route, up to 5 stops.
    const density = (b) => matches.filter((c) => c !== b && haversine(b, c) <= 1500).length;
    const anchor = matches.slice().sort((a, b) => density(b) - density(a) || completeness(b) - completeness(a) || a.name.localeCompare(b.name))[0];
    if (density(anchor) < 2) continue;
    const route = [anchor];
    while (route.length < Math.min(5, matches.length)) {
      const last = route[route.length - 1];
      const rest = matches.filter((c) => !route.includes(c)).sort((a, b) => haversine(last, a) - haversine(last, b) || a.name.localeCompare(b.name));
      if (haversine(last, rest[0]) > 1500) break;
      route.push(rest[0]);
    }
    if (route.length < 3) continue;
    picked = { theme, route };
    break;
  }
  if (!picked) { skipped.push(hood.name); continue; }
  const legs = picked.route.slice(1).map((b, i) => haversine(picked.route[i], b));
  const longest = Math.max(0, ...legs);
  const names = picked.route.map((b) => b.name);
  plan.push({
    hood,
    theme: picked.theme,
    title: `${hood.name} ${picked.theme.label}`,
    slug: `${slugify(hood.name)}-${picked.theme.key}`,
    description: `A ${picked.route.length}-stop ${picked.theme.label.toLowerCase()} in ${hood.name}, in walking order: ${names.join(', ')}.`,
    duration: `${picked.route.length} stops`,
    difficulty: longest <= 1000 ? 'Easy' : 'Moderate',
    stops: picked.route,
    legs
  });
}

console.log(`planned ${plan.length} itineraries; no qualifying theme in: ${skipped.join(', ') || 'none'}`);
for (const p of plan) console.log(`  ${p.title} (${p.stops.length} stops, ${p.difficulty}): ${p.stops.map((s) => s.name).join(' > ')}`);
if (!APPLY) { console.log('dry run only; re-run with --apply'); process.exit(0); }

const existing = new Set(db.prepare('SELECT slug FROM itineraries').all().map((r) => r.slug));
const insertIt = db.prepare('INSERT INTO itineraries (id, title, slug, neighborhoodId, duration, difficulty, description, highlights, createdAt) VALUES (?,?,?,?,?,?,?,?,?)');
const insertStep = db.prepare('INSERT INTO itinerary_steps (id, itineraryId, "order", time, activity, notes, durationMinutes, businessId) VALUES (?,?,?,?,?,?,?,?)');
db.exec('BEGIN');
try {
  let n = 0;
  for (const p of plan) {
    if (existing.has(p.slug)) continue;
    const itId = id();
    insertIt.run(itId, p.title, p.slug, p.hood.id, p.duration, p.difficulty, p.description, '[]', new Date().toISOString());
    let clock = 10 * 60;
    p.stops.forEach((s, i) => {
      const gap = i < p.legs.length ? Math.round(p.legs[i] / 80) + 5 : 0;
      insertStep.run(id(), itId, i + 1, formatClock(clock), `Visit ${s.name}`, `${s.category}; walk to the next stop about ${i < p.legs.length ? Math.round(p.legs[i] / 80) : 0} min`, 60, s.id);
      clock += 60 + gap;
    });
    n++;
  }
  db.exec('COMMIT');
  console.log(`inserted ${n} itineraries`);
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}
db.close();
