'use strict';

// Free OSM intake for the currently empty Vancouver directory areas.
// Default mode is a read-only dry run. Add --apply only after reviewing its report.
// Cached source responses are stored under the OS temp directory for seven days.

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const USER_AGENT = 'VancouverDirectoryMVP/1.0 (OpenStreetMap community data import; local development)';
const CACHE_DIR = path.join(os.tmpdir(), 'vancouver-directory-osm-cache');
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BOUNDARY_URL = 'https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/local-area-boundary/records?limit=100';
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

const TARGET_CATALOGUE = {
  'commercial-drive': { name: 'Commercial Drive', boundary: 'Grandview-Woodland', corridor: true },
  'grandview-woodland': { name: 'Grandview-Woodland', boundary: 'Grandview-Woodland' },
  'hastings-sunrise': { name: 'Hastings-Sunrise', boundary: 'Hastings-Sunrise' },
  killarney: { name: 'Killarney', boundary: 'Killarney' },
  marpole: { name: 'Marpole', boundary: 'Marpole' },
  strathcona: { name: 'Strathcona', boundary: 'Strathcona' },
  sunset: { name: 'Sunset', boundary: 'Sunset' },
  oakridge: { name: 'Oakridge', boundary: 'Oakridge' },
  // Thin-neighbourhood targets (Phase C). Where the City dataset has a matching local
  // area it is used; where it does not, an explicit approximate footprint is used and
  // the fact is documented rather than silently attributed.
  chinatown: { name: 'Chinatown', box: { south: 49.2768, west: -123.1032, north: 49.2830, east: -123.0942 }, approximate: true },
  kerrisdale: { name: 'Kerrisdale', boundary: 'Kerrisdale' },
  'coal-harbour': { name: 'Coal Harbour', box: { south: 49.2850, west: -123.1330, north: 49.2952, east: -123.1152 }, approximate: true },
  'mount-pleasant': { name: 'Mount Pleasant', boundary: 'Mount Pleasant' },
  'south-granville': { name: 'South Granville', box: { south: 49.2550, west: -123.1420, north: 49.2725, east: -123.1300 }, approximate: true },
  fairview: { name: 'Fairview', boundary: 'Fairview' },
  'false-creek': { name: 'False Creek', box: { south: 49.2652, west: -123.1300, north: 49.2775, east: -123.1000 }, approximate: true },
  'point-grey': { name: 'Point Grey', boundary: 'West Point Grey' },
  'victoria-fraserview': { name: 'Victoria-Fraserview', boundary: 'Victoria-Fraserview' },
  'renfrew-collingwood': { name: 'Renfrew-Collingwood', boundary: 'Renfrew-Collingwood' }
};

const DEFAULT_TARGETS = [
  'commercial-drive', 'grandview-woodland', 'hastings-sunrise', 'killarney',
  'marpole', 'strathcona', 'sunset', 'oakridge'
];

