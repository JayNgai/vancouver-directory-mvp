/**
 * Venue ordering helper.
 *
 * rating / reviewCount / priceRange are NULL across the directory: nothing free could
 * confirm them, so they must never drive ordering or be treated as present.
 * Order by how much data a venue actually has (so richer records surface first),
 * then by name for a stable, deterministic order.
 */

function completenessScore(business) {
  let score = 0;
  if (business.phone) score += 2;
  if (business.website) score += 2;
  if (business.hours) score += 2;
  if (business.description) score += 1;
  if (business.latitude !== null && business.latitude !== undefined) score += 1;
  if (business.address && !/not mapped/i.test(business.address)) score += 2;
  if (business.slug) score += 1;
  try {
    if (JSON.parse(business.photos || '[]').length > 0) score += 1;
  } catch (error) {
    // Ignore malformed photo JSON; it simply contributes no completeness.
  }
  return score;
}

function byCompletenessThenName(a, b) {
  const diff = completenessScore(b) - completenessScore(a);
  if (diff !== 0) return diff;
  return String(a.name || '').localeCompare(String(b.name || ''));
}

function sortByCompleteness(list) {
  return [...list].sort(byCompletenessThenName);
}

module.exports = { completenessScore, byCompletenessThenName, sortByCompleteness };
