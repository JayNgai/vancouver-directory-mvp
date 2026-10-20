#!/usr/bin/env node
/**
 * The guard Alfred asked for: CSP kills inline handler attributes WITHOUT A SOUND, so the check has to
 * be at WRITE TIME, not at runtime.
 *
 * This app serves `script-src-attr 'none'` (helmet defaults). An inline `on*` attribute is then INERT:
 * the page still renders, inline <script> BLOCKS still run, and the attribute still READS correctly in
 * the DOM - so a broken interaction looks perfectly healthy. That shipped a dead drag-and-drop, a dead
 * tap-to-swap and a dead search filter, all silent.
 *
 * It also covers the second bug on the same header: `style-src 'self'` blocks an external stylesheet,
 * which is how the Google Fonts @import silently killed the site's typography.
 *
 * Run: node src/scripts/check-csp-interactions.js       (offline, no browser)
 */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..');

let fails = 0;
const ok = (c, l, d) => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${l}${d ? '  ' + d : ''}`); if (!c) fails++; };

const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const list = (dir, ext) => fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith(ext)).map((f) => `${dir}/${f}`);
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

// ---- 1. THE BAN, applied to EVERYTHING, with exemptions named rather than assumed ----
// Scanning every template (not just the statically-rendered ones) is the conservative choice: a partial
// or a layout reaches a user through the template that INCLUDES it, so "not rendered directly" is not a
// reason to skip it. Only a file that cannot reach a user at all may be exempt - and section 2 proves
// that rather than trusting it.
const ON = /\b(onclick|onchange|onsubmit|oninput|ondrop|ondragover|ondragenter|ondragleave|ondragstart|ondragend|onload|onerror|onkeydown|onkeyup|onkeypress|onfocus|onblur|onmouseover|onmouseout|onmousedown|onmouseup|onmousemove|ontouchstart|ontouchend|onscroll)\s*=/g;

// A file here may keep inline handlers ONLY because it cannot reach a user.
const EXEMPT = {
  'concierge.before-redesign.html': 'pre-redesign snapshot superseded by concierge.html; no render call references it',
};

console.log('--- 1. no inline on* handler attribute anywhere in the templates or page scripts ---');
let violations = 0;
for (const t of list('templates', '.html')) {
  const name = path.basename(t);
  const hits = stripComments(read(t)).match(ON) || [];
  if (EXEMPT[name]) {
    console.log(`  SKIP  ${name} - exempt: ${EXEMPT[name]}${hits.length ? ` (holds ${hits.length})` : ''}`);
    continue;
  }
  ok(hits.length === 0, `${name} declares no inline handler attribute`, hits.join(' '));
  violations += hits.length;
}
for (const j of list('public', '.js')) {
  const hits = stripComments(read(j)).match(ON) || [];
  ok(hits.length === 0, `${path.basename(j)} emits no inline handler attribute`, hits.join(' '));
  violations += hits.length;
}

// ---- 2. an exemption must be PROVEN unreachable, or it is just hiding something live ----
console.log('\n--- 2. every exempt file is genuinely unreachable (an exemption must not hide a live bug) ---');
const srcFiles = [];
(function walk(d) {
  for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = `${d}/${e.name}`;
    if (e.isDirectory()) walk(p); else if (e.name.endsWith('.js')) srcFiles.push(p);
  }
})('src');
srcFiles.push('server.js');
const rendered = new Set();
for (const f of srcFiles) {
  if (!fs.existsSync(path.join(root, f))) continue;
  for (const m of read(f).matchAll(/res\.render\(\s*['"]([^'"]+)['"]/g)) rendered.add(path.basename(m[1]));
}
// a computed template name would make reachability unknowable, so refuse to guess
const dynamic = srcFiles.some((f) => fs.existsSync(path.join(root, f)) && /res\.render\(\s*(?!['"])/.test(read(f)));
ok(!dynamic, 'no render call takes a computed template name (reachability can be trusted)');
for (const name of Object.keys(EXEMPT)) {
  ok(!rendered.has(name), `${name} is NOT referenced by any render call`,
    rendered.has(name) ? 'IT IS - the exemption is wrong' : '');
}
console.log(`  (info) ${rendered.size} templates are named by a literal render call; layouts and _partials`);
console.log('         reach users through those, which is why the ban above is unconditional.');

// ---- 4. the CSP config that makes all of the above true ----
console.log('\n--- 4. the CSP configuration ---');
const serverSrc = stripComments(read('server.js'));
ok(/useDefaults:\s*true/.test(serverSrc), "helmet defaults are on (they supply script-src-attr 'none')");
ok(!/scriptSrcAttr/.test(serverSrc), 'scriptSrcAttr is NOT overridden to re-enable inline handlers');
ok(/styleSrc:\s*\[/.test(serverSrc), 'styleSrc is set explicitly');

// ---- 5. the fonts: vendored, or loaded under a directive that forbids them ----
console.log('\n--- 5. webfonts load under this CSP (vendored, not remote) ---');
const cssFiles = list('public', '.css');
let remoteFontRefs = 0;
for (const c of cssFiles) {
  const hits = (read(c).match(/fonts\.googleapis\.com|fonts\.gstatic\.com/g) || []);
  ok(hits.length === 0, `${path.basename(c)} references no remote font host`, hits.length ? `${hits.length} ref(s)` : '');
  remoteFontRefs += hits.length;
}
const fontDir = 'public/vendor/fonts';
ok(fs.existsSync(path.join(root, fontDir)), 'the fonts are vendored under public/vendor/fonts');
if (fs.existsSync(path.join(root, fontDir))) {
  const files = fs.readdirSync(path.join(root, fontDir));
  const woff = files.filter((f) => f.endsWith('.woff2'));
  ok(woff.length > 0, 'vendored .woff2 files exist', `${woff.length} files`);
  const fcss = files.includes('fonts.css') ? read(`${fontDir}/fonts.css`) : '';
  ok(!/https?:\/\//.test(fcss), 'the vendored @font-face file points at no remote URL');
  // every file it references must exist
  const refs = [...fcss.matchAll(/url\('([^']+)'\)/g)].map((m) => m[1]);
  const missing = refs.filter((r) => !fs.existsSync(path.join(root, fontDir, path.basename(r))));
  ok(refs.length > 0 && missing.length === 0, 'every vendored @font-face src resolves on disk', missing.join(', '));
  ok(cssFiles.every((c) => !/fonts\.googleapis/.test(read(c))), 'no CSS file still imports Google Fonts');
}

// ---- 6. a control marked data-autosubmit must have something listening ----
console.log('\n--- 6. data-autosubmit has a listener ---');
const withAutosubmit = list('templates', '.html').filter((t) => /data-autosubmit/.test(read(t)));
const usesAutosubmit = withAutosubmit.length > 0;
if (usesAutosubmit) {
  ok(fs.existsSync(path.join(root, 'public/forms.js')), 'public/forms.js exists (the auto-submit wiring)');
  ok(/addEventListener\('change'/.test(read('public/forms.js')), "forms.js attaches a 'change' listener");
  for (const t of withAutosubmit) {
    ok(/<script[^>]*src="\/forms\.js"/.test(read(t)), `${path.basename(t)} loads /forms.js`);
  }
} else {
  console.log('  (no template uses data-autosubmit)');
}

console.log(`\nRESULT: ${fails === 0 ? 'ALL PASS' : fails + ' FAILURE(S)'}  (${violations} inline handler attribute(s) found)`);
process.exit(fails === 0 ? 0 : 1);
