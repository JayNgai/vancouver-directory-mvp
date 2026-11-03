#!/usr/bin/env node
/**
 * The gate for route copy: content/routes/*.md.
 *
 * WHY: five route drafts were edited for a proof pass, and a proof pass pushes a
 * writer towards specificity — a price, a seat count, a closing time. Specificity is
 * the product. Specificity with no provenance is a liability, and every route file
 * already claims "every specific claim traces to the database or a named source".
 * Nothing enforced that claim. This does.
 *
 * Four rule groups, per route file:
 *   1. Every stop section carries provenance — a `source:` line inside it, or a row
 *      in the file's sources table that names the venue.
 *   2. A bare figure — price, capacity or count, distance not in the legs table,
 *      clock time, year — needs that same provenance. A price must also appear as an
 *      amount in the sources table: "$6" is not proven by a row saying "happy hour".
 *   3. The file keeps its structure: a legs table, a sources table, a "still not
 *      verified" section, and one alternatives line per stop.
 *   4. No banned phrase — the AI-marketing list from the copy pass.
 *
 * Fail closed, by design:
 *   - an unreadable directory, an empty set of route files, or an exception while
 *     reading one file is a failure, not a skip;
 *   - a .md file in content/routes that this script cannot classify is a failure, so
 *     a new kind of file cannot slip past the gate unnoticed.
 *
 * SCOPE. In scope: every *.md in content/routes that is route copy. Out of scope, and
 * named here so the exclusion is a decision rather than an oversight:
 *   - *-confirmations.md — hour-confirmation lists, not route copy (the route's hours
 *     columns are checked against the database by the itinerary pass, not by prose);
 *   - COPY-REVIEW.md — the review of the copy, which quotes the banned phrases on
 *     purpose and therefore cannot be held to them;
 *   - *.slots.md — the research notes behind a route (e.g. 01-gastown.slots.md): one
 *     `source:` line per fact, no route structure. They get rule 4 only. They are
 *     still counted, so a banned phrase cannot hide in the evidence either.
 *
 * Preference, stated once: friction over silence. Where a pattern could match a
 * harmless thing, it matches. A human reading the failure message can dismiss it; a
 * reader trusting an unsourced price cannot.
 *
 * Run: node src/scripts/check-route-copy.js        (offline, no DB, no browser)
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const dir = path.join(root, 'content', 'routes');

let fails = 0;
let checks = 0;
const ok = (c, label, detail) => {
  checks++;
  if (!c) fails++;
  console.log(`  ${c ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};
const fail = (label, detail) => ok(false, label, detail);

// ---------------------------------------------------------------------------
// Classification

const isConfirmation = (f) => /-confirmations\.md$/i.test(f);
const isReview = (f) => f === 'COPY-REVIEW.md';
const isEvidence = (f) => /\.slots\.md$/i.test(f);

let entries;
try {
  entries = fs.readdirSync(dir).filter((f) => /\.md$/i.test(f)).sort();
} catch (e) {
  console.log(`  FAIL  content/routes is readable  ${e.message}`);
  console.log(`\nFAILED — 1 problem(s)`);
  process.exit(1);
}

const unknown = entries.filter((f) => isConfirmation(f) === false && isReview(f) === false && isEvidence(f) === false && !/^\d{2}-/.test(f));
const routeFiles = entries.filter((f) => !isConfirmation(f) && !isReview(f) && !isEvidence(f) && /^\d{2}-/.test(f));
const evidenceFiles = entries.filter(isEvidence);

// ---------------------------------------------------------------------------
// Markdown reading

const BANNED_PHRASES = [
  'hidden gem',
  'must-visit',
  'perfect for',
  'whether you are',
  'nestled',
  'elevate',
  'seamless',
  'game-changer',
  'a testament to',
];

const norm = (s) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Words that carry no identity: a sources row mentioning "coffee" proves nothing
// about which coffee shop a stop is.
const GENERIC = new Set([
  'the', 'and', 'co', 'inc', 'ltd', 'bar', 'pub', 'cafe', 'cafes', 'coffee', 'roast',
  'roaster', 'roasters', 'restaurant', 'bakery', 'kitchen', 'street', 'st', 'main',
  'west', 'east', 'north', 'south', 'van', 'avenue', 'ave', 'road', 'room', 'house',
  'ice', 'cream', 'that', 'with', 'shop',
]);

function parseFile(text) {
  const lines = text.split(/\r?\n/);
  const headings = [];
  lines.forEach((line, i) => {
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (m) headings.push({ level: m[1].length, text: m[2], line: i });
  });
  const sections = headings.map((h, k) => {
    const endLine = k + 1 < headings.length ? headings[k + 1].line : lines.length;
    const body = lines.slice(h.line + 1, endLine);
    return { ...h, endLine, body, bodyText: body.join('\n') };
  });
  return { lines, headings, sections };
}

function tableRows(section) {
  const rows = [];
  for (const line of section.body) {
    if (!/^\s*\|/.test(line)) continue;
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '')) continue; // separator
    rows.push(cells);
  }
  return rows;
}

function sourcesTable(parsed) {
  const sec = parsed.sections.find((s) => s.level >= 2 && /^sources\b/i.test(s.text.trim()));
  if (!sec) return { sec: null, rows: [] };
  const rows = tableRows(sec)
    .filter((cells) => cells.length >= 2)
    .filter((cells) => !/^fact$/i.test(cells[0]))
    .map((cells) => ({ fact: cells[0], source: cells[1], text: cells.slice(0, 2).join(' ') }));
  return { sec, rows };
}

function numbersSection(parsed) {
  return parsed.sections.find((s) => s.level >= 2 && /numbers|legs?|distances?/i.test(s.text));
}

function stopName(headingText) {
  return headingText
    .replace(/^\d{1,2}:\d{2}\s*[—–-]+\s*/, '')
    .replace(/,\s*\d.*$/, '')
    .trim();
}

