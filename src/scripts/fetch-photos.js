#!/usr/bin/env node
/**
 * Assign a generic stand-in photograph to listings, self-hosted at render size.
 *
 * WHY A SCRIPT AND NOT A CDN: the old site hotlinked Wikimedia Commons at 1280px
 * into a 356x170 box — roughly 20x the pixels the layout used, 6.1 MB of the 6.25 MB
 * page, from a domain nobody here controls. A directory that looks like nobody has
 * ever been there cannot convert, but neither can one that ships 6 MB of someone
 * else's bandwidth.
 *
 * HONESTY RULE: every image written here is a GENERIC stand-in for a category, not a
 * photograph of the venue. imageAttribution says so in words the user reads. The
 * assignment is by category, and the manifest records that each image was inspected
 * first — a bakery gets bread, a bar gets a bar.
 *
 * When an owner claims a listing and uploads their own photo, imageKind becomes
 * 'owner' and the stand-in notice disappears from the card.
 *
 * Downloads 1x (400px) and 2x (800px) WebP. Requests `fm=webp` from the source so no
 * local image encoder is needed and no new dependency is added.
 *
 * Run: node src/scripts/fetch-photos.js --dry
 *      node src/scripts/fetch-photos.js --limit=400
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const root = path.join(__dirname, '..', '..');
const imgDir = path.join(root, 'public', 'img');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'data', 'photo-manifest.json'), 'utf8'));
const prisma = new PrismaClient();

const dry = process.argv.includes('--dry');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : 400;

const SIZES = [{ suffix: '1x', w: 400 }, { suffix: '2x', w: 800 }];
const CREDIT_TAIL = ' — stand-in, not this venue';

function credit() {
  return `${manifest.credit}${CREDIT_TAIL}`;
}

/** Deterministic 0..n-1 from a string, so re-runs assign the same photo. */
function hashIndex(str, n) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % n;
}

function poolFor(category) {
  const pool = manifest.byCategory[category];
  return Array.isArray(pool) && pool.length ? pool : null;
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 4000) throw new Error(`suspiciously small (${buf.length}b): ${url}`);
  fs.writeFileSync(dest, buf);
  return buf.length;
}

async function main() {
  if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

  // Candidates: verified first, then the most complete records, and only venues
  // that do not already have an owner photo.
  //
  // NOT{ imageKind: 'owner' } is wrong here: on a nullable column SQL evaluates
  // null = 'owner' to NULL, so `NOT (...)` drops every row with no photo yet.
  // It matched zero of 2,958 listings. The OR form keeps the NULLs.
  const all = await prisma.business.findMany({
    where: { OR: [{ imageKind: null }, { imageKind: { not: 'owner' } }] },
    include: { neighborhood: true },
    orderBy: [{ isVerified: 'desc' }, { name: 'asc' }],
  });

  // Round-robin the category pool so the same stand-in does not land on two
  // venues that sit next to each other in a list.
  const counters = new Map();
  const assignments = [];
  for (const b of all) {
    if (assignments.length >= LIMIT) break;
    const pool = poolFor(b.category);
    if (!pool) continue; // no honest image for this category -> no-photo state
    const used = counters.get(b.category) || 0;
    const photoId = pool[used % pool.length];
    counters.set(b.category, used + 1);
    assignments.push({ business: b, photoId });
  }

  console.log(`manifest categories: ${Object.keys(manifest.byCategory).join(', ')}`);
  console.log(`candidates available: ${all.length}`);
  console.log(`assignments to write: ${assignments.length} (limit ${LIMIT})`);
  console.log(`categories left to the no-photo state: ${[...new Set(all.map((b) => b.category))].filter((c) => !poolFor(c)).join(', ') || 'none'}`);
  console.log('');

  let downloaded = 0;
  let failed = 0;
  const seen = new Set();

  for (const { business: b, photoId } of assignments) {
    const slug = b.slug || b.id;
    // The path and the URL must be the SAME string. They were not: files were
    // written to public/<slug>-1x.webp while imageUrl pointed at /img/<slug>-1x.webp,
    // so every card would have 404'd. name is the single source for both.
    const base = `img/${slug}`;
    const files = SIZES.map((s) => ({ ...s, name: `${base}-${s.suffix}.webp`, url: `/${base}-${s.suffix}.webp` }));
    const anyMissing = files.some((f) => !fs.existsSync(path.join(root, 'public', f.name)));

    if (anyMissing) {
      if (dry) {
        console.log(`  would fetch  ${slug}  <- ${photoId}`);
      } else {
        for (const f of files) {
          const src = `https://images.unsplash.com/photo-${photoId}?w=${f.w}&q=70&fm=webp&fit=crop`;
          try {
            const bytes = await download(src, path.join(root, 'public', f.name));
            downloaded += 1;
            if (!seen.has(slug)) console.log(`  fetched ${f.name} (${Math.round(bytes / 1024)} KB)`);
          } catch (e) {
            failed += 1;
            console.error(`  FAILED ${f.name}: ${e.message}`);
            break;
          }
        }
        seen.add(slug);
      }
    }

    if (!dry) {
      await prisma.business.update({
        where: { id: b.id },
        data: {
          imageUrl: `/${base}-1x.webp`,
          imageAttribution: credit(),
          imageKind: 'standin',
        },
      });
    }
  }

  if (!dry) {
    const standins = await prisma.business.count({ where: { imageKind: 'standin' } });
    const owners = await prisma.business.count({ where: { imageKind: 'owner' } });
    const total = await prisma.business.count();
    const filesOnDisk = fs.readdirSync(imgDir).filter((f) => f.endsWith('.webp')).length;
    console.log('');
    console.log(`imageKind=standin : ${standins}`);
    console.log(`imageKind=owner   : ${owners}`);
    console.log(`no photo (tier 0) : ${total - standins - owners} of ${total}`);
    console.log(`webp files on disk: ${filesOnDisk}`);
    console.log(`new downloads     : ${downloaded}   failures: ${failed}`);
  }

  await prisma.$disconnect();
  if (failed) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