const requested = (process.env.OSM_FILL_TARGETS || DEFAULT_TARGETS.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
const TARGETS = requested.map((slug) => {
  const entry = TARGET_CATALOGUE[slug];
  if (!entry) throw new Error(`Unknown target slug: ${slug}`);
  return { slug, ...entry };
});

// Commercial Drive is a corridor inside the official Grandview-Woodland local area,
// not a separate City polygon. Keep it separate from the surrounding local area.
const DRIVE_CORRIDOR = { south: 49.260, west: -123.077, north: 49.280, east: -123.061 };

function readCache(filename) {
  const file = path.join(CACHE_DIR, filename);
  try {
    const stat = fs.statSync(file);
    if (Date.now() - stat.mtimeMs < CACHE_TTL_MS) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) { /* cache miss */ }
  return null;
}

function writeCache(filename, value) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(path.join(CACHE_DIR, filename), JSON.stringify(value));
}

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: options.method || 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(options.body) } : {})
      },
      timeout: 90000
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode} from ${url}: ${body.slice(0, 300)}`));
        }
        try { resolve(JSON.parse(body)); } catch (error) { reject(new Error(`Invalid JSON from ${url}: ${error.message}`)); }
      });
    });
    req.on('timeout', () => req.destroy(new Error(`Request timeout: ${url}`)));
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function getBoundaries(refresh) {
  if (!refresh) {
    const cached = readCache('city-local-area-boundaries.json');
    if (cached) return cached;
  }
  const data = await requestJson(BOUNDARY_URL);
  if (!Array.isArray(data.results) || data.results.length < 20) {
    throw new Error(`City boundary response malformed or incomplete (records=${data.results && data.results.length})`);
  }
  writeCache('city-local-area-boundaries.json', data);
  return data;
}

function geometryToPolygons(feature) {
  const geometry = feature && feature.geometry;
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

function pointOnRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointInGeometry(lon, lat, polygons) {
  const point = [lon, lat];
  return polygons.some((rings) => rings.length > 0 && pointOnRing(point, rings[0]) && !rings.slice(1).some((hole) => pointOnRing(point, hole)));
}

function bounds(polygons) {
  const coords = [];
  for (const polygon of polygons) for (const ring of polygon) for (const coord of ring) coords.push(coord);
  if (!coords.length) throw new Error('City boundary has no coordinates');
  return {
    south: Math.min(...coords.map((c) => c[1])),
    west: Math.min(...coords.map((c) => c[0])),
    north: Math.max(...coords.map((c) => c[1])),
    east: Math.max(...coords.map((c) => c[0]))
  };
}

function inCorridor(lat, lon) {
  return lat >= DRIVE_CORRIDOR.south && lat <= DRIVE_CORRIDOR.north && lon >= DRIVE_CORRIDOR.west && lon <= DRIVE_CORRIDOR.east;
}

function targetBounds(target, boundaryByName) {
  if (target.box) return target.box;
  return bounds(boundaryByName.get(target.boundary));
}

function insideBox(lat, lon, box) {
  return lat >= box.south && lat <= box.north && lon >= box.west && lon <= box.east;
}

function insideTarget(target, lat, lon, boundaryByName) {
  if (target.box) return insideBox(lat, lon, target.box);
  return pointInGeometry(lon, lat, boundaryByName.get(target.boundary));
}

function makeOverpassQuery(targets, boundaryByName) {
  const areas = new Map();
  for (const target of targets) {
    const targetBox = target.corridor ? DRIVE_CORRIDOR : targetBounds(target, boundaryByName);
    const key = [targetBox.south, targetBox.west, targetBox.north, targetBox.east].map((n) => n.toFixed(6)).join(',');
    areas.set(key, targetBox);
  }
  const boxes = [...areas.values()].map(({ south, west, north, east }) => {
    const box = `(${south},${west},${north},${east})`;
    return `nwr["name"]["amenity"~"^(restaurant|cafe|pub|bar|fast_food|food_court|ice_cream|biergarten)$"]${box};\n` +
      `nwr["name"]["shop"~"^(bakery|confectionery|coffee|deli)$"]${box};`;
  }).join('\n');
  return `[out:json][timeout:90];\n(\n${boxes}\n);\nout center tags;`;
}

async function getOsmElements(query, refresh) {
  if (!refresh) {
    const cached = readCache('osm-empty-neighborhood-candidates.json');
    if (cached && cached.query === query) return cached.elements;
  }
  // A single Overpass request covers all target footprints; no request fan-out.
  const body = `data=${encodeURIComponent(query)}`;
  const data = await requestJson(OVERPASS_URL, { method: 'POST', body });
  if (!Array.isArray(data.elements)) throw new Error('Overpass response has no elements array');
  writeCache('osm-empty-neighborhood-candidates.json', { query, elements: data.elements });
  return data.elements;
}

function getCoordinates(element) {
  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function normalize(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function distanceMeters(a, b) {
  const bLat = b.lat ?? b.latitude;
  const bLon = b.lon ?? b.longitude;
  if (!Number.isFinite(a.latitude) || !Number.isFinite(a.longitude) || !Number.isFinite(bLat) || !Number.isFinite(bLon)) return Infinity;
  const latMean = ((a.latitude + bLat) / 2) * Math.PI / 180;
  const dx = (a.longitude - bLon) * 111320 * Math.cos(latMean);
  const dy = (a.latitude - bLat) * 111320;
  return Math.hypot(dx, dy);
}

function hasFullAddress(tags) {
  return Boolean(tags['addr:full'] || (tags['addr:street'] && tags['addr:housenumber']));
}

function isDuplicate(candidate, existing) {
  const name = normalize(candidate.name);
  for (const row of existing) {
    if (row.id === candidate.id || row.id === candidate.osmId) return row;
    if (normalize(row.name) !== name) continue;
    const sameStreetAddress = candidate.fullAddress && row.address && normalize(candidate.fullAddress) === normalize(row.address);
    const nearbyCoords = Number.isFinite(row.latitude) && Number.isFinite(row.longitude) && distanceMeters(row, candidate) <= 30;
    if (sameStreetAddress || nearbyCoords) return row;
  }
  return null;
}

function categoryFrom(tags) {
  const kind = tags.amenity || tags.shop;
  if (kind === 'cafe' || kind === 'coffee') return ['Cafe', 'Cafe'];
  if (kind === 'pub' || kind === 'bar' || kind === 'biergarten') return ['Bar', 'Bar / Pub'];
  if (kind === 'bakery' || kind === 'confectionery' || kind === 'ice_cream') return ['Dessert', kind.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())];
  if (kind === 'deli') return ['Restaurant', 'Deli'];
  if (kind === 'fast_food') return ['Restaurant', 'Fast Food'];
  if (kind === 'food_court') return ['Restaurant', 'Food Court'];
  return ['Restaurant', 'Restaurant'];
}

function addressFrom(tags, neighborhoodName) {
  if (tags['addr:full']) return tags['addr:full'];
  const parts = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean);
  if (parts.length) return `${parts.join(' ')}, ${tags['addr:city'] || 'Vancouver'}, BC`;
  // OSM has no street address for this feature; make that limitation explicit.
  return `${neighborhoodName}, Vancouver, BC (street address not mapped)`;
}

function candidateFrom(element, neighborhood, coords) {
  const tags = element.tags || {};
  const [category, fallbackPrimary] = categoryFrom(tags);
  const primaryCategory = tags.cuisine ? tags.cuisine.replace(/_/g, ' ').toLowerCase() : fallbackPrimary;
  const badges = ['source-openstreetmap'];
  if (tags.outdoor_seating === 'yes') badges.push('patio');
  if (tags.brewery === 'yes') badges.push('craft-beer');
  if (tags.takeaway === 'yes') badges.push('takeout');
  if (tags.wheelchair === 'yes') badges.push('accessible');
  if (tags.cuisine) badges.push(tags.cuisine.replace(/_/g, '-'));
  const streetAddress = hasFullAddress(tags) ? addressFrom(tags, neighborhood.name) : null;
  const addressQuality = streetAddress ? 'street-address' : (tags['addr:street'] || tags['addr:housenumber'] ? 'partial-address' : 'area-only');
  const osmId = `osm-${element.type}-${element.id}`;
  return {
    id: osmId,
    osmId,
    name: tags.name.trim(),
    slug: `${normalize(tags.name).replace(/\s+/g, '-')}-${element.type}-${element.id}`,
    category,
    primaryCategory,
    tags: JSON.stringify([...new Set(badges)]),
    address: addressFrom(tags, neighborhood.name),
    fullAddress: streetAddress,
    addressQuality,
    latitude: coords.lat,
    longitude: coords.lon,
    phone: tags.phone || tags['contact:phone'] || null,
    website: tags.website || tags['contact:website'] || null,
    hours: tags.opening_hours || null,
    priceRange: null,
    rating: null,
    reviewCount: null,
    photos: '[]',
    description: tags.description || null,
    isVerified: false,
    neighborhoodId: neighborhood.id,
    neighborhoodName: neighborhood.name,
    osmType: element.type,
    osmSourceId: element.id
  };
}

async function getDbSnapshot() {
  const neighborhoods = await prisma.neighborhood.findMany({
    select: { id: true, name: true, slug: true, _count: { select: { businesses: true } } },
    orderBy: { name: 'asc' }
  });
  const businesses = await prisma.business.findMany({ select: { id: true, name: true, address: true, latitude: true, longitude: true } });
  return { neighborhoods, businesses };
}

async function applyAdditions(candidates) {
  return prisma.$transaction(async (tx) => {
    // Re-read within the write transaction so the dry-run comparison cannot go stale.
    const current = await tx.business.findMany({ select: { id: true, name: true, address: true, latitude: true, longitude: true } });
    const accepted = [];
    const seenOsmIds = new Set();
    for (const candidate of candidates) {
      if (seenOsmIds.has(candidate.osmId) || isDuplicate(candidate, [...current, ...accepted])) continue;
      seenOsmIds.add(candidate.osmId);
      accepted.push(candidate);
    }
    for (const candidate of accepted) {
      const { fullAddress, addressQuality, osmId, neighborhoodName, osmType, osmSourceId, ...data } = candidate;
      await tx.business.create({ data });
    }
    return accepted.length;
  }, { timeout: 120000 });
}

async function main() {
  const refresh = process.argv.includes('--refresh');
  const apply = process.argv.includes('--apply');
  const before = await getDbSnapshot();
  const neighborhoodBySlug = new Map(before.neighborhoods.map((n) => [n.slug, n]));
  for (const target of TARGETS) {
    if (!neighborhoodBySlug.has(target.slug)) throw new Error(`Missing target neighborhood slug in DB: ${target.slug}`);
  }

  const cityData = await getBoundaries(refresh);
  const boundaryByName = new Map();
  for (const record of cityData.results) {
    const polygons = geometryToPolygons(record.geom);
    if (polygons.length) boundaryByName.set(record.name, polygons);
  }
  for (const target of TARGETS) {
    if (target.boundary && !boundaryByName.has(target.boundary)) {
      throw new Error(`Missing official City local-area boundary: ${target.boundary}`);
    }
  }

  const query = makeOverpassQuery(TARGETS, boundaryByName);
  // Be conservative even though only one request per source is needed per run.
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const elements = await getOsmElements(query, refresh);
  const elementSeen = new Set();
  const candidatesBySlug = new Map(TARGETS.map((t) => [t.slug, []]));
  const noBoundaryMatch = [];

  for (const element of elements) {
    const osmId = `${element.type}/${element.id}`;
    if (elementSeen.has(osmId)) continue;
    elementSeen.add(osmId);
    const tags = element.tags || {};
    const coords = getCoordinates(element);
    if (!tags.name || !coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lon)) continue;

    const drive = TARGETS.find((t) => t.corridor);
    const specific = TARGETS.filter((t) => !t.corridor);
    let target = null;
    if (drive && inCorridor(coords.lat, coords.lon) && insideTarget(drive, coords.lat, coords.lon, boundaryByName)) {
      target = drive;
    } else {
      // Smallest footprint first so an approximate box does not swallow a precise polygon.
      const ordered = [...specific].sort((a, b) => {
        const areaOf = (t) => {
          const boundsOf = targetBounds(t, boundaryByName);
          return (boundsOf.north - boundsOf.south) * (boundsOf.east - boundsOf.west);
        };
        return areaOf(a) - areaOf(b);
      });
      target = ordered.find((t) => insideTarget(t, coords.lat, coords.lon, boundaryByName)) || null;
    }
    if (!target) {
      noBoundaryMatch.push(osmId);
      continue;
    }
    const dbNeighborhood = neighborhoodBySlug.get(target.slug);
    candidatesBySlug.get(target.slug).push(candidateFrom(element, dbNeighborhood, coords));
  }

  const existing = before.businesses;
  const newBySlug = new Map();
  const duplicatesBySlug = new Map();
  for (const target of TARGETS) {
    const pool = [...existing];
    const accepted = [];
    let duplicates = 0;
    for (const candidate of candidatesBySlug.get(target.slug)) {
      const duplicate = isDuplicate(candidate, pool);
      if (duplicate) { duplicates++; continue; }
      accepted.push(candidate);
      pool.push(candidate);
    }
    newBySlug.set(target.slug, accepted);
    duplicatesBySlug.set(target.slug, duplicates);
  }

  console.log(`Mode: ${apply ? 'APPLY (add-only transaction)' : 'DRY RUN (read-only)'}`);
  console.log(`OSM raw response elements: ${elements.length}; unique named candidate objects: ${elementSeen.size}`);
  console.log(`Unassigned/outside-target boundary objects: ${noBoundaryMatch.length}`);
  console.log(`DB before: ${before.neighborhoods.length} neighborhoods, ${before.businesses.length} businesses`);
  console.log('Target report: current | matched | duplicate | proposed additions');
  for (const target of TARGETS) {
    const n = neighborhoodBySlug.get(target.slug);
    console.log(`${target.name}: ${n._count.businesses} | ${candidatesBySlug.get(target.slug).length} | ${duplicatesBySlug.get(target.slug)} | ${newBySlug.get(target.slug).length}`);
  }
  console.log('Candidate quality spot-check: categories, address completeness, and sample names');
  for (const target of TARGETS) {
    const rows = newBySlug.get(target.slug);
    const categoryCounts = {};
    for (const row of rows) categoryCounts[row.category] = (categoryCounts[row.category] || 0) + 1;
    const addressCounts = {};
    for (const row of rows) addressCounts[row.addressQuality] = (addressCounts[row.addressQuality] || 0) + 1;
    const sample = rows.slice(0, 3).map((row) => `${row.name} [${row.category}; ${row.addressQuality}]`);
    console.log(`${target.name}: categories=${JSON.stringify(categoryCounts)}; address quality=${JSON.stringify(addressCounts)}; samples=${sample.join(' / ')}`);
  }

  const proposed = TARGETS.flatMap((target) => newBySlug.get(target.slug));
  const uniqueCandidateIds = new Set(proposed.map((row) => row.osmId));
  if (uniqueCandidateIds.size !== proposed.length) throw new Error('Safety stop: duplicate OSM object IDs remain after dedupe.');
  if (proposed.some((row) => row.isVerified !== false || row.rating !== null || row.reviewCount !== null)) {
    throw new Error('Safety stop: candidate data contains unsubstantiated verification or ratings.');
  }
  if (!proposed.length) {
    console.log('No new non-duplicate candidates available. No database writes were made.');
    return;
  }
  if (proposed.length > 1200 || TARGETS.some((target) => newBySlug.get(target.slug).length > 500)) {
    throw new Error('Safety stop: candidate volume exceeds sanity limit; no writes made.');
  }
  if (!apply) {
    console.log(`Dry-run complete. Proposed additions: ${proposed.length}. No database writes were made.`);
    return;
  }

  const inserted = await applyAdditions(proposed);
  console.log(`Inserted ${inserted} new businesses; existing business rows were not updated or deleted.`);
  const after = await getDbSnapshot();
  console.log(`DB after: ${after.neighborhoods.length} neighborhoods, ${after.businesses.length} businesses`);
  for (const target of TARGETS) {
    const n = after.neighborhoods.find((entry) => entry.slug === target.slug);
    console.log(`${target.name}: ${n._count.businesses}`);
  }
}

main()
  .catch((error) => { console.error(`OSM fill stopped: ${error.stack || error.message}`); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
