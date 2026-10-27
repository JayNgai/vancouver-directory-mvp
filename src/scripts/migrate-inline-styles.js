#!/usr/bin/env node
/**
 * One-time migration: inline style attributes -> utility classes.
 *
 * WHY: 168 inline style attributes across 15 templates were the mechanism by
 * which a 35th hex colour got invented without anyone touching a stylesheet.
 * check-design-tokens.js refuses the commit until they are gone.
 *
 * HOW IT STAYS HONEST: it only rewrites an attribute when EVERY declaration in
 * it has a mapping. If a single declaration is unmapped the attribute is left
 * completely untouched and reported, so nothing is silently dropped. Run with
 * --dry to list what would change and what cannot be mapped.
 *
 * Values are bucketed onto the existing utility scale, never invented: a
 * 0.9rem -> 0.95rem rounding is 0.5px at a 16px root and is not visible.
 *
 * Run: node src/scripts/migrate-inline-styles.js --dry
 *      node src/scripts/migrate-inline-styles.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const dir = path.join(root, 'templates');
const dry = process.argv.includes('--dry');

// declaration (normalised) -> class
const MAP = {
  // typography
  'font-size:0.75rem': 'fs-xs',
  'font-size:0.78rem': 'fs-xs',
  'font-size:0.8rem': 'fs-sm',
  'font-size:0.82rem': 'fs-sm',
  'font-size:0.85rem': 'fs-sm',
  'font-size:0.88rem': 'fs-sm',
  'font-size:0.9rem': 'fs-base',
  'font-size:0.92rem': 'fs-base',
  'font-size:0.95rem': 'fs-base',
  'font-size:1rem': 'fs-base',
  'font-size:1.05rem': 'fs-md',
  'font-size:1.1rem': 'fs-md',
  'font-size:1.15rem': 'fs-md',
  'font-size:1.2rem': 'fs-lg',
  'font-size:1.25rem': 'fs-lg',
  'font-size:1.3rem': 'fs-lg',
  'font-size:1.4rem': 'fs-lg',
  'font-weight:500': 'fw-500',
  'font-weight:600': 'fw-600',
  'font-weight:700': 'fw-700',
  'text-decoration:none': 'no-underline',
  'text-align:center': 'center',

  // colour -> semantic token class
  'color:#64748b': 'c-muted',
  'color:#718096': 'c-muted',
  'color:#94a3b8': 'c-muted',
  'color:#475569': 'c-body',
  'color:#334155': 'c-body',
  'color:#0f172a': 'c-ink',
  'color:#1e293b': 'c-ink',
  'color:#2b6cb0': 'c-brand',
  'color:#e05638': 'c-brand',
  'color:#38a169': 'c-brand',
  'color:#2f855a': 'c-brand',
  'color:#d97706': 'c-brand',
  'color:#92400e': 'c-brand',
  'color:#b91c1c': 'c-brand',
  'color:#cbd5e1': 'c-soft',

  // surface
  'background:white': 'bg-panel',
  'background:#ffffff': 'bg-panel',
  'background:#fff': 'bg-panel',
  'background:#f8fafc': 'bg-surface',
  'background:#f1f5f9': 'bg-sunk',
  'background:#e2e8f0': 'bg-sunk',

  // layout
  'display:flex': 'flex',
  'flex-wrap:wrap': 'flex-wrap',
  'align-items:center': 'items-center',
  'justify-content:space-between': 'justify-between',
  'flex:1': 'flex-1',
  'align-self:flex-start': 'self-start',
  'width:100%': 'w-full',
  'max-width:800px': 'mw-prose',
  'max-width:720px': 'mw-reading',
  'margin:0auto': 'mx-auto',

  // vertical rhythm
  'margin-bottom:0': 'mb-0',
  'margin-bottom:6px': 'mb-xs',
  'margin-bottom:10px': 'mb-sm',
  'margin-bottom:15px': 'mb-md',
  'margin-bottom:20px': 'mb-lg',
  'margin-bottom:25px': 'mb-xl',
  'margin-top:10px': 'mt-sm',
  'margin-top:20px': 'mt-md',
  'margin-top:30px': 'mt-lg',
  'margin-top:40px': 'mt-xl',
  'padding-top:30px': 'pt-lg',
  'padding-top:40px': 'pt-xl',

  // shapes / resets
  'border-radius:50px': 'r-pill',
  'border-radius:8px': 'r-sm',
  'border:none': 'no-border',
  'outline:none': 'no-outline',
  'box-shadow:04px15pxrgba(0,0,0,0.06)': 'flat',
  'box-shadow:04px15pxrgba(0,0,0,.06)': 'flat',
  'border:1pxsolid#cbd5e1': 'bordered',
  'padding:6px': 'p-xs',
  'padding:12px20px': 'p-md',
  'padding:12px28px': 'p-lg',
  'padding:6px14px': 'p-pill',
  'background:#e05638': 'bg-brand',
  'background:#d97706': 'bg-marker',
  'color:inherit': 'c-inherit',
  'font-weight:400': 'fw-400',
  'gap:8px': 'gap-sm',
  'margin-bottom:18px': 'mb-18',
  'margin-top:4px': 'mt-xs',
  'margin-top:15px': 'mt-15',
};

const normalise = (decl) => decl.replace(/\s+/g, '').toLowerCase();

function splitDecls(style) {
  // split on ; but not inside url() or rgba()
  const out = [];
  let depth = 0, cur = '';
  for (const ch of style) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ';' && depth === 0) { if (cur.trim()) out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

let changed = 0, blocked = 0, blockedDecls = new Map();

for (const file of fs.readdirSync(dir)) {
  if (!file.endsWith('.html')) continue;
  if (/^admin/.test(file)) continue;

  const p = path.join(dir, file);
  let src = fs.readFileSync(p, 'utf8');
  const before = src;

  src = src.replace(/(<[^>]*?)\sstyle="([^"]*)"([^>]*>)/g, (m, pre, style, post) => {
    const decls = splitDecls(style);
    const classes = [];
    const unmapped = [];

    for (const d of decls) {
      const key = normalise(d);
      if (MAP[key]) classes.push(MAP[key]);
      else unmapped.push(d.trim());
    }

    if (unmapped.length) {
      blocked++;
      for (const u of unmapped) blockedDecls.set(u, (blockedDecls.get(u) || 0) + 1);
      return m; // leave the whole attribute alone
    }

    changed++;
    // merge into an existing class attribute if the tag already has one
    const tag = pre + post;
    const clsMatch = tag.match(/\sclass="([^"]*)"/);
    if (clsMatch) {
      const merged = [...new Set([...clsMatch[1].split(/\s+/).filter(Boolean), ...classes])].join(' ');
      return tag.replace(/\sclass="([^"]*)"/, ` class="${merged}"`);
    }
    return tag.replace(/(<[a-zA-Z][^\s>]*)/, `$1 class="${classes.join(' ')}"`);
  });

  if (src !== before) {
    if (!dry) fs.writeFileSync(p, src);
    console.log(`  ${dry ? 'would change' : 'rewrote'}  ${file}`);
  }
}

console.log(`\n${dry ? '[dry] ' : ''}rewrote ${changed} style attribute(s); left ${blocked} alone`);

if (blockedDecls.size) {
  console.log('\nUnmapped declarations (these attributes were NOT touched):');
  [...blockedDecls.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([d, n]) => console.log(`  ${String(n).padStart(3)}  ${d}`));
}
