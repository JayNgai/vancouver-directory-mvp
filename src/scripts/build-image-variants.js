/**
 * Generates responsive WebP variants for the district photographs.
 *
 * WHY: the five district tiles on the home page were shipping 1280px JPEGs into a
 * 356x148 slot at 390px wide - a 3.6x oversample that made up roughly 1,900 KB of
 * the 2,219 KB home transfer. Resizing is the single largest remaining win, and it
 * needs a real encoder, hence sharp (approved as a devDependency).
 *
 * Widths are fixed rather than "whatever the original is", so the srcset the
 * template emits always has matching files. A portrait or unusually small source
 * simply produces fewer variants.
 *
 * Idempotent: skips an output that is newer than its source. Safe to re-run.
 *
 * Run:  node src/scripts/build-image-variants.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const IMG_DIR = path.join(__dirname, '..', '..', 'public', 'img');
const WIDTHS = [480, 800, 1280];
const QUALITY = 74;

// Only the district photographs come from a shopping-mall of sizes. The business
// photos were already produced at -1x/-2x by an earlier pass.
const SOURCE_RE = /^hood-[a-z0-9-]+\.(jpe?g|png)$/i;

async function main() {
    const files = fs.readdirSync(IMG_DIR).filter((f) => SOURCE_RE.test(f)).sort();
    if (!files.length) {
        console.log('no source images matched — nothing to do');
        return;
    }

    let sourceBytes = 0;
    let variantBytes = 0;
    let made = 0;
    let skipped = 0;

    for (const file of files) {
        const sourcePath = path.join(IMG_DIR, file);
        const stat = fs.statSync(sourcePath);
        sourceBytes += stat.size;
        const base = file.replace(/\.(jpe?g|png)$/i, '');
        const meta = await sharp(sourcePath).metadata();

        for (const width of WIDTHS) {
            if (meta.width && meta.width < width) continue; // never upscale
            const outName = `${base}-${width}.webp`;
            const outPath = path.join(IMG_DIR, outName);

            if (fs.existsSync(outPath) && fs.statSync(outPath).mtimeMs >= stat.mtimeMs) {
                variantBytes += fs.statSync(outPath).size;
                skipped++;
                continue;
            }

            const info = await sharp(sourcePath)
                .resize({ width, withoutEnlargement: true })
                .webp({ quality: QUALITY })
                .toFile(outPath);

            variantBytes += info.size;
            made++;
            console.log(`  ${outName.padEnd(38)} ${String(Math.round(info.size / 1024)).padStart(5)} KB  (${info.width}x${info.height})`);
        }
    }

    console.log('');
    console.log(`sources : ${files.length} files, ${Math.round(sourceBytes / 1024)} KB`);
    console.log(`variants: ${made} written, ${skipped} already current, ${Math.round(variantBytes / 1024)} KB total`);
}

main().catch((error) => {
    console.error('image variant build failed:', error.message);
    process.exit(1);
});
