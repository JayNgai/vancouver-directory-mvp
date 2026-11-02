/**
 * Smart Concierge: deterministic, rule-based itinerary builder.
 * No language model and no randomness: the same inputs always give the same itinerary.
 *
 * Each stop's explanation is produced by src/lib/reasons.js, which returns three
 * human reasons (timing, sequence, character) drawn only from stored fields a
 * diner acts on. Provenance fields — City licence status, licence date, Overture
 * confidence, data-source lists — are deliberately not reachable from there.
 */
const { decorate } = require('./format');
const { stopReasons } = require('./reasons');

const SLOT_MINUTES = { '2h': 30, '3h': 45, '4h': 60, '8h': 90 };
const TOTAL_MINUTES = { '2h': 120, '3h': 180, '4h': 240, '8h': 480 };
const START_TIMES = { morning: 9 * 60, afternoon: 13 * 60, evening: 17 * 60 + 30, flexible: 11 * 60 };
const WALK_METRES_PER_MIN = 80;

// A walking day has a maximum leg and a tolerance. Both are planning limits, not
// walking advice: 25 minutes at 80 m/min is about 2 km between two stops, and a
// plan may run 15 minutes past the requested window before the clock trims a stop.
const MAX_WALK_MIN = 25;
const OVERSHOOT_TOLERANCE_MIN = 15;

// Activity keywords -> rules. A rule matches a business by category or by a cleaned tag.
const KEYWORD_RULES = [
  { words: ['coffee', 'espresso', 'latte', 'cafe', 'café'], categories: ['Cafe'], tags: ['coffee', 'coffee-shop', 'cafe'] },
  { words: ['cocktail', 'cocktails', 'drinks', 'wine', 'nightlife', 'lounge', 'club'], categories: ['Nightlife', 'Bar / Pub'], tags: ['cocktails', 'cocktail-bar', 'wine-bar', 'nightlife'] },
  { words: ['beer', 'pub', 'bar', 'brewery', 'craft-beer'], categories: ['Bar / Pub', 'Nightlife'], tags: ['craft-beer', 'pub', 'brewery'] },
  { words: ['sushi', 'sashimi', 'aburi'], categories: [], tags: ['sushi'] },
  { words: ['ramen', 'noodle', 'noodles'], categories: [], tags: ['ramen', 'noodle'] },
  { words: ['pizza'], categories: [], tags: ['pizza'] },
  { words: ['dim sum', 'dimsum', 'dim-sum'], categories: [], tags: ['dim-sum', 'chinese'] },
  { words: ['brunch', 'breakfast'], categories: [], tags: ['breakfast', 'brunch'] },
  { words: ['bakery', 'bread', 'pastry', 'croissant'], categories: ['Bakery'], tags: ['bakery'] },
  { words: ['dessert', 'ice cream', 'gelato', 'sweet', 'cake'], categories: ['Dessert'], tags: ['ice-cream', 'dessert', 'sweet-treat'] },
  { words: ['burger', 'burgers'], categories: ['Fast Food'], tags: ['burger'] },
  { words: ['patio', 'outdoor'], categories: [], tags: ['patio', 'outdoor-seating'] },
  { words: ['vegan', 'vegetarian'], categories: [], tags: ['vegan', 'vegetarian'] },
  { words: ['restaurant', 'dinner', 'eat', 'food', 'lunch'], categories: ['Restaurant'], tags: [] },
  // Categories added with the nine-category build
  { words: ['museum', 'gallery', 'art', 'arts', 'culture', 'heritage', 'history'], categories: ['Arts & Culture'], tags: [] },
  { words: ['shop', 'shops', 'shopping', 'boutique', 'store', 'retail', 'books', 'bookstore', 'clothes', 'gift'], categories: ['Shopping & Retail'], tags: [] },
  { words: ['walk', 'walks', 'walking', 'stroll', 'hike', 'hiking', 'park', 'parks', 'beach', 'trail', 'outdoors', 'recreation'], categories: ['Outdoors & Recreation'], tags: ['waterfront'] },
  { words: ['cinema', 'movie', 'movies', 'theatre', 'theater', 'concert', 'live music', 'bowling', 'entertainment'], categories: ['Entertainment'], tags: ['live-music'] },
  { words: ['gym', 'yoga', 'pilates', 'spa', 'massage', 'salon', 'haircut', 'barber', 'wellness', 'fitness', 'dentist', 'clinic', 'chiropractor'], categories: ['Health & Wellness'], tags: [] },
  { words: ['hotel', 'hotels', 'stay', 'lodging', 'b&b', 'bed and breakfast'], categories: ['Accommodation'], tags: [] },
  { words: ['bank', 'pharmacy', 'library', 'post office', 'laundry', 'travel agent', 'services'], categories: ['Services'], tags: [] },
  { words: ['kids', 'kid', 'children', 'family', 'playground', 'preschool', 'daycare'], categories: ['Family & Kids'], tags: ['family-friendly'] },
  { words: ['dog', 'dogs', 'pet-friendly'], categories: [], tags: ['dog-friendly'] }
];
// Requests the directory still has no category for: reported honestly, never faked.
const UNSUPPORTED_WORDS = ['clinic', 'gallery-tour', 'government', 'city hall', 'police', 'school', 'parking'];

