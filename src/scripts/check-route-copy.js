#!/usr/bin/env node
/**
 * The gate for route copy: content/routes/*.md — claim-level provenance.
 *
 * WHY. The first version of this gate asked a venue-level question: does some row
 * in the file's sources table name this stop? That is the wrong unit. A row called
 * "Scout Magazine place page" satisfied it for a seat count, a price and an opening
 * year at once, so a sentence could carry a figure from no row at all and still
 * pass, and a figure was checked against a table that never said which sentence it
 * belonged to. This version moves the unit down to the sentence: a claim carries a
 * marker, the marker resolves to a register row, and both directions are enforced.
 *
 * The marker: a claim sentence ends with `[[sN]]`; the file ends with a register
 *
 *   ## Sources
 *   | key | source | read |
 *   |---|---|---|
 *   | s1 | https://labattoir.ca/a-la-carte | 2026-11-02 |
 *
 * Rule groups, per route file:
 *   1. Claims. Every sentence outside an exempt region that carries a specific
 *      detail — a price, a capacity or count, a date, a year, an opening time
 *      stated in prose, or a distance not already in the legs table — must contain
 *      `[[sN]]` for a key that exists in this file's register.
 *   2. Orphans, both ways. No marker without a register row; no register row that
 *      no marker references; no marker that is not `[[sN]]` exactly.
 *   3. Structure. A legs table, a register, a "still not verified" section, and one
 *      alternatives line per stop — unchanged from the first version of the gate.
 *   4. Banned phrases — unchanged.
 *
 * EXEMPT REGIONS, and why each one is exempt:
 *   - the masthead: the `**Route:**` line and the standing provenance paragraph, i.e.
 *     everything above the first horizontal rule. Its figures are the count of this
 *     file's own stop sections, the legs-table total and the stops' own hours — so
 *     the gate does not take them on trust. It checks the stop count and the total
 *     distance against the file itself (see "masthead" in checkRoute) instead of
 *     asking for a marker on the title block.
 *   - the hours line under each stop heading: `311 West Cordova Street · Cafe ·
 *     Mon–Fri 08:00–16:00`. That is the database row printed, not a writer's claim.
 *     The block is exempt only if it carries a `·`; if the shape changes, the lines
 *     fall back into scope.
 *   - the legs table: distances and walk times from stored coordinates.
 *   - table rows and headings, anywhere: a table cell is not a sentence.
 *   - "still not verified": the section that names what is deliberately not claimed.
 *
 * Everything else is a claim sentence and needs a marker. That includes the
 * alternatives lines (`*If it is shut or full:* …`) and the hour-conflict notes: they
 * carry database hours and stored-coordinate distances too, but they are prose a
 * reader acts on and the legs table does not cover them, so they are claims.
 *
 * A register row's `read` column is a date (`YYYY-MM-DD`) or the literal
 * `not recorded`. The second value exists so that a row inherited from an earlier
 * sources table without a date is not given one now: an invented read date is the
 * same failure as an invented price.
 *
 * Fail closed, by design:
 *   - an unreadable directory, an empty set of route files, or an exception while
 *     reading one file is a failure, not a skip;
 *   - a .md file in content/routes that this script cannot classify is a failure, so
 *     a new kind of file cannot slip past the gate unnoticed;
 *   - a register with no rows, the wrong header, or a key that is not `s<N>` fails.
 *
 * SCOPE. In scope: every *.md in content/routes that is route copy. Out of scope, and
 * named here so the exclusion is a decision rather than an oversight:
 *   - *-confirmations.md — hour-confirmation lists, not route copy;
 *   - COPY-REVIEW.md — the review of the copy, which quotes banned phrases and cut
 *     claims on purpose and therefore cannot be held to the same rules;
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
  section.body.forEach((line, i) => {
    if (!/^\s*\|/.test(line)) return;
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '')) return; // separator
    rows.push({ cells, line: section.line + i + 2 });
  });
  return rows;
}

// ---------------------------------------------------------------------------
// The register: `## Sources` as | key | source | read |

const REGISTER_COLUMNS = ['key', 'source', 'read'];
const KEY_RE = /^s\d+$/;
const READ_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const READ_NONE_RE = /^not recorded$/i;
const MARKER_ANY = /\[\[[^\]]*\]\]/g;

function readRegister(parsed) {
  const sec = parsed.sections.find((s) => s.level >= 2 && /^sources\b/i.test(s.text.trim()));
  const rows = sec ? tableRows(sec) : [];
  const header = rows.length ? rows[0].cells.map((c) => c.toLowerCase()) : [];
  const headerOk = header.length === REGISTER_COLUMNS.length && REGISTER_COLUMNS.every((c, i) => header[i] === c);
  const map = new Map();
  rows.slice(1).forEach((row) => {
    const key = row.cells[0];
    if (key && KEY_RE.test(key) && !map.has(key)) {
      map.set(key, { key, source: row.cells[1] || '', read: row.cells[2] || '', line: row.line });
    }
  });
  return { sec, headerOk, headerText: header.join(' | '), rows: rows.slice(1), map };
}

// ---------------------------------------------------------------------------

function numbersSection(parsed) {
  return parsed.sections.find((s) => s.level >= 2 && /numbers|legs?|distances?/i.test(s.text));
}

function stillNotVerified(parsed) {
  return parsed.sections.find((s) => s.level >= 2 && /still not verified/i.test(s.text));
}

// The masthead is everything above the first horizontal rule.
function mastheadEnd(parsed) {
  return parsed.lines.findIndex((l) => /^\s*---\s*$/.test(l));
}

function exemptLines(parsed, registerSec) {
  const lines = parsed.lines;
  const exempt = new Set();

  const mastEnd = mastheadEnd(parsed);
  for (let i = 0; i <= (mastEnd === -1 ? -1 : mastEnd); i++) exempt.add(i);

  lines.forEach((line, i) => {
    if (/^\s*\|/.test(line)) exempt.add(i); // a table cell is not a sentence
    if (/^\s*---\s*$/.test(line)) exempt.add(i);
  });
  parsed.headings.forEach((h) => exempt.add(h.line));

  // The hours line under each stop heading, with its wrapped continuation lines.
  // Exempt only if it carries the `·` separators of the printed database row.
  parsed.sections
    .filter((s) => s.level === 3)
    .forEach((s) => {
      let i = s.line + 1;
      while (i < s.endLine && !lines[i].trim()) i++;
      if (i >= s.endLine || !/·/.test(lines[i])) return;
      for (; i < s.endLine; i++) {
        if (!lines[i].trim()) break;
        exempt.add(i);
      }
    });

  const snv = stillNotVerified(parsed);
  if (snv) for (let i = snv.line + 1; i < snv.endLine; i++) exempt.add(i);
  if (registerSec) for (let i = registerSec.line + 1; i < registerSec.endLine; i++) exempt.add(i);

  return exempt;
}

// ---------------------------------------------------------------------------
// Sentences. A claim is a sentence, not a paragraph, so the split has to survive
// "Guilt & Co", "$6.75", "e.g." and a bold venue name after a full stop.

const DOT = '\u0001';
const ABBREV = /\b(Co|St|Ave|Rd|Blvd|Dr|Mt|No|vs|Inc|Ltd|Jr|Sr|Dept|approx|Mon|Tues|Wed|Thu|Thurs|Fri|Sat|Sun|Jan|Feb|Mar|Apr|Jun|Jul|Sept|Sep|Oct|Nov|Dec)\.(?=\s)/g;
const SENTENCE_END = /[.!?]+(?=\s+[A-Z*“‘"'(0-9]|\s*$)/g;

function protectDots(s) {
  let out = s.replace(/\b(e\.g|i\.e)\./gi, (m) => m.slice(0, -1) + DOT);
  out = out.replace(ABBREV, (_m, a) => a + DOT);
  return out;
}

function sentencesIn(text) {
  const guarded = protectDots(text);
  const spans = [];
  let last = 0;
  SENTENCE_END.lastIndex = 0;
  let m;
  while ((m = SENTENCE_END.exec(guarded)) !== null) {
    const end = m.index + m[0].length;
    spans.push({ start: last, end, text: text.slice(last, end).trim() });
    last = end;
    while (last < text.length && /\s/.test(text[last])) last += 1;
  }
  if (last < text.length) spans.push({ start: last, end: text.length, text: text.slice(last).trim() });
  return spans.filter((s) => s.text.length > 0);
}

// Consecutive in-scope lines form one group; a blank line, an exempt line, a heading
// or a new bullet ends it. Bullets are their own unit because a list of hour conflicts
// is a list of claims, not one long sentence.
function walkGroups(parsed, exempt) {
  const groups = [];
  let cur = null;
  const flush = () => {
    if (cur) groups.push(cur);
    cur = null;
  };
  parsed.lines.forEach((raw, i) => {
    if (exempt.has(i) || !raw.trim()) return flush();
    if (/^\s*[-*]\s+/.test(raw) && cur) flush();
    if (!cur) cur = { lines: [] };
    cur.lines.push({ text: raw.trim(), no: i + 1 });
  });
  flush();
  return groups;
}

function joinGroup(group) {
  let text = '';
  const starts = [];
  group.lines.forEach((l, k) => {
    if (k) text += ' ';
    starts.push({ offset: text.length, no: l.no });
    text += l.text;
  });
  const lineAt = (offset) => {
    let no = starts[0].no;
    for (const s of starts) if (s.offset <= offset) no = s.no;
    return no;
  };
  return { text, lineAt };
}

function headingLabels(parsed) {
  const labels = new Map();
  const byLine = new Map(parsed.headings.map((h) => [h.line, h]));
  let cur = '(intro)';
  parsed.lines.forEach((_l, i) => {
    const h = byLine.get(i);
    if (h) cur = h.level === 1 ? '(intro)' : `${'#'.repeat(h.level)} ${h.text}`;
    labels.set(i + 1, cur);
  });
  return labels;
}

// ---------------------------------------------------------------------------
// Figure patterns. A short, explicit list — not one clever regex. Every entry says
// what it is for. When in doubt the pattern is deliberately broad: a false positive
// costs a sentence of reading, a false negative ships an invented price.

const PRICE = /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d+)?/g; // $6, $6.75, $1,200
const PRICE_WORD = /\b\d[\d,.]*\s?(?:dollars?|cents)\b/gi; // 6 dollars
// The lookbehind keeps a clock's trailing zeros out of the count pattern: in
// "10:00 every day", the "00" is not a count of days.
const NUMBER_WORD =
  '(?<![\\d:.])(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|hundred)';
const HOUR_WORD = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve';
const COUNT_NOUNS =
  'seats?|covers?|people|persons?|guests?|patrons?|shows?|sets?|courses?|rooms?|tables?|booths?|bottles?|ways?|kinds?|blocks?|stops?|years?|shops?|cafes?|bars?|restaurants?|floors?|nights?|days?|weekends?';
// "sixteen seats", "two shows", "seven courses", "one bottle per two guests", "three ways"
const COUNT = new RegExp(`\\b(?:${NUMBER_WORD})\\s+(?:[a-z-]+\\s+){0,2}(?:${COUNT_NOUNS})\\b`, 'gi');
const DISTANCE = /\b\d[\d,.]*\s?(?:m|km|metres?|meters?)\b/gi; // 692m, 71 m, 2 km
const CLOCK = /\b\d{1,2}:\d{2}\b/g; // 10:00, 17:30
// An opening time stated in prose: "at five", "closes at two or three", "at half past six".
const WORDTIME = new RegExp(
  `\\b(?:at|by|from|until|till|before|after|opens?|closes?|shuts?)\\s+(?:(?:half|quarter)\\s+past\\s+)?(?:${HOUR_WORD}|noon|midnight)\\b`,
  'gi'
);
const YEAR = /\b(?:19|20)\d{2}\b/g; // 1995, 2026
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g; // 2024-07-05
const MONTH_DAY = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}\b/gi; // June 5

const PATTERNS = [
  { kind: 'price', re: PRICE },
  { kind: 'price', re: PRICE_WORD },
  { kind: 'count', re: COUNT },
  { kind: 'distance', re: DISTANCE },
  { kind: 'clock time', re: CLOCK },
  { kind: 'prose time', re: WORDTIME },
  { kind: 'year', re: YEAR },
  { kind: 'date', re: ISO_DATE },
  { kind: 'date', re: MONTH_DAY },
];

function specificDetails(text, legsNumbers) {
  const found = [];
  for (const { kind, re } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const value = m[0].trim();
      // A distance already in the legs table is the legs table's figure, not prose.
      if (kind === 'distance' && legsNumbers.has(value.replace(/[^\d.]/g, ''))) continue;
      found.push({ kind, text: value });
    }
  }
  return found;
}

const clip = (s, n = 120) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…');

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
  const register = readRegister(parsed);
  const numbers = numbersSection(parsed);
  const exempt = exemptLines(parsed, register.sec);
  const labelAt = headingLabels(parsed);

  // Digits that belong to the legs table, so a distance copied from it into prose is
  // not treated as a new claim. Table cells only: the method note under the table is
  // prose, and its own figures ("75 m per minute") are claims like any other.
  const legsNumbers = new Set();
  if (numbers) {
    for (const row of tableRows(numbers)) {
      for (const tok of row.cells.join(' ').match(/\d[\d,.]*/g) || []) legsNumbers.add(tok.replace(/[^\d.]/g, ''));
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

  ok(Boolean(register.sec), `${file}: sources register`, register.sec ? `${register.rows.length} row(s)` : 'no "## Sources" table');
  ok(register.headerOk, `${file}: register header is | key | source | read |`,
    register.headerOk ? '' : `found "${register.headerText || 'no header row'}"`);

  const rowProblems = [];
  const keyCounts = new Map();
  register.rows.forEach((row) => {
    if (row.cells.length !== 3) {
      rowProblems.push(`line ${row.line}: ${row.cells.length} cell(s), expected 3`);
      return;
    }
    const [key, source, read] = row.cells;
    if (!KEY_RE.test(key || '')) rowProblems.push(`line ${row.line}: key "${key}" is not s<N>`);
    if (key) keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
    if (!source) rowProblems.push(`line ${row.line}: ${key} has no source`);
    if (!READ_DATE_RE.test(read || '') && !READ_NONE_RE.test(read || '')) {
      rowProblems.push(`line ${row.line}: ${key} read "${read}" is neither YYYY-MM-DD nor "not recorded"`);
    }
  });
  for (const [key, n] of keyCounts) if (n > 1) rowProblems.push(`duplicate key ${key} (${n} rows)`);
  ok(register.map.size > 0, `${file}: register holds at least one key`, `${register.map.size} key(s)`);
  ok(rowProblems.length === 0, `${file}: register rows are well formed`,
    rowProblems.length ? `\n    ${rowProblems.join('\n    ')}` : '');

  const unverified = stillNotVerified(parsed);
  ok(Boolean(unverified), `${file}: "still not verified" section`, unverified ? '' : 'missing');

  const stops = parsed.sections.filter((s) => s.level === 3);
  ok(stops.length > 0, `${file}: has stop sections`, `${stops.length} stop(s)`);

  // The masthead is exempt from markers, so its two figures are checked against the
  // file itself instead of being taken on trust.
  const masthead = parsed.lines.slice(0, mastheadEnd(parsed) === -1 ? 0 : mastheadEnd(parsed)).join(' ');
  const mastStops = /\b(\d+)\s+stops?\b/i.exec(masthead);
  ok(Boolean(mastStops) && Number(mastStops[1]) === stops.length,
    `${file}: masthead stop count matches the file`,
    mastStops ? `says ${mastStops[1]}, file has ${stops.length}` : 'no "N stops" in the masthead');
  const totalRow = numbers ? tableRows(numbers).find((r) => /total/i.test(r.cells[0] || '')) : null;
  const totalMetres = totalRow ? (totalRow.cells.join(' ').match(/[\d,]+/) || [])[0] : null;
  const mastMetres = /\b(\d[\d,]*)\s?m\s+walked\b/i.exec(masthead);
  ok(Boolean(mastMetres) && Boolean(totalMetres) && mastMetres[1].replace(/,/g, '') === totalMetres.replace(/,/g, ''),
    `${file}: masthead distance matches the legs total`,
    mastMetres ? `says ${mastMetres[1]}m, legs table totals ${totalMetres || '—'}m` : 'no "Nm walked" in the masthead');

  if (stops.length === 0) return;

  for (const stop of stops) {
    const hasAlt = stop.body.some((l) => /^\*?If\b/i.test(l.trim()));
    ok(hasAlt, `${file}: ### ${stop.text} — alternatives line`,
      hasAlt ? '' : 'no "*If it is shut or full:* …" line, so a reader with no seat has no fallback');
  }

  // 1 + 2. Walk the copy once: every sentence outside the exempt regions is either a
  // claim that carries a resolvable marker, or a sentence with no specific detail.
  const claims = [];
  const unknownKeys = new Map();
  const malformed = [];
  const usedKeys = new Map();

  for (const group of walkGroups(parsed, exempt)) {
    const { text: joined, lineAt } = joinGroup(group);
    for (const span of sentencesIn(joined)) {
      const line = lineAt(span.start);
      const details = specificDetails(span.text, legsNumbers);
      const markers = span.text.match(MARKER_ANY) || [];
      const keys = [];
      for (const raw of markers) {
        const inner = raw.slice(2, -2).trim();
        if (!KEY_RE.test(inner)) {
          malformed.push({ line, raw, text: span.text });
          continue;
        }
        keys.push(inner);
        if (!usedKeys.has(inner)) usedKeys.set(inner, line);
        if (!register.map.has(inner) && !unknownKeys.has(inner)) unknownKeys.set(inner, { line, text: span.text });
      }
      claims.push({
        text: span.text,
        line,
        details,
        keys,
        resolvable: keys.some((k) => register.map.has(k)),
      });
    }
  }

  const claimSentences = claims.filter((c) => c.details.length > 0);
  const unmarked = claimSentences.filter((c) => !c.resolvable);
  for (const c of unmarked) {
    const kinds = [...new Set(c.details.map((d) => d.kind))].join(', ');
    fail(`${file}: ${labelAt.get(c.line) || '(file)'} — unmarked claim (${kinds})`,
      `line ${c.line}: "${clip(c.text)}"  ${c.details.map((d) => d.text).join(', ')}`);
  }
  if (unmarked.length === 0) {
    const sections = new Set(claimSentences.map((c) => labelAt.get(c.line))).size;
    ok(true, `${file}: every claim sentence carries a resolvable marker`,
      `${claimSentences.length} claim sentence(s) in ${sections} section(s), keys ${[...usedKeys.keys()].sort().join(' ')}`);
  }

  for (const m of malformed) {
    fail(`${file}: ${labelAt.get(m.line) || '(file)'} — malformed marker`,
      `line ${m.line}: "${m.raw}" is not [[sN]]  ...${clip(m.text, 80)}`);
  }
  if (malformed.length === 0) ok(true, `${file}: every marker is well formed ([[sN]])`, `${usedKeys.size} key(s) used`);

  for (const [key, where] of unknownKeys) {
    fail(`${file}: ${labelAt.get(where.line) || '(file)'} — marker ${key} has no register row`,
      `line ${where.line}: no "| ${key} |" row in ## Sources  ...${clip(where.text, 80)}`);
  }
  if (unknownKeys.size === 0) ok(true, `${file}: every marker resolves to a register row`, '');

  const orphanRows = [...register.map.keys()].filter((k) => !usedKeys.has(k));
  for (const key of orphanRows) {
    const row = register.map.get(key);
    fail(`${file}: register row ${key} is referenced by no claim`,
      `line ${row.line}: "${clip(row.source, 60)}" — attach [[${key}]] to the sentence it supports, or drop the row`);
  }
  if (orphanRows.length === 0 && register.map.size > 0) {
    ok(true, `${file}: every register row is referenced`, `${register.map.size} row(s)`);
  }

  const strayMarkers = [];
  parsed.lines.forEach((line, i) => {
    if (exempt.has(i) && MARKER_ANY.test(line)) {
      MARKER_ANY.lastIndex = 0;
      strayMarkers.push(`    ${rel}:${i + 1}  ${line.trim().slice(0, 90)}`);
    }
    MARKER_ANY.lastIndex = 0;
  });
  ok(strayMarkers.length === 0, `${file}: no marker outside a claim sentence`,
    strayMarkers.length ? `\n${strayMarkers.join('\n')}` : '');
}

function checkEvidence(file) {
  const rel = `content/routes/${file}`;
  let text;
  try {
    text = fs.readFileSync(path.join(dir, file), 'utf8');
  } catch (e) {
    return fail(`${file}: readable`, e.message);
  }
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
