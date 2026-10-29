/**
 * Guards the responsive image pipeline.
 *
 * The failure this prevents is silent: `srcset` lists a file that was never built,
 * the browser picks it, and the image simply does not appear. Nothing 500s, nothing
 * logs, and the page looks like a photograph was deleted. So every URL the filters
 * would emit is checked against the filesystem, and every district source is checked
 * for the variants the template expects.
 *
 * Run:  node src/scripts/check-image-variants.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { variantParts, preferredSrc, IMG_DIR, VARIANT_WIDTHS } = require('../lib/image-filters');

let failures = 0;
const check = (cond, label, detail) => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
    if (!cond) failures++;
};

console.log('--- every district source has variants ---');

const sources = fs.readdirSync(IMG_DIR).filter((f) => /^hood-.+\.(jpe?g|png)$/i.test(f));
check(sources.length > 0, 'district sources found', `${sources.length}`);

let totalVariants = 0;
for (const file of sources) {
    const url = `/img/${file}`;
    const parts = variantParts(url);
    totalVariants += parts.length;
    check(parts.length >= 2, `${file} has at least 480 and 800 variants`, `${parts.length} of ${VARIANT_WIDTHS.length}`);

    // Every listed URL must actually resolve, or the browser downloads a 404.
    const missing = parts
        .map((p) => p.split(' ')[0])
        .filter((u) => !fs.existsSync(path.join(IMG_DIR, path.basename(u))));
    check(missing.length === 0, `  ${file}: every srcset entry exists on disk`, missing.join(', ') || 'ok');

    const preferred = preferredSrc(url);
    check(fs.existsSync(path.join(IMG_DIR, path.basename(preferred))),
        `  ${file}: the fallback src exists`, preferred);
}

console.log('\n--- the filters stay quiet when there is nothing to offer ---');
check(variantParts('/img/lees-1x.webp').length === 0, 'a file with no variants yields no srcset');
check(preferredSrc('/img/lees-1x.webp') === '/img/lees-1x.webp', 'and keeps its own src');
check(variantParts(null).length === 0, 'null input is handled');
check(preferredSrc(undefined) === undefined, 'undefined input is handled');

console.log(`\nsources: ${sources.length}, variants: ${totalVariants}`);
console.log(`\nRESULT: ${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