// Rows that belong to this venue and no other. Whole-word matching, so the "town"
// in New Town Bakery cannot be satisfied by Chinatown BBQ's row.
function venueRows(name, rows) {
  const n = norm(name);
  if (!n) return [];
  const out = rows.filter((r) => norm(r.text).includes(n));
  const tokens = n.split(' ').filter((t) => t.length >= 4 && !GENERIC.has(t));
  for (const t of tokens) {
    const re = new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
    for (const r of rows) if (re.test(norm(r.text)) && !out.includes(r)) out.push(r);
  }
  return out;
}

function provenanceFor(name, rows, sectionText) {
  if (/\bsource\s*:/i.test(sectionText)) return { label: 'a source: line in the section', rows: [] };
  const own = venueRows(name, rows);
  if (own.length) return { label: `a sources row names "${name}"`, rows: own };
  const n = norm(name);
  const tokens = n.split(' ').filter((t) => t.length >= 4 && !GENERIC.has(t));
  for (const t of tokens) {
    const re = new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
    const row = rows.find((r) => re.test(norm(r.text)));
    if (row) return { label: `a sources row mentions "${t}"`, rows: [row] };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Figure patterns. A short, explicit list — not one clever regex. Every entry says
// what it is for. When in doubt the pattern is deliberately broad: a false positive
// costs a sentence of reading, a false negative ships an invented price.

const PRICE = /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d+)?/g; // $6, $6.75, $1,200
const PRICE_WORD = /\b\d[\d,.]*\s?(?:dollars?|cents)\b/gi; // 6 dollars
const NUMBER_WORD =
  '\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|hundred';
const COUNT_NOUNS =
  'seats?|covers?|people|persons?|guests?|patrons?|shows?|sets?|courses?|rooms?|tables?|booths?|bottles?|ways?|kinds?|blocks?|stops?|years?|shops?|cafes?|bars?|restaurants?|floors?|nights?|days?|weekends?';
// "sixteen seats", "two shows", "seven courses", "one bottle per two guests", "three ways"
const COUNT = new RegExp(`\\b(?:${NUMBER_WORD})\\s+(?:[a-z-]+\\s+){0,2}(?:${COUNT_NOUNS})\\b`, 'gi');
const DISTANCE = /\b\d[\d,.]*\s?(?:m|km|metres?|meters?)\b/gi; // 692m, 71 m, 2 km
const CLOCK = /\b\d{1,2}:\d{2}\b/g; // 10:00, 17:30
const YEAR = /\b(?:19|20)\d{2}\b/g; // 1995, 2026

const PATTERNS = [
  { kind: 'price', re: PRICE },
  { kind: 'price', re: PRICE_WORD },
  { kind: 'count', re: COUNT },
  { kind: 'distance', re: DISTANCE },
  { kind: 'time', re: CLOCK },
  { kind: 'year', re: YEAR },
];

function figuresIn(lines, legsNumbers) {
  const found = [];
  for (const { line, i } of lines) {
    const isAlternatives = /^\*?If\b/i.test(line.trim());
    const isHoursLines = /·/.test(line); // "311 West Cordova Street · Cafe · Mon–Fri 08:00–16:00"
    for (const { kind, re } of PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line)) !== null) {
        const text = m[0].trim();
        // The hours/address line is the database row, and the venue row covers it.
        if (isHoursLines) continue;
        // An alternatives line states a neighbour's database hours and distance. A
        // price there would still be a claim, so price stays in scope; nothing else
        // in that line is this stop's claim.
        if (isAlternatives && kind !== 'price') continue;
        // A distance already in the legs table is machine-derived, not prose.
        if (kind === 'distance') {
          const n = text.replace(/[^\d.]/g, '');
          if (legsNumbers.has(n)) continue;
        }
        found.push({ kind, text, excerpt: line.trim(), line: i + 1 });
      }
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Per-file checks

function checkRoute(file) {
  const rel = `content/routes/${file}`;
  let text;
  try {
    text = fs.readFileSync(path.join(dir, file), 'utf8');
  } catch (e) {
    return fail(`${file}: readable`, e.message);
  }
  const parsed = parseFile(text);
  const { rows, sec: sourcesSec } = sourcesTable(parsed);
  const numbers = numbersSection(parsed);
  const legsNumbers = new Set();
  if (numbers) {
    for (const line of numbers.body) {
      for (const tok of line.match(/\d[\d,.]*/g) || []) legsNumbers.add(tok.replace(/[^\d.]/g, ''));
    }
  }

  console.log(`\n--- ${file} ---`);

  // 4. Banned phrases. Cheap, so it runs first and reads the whole file, tables and
  // headings included: "hidden gem" in a heading is still slop in front of a reader.
  const bannedHits = [];
  parsed.lines.forEach((line, i) => {
    const lower = line.toLowerCase();
    for (const p of BANNED_PHRASES) {
      if (lower.includes(p)) bannedHits.push(`    ${rel}:${i + 1}  "${p}"  ${line.trim().slice(0, 90)}`);
    }
  });
  ok(bannedHits.length === 0, `${file}: no banned phrase`,
    bannedHits.length ? `\n${bannedHits.join('\n')}` : '');

  // 3. Structure.
  ok(Boolean(numbers) && tableRows(numbers).length > 1 && /distance/i.test(numbers.bodyText),
    `${file}: legs table`, numbers ? '' : 'no "## The numbers"-style section with a distance column');

  ok(rows.length > 0, `${file}: sources table`, sourcesSec ? `${rows.length} row(s)` : 'no "## Sources" table');

  const unverified = parsed.sections.find((s) => /still not verified/i.test(s.text));
  ok(Boolean(unverified), `${file}: "still not verified" section`, unverified ? '' : 'missing');

  const stops = parsed.sections.filter((s) => s.level === 3);
  ok(stops.length > 0, `${file}: has stop sections`, `${stops.length} stop(s)`);

  if (stops.length === 0) return;

  // 1 + 2 + 3 (alternatives), stop by stop.
  for (const stop of stops) {
    const name = stopName(stop.text) || stop.text;
    const label = `### ${stop.text}`;

    const how = provenanceFor(name, rows, stop.bodyText);
    ok(Boolean(how), `${file}: ${label} — provenance`, how ? how.label : `no source: line and no sources-table row names "${name}"`);

    const hasAlt = stop.body.some((l) => /^\*?If\b/i.test(l.trim()));
    ok(hasAlt, `${file}: ${label} — alternatives line`,
      hasAlt ? '' : 'no "*If it is shut or full:* …" line, so a reader with no seat has no fallback');

    const figs = figuresIn(
      stop.body.map((line, i) => ({ line, i: stop.line + i })).filter((l) => l.line.trim()),
      legsNumbers
    );
    if (figs.length === 0) {
      ok(true, `${file}: ${label} — bare figures`, 'none found');
      continue;
    }
    if (!how) {
      for (const f of figs) {
        fail(`${file}: ${label} — ${f.kind} with no provenance`,
          `"${f.text}"  line ${f.line}  ...${f.excerpt.slice(0, 80)}`);
      }
    } else {
      ok(true, `${file}: ${label} — ${figs.length} figure(s)`, figs.map((f) => f.text).join(', ').slice(0, 70) + `  (${how.label})`);
    }

    // 2b. A price must also appear as an amount in a sources row for *this venue*. A
    // row saying "happy hour" does not prove "$6", and another venue's $10 row does
    // not prove this venue's $10. Only meaningful once provenance exists.
    for (const f of how ? figs.filter((x) => x.kind === 'price' && /^\$/.test(x.text)) : []) {
      const num = f.text.replace(/[^\d.]/g, '').replace(/\.$/, '');
      if (!num) continue;
      const escaped = num.replace(/[.]/g, '\\.');
      const amount = new RegExp('\\$\\s?' + escaped + '(?![\\d.])');
      const flat = (s) => s.replace(/(\d),(\d)/g, '$1$2');
      const proven = how.rows.some((r) => amount.test(flat(r.text)));
      ok(proven, `${file}: ${label} — price ${f.text} appears in the sources table`,
        proven ? '' : `no sources row for this venue carries the amount ${f.text}; add the row with URL and date, or cut the price`);
    }
  }
}

function checkEvidence(file) {
  const rel = `content/routes/${file}`;
  const text = fs.readFileSync(path.join(dir, file), 'utf8');
  const hits = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const lower = line.toLowerCase();
    for (const p of BANNED_PHRASES) {
      if (lower.includes(p)) hits.push(`    ${rel}:${i + 1}  "${p}"`);
    }
  });
  ok(hits.length === 0, `${file}: no banned phrase (evidence file, rule 4 only)`,
    hits.length ? `\n${hits.join('\n')}` : '');
}

// ---------------------------------------------------------------------------

console.log('--- 0. scope ---');
ok(routeFiles.length > 0, 'at least one route file in content/routes', `${routeFiles.length} route file(s)`);
ok(unknown.length === 0, 'every .md in content/routes is classified',
  unknown.length ? `unrecognised: ${unknown.join(', ')} — this gate fails closed; classify the file in the header of check-route-copy.js` : '');
if (routeFiles.length === 0) {
  console.log('\nFAILED — 1 problem(s)');
  process.exit(1);
}

for (const f of routeFiles) {
  try {
    checkRoute(f);
  } catch (e) {
    fail(`${f}: checked without throwing`, e.message.split('\n')[0]);
  }
}
for (const f of evidenceFiles) {
  try {
    checkEvidence(f);
  } catch (e) {
    fail(`${f}: checked without throwing`, e.message.split('\n')[0]);
  }
}

console.log(`\n${fails === 0 ? 'OK' : 'FAILED'} — ${fails} problem(s), ${checks} check(s) over ${routeFiles.length} route file(s)`);
process.exit(fails === 0 ? 0 : 1);
