/**
 * JSON-LD for a business page.
 *
 * The audit found three problems this fixes:
 *  - every listing said @type LocalBusiness with no @id, so chain branches
 *    overwrote each other in the graph and contradicted one another on address
 *    and phone;
 *  - the branch's `url` was the brand's website, not the page describing the
 *    branch;
 *  - the visible breadcrumb had no BreadcrumbList.
 *
 * One rule decides when identifiers are published: an @id is permanent, so it is
 * only emitted once PUBLIC_BASE_URL is a real public origin. On loopback the
 * output stays exactly as safe as before (no @id, no url, no brand node), which
 * makes this file safe to merge before the hostname is chosen.
 */

function isPublicBase(base) {
  const value = String(base || '').trim();
  if (!value) return false;
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1' && host !== '0.0.0.0';
  } catch (error) {
    return false;
  }
}

function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Canadian postal code, only when the row actually holds one. Six of 2,958
// addresses do; guessing the rest would be inventing data.
function postalCodeFrom(address) {
  const match = /([A-Z]\d[A-Z])\s?(\d[A-Z]\d)/i.exec(String(address || ''));
  return match ? `${match[1].toUpperCase()} ${match[2].toUpperCase()}` : null;
}

// schema.org has no way to say "closed" in openingHoursSpecification, so days
// with no window are omitted rather than published as an assumption.
function openingHours(raw) {
  let parseHoursWindows;
  try {
    ({ parseHoursWindows } = require('./reasons'));
  } catch (error) {
    return [];
  }
  if (typeof parseHoursWindows !== 'function') return [];
  let windows = [];
  try {
    windows = parseHoursWindows(raw) || [];
  } catch (error) {
    return [];
  }
  const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const clock = (minutes) => {
    const m = ((minutes % 1440) + 1440) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  };
  const specs = [];
  for (const w of windows) {
    if (!w || !w.days || typeof w.open !== 'number' || typeof w.close !== 'number') continue;
    const days = [...w.days].map((d) => DAY[d]).filter(Boolean);
    if (!days.length) continue;
    specs.push({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: days,
      opens: clock(w.open),
      closes: clock(w.close),
    });
  }
  return specs;
}

/**
 * @param {object} business  a decorated business row (name, slug, address, phone, website, hours…)
 * @param {object} opts      { base, districtName, districtSlug }
 * @returns {object} a schema.org document with a @graph
 */
function buildBusinessJsonLd(business, opts = {}) {
  const base = String(opts.base || '').replace(/\/$/, '');
  const publishIds = isPublicBase(base);
  const branch = {
    '@type': 'LocalBusiness',
    name: business.name,
    address: {
      '@type': 'PostalAddress',
      streetAddress: business.address,
      addressLocality: 'Vancouver',
      addressRegion: 'BC',
      addressCountry: 'CA',
    },
  };

  const postal = postalCodeFrom(business.address);
  if (postal) branch.address.postalCode = postal;
  if (business.latitude != null && business.longitude != null) {
    branch.geo = { '@type': 'GeoCoordinates', latitude: business.latitude, longitude: business.longitude };
  }
  if (business.phone) branch.telephone = business.phone;
  if (business.website && publishIds) branch.sameAs = [business.website];
  else if (business.website) branch.sameAs = [business.website];

  const graph = [branch];

  if (publishIds && business.slug) {
    branch['@id'] = `${base}/businesses/${business.slug}#business`;
    branch.url = `${base}/businesses/${business.slug}`;
  }

  // A chain is many branches of one brand. The brand node is keyed by the name, so
  // two Starbucks pages declare the same brand id and different branch ids, which
  // is what stops them contradicting each other.
  const brandSlug = slugify(business.name);
  if (publishIds && brandSlug) {
    const brandId = `${base}/brands/${brandSlug}#organization`;
    graph.push({ '@type': 'Organization', '@id': brandId, name: business.name });
    branch.branchOf = { '@id': brandId };
  }

  const hours = openingHours(business.hours);
  if (hours.length) branch.openingHoursSpecification = hours;

  if (opts.districtName && opts.districtSlug) {
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: publishIds ? `${base}/` : undefined },
        { '@type': 'ListItem', position: 2, name: 'Neighbourhoods', item: publishIds ? `${base}/neighborhoods` : undefined },
        { '@type': 'ListItem', position: 3, name: opts.districtName, item: publishIds ? `${base}/neighborhoods/${opts.districtSlug}` : undefined },
        { '@type': 'ListItem', position: 4, name: business.name },
      ],
    });
  }

  // LocalBusiness.url is required by the validator; without a public origin there
  // is no honest URL to give, so the field is dropped rather than pointed at a
  // brand website that is not this branch.
  for (const node of graph) {
    if (node.item && node.item.length) {
      node.itemListElement.forEach((li) => { if (!li.item) delete li.item; });
    }
  }

  return { '@context': 'https://schema.org', '@graph': graph };
}

module.exports = { buildBusinessJsonLd, isPublicBase, slugify, postalCodeFrom };
