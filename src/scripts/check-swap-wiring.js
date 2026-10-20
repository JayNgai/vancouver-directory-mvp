#!/usr/bin/env node
/**
 * Guards the two defects that shipped a broken drag-and-drop while every unit test passed.
 *
 * WHY THIS FILE EXISTS: the swap UI was verified with a DOM stub, and a stub cannot test a CSP
 * directive, inline-handler resolution, or a Leaflet method that does not exist. Both defects here are
 * invisible to a stub and obvious to a browser:
 *
 *   1. `script-src-attr 'none'` makes every inline handler attribute INERT. The attributes still READ
 *      correctly in the DOM (getAttribute('onclick') returns 'tapSwap(0)'), so the page looks wired and
 *      does nothing. Chrome reports it as a CSP violation, not a JS error.
 *   2. `L.layerGroup()` has no `getBounds()`. A stub that supplied one let a real TypeError ship.
 *
 * Run: node src/scripts/check-swap-wiring.js       (no browser needed)
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let fails = 0;
const ok = (c, l, d) => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${l}${d ? '  ' + d : ''}`); if (!c) fails++; };

const studio = read('public/studio.js');
const partial = read('templates/_studio_results.html');

// Strip comments before scanning, so prose ABOUT inline handlers cannot pass or fail this.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/.*$/gm, '');
const studioCode = stripComments(studio);

console.log('--- 1. no inline handler attributes in generated markup ---');
const handlers = /(onclick|ondrop|ondragover|ondragleave|ondragstart|ondragend|onsubmit|onchange)\s*=/g;
const inlineInStudio = studioCode.match(handlers) || [];
const inlineInPartial = stripComments(partial).match(handlers) || [];
ok(inlineInStudio.length === 0, 'studio.js emits no inline handler attributes (they are inert under CSP)',
  inlineInStudio.length ? inlineInStudio.join(' ') : '');
ok(inlineInPartial.length === 0, 'the results partial declares no inline handler attributes',
  inlineInPartial.length ? inlineInPartial.join(' ') : '');

console.log('\n--- 2. the CSP that makes inline handlers inert is still in force ---');
// `script-src-attr 'none'` is NOT written in server.js: it arrives from helmet's DEFAULTS via
// useDefaults: true. So assert the two things that actually decide it.
const serverSrc = stripComments(read('server.js'));   // comments mention scriptSrcAttr on purpose
ok(/useDefaults:\s*true/.test(serverSrc), "helmet's defaults are on (they supply script-src-attr 'none')");
ok(!/scriptSrcAttr/.test(serverSrc), 'server.js does NOT override scriptSrcAttr to allow inline handlers');
ok(/scriptSrc:\s*\[/.test(serverSrc), 'scriptSrc is set explicitly for inline <script> blocks');
// The served header is the authoritative check; the browser E2E asserts it. Here, offline, be explicit.
console.log('  note: the live header is asserted by src/scripts/browser-swap-e2e.js, which needs the app.');

console.log('\n--- 3. the wiring that REPLACES inline handlers is present and delegated ---');
['dragstart', 'dragend', 'dragover', 'dragleave', 'drop'].forEach((t) => {
  ok(new RegExp(`addEventListener\\('${t}'`).test(studioCode), `studio.js attaches a delegated '${t}' listener`);
});
ok(/addEventListener\('click'/.test(studioCode), "studio.js attaches a delegated 'click' listener");
ok(/installWiring/.test(studioCode) && /installWiring\.done/.test(studioCode), 'installWiring is idempotent');
ok(/data-step-idx/.test(studioCode) && /data-swap-idx/.test(studioCode),
  'cards carry data-step-idx / data-swap-idx (how a delegated handler finds its index)');
ok(/preventDefault\(\)/.test(studioCode), 'a dragover handler calls preventDefault (without it no drop ever fires)');

console.log('\n--- 4. a drop with no index must be LOUD, not silent ---');
ok(/console\.warn/.test(studioCode), 'an unusable drop says so instead of doing nothing silently');
ok(/getData\('text\/plain'\)/.test(studioCode), "the drag uses a real MIME type ('text/plain'), not a custom key");
ok(!/getData\('swapIdx'\)/.test(studioCode), "the old non-MIME 'swapIdx' key is gone");

console.log('\n--- 5. the map does not ask a LayerGroup for a method it does not have ---');
ok(/L\.latLngBounds\(/.test(studioCode), 'drawRoute derives bounds from the POINTS (L.latLngBounds)');
ok(!/routeLayer\.getBounds\(/.test(studioCode), 'nothing calls routeLayer.getBounds() (L.layerGroup has no such method)');

console.log(`\nRESULT: ${fails === 0 ? 'ALL PASS' : fails + ' FAILURE(S)'}`);
process.exit(fails === 0 ? 0 : 1);
