'use strict';
/**
 * Shared deterministic helpers for directory data QA.
 *
 * Everything here is plain code that can be computed exactly — by design. The JEV pilot
 * (see ../README.md) sits BEHIND these helpers as a replaceable classifier; it never owns a
 * gate, a rule or a limit. This module has no dependency on any model.
 */

const { CATEGORY_OPTIONS } = require('../lib/categories');

/** The 12 canonical listing categories the site actually offers as filters. */
const CANONICAL_CATEGORIES = CATEGORY_OPTIONS.slice();

/** Generous bounding box around the City of Vancouver. Anything outside is suspect. */
const VANCOUVER_BBOX = { minLat: 49.19, maxLat: 49.32, minLng: -123.27, maxLng: -123.0 };

/** Normalise a name for duplicate detection: strip accents, case, punctuation, leading article. */
function normalizeName(raw) {
  let text = String(raw == null ? '' : raw).normalize('NFKD');
  text = text.replace(/[\u0300-\u036f]/g, ''); // strip combining marks
  text = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  text = text.replace(/^(the|a|an) /, '');
  return text.replace(/\s+/g, ' ').trim();
}

/** Normalise an address string the same way. */
function normalizeAddress(raw) {
  return String(raw == null ? '' : raw)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Metres between two {latitude, longitude} points (haversine). */
function haversineMetres(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function coordsPresent(record) {
  return Number.isFinite(record.latitude) && Number.isFinite(record.longitude);
}

function coordsInsideVancouver(record) {
  if (!coordsPresent(record)) return false;
  const { latitude: la, longitude: lo } = record;
  return (
    la >= VANCOUVER_BBOX.minLat &&
    la <= VANCOUVER_BBOX.maxLat &&
    lo >= VANCOUVER_BBOX.minLng &&
    lo <= VANCOUVER_BBOX.maxLng
  );
}

/** A phone that looks dialable (>=7 digits) — OSM stores several odd formats. */
function phoneLooksValid(raw) {
  if (!raw) return false;
  const digits = String(raw).replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

/** A website that parses as an http(s) URL, or a bare host we can safely prefix. */
function websiteLooksValid(raw) {
  if (!raw) return false;
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    return Boolean(url.hostname && url.hostname.includes('.'));
  } catch {
    return false;
  }
}

/** An address with at least a street number and a street word. */
function addressLooksStructured(raw) {
  if (!raw) return false;
  return /\d/.test(raw) && /[a-z]{3,}/i.test(raw);
}

function tagsParse(raw) {
  try {
    const parsed = JSON.parse(raw == null ? '[]' : raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

module.exports = {
  CANONICAL_CATEGORIES,
  VANCOUVER_BBOX,
  normalizeName,
  normalizeAddress,
  haversineMetres,
  coordsPresent,
  coordsInsideVancouver,
  phoneLooksValid,
  websiteLooksValid,
  addressLooksStructured,
  tagsParse
};