function tokens(text) {
  return String(text || '').toLowerCase().replace(/[^a-zé\s-]/g, ' ').split(/\s+/).filter(Boolean);
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function parseActivity(activity) {
  const text = String(activity || '').toLowerCase();
  const matched = [];
  const categories = new Set();
  const tags = new Set();
  for (const rule of KEYWORD_RULES) {
    // whole-word match, so 'park' does not match 'parking' and 'art' does not match 'party'
    const re = new RegExp(`(^|[^a-z])(${rule.words.map(escapeRe).join('|')})($|[^a-z])`);
    const hit = rule.words.find((w) => new RegExp(`(^|[^a-z])${escapeRe(w)}($|[^a-z])`).test(text));
    if (hit && re.test(text)) {
      matched.push(hit);
      rule.categories.forEach((c) => categories.add(c));
      rule.tags.forEach((t) => tags.add(t));
    }
  }
  const words = tokens(activity);
  const unsupported = UNSUPPORTED_WORDS.filter((w) => words.includes(w) || text.includes(w));
  return { matched, categories: [...categories], tags: [...tags], unsupported };
}

function businessTags(b) {
  try {
    const parsed = JSON.parse(b.tags || '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function namedInText(b, text) {
  // 1 when the listing's name appears in the prompt (e.g. "walk in stanley park"), else 0.
  const t = String(text || '').toLowerCase();
  return t && b.name && t.includes(b.name.toLowerCase()) ? 1 : 0;
}

function contactable(b) {
  // Parks and outdoor places rarely list a phone or website, so they are reachable without one.
  return hasContact(b) || b.category === 'Outdoors & Recreation';
}

function hasContact(b) {
  return Boolean((b.phone && String(b.phone).trim()) || (b.website && String(b.website).trim()));
}

// Completeness uses only contact, location, hours and licence fields. Never rating or reviews.
function completeness(b) {
  return [
    b.phone, b.website, b.address, b.displayHours || b.hours,
    b.latitude != null && b.longitude != null ? 'geo' : null,
    b.cityLicenceStatus === 'Issued' ? 'licence' : null
  ].filter(Boolean).length;
}

function haversine(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function matchesRules(b, parsed) {
  if (!parsed.categories.length && !parsed.tags.length) return true; // no keywords: any listing
  const cats = [b.category, b.primaryCategory].filter(Boolean);
  if (parsed.categories.some((c) => cats.includes(c))) return true;
  const tags = businessTags(b);
  return parsed.tags.some((t) => tags.includes(t));
}

function formatClock(minutes) {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/**
 * @param {object} input {activity, duration, timeOfDay, neighborhoodId}
 * @param {object[]} businesses rows with neighborhood included, from the database
 */
/**
 * Multi-intent planning. "coffee date then a walk and dinner" -> Cafe, Outdoors, Restaurant.
 * Each segment becomes one intent; each intent takes one venue; no category repeats.
 */
const SEGMENT_SPLIT = /\s*(?:,|;|&|\band then\b|\bthen\b|\bafter\b|\bfollowed by\b|\bbefore\b|\band\b)\s*/i;
const MULTI_SLOT_MINUTES = { '2h': 30, '3h': 40, '4h': 45, '8h': 60 };

function parseIntents(activity) {
  const segments = String(activity || '').split(SEGMENT_SPLIT).map((s) => s.trim()).filter(Boolean);
  const intents = [];
  const unmatched = [];
  for (const seg of segments) {
    const p = parseActivity(seg);
    if (!p.categories.length && !p.tags.length) { unmatched.push(seg); continue; }
    intents.push({
      label: seg,
      categories: p.categories,
      tags: p.categories.length ? [] : p.tags,
      keywords: p.matched,
      unsupported: p.unsupported
    });
  }
  // A segment repeating an earlier category is kept only if the user asked for it by name
  // ("three different coffee shops" is not handled, so repeats are dropped and reported).
  const seen = new Set();
  const unique = [];
  const dropped = [];
  for (const it of intents) {
    const key = it.categories[0] || it.tags.join('|');
    if (seen.has(key)) { dropped.push(it.label); continue; }
    seen.add(key);
    unique.push(it);
  }
  return { intents: unique, unmatched, dropped };
}

function intentMatches(b, intent) {
  const cats = [b.category, b.primaryCategory].filter(Boolean);
  if (intent.categories.length) return intent.categories.some((c) => cats.includes(c));
  const tags = businessTags(b);
  return intent.tags.some((t) => tags.includes(t));
}

/**
 * Cap repeated categories so an unqualified prompt does not produce four cafés.
 *
 * The proximity walk picks the nearest unchosen venue at every step, which is
 * right for walking distance and wrong for variety: with a broad prompt every
 * candidate is eligible, so the route can end up four of the same thing.
 *
 * A third consecutive repeat is swapped for the nearest candidate of a different
 * category. When the user explicitly asked to crawl ("coffee crawl", "bar crawl"),
 * repetition is the request, so nothing is swapped.
 */
function diversifyRoute(route, pool, isCrawl) {
  if (isCrawl || route.length < 3) return route;

  const out = route.slice();
  const used = new Set(out.map((b) => b.id));

  for (let i = 2; i < out.length; i += 1) {
    const repeats = out[i].category === out[i - 1].category && out[i].category === out[i - 2].category;
    if (!repeats) continue;

    const candidates = pool
      .filter((b) => !used.has(b.id) && b.category !== out[i - 1].category)
      .map((b) => ({ b, d: haversine(out[i - 1], b) }))
      .sort((x, y) => x.d - y.d || x.b.name.localeCompare(y.b.name));

    if (!candidates.length) continue; // nothing else to walk to; keep the repeat

    used.delete(out[i].id);
    used.add(candidates[0].b.id);
    out[i] = candidates[0].b;
  }

  return out;
}

function buildMulti(input, businesses, planned) {
  const { intents, unmatched, dropped } = planned;
  const duration = TOTAL_MINUTES[input.duration] ? input.duration : '4h';
  const timeOfDay = START_TIMES[input.timeOfDay] !== undefined ? input.timeOfDay : 'flexible';
  const slot = MULTI_SLOT_MINUTES[duration];

  // Neighbourhood: form value, or one named in the prompt.
  let scopeId = input.neighborhoodId || null;
  let scopeName = null;
  const hoods = new Map();
  for (const b of businesses) if (b.neighborhood) hoods.set(b.neighborhood.id, b.neighborhood.name);
  if (!scopeId) {
    const text = String(input.activity || '').toLowerCase();
    for (const [id, name] of hoods) {
      const full = name.toLowerCase();
      if (new RegExp(`(^|[^a-z])(${escapeRe(full)}|${escapeRe(full.split(' ')[0])})($|[^a-z])`).test(text)) { scopeId = id; scopeName = name; break; }
    }
  } else {
    scopeName = hoods.get(scopeId) || null;
  }

  // A prompt with neither a district nor a named neighbourhood used to draw from
  // all of Vancouver. Measured on 2026-11-02: "coffee, 3 hours" returned a 4h44m
  // plan whose walking legs alone ran 184 minutes, including one of 92 minutes.
  // Seeding a district keeps the day walkable. The seed is the district with the
  // most venues that can serve any of the requested intents, so a two-intent
  // prompt lands where both exist rather than where only the first does.
  if (!scopeId) {
    const byHood = new Map();
    for (const b of businesses) {
      if (!b.neighborhoodId || b.latitude == null || b.longitude == null) continue;
      if (!contactable(b)) continue;
      const hit = intents.findIndex((intent) => intentMatches(b, intent));
      if (hit < 0) continue;
      const rec = byHood.get(b.neighborhoodId) || { cover: new Set(), count: 0 };
      rec.cover.add(hit);
      rec.count += 1;
      byHood.set(b.neighborhoodId, rec);
    }
    // Cover first, volume second: a district that can serve both intents beats a
    // denser one that can serve only the first and leaves the second unfilled.
    let bestId = null;
    let best = null;
    for (const [id, rec] of byHood) {
      if (!best || rec.cover.size > best.cover.size
        || (rec.cover.size === best.cover.size && rec.count > best.count)) {
        best = rec;
        bestId = id;
      }
    }
    if (bestId) { scopeId = bestId; scopeName = hoods.get(bestId) || null; }
  }
  const catSet = Array.isArray(input.categories) && input.categories.length ? new Set(input.categories.map(String)) : null;
  const eligible = businesses.filter((b) => (!scopeId || b.neighborhoodId === scopeId)
    && contactable(b) && b.latitude != null && b.longitude != null
    && (!catSet || catSet.has(b.category) || catSet.has(b.primaryCategory)));

  const picks = [];      // {intent, business}
  const unfilled = [];   // intents with no eligible venue
  const usedCats = new Set();
  const usedIds = new Set();
  for (const intent of intents) {
    const pool = eligible.filter((b) => intentMatches(b, intent)
      && !usedIds.has(b.id)
      && !usedCats.has(b.category));
    if (!pool.length) { unfilled.push(intent.label); continue; }
    const named = (b) => (intent.keywords || []).some((k) => b.name.toLowerCase().includes(k));
    let pick;
    const last = picks.length ? picks[picks.length - 1].business : null;
    if (!last) {
      const density = (b) => pool.filter((c) => c !== b && haversine(b, c) <= 1500).length;
      pick = pool.slice().sort((a, b) => (named(b) - named(a)) || density(b) - density(a) || completeness(b) - completeness(a) || a.name.localeCompare(b.name))[0];
    } else {
      pick = pool.slice().sort((a, b) => (named(b) - named(a)) || haversine(last, a) - haversine(last, b) || completeness(b) - completeness(a) || a.name.localeCompare(b.name))[0];
    }
    picks.push({ intent, business: pick });
    usedIds.add(pick.id);
    usedCats.add(pick.category);
  }

  // Sequence the picks by proximity, starting from the first intent's venue, and
  // refuse a leg longer than MAX_WALK_MIN. A stop you cannot walk to is not a stop
  // on a walking day, and a 92-minute leg is what produced the 14.7 km plan.
  const ordered = [];
  const droppedFar = [];
  if (picks.length) {
    const rest = picks.slice();
    ordered.push(rest.shift());
    while (rest.length) {
      const last = ordered[ordered.length - 1].business;
      rest.sort((a, b) => haversine(last, a.business) - haversine(last, b.business));
      const next = rest[0];
      const legMinutes = Math.round(haversine(last, next.business) / WALK_METRES_PER_MIN) + 5;
      if (legMinutes > MAX_WALK_MIN) {
        droppedFar.push(next.intent.label);
        rest.shift();
        continue;
      }
      ordered.push(rest.shift());
    }
  }

  // Then trim to the window that was asked for. Stop time AND walking time count;
  // the old planner budgeted only stop time, which is why the plan could run 58%
  // past a three-hour request.
  const budget = TOTAL_MINUTES[duration] + OVERSHOOT_TOLERANCE_MIN;
  const kept = [];
  let budgetClock = START_TIMES[timeOfDay];
  const dayStart = START_TIMES[timeOfDay];
  for (let i = 0; i < ordered.length; i++) {
    const walkIn = i ? Math.round(haversine(ordered[i - 1].business, ordered[i].business) / WALK_METRES_PER_MIN) + 5 : 0;
    if (budgetClock + walkIn + slot > dayStart + budget) break;
    budgetClock += walkIn + slot;
    kept.push(ordered[i]);
  }

  let clock = START_TIMES[timeOfDay];
  const dayIndex = new Date().getDay();
  const startMinutes = START_TIMES[timeOfDay];
  const requestedHours = TOTAL_MINUTES[duration] / 60;
  const steps = kept.map((p, i) => {
    const prev = i > 0 ? kept[i - 1].business : null;
    const walkFromPrevMinutes = prev ? Math.round(haversine(prev, p.business) / WALK_METRES_PER_MIN) + 5 : null;
    const step = {
      time: formatClock(clock),
      estimatedDuration: `${slot} min`,
      reasons: stopReasons(p.business, { nowMinutes: clock, dayIndex, prev, startMinutes, requestedHours, walkFromPrevMinutes }),
      business: decorate(p.business),
      intent: p.intent.label
    };
    if (i < kept.length - 1) {
      const gap = Math.round(haversine(p.business, kept[i + 1].business) / WALK_METRES_PER_MIN) + 5;
      step.walkToNextMinutes = gap;
      clock += slot + gap;
    }
    return step;
  });

  // Swap options: other venues in the same category as each stop, nearest first.
  const chosenIds = new Set(kept.map((p) => p.business.id));
  const swapOptions = [];
  const seen = new Set();
  for (const p of kept) {
    const near = eligible
      .filter((b) => !chosenIds.has(b.id) && !seen.has(b.id) && b.category === p.business.category)
      .map((b) => ({ b, d: haversine(p.business, b) }))
      .sort((x, y) => x.d - y.d || x.b.name.localeCompare(y.b.name))
      .slice(0, 2);
    for (const { b, d } of near) {
      if (swapOptions.length >= 5) break;
      seen.add(b.id);
      swapOptions.push({ ...decorate(b), distanceFromStopMetres: Math.round(d), swapForStop: p.business.name });
    }
    if (swapOptions.length >= 5) break;
  }

  return {
    steps,
    swapOptions,
    meta: {
      mode: 'multi',
      duration,
      timeOfDay,
      intents: intents.map((i) => i.label),
      unfilledIntents: unfilled,
      unmatchedSegments: unmatched,
      droppedRepeats: dropped,
      scope: scopeName,
      usedFallback: false,
      matchedKeywords: intents.map((i) => i.label),
      unsupportedRequests: [],
      note: [
        unfilled.length ? `No listings yet for: ${unfilled.join(', ')}.` : null,
        unmatched.length ? `Not understood: ${unmatched.join(', ')}.` : null,
        dropped.length ? `Repeated categories skipped: ${dropped.join(', ')}.` : null,
        droppedFar.length ? `Too far to walk for: ${droppedFar.join(', ')}.` : null,
        kept.length < picks.length && !droppedFar.length ? 'Shortened to fit your window.' : null
      ].filter(Boolean).join(' ') || null
    }
  };
}

function buildConcierge(input, businesses) {
  const planned = parseIntents(input.activity);
  if (planned.intents.length >= 2) return buildMulti(input, businesses, planned);

  const duration = TOTAL_MINUTES[input.duration] ? input.duration : '4h';
  const timeOfDay = START_TIMES[input.timeOfDay] !== undefined ? input.timeOfDay : 'flexible';
  const parsed = parseActivity(input.activity);
  // Optional category filter from the form (multi-select). Empty or missing means no filter.
  const catSet = Array.isArray(input.categories) && input.categories.length ? new Set(input.categories.map(String)) : null;
  // A neighbourhood named in the text ("museum downtown") scopes the search when the form sends none.
  let scopeId = input.neighborhoodId || null;
  if (!scopeId) {
    const text = String(input.activity || '').toLowerCase();
    const hoods = new Map();
    for (const b of businesses) if (b.neighborhood) hoods.set(b.neighborhood.id, b.neighborhood.name);
    for (const [id, name] of hoods) {
      const full = name.toLowerCase();
      const first = full.split(' ')[0];
      const re = new RegExp(`(^|[^a-z])(${escapeRe(full)}|${escapeRe(first)})($|[^a-z])`);
      if (re.test(text)) { scopeId = id; parsed.neighbourhoodFromText = name; break; }
    }
  }
  const baseSlot = SLOT_MINUTES[duration];
  const stopCount = Math.floor(TOTAL_MINUTES[duration] / baseSlot);

  const inScope = businesses.filter((b) => !scopeId || b.neighborhoodId === scopeId);
  const eligible = inScope.filter((b) => contactable(b) && b.latitude != null && b.longitude != null
    && (!catSet || catSet.has(b.category) || catSet.has(b.primaryCategory)));

  let pool = eligible.filter((b) => matchesRules(b, parsed));
  let fallback = false;
  if (pool.length < 3) {
    fallback = true;
    pool = eligible.slice().sort((a, b) => completeness(b) - completeness(a) || a.name.localeCompare(b.name));
  }
  pool.sort((a, b) => namedInText(b, input.activity) - namedInText(a, input.activity) || completeness(b) - completeness(a) || a.name.localeCompare(b.name));
  const candidates = pool.slice(0, 40);

  // Proximity route: anchor in the densest cluster (most candidates within 1.5 km), then always
  // move to the nearest unchosen one, so the walk stays inside one area.
  const density = (b) => candidates.filter((c) => c !== b && haversine(b, c) <= 1500).length;
  const chosen = [];
  if (candidates.length) {
    const anchor = candidates.slice().sort((a, b) => namedInText(b, input.activity) - namedInText(a, input.activity) || density(b) - density(a) || completeness(b) - completeness(a) || a.name.localeCompare(b.name))[0];
    chosen.push(anchor);
    while (chosen.length < Math.min(stopCount, candidates.length)) {
      const last = chosen[chosen.length - 1];
      const rest = candidates.filter((c) => !chosen.includes(c));
      rest.sort((a, b) => haversine(last, a) - haversine(last, b) || a.name.localeCompare(b.name));
      chosen.push(rest[0]);
    }
  }

  // Speak only when the user asked to crawl. A "coffee crawl" is four cafés on
  // purpose; an "afternoon in Gastown" is not.
  const isCrawl = /\bcrawl\b/i.test(String(input.activity || ''));
  const route = diversifyRoute(chosen, candidates, isCrawl);

  // A leg longer than MAX_WALK_MIN is not a walk, it is a transfer. Measured
  // 2026-11-02: "coffee, 3 hours" produced a 92-minute leg and a 14.7 km day, so
  // a stop that far from the previous one is dropped instead of published.
  const walkRoute = [];
  const droppedFar = [];
  for (const b of route) {
    const last = walkRoute[walkRoute.length - 1];
    if (last) {
      const leg = Math.round(haversine(last, b) / WALK_METRES_PER_MIN) + 5;
      if (leg > MAX_WALK_MIN) { droppedFar.push(b.name); continue; }
    }
    walkRoute.push(b);
  }

  // Walking legs. Computed BEFORE the slot size, because the dwell time has to be
  // whatever is left of the requested budget once the walking is paid for.
  // The old code budgeted dwell and ignored walking entirely, so a 4-hour request
  // produced a 4h18 route.
  const computeLegs = (r) => r.map((b, i) => (i < r.length - 1
    ? Math.round(haversine(b, r[i + 1]) / WALK_METRES_PER_MIN) + 5
    : null));
  const budget = TOTAL_MINUTES[duration];
  let legs = computeLegs(walkRoute);
  let totalWalk = legs.reduce((sum, g) => sum + (g || 0), 0);
  let slot = walkRoute.length
    ? Math.max(25, Math.floor((budget - totalWalk) / walkRoute.length))
    : baseSlot;
  // The 25-minute dwell floor can push a long-walk day past its window; drop the
  // last stop until the whole plan fits inside the requested time plus tolerance.
  while (walkRoute.length > 1 && walkRoute.length * slot + totalWalk > budget + OVERSHOOT_TOLERANCE_MIN) {
    walkRoute.pop();
    legs = computeLegs(walkRoute);
    totalWalk = legs.reduce((sum, g) => sum + (g || 0), 0);
    slot = Math.max(25, Math.floor((budget - totalWalk) / walkRoute.length));
  }

  // Timed steps, with walking gaps between stops.
  let clock = START_TIMES[timeOfDay];
  const dayIndex = new Date().getDay();
  const startMinutes = START_TIMES[timeOfDay];
  const requestedHours = TOTAL_MINUTES[duration] / 60;
  const steps = walkRoute.map((b, i) => {
    const prev = i > 0 ? walkRoute[i - 1] : null;
    const walkFromPrevMinutes = i > 0 ? legs[i - 1] : null;
    const step = {
      time: formatClock(clock),
      estimatedDuration: `${slot} min`,
      reasons: stopReasons(b, { nowMinutes: clock, dayIndex, prev, startMinutes, requestedHours, walkFromPrevMinutes }),
      business: decorate(b)
    };
    if (i < walkRoute.length - 1) {
      step.walkToNextMinutes = legs[i];
      clock += slot + legs[i];
    }
    return step;
  });

  const used = new Set(walkRoute.map((c) => c.id));
  const swapPool = (fallback ? eligible : eligible.filter((b) => matchesRules(b, parsed))).filter((b) => !used.has(b.id));
  const swapOptions = [];
  const seen = new Set();
  for (const stop of walkRoute) {
    const near = swapPool
      .filter((b) => !seen.has(b.id))
      .map((b) => ({ b, d: haversine(stop, b) }))
      .sort((x, y) => x.d - y.d || x.b.name.localeCompare(y.b.name))
      .slice(0, 2);
    for (const { b, d } of near) {
      if (swapOptions.length >= 5) break;
      seen.add(b.id);
      swapOptions.push({ ...decorate(b), distanceFromStopMetres: Math.round(d), swapForStop: stop.name });
    }
    if (swapOptions.length >= 5) break;
  }

  return {
    steps,
    swapOptions,
    meta: {
      duration,
      timeOfDay,
      stopCount: walkRoute.length,
      slotMinutes: slot,
      walkMinutes: totalWalk,
      totalMinutes: walkRoute.length ? walkRoute.length * slot + totalWalk : 0,
      usedFallback: fallback,
      matchedKeywords: parsed.matched,
      unsupportedRequests: parsed.unsupported,
      note: [
        parsed.unsupported.length
          ? `No listing category for "${parsed.unsupported.join('", "')}" yet, so those words were not used.`
          : null,
        droppedFar.length
          ? `Too far to walk from the previous stop: ${droppedFar.slice(0, 3).join(', ')}.`
          : null
      ].filter(Boolean).join(' ') || null
    }
  };
}

module.exports = { buildConcierge, parseActivity, completeness, haversine, formatClock, diversifyRoute };
