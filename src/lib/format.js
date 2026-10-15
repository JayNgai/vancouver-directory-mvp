/**
 * Display formatting helpers.
 *
 * Rules that matter for this project:
 *  - Never invent data. If a value cannot be parsed safely, the formatter returns null
 *    and the template shows nothing.
 *  - Phone digits are never altered: stored values stay as provided, only the display
 *    format is normalised.
 *  - Internal provenance tags (e.g. "source-openstreetmap") drive the footer credits and
 *    must not be shown to users as hashtags.
 */

const DAY_NAMES = { mo: 'Mon', tu: 'Tue', we: 'Wed', th: 'Thu', fr: 'Fri', sa: 'Sat', su: 'Sun' };
const DAY_ORDER = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'];

function formatClockParts(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2];
  if (Number.isNaN(hour) || hour > 27) return null;
  let nextDay = false;
  if (hour >= 24) {
    hour -= 24;
    nextDay = true;
  }
  const period = hour >= 12 ? 'pm' : 'am';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return { hour, minute, text: `${twelve}:${minute} ${period}`, nextDay };
}

function formatClock(value) {
  const parts = formatClockParts(value);
  if (!parts) return null;
  return parts.nextDay ? `${parts.text} (+1 day)` : parts.text;
}

/** Renders an opening range, marking a range that runs past midnight. */
function formatRange(startValue, endValue, openEnded) {
  const start = formatClockParts(startValue);
  const end = formatClockParts(endValue);
  if (!start || !end) return null;
  const crossesMidnight = end.nextDay || end.hour < start.hour || (end.hour === start.hour && end.minute < start.minute);
  const endText = crossesMidnight && !/\+1 day/.test(end.text) ? `${end.text} (+1 day)` : end.text;
  return `${start.text}-${endText}${openEnded ? ' onwards' : ''}`;
}

function formatDays(spec) {
  // Returns a plain-English day phrase, or null when the spec is not understood.
  const cleaned = spec.replace(/\s+/g, '');
  if (!cleaned) return null;
  const indices = [];
  let includesHoliday = false;
  for (const chunk of cleaned.split(',')) {
    if (!chunk) return null;
    if (/^ph$/i.test(chunk)) {
      includesHoliday = true;
      continue;
    }
    const range = /^([a-z]{2})-([a-z]{2})$/i.exec(chunk);
    if (range) {
      const fromIndex = DAY_ORDER.indexOf(range[1].toLowerCase());
      const toIndex = DAY_ORDER.indexOf(range[2].toLowerCase());
      if (fromIndex < 0 || toIndex < 0) return null;
      if (fromIndex <= toIndex) {
        for (let i = fromIndex; i <= toIndex; i += 1) indices.push(i);
      } else {
        // Wrap-around range e.g. Sa-Mo means Sat, Sun, Mon.
        for (let i = fromIndex; i <= 6; i += 1) indices.push(i);
        for (let i = 0; i <= toIndex; i += 1) indices.push(i);
      }
      continue;
    }
    const single = DAY_ORDER.indexOf(chunk.toLowerCase());
    if (single < 0) return null;
    indices.push(single);
  }

  const unique = [...new Set(indices)].sort((a, b) => a - b);
  const labels = [];
  let runStart = null;
  for (let i = 0; i < unique.length; i += 1) {
    if (runStart === null) {
      runStart = unique[i];
    }
    const isLast = i === unique.length - 1;
    if (!isLast && unique[i + 1] === unique[i] + 1) continue;
    const runEnd = unique[i];
    if (runEnd - runStart >= 1) {
      labels.push(`${DAY_NAMES[DAY_ORDER[runStart]]}-${DAY_NAMES[DAY_ORDER[runEnd]]}`);
    } else {
      labels.push(DAY_NAMES[DAY_ORDER[runStart]]);
    }
    runStart = null;
  }

  if (unique.length === 7) {
    return includesHoliday ? 'Daily and public holidays' : 'Daily';
  }
  if (includesHoliday) labels.push('public holidays');
  return labels.join(', ');
}

