#!/usr/bin/env node
/**
 * The photography guard.
 *
 * WHY: the old site rendered 2,958 listings with zero photographs and put an empty
 * 170px grey box in 34% of every card. The replacement has three tiers, and the
 * failure mode that matters is not a missing photo — it is a STOCK photo presented
 * as if it were the venue. That is a lie about a real business, and it is the one
 * thing this component must never do.
 *
 * So this renders the real partial through the real Nunjucks engine against real
 * fixtures, and asserts on the HTML a browser would receive.
 *
 * Run: node src/scripts/check-photo-states.js        (offline, no browser, no DB)
 */
const fs = require('fs');
const path = require('path');
const nunjucks = require('nunjucks');

const root = path.join(__dirname, '..', '..');
const tplDir = path.join(root, 'templates');

let fails = 0;
const ok = (c, label, detail) => {
  console.log(`  ${c ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
  if (!c) fails++;
};

const env = nunjucks.configure(tplDir, { autoescape: true, throwOnUndefined: false });

const render = (item) => {
  try {
    return env.render('_listing-photo.html', { photoItem: item });
  } catch (e) {
    return `__RENDER_ERROR__ ${e.message}`;
  }
};

const base = {
  name: "Lee's Donuts",
  address: '199 Water Street, Vancouver',
  category: 'Bakery',
  neighborhood: { name: 'Gastown' },
};

// ---------------------------------------------------------------------------
console.log('--- 1. tier 2: an owner photo names the venue ---');
const owner = render({ ...base, imageUrl: '/img/lees-1x.webp', imageKind: 'owner', imageAttribution: 'Supplied by the business' });
ok(!owner.startsWith('__RENDER_ERROR__'), 'renders without error', owner.slice(0, 60));
ok(/<img\s/.test(owner), 'renders an <img>');
ok(/alt="Lee&#39;s Donuts"|alt="Lee's Donuts"/.test(owner), 'alt names the venue', (owner.match(/alt="[^"]*"/) || [''])[0]);
ok(!/not this venue/i.test(owner), 'does NOT carry a stand-in disclaimer');
ok(!/atlas-nophoto/.test(owner), 'does not render the no-photo state');

// ---------------------------------------------------------------------------
console.log('\n--- 2. tier 1: a stand-in says it is not this venue ---');
const standin = render({
  ...base,
  imageUrl: '/img/lees-1x.webp',
  imageKind: 'standin',
  imageAttribution: 'Stock photo, Unsplash — stand-in, not this venue',
});
ok(/<img\s/.test(standin), 'renders an <img>');
ok(/not this venue/i.test(standin), 'the visible caption says "not this venue"');
ok(/alt="Stand-in photograph, not /.test(standin), 'the alt text says it is not this venue');
ok(/srcset="[^"]*400w[^"]*800w/.test(standin), 'emits a srcset with both widths', (standin.match(/srcset="[^"]{0,60}/) || [''])[0]);
ok(/sizes="/.test(standin), 'emits a sizes attribute');
ok(/width="400"\s+height="300"/.test(standin), 'declares intrinsic dimensions (prevents layout shift)');
ok(/loading="lazy"/.test(standin), 'lazy-loads below the fold');

// ---------------------------------------------------------------------------
console.log('\n--- 3. tier 0: no photo renders the DESIGNED state, never an empty box ---');
const none = render({ ...base, imageUrl: null, imageKind: null });
ok(/atlas-nophoto/.test(none), 'renders the designed no-photo block');
ok(!/<img\s/.test(none), 'renders no <img> at all');
ok(/Water Street/.test(none), 'shows the street rather than nothing', (none.match(/class="street">([^<]*)/) || [''])[0]);
ok(/No photo yet/.test(none), 'says "No photo yet"');

// ---------------------------------------------------------------------------
console.log('\n--- 4. never both, never neither ---');
for (const [label, item] of [['owner', { ...base, imageUrl: '/x-1x.webp', imageKind: 'owner' }],
  ['standin', { ...base, imageUrl: '/x-1x.webp', imageKind: 'standin' }],
  ['none', { ...base, imageUrl: null, imageKind: null }]]) {
  const html = render(item);
  const hasImg = /<img\s/.test(html);
  const hasEmpty = /atlas-nophoto/.test(html);
  ok(hasImg !== hasEmpty, `${label}: exactly one of <img> / no-photo state`, `img=${hasImg} noPhoto=${hasEmpty}`);
}

// A stand-in with no attribution string must not render a bare image that looks
// like an owner photo. It must fall through to the no-photo state.
const noCredit = render({ ...base, imageUrl: '/x-1x.webp', imageKind: 'standin', imageAttribution: null });
ok(!/<img\s/.test(noCredit) || /not this venue/i.test(noCredit),
  'an unlabelled stand-in cannot slip through as a real photo',
  /<img\s/.test(noCredit) ? 'RENDERED AN IMAGE WITHOUT A DISCLAIMER' : 'fell back to no-photo');

// ---------------------------------------------------------------------------
console.log('\n--- 5. no template still emits the old empty placeholder ---');
const templates = fs.readdirSync(tplDir).filter((f) => f.endsWith('.html') && !/^admin/.test(f));
// Nunjucks comments are prose. _no-photo.html explains the old placeholder by
// name; scanning that would force us to stop documenting what we replaced.
const stripComments = (s) => s.replace(/\{#[\s\S]*?#\}/g, '').replace(/<!--[\s\S]*?-->/g, '');
const offenders = templates.filter((f) => /card-img-placeholder/.test(stripComments(fs.readFileSync(path.join(tplDir, f), 'utf8'))));
ok(offenders.length === 0, 'no template uses .card-img-placeholder any more',
  offenders.length ? offenders.join(', ') : '');

// ---------------------------------------------------------------------------
console.log(`\n${fails === 0 ? 'OK' : 'FAILED'} — ${fails} problem(s)`);
process.exit(fails === 0 ? 0 : 1);
