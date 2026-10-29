/**
 * Responsive-image helpers, registered on a Nunjucks environment.
 *
 * Extracted so the server and the template guards share ONE implementation. The
 * photo-state guard renders `_listing-photo.html` in its own environment; when the
 * filters lived inline in server.js that guard rendered a template whose filters did
 * not exist and failed for a reason that had nothing to do with photographs.
 *
 * The core problem the filters solve: a template cannot know which variant files
 * exist on disk. Emitting a srcset entry for a file that was never built is worse
 * than emitting none - the browser selects the missing file and the image vanishes.
 * So the template asks, and the answer comes from the filesystem.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const IMG_DIR = path.join(__dirname, '..', '..', 'public', 'img');
const VARIANT_WIDTHS = [480, 800, 1280];

// The largest rendered slot is a bento tile at ~594px (measured at 1440). Saying 600
// here is what makes the browser pick the 800px file for that slot instead of 480.
const SIZES = '(max-width: 600px) 96vw, (max-width: 1000px) 48vw, 600px';

const SOURCE_RE = /^\/img\/(.+)\.(jpe?g|png)$/i;

function baseName(url) {
    if (typeof url !== 'string') return null;
    const match = url.match(SOURCE_RE);
    return match ? match[1] : null;
}

function variantParts(url) {
    const base = baseName(url);
    if (!base) return [];
    const parts = [];
    for (const width of VARIANT_WIDTHS) {
        const name = `${base}-${width}.webp`;
        if (fs.existsSync(path.join(IMG_DIR, name))) parts.push(`/img/${name} ${width}w`);
    }
    return parts;
}

function preferredSrc(url) {
    const base = baseName(url);
    if (!base) return url;
    const candidate = `${base}-800.webp`;
    return fs.existsSync(path.join(IMG_DIR, candidate)) ? `/img/${candidate}` : url;
}

function registerImageFilters(env) {
    env.addFilter('srcset', (url) => variantParts(url).join(', '));
    env.addFilter('preferred', preferredSrc);
    env.addGlobal('IMG_SIZES', SIZES);
    return env;
}

module.exports = { registerImageFilters, variantParts, preferredSrc, SIZES, VARIANT_WIDTHS, IMG_DIR };
