#!/usr/bin/env node
/**
 * The guard for the design token layer.
 *
 * WHY THIS EXISTS: the site had 34 distinct hex colours across four unrelated
 * design systems and ZERO custom properties defined. Nothing enforced anything,
 * so every new component invented its own palette — which is how the Concierge
 * ended up rendering in Bootstrap #007bff while the rest of the site was orange.
 *
 * A token layer with no guard regresses within a week. This refuses the commit.
 *
 * SCOPE / EXEMPTIONS, named rather than assumed:
 *   - public/tokens.css is the ONE file allowed to hold colour values.
 *   - public/vendor/** is third-party (Leaflet ships its own palette). Not ours.
 *   - templates/admin*.html are out of scope: the Global Constraints say never
 *     touch the admin templates, and it is incoherent to enforce a rule on files
 *     I am forbidden to change.
 *
 * Run: node src/scripts/check-design-tokens.js       (offline, no browser)
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');

let fails = 0;
const ok = (c, label, detail) => {
  console.log(`  ${c ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
  if (!c) fails++;
};

const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));

// Comments are prose, not paint. A hex value inside a comment explains WHY a
// colour was removed; scanning it would force us to stop writing down the reason.
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\{#[\s\S]*?#\}/g, '');

// ---- the contract -----------------------------------------------------------
// Every token the rest of the codebase is allowed to consume. Adding a token
// means adding it here; that is the point.
const REQUIRED = [
  '--surface', '--panel', '--sunk',
  '--ink', '--ink-2', '--muted',
  '--rule', '--rule-soft',
  '--brand', '--brand-deep', '--marker',
  '--open', '--closed', '--focus',
  '--font-display', '--font-ui', '--font-data',
  '--t-1', '--t0', '--t1', '--t2', '--t3', '--t4', '--t5',
  '--s1', '--s2', '--s3', '--s4', '--s5', '--s6',
  '--radius', '--radius-input',
  '--ease', '--dur',
];

// Colours from OTHER design systems that leaked in. These are never a choice
// anyone made about this brand — they are defaults that shipped by accident.
const BANNED_VALUES = [
  ['#007bff', 'Bootstrap primary blue — the var(--accent, #007bff) fallback'],
  ['#2b6cb0', 'Chakra blue.600'],
  ['#2f855a', 'Chakra green.600'],
  ['#22543d', 'Chakra green.800'],
  ['#0f766e', 'Tailwind teal.700'],
  ['#e05638', 'the retired brand orange (fails AA at 3.78:1 on white)'],
  ['#e6fffa', 'Chakra green.50'],
  ['#9ae6b4', 'Chakra green.200'],
  ['#fc8181', 'Chakra red.300'],
  ['#742a2a', 'Chakra red.800'],
  ['#fef3c7', 'ad-hoc amber badge'],
  ['#fff5f5', 'ad-hoc error surface'],
  ['#f0f7ff', 'ad-hoc hover blue'],
  ['#1e1b4b', 'the navy→brown gradient stop'],
  ['#431407', 'the navy→brown gradient stop'],
];

const HEX = /#[0-9a-fA-F]{3,8}\b/g;

const cssFiles = fs.readdirSync(path.join(root, 'public'))
  .filter((f) => f.endsWith('.css'))
  .map((f) => `public/${f}`);

const templateFiles = fs.readdirSync(path.join(root, 'templates'))
  .filter((f) => f.endsWith('.html'))
  .filter((f) => !/^admin/.test(f))
  .map((f) => `templates/${f}`);

// ============================================================================
console.log('--- 1. tokens.css exists and is the single source of tokens ---');

const tokensPath = 'public/tokens.css';
ok(exists(tokensPath), 'public/tokens.css exists');

let tokenCss = '';
if (exists(tokensPath)) {
  tokenCss = read(tokensPath);
  const rootBlocks = (tokenCss.match(/:root\s*\{/g) || []).length;
  ok(rootBlocks === 1, 'exactly one :root block', `found ${rootBlocks}`);
}

// ============================================================================
console.log('--- 2. every required token is defined in it ---');

const missing = [];
if (tokenCss) {
  for (const name of REQUIRED) {
    const re = new RegExp(name.replace(/[-]/g, '\\-') + '\\s*:');
    if (!re.test(tokenCss)) missing.push(name);
  }
}
ok(missing.length === 0, `all ${REQUIRED.length} required tokens defined`,
  missing.length ? 'missing: ' + missing.join(', ') : '');

// A token defined but never consumed is dead weight; report it, do not fail on
// it yet — this becomes a hard failure once Phase 4 rebuilds the pages.
const allCss = cssFiles
  .filter((f) => f !== tokensPath)
  .map((f) => stripComments(read(f)))
  .join('\n');
const templateBlob = templateFiles.map((f) => read(f)).join('\n');
const consumers = allCss + '\n' + templateBlob;
const unused = REQUIRED.filter((n) => !new RegExp(n.replace(/[-]/g, '\\-') + '(?![\\w-])').test(consumers));
console.log(`  ----  ${unused.length} token(s) defined but not yet consumed: ${unused.join(', ') || 'none'}`);

// ============================================================================
console.log('--- 3. no raw hex outside tokens.css ---');

for (const f of cssFiles) {
  if (f === tokensPath) continue;
  const hits = stripComments(read(f)).match(HEX) || [];
  ok(hits.length === 0, f, hits.length ? `${hits.length} hex value(s): ${[...new Set(hits)].slice(0, 6).join(' ')}` : '');
}
for (const f of templateFiles) {
  const hits = stripComments(read(f)).match(HEX) || [];
  ok(hits.length === 0, f, hits.length ? `${hits.length} hex value(s): ${[...new Set(hits)].slice(0, 6).join(' ')}` : '');
}

// ============================================================================
console.log('--- 4. no colour borrowed from another design system, anywhere ---');

const bannedHits = [];
for (const f of [...cssFiles, ...templateFiles]) {
  const src = stripComments(read(f)).toLowerCase();
  for (const [value, why] of BANNED_VALUES) {
    if (src.includes(value)) bannedHits.push(`${f} → ${value} (${why})`);
  }
}
ok(bannedHits.length === 0, `none of the ${BANNED_VALUES.length} foreign colour values appear`,
  bannedHits.length ? '\n        ' + bannedHits.slice(0, 8).join('\n        ') : '');

// The navy→brown diagonal that was the old hero.
ok(!/linear-gradient\(\s*135deg,\s*#0f172a/i.test(allCss),
  'the navy→brown 135deg hero gradient is gone');

// ============================================================================
console.log('--- 5. no inline style attributes in templates ---');
// Inline styles are how a 35th hex colour gets born without touching a
// stylesheet. Admin templates are exempt per the scope note above.

const inlineStyle = [];
for (const f of templateFiles) {
  const src = read(f);
  const hits = src.match(/\tstyle\s*=| style\s*=/g) || [];
  if (hits.length) inlineStyle.push(`${f} (${hits.length})`);
}
ok(inlineStyle.length === 0, 'no style="..." attributes in consumer templates',
  inlineStyle.length ? inlineStyle.join(', ') : '');

// ============================================================================
console.log(`\n${fails === 0 ? 'OK' : 'FAILED'} — ${fails} problem(s)`);
process.exit(fails === 0 ? 0 : 1);