function formatTimeSpec(spec) {
  const tokens = spec.split(',').map((t) => t.trim()).filter(Boolean);
  if (!tokens.length) return null;
  const rendered = [];
  for (const token of tokens) {
    if (/^off$/i.test(token)) {
      rendered.push('closed');
      continue;
    }
    if (/^00:00-(24:00|00:00)$/.test(token)) {
      rendered.push('open all day');
      continue;
    }
    const openEnded = /^(\d{1,2}:\d{2})\+$/.exec(token);
    if (openEnded) {
      const start = formatClock(openEnded[1]);
      if (!start) return null;
      rendered.push(`${start} onwards`);
      continue;
    }
    const openEndedRange = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})\+$/.exec(token);
    if (openEndedRange) {
      const renderedRange = formatRange(openEndedRange[1], openEndedRange[2], true);
      if (!renderedRange) return null;
      rendered.push(renderedRange);
      continue;
    }
    const range = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/.exec(token);
    if (range) {
      const renderedRange = formatRange(range[1], range[2], false);
      if (!renderedRange) return null;
      rendered.push(renderedRange);
      continue;
    }
    return null; // unknown time syntax: show nothing rather than guess
  }
  return rendered.join(', ');
}

const DAY_SPEC_PATTERN = /^(?:ph|[a-z]{2}(?:-[a-z]{2})?)(?:,(?:ph|[a-z]{2}(?:-[a-z]{2})?))*$/i;
const DAY_PREFIX_PATTERN = /^((?:ph|[a-z]{2}(?:-[a-z]{2})?)(?:,(?:ph|[a-z]{2}(?:-[a-z]{2})?))*)\s+(.+)$/i;

/**
 * Splits a clause such as "Mo-Sa 07:00-22:00, Su 08:00-22:00" or "Sa,Su off" into
 * day-scoped rules. A comma starts a new rule only when the following segment begins
 * with a day list; otherwise it continues the current time list.
 */
function splitClause(clause) {
  const segments = clause.split(',').map((s) => s.trim()).filter(Boolean);
  const groups = [];
  let current = null;
  let pendingDays = null;
  for (const segment of segments) {
    if (DAY_SPEC_PATTERN.test(segment)) {
      if (current && current.times) {
        groups.push(current);
        current = null;
      }
      pendingDays = pendingDays ? `${pendingDays},${segment}` : segment;
      continue;
    }
    const withDays = DAY_PREFIX_PATTERN.exec(segment);
    if (withDays) {
      if (current && current.times) {
        groups.push(current);
        current = null;
      }
      if (pendingDays) {
        groups.push({ days: `${pendingDays},${withDays[1]}`, times: withDays[2] });
        pendingDays = null;
      } else {
        groups.push({ days: withDays[1], times: withDays[2] });
      }
      continue;
    }
    // Time-only segment.
    if (pendingDays && !current) {
      current = { days: pendingDays, times: segment };
      pendingDays = null;
      continue;
    }
    if (current) {
      current.times = `${current.times},${segment}`;
      continue;
    }
    if (groups.length) {
      // A further time range belongs to the day list of the rule before it.
      groups[groups.length - 1].times = `${groups[groups.length - 1].times},${segment}`;
      continue;
    }
    current = { days: null, times: segment };
  }
  if (current) groups.push(current);
  if (pendingDays) groups.push({ days: pendingDays, times: null });
  return groups;
}

function hoursItems(raw) {
  if (!raw) return null;
  // OSM writers are inconsistent about the space after a comma in a day list ("Sa, Su").
  const value = String(raw).trim().replace(/([A-Za-z]{2}),\s+([A-Za-z]{2})/g, '$1,$2');
  if (!value) return null;
  if (/^24\/7$/i.test(value)) return ['Open 24 hours, 7 days a week'];
  if (/^open$/i.test(value)) return ['Open (no hours published)'];

  const rules = value.split(';').map((r) => r.trim()).filter(Boolean);
  const rendered = [];
  for (const rule of rules) {
    if (/^off$/i.test(rule)) {
      rendered.push('Closed');
      continue;
    }
    if (/^ph\s+off$/i.test(rule)) {
      rendered.push('Closed on public holidays');
      continue;
    }
    for (const group of splitClause(rule)) {
      if (!group.times) return null;
      const times = formatTimeSpec(group.times);
      if (!times) return null;
      if (group.days) {
        const days = formatDays(group.days);
        if (!days) return null;
        rendered.push(`${days} ${times}`);
      } else {
        rendered.push(`Daily ${times}`);
      }
    }
  }
  return rendered.length ? rendered : null;
}

function formatHours(raw) {
  const items = hoursItems(raw);
  return items ? items.join(', ') : null;
}

