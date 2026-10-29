#!/usr/bin/env node
/**
 * Self-host the neighbourhood photographs, and drop the dishonest ones.
 *
 * WHY: the old cards hotlinked Wikimedia Commons. Two separate problems:
 *
 *  1. Every page load made 20 requests to a domain nobody here controls. The
 *     brief requires zero third-party image hosts, so the bytes must be local.
 *
 *  2. Half of the images did not show their neighbourhood. Inspecting all 20
 *     found a derelict interior for Commercial Drive, a library building for
 *     Kerrisdale, a college lawn for Point Grey, a sepia railway station for
 *     Renfrew-Collingwood, black-and-white archive shots for West End, a bin in
 *     an empty corridor for Yaletown, rubble for Strathcona, and a poverty-coded
 *     street shot for Mount Pleasant. Using those as a district's identity is
 *     the "automated and careless" read the audit flagged.
 *
 * KEEP means: a photograph of that neighbourhood, at street level, that a person
 * would recognise. DROP means: no image, and the designed no-photo state renders
 * instead. An honest absence beats a misleading presence.
 *
 * Attribution strings already carry author + licence ("Photo: X / CC BY-SA 4.0")
 * and are preserved untouched.
 *
 * Run: node src/scripts/self-host-neighborhood-photos.js --dry
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const root = path.join(__dirname, '..', '..');
const imgDir = path.join(root, 'public', 'img');
const prisma = new PrismaClient();
const dry = process.argv.includes('--dry');

// Judged one by one from a rendered contact sheet, not assumed from a filename.
const KEEP = [
  'Chinatown',            // Millennium Gate, the district's own landmark
  'Coal Harbour',         // marina and mountains
  'Downtown Vancouver',   // cherry-blossom street, people, colour
  'False Creek',          // Burrard Bridge and the skyline
  'Gastown',              // brick storefronts at street level
  'Grandview-Woodland',   // park with a community event
  'Hastings-Sunrise',     // leafy residential street
  'Killarney',            // park and sculpture
  'Kitsilano',            // street, shops, mountains behind
  'Marpole',              // Granville Street frontage
  'Oakridge',             // the district seen whole
  'South Granville',      // the commercial strip
];

// No honest photograph available -> designed absence.
const DROP = [
  'Commercial Drive',     // derelict interior, rubble
  'Kerrisdale',           // a library building, not a district
  'Mount Pleasant',       // poverty-coded street shot
  'Point Grey',           // a college lawn
  'Renfrew-Collingwood',  // sepia archive railway station
  'Strathcona',           // dark interior with refuse bags
  'West End',             // black-and-white archive house
  'Yaletown',             // empty corridor with a bin
];

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'jayngai.com photo self-host (one-off migration)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 5000) throw new Error(`suspiciously small (${buf.length}b)`);
  fs.writeFileSync(dest, buf);
  return buf.length;
}

async function main() {
  if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

  const rows = await prisma.neighborhood.findMany({ select: { id: true, slug: true, name: true, imageUrl: true, imageAttribution: true } });
  let kept = 0;
  let dropped = 0;
  let already = 0;
  let failed = 0;

  for (const n of rows) {
    if (KEEP.includes(n.name)) {
      if (!n.imageUrl) { console.log(`  SKIP ${n.name}: no image to keep`); continue; }
      if (n.imageUrl.startsWith('/img/hood-')) { already += 1; continue; }

      const ext = (n.imageUrl.match(/\.(jpe?g|png|webp)(\?|$)/i) || [null, 'jpg'])[1].toLowerCase();
      const filename = `hood-${n.slug}.${ext === 'jpeg' ? 'jpg' : ext}`;
      const dest = path.join(root, 'public', 'img', filename);

      if (dry) {
        console.log(`  would keep   ${n.name} -> /img/${filename}`);
      } else {
        try {
          const bytes = await download(n.imageUrl, dest);
          await prisma.neighborhood.update({
            where: { id: n.id },
            data: { imageUrl: `/img/${filename}` },
          });
          console.log(`  kept         ${n.name} -> /img/${filename} (${Math.round(bytes / 1024)} KB)`);
          kept += 1;
        } catch (e) {
          console.error(`  FAILED ${n.name}: ${e.message}`);
          await prisma.neighborhood.update({ where: { id: n.id }, data: { imageUrl: null, imageAttribution: null } });
          failed += 1;
        }
      }
    } else if (DROP.includes(n.name) && n.imageUrl) {
      if (dry) {
        console.log(`  would drop   ${n.name}`);
      } else {
        await prisma.neighborhood.update({ where: { id: n.id }, data: { imageUrl: null, imageAttribution: null } });
        console.log(`  dropped      ${n.name} -> designed no-photo state`);
        dropped += 1;
      }
    }
  }

  if (!dry) {
    const withImg = await prisma.neighborhood.count({ where: { imageUrl: { not: null } } });
    const withoutImg = await prisma.neighborhood.count({ where: { imageUrl: null } });
    console.log('');
    console.log(`kept ${kept} · already local ${already} · dropped ${dropped} · failed ${failed}`);
    console.log(`neighbourhoods with a local photo: ${withImg}`);
    console.log(`neighbourhoods on the no-photo state: ${withoutImg}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