/** Turns one rendered item ("Mon-Thu, Sun 5:00 pm-11:30 pm") into a table row for the detail page. */
function itemToRow(item) {
  const match = /\d{1,2}:\d{2}/.exec(item);
  if (!match) return { label: '', times: [item] };
  const label = item.slice(0, match.index).trim().replace(/-/g, '\u2013');
  const times = item.slice(match.index).trim().split(/,\s*/)
    .map((t) => t.replace(/(am|pm)-(\d)/g, '$1 \u2013 $2'));
  return { label, times };
}

function formatHoursRows(raw) {
  const items = hoursItems(raw);
  return items ? items.map(itemToRow) : null;
}

function formatPhone(raw) {
  if (!raw) return null;
  const value = String(raw).trim();
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (/^1\d{10}$/.test(digits) || /^\d{10}$/.test(digits)) {
    const local = digits.length === 11 ? digits.slice(1) : digits;
    return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
  }
  // Anything else is shown as stored: digits are never rewritten.
  return value;
}

const INTERNAL_TAG_PREFIXES = ['source-'];

function visibleTags(rawTags) {
  if (!Array.isArray(rawTags)) return [];
  const cleaned = rawTags
    .map((tag) => String(tag))
    .filter((tag) => tag && !INTERNAL_TAG_PREFIXES.some((prefix) => tag.toLowerCase().startsWith(prefix)));
  const plain = new Set(cleaned.filter((tag) => !tag.toLowerCase().startsWith('cuisine-')));
  // A "cuisine-x" tag is redundant when the plain "x" tag is already shown.
  return cleaned.filter((tag) => {
    if (!tag.toLowerCase().startsWith('cuisine-')) return true;
    return !plain.has(tag.slice('cuisine-'.length));
  });
}

const LIQUOR_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Renders the BC liquor "Hours of Service" as a plain-English serving window phrase. */
function liquorItems(raw) {
  if (!raw) return null;
  let windows;
  try {
    windows = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (error) {
    return null;
  }
  if (!windows || typeof windows !== 'object') return null;

  const groups = new Map();
  for (const day of LIQUOR_DAYS) {
    const window = windows[day];
    if (!window) continue;
    const match = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/.exec(String(window).trim());
    if (!match) return null;
    const start = formatClockParts(match[1]);
    const end = formatClockParts(match[2]);
    if (!start || !end) return null;
    const crossesMidnight = end.hour < start.hour || (end.hour === start.hour && end.minute < start.minute);
    const text = `${start.text}-${end.text}${crossesMidnight ? ' (+1 day)' : ''}`;
    if (!groups.has(text)) groups.set(text, []);
    groups.get(text).push(day);
  }
  if (!groups.size) return null;

  const parts = [];
  for (const [text, days] of groups) {
    const indices = days.map((day) => LIQUOR_DAYS.indexOf(day)).sort((a, b) => a - b);
    const labels = [];
    let runStart = indices[0];
    for (let i = 0; i < indices.length; i += 1) {
      const isLast = i === indices.length - 1;
      if (!isLast && indices[i + 1] === indices[i] + 1) continue;
      const runEnd = indices[i];
      labels.push(runEnd > runStart ? `${LIQUOR_DAYS[runStart]}-${LIQUOR_DAYS[runEnd]}` : LIQUOR_DAYS[runStart]);
      if (!isLast) runStart = indices[i + 1];
    }
    parts.push(`${labels.join(', ')} ${text}`);
  }
  return parts;
}

function formatLiquorHours(raw) {
  const items = liquorItems(raw);
  return items ? items.join(', ') : null;
}

function formatLiquorRows(raw) {
  const items = liquorItems(raw);
  return items ? items.map(itemToRow) : null;
}

function decorate(business) {
  let parsedTags = [];
  try {
    parsedTags = JSON.parse(business.tags || '[]');
  } catch (error) {
    parsedTags = [];
  }
  return {
    ...business,
    parsedTags: visibleTags(parsedTags),
    displayHours: formatHours(business.hours),
    displayPhone: formatPhone(business.phone),
    displayLiquorHours: formatLiquorHours(business.liquorServiceHours),
    hoursRows: formatHoursRows(business.hours),
    liquorRows: formatLiquorRows(business.liquorServiceHours)
  };
}

module.exports = { formatHoursRows, formatLiquorRows, formatHours, formatPhone, visibleTags, formatLiquorHours, decorate };
