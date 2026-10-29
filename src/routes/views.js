const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { sortByCompleteness } = require('../lib/business-order');
const { decorate } = require('../lib/format');
const { record } = require('../lib/tracking');
// One navigation-export implementation shared with the browser and the API — see public/maps-url.js.
const mapsUrl = require('../../public/maps-url');
const { failText } = require('../lib/errors');
const prisma = new PrismaClient();

const PER_PAGE = 24;

function parseTags(tagsStr) {
  try {
    return JSON.parse(tagsStr || '[]');
  } catch (e) {
    return [];
  }
}

/** Builds the query string for pagination links, preserving every filter except the page. */
function queryBase(query, extraKey) {
  const parts = [];
  for (const [key, value] of Object.entries(query)) {
    if (key === 'page' || value === undefined || value === '') continue;
    if (extraKey && key === extraKey) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }
  return parts.join('&');
}

function paginate(items, requestedPage, baseQuery) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const page = Math.min(Math.max(1, Number(requestedPage) || 1), totalPages);
  const start = (page - 1) * PER_PAGE;
  return {
    items: items.slice(start, start + PER_PAGE),
    page,
    totalPages,
    total,
    perPage: PER_PAGE,
    from: total === 0 ? 0 : start + 1,
    to: Math.min(start + PER_PAGE, total),
    baseQuery
  };
}

// Homepage
router.get('/', async (req, res) => {
  try {
    // Photographed districts first, then by how many places they hold: the bento
    // leads with tiles that actually have an image rather than a row of blanks.
    const neighborhoodsAll = await prisma.neighborhood.findMany({
      include: { _count: { select: { businesses: true } } },
    });
    const neighborhoods = neighborhoodsAll.sort((a, b) => {
      const img = (b.imageUrl ? 1 : 0) - (a.imageUrl ? 1 : 0);
      if (img) return img;
      const count = b._count.businesses - a._count.businesses;
      if (count) return count;
      return a.name.localeCompare(b.name);
    });
    const itineraries = await prisma.itinerary.findMany({
      take: 3,
      include: { neighborhood: true, steps: true }
    });
    const featuredBusinesses = sortByCompleteness(
      await prisma.business.findMany({ include: { neighborhood: true } })
    ).slice(0, 6);

    // Real counts, so the data strip states facts rather than vibes.
    const [totalPlaces, totalItineraries, totalStandins] = await Promise.all([
      prisma.business.count(),
      prisma.itinerary.count(),
      prisma.business.count({ where: { imageKind: 'standin' } }),
    ]);

    res.render('index.html', {
      neighborhoods,
      itineraries,
      featuredBusinesses,
      totalPlaces,
      totalItineraries,
      totalNeighborhoods: neighborhoods.length,
      totalStandins
    });
  } catch (error) {
    failText(res, 'GET /', error);
  }
});

// Business detail page
router.get('/businesses/:slug', async (req, res) => {
  try {
    // slug is not a unique column in the schema, so look up with findFirst.
    let business = await prisma.business.findFirst({
      where: { slug: req.params.slug },
      include: { neighborhood: true }
    });

    // A merged-away row keeps its old slug as an alias so bookmarks still resolve.
    if (!business) {
      business = await prisma.business.findFirst({
        where: { slugAliases: { contains: `"${req.params.slug}"` } },
        include: { neighborhood: true }
      });
    }

    if (!business) {
      return res.status(404).send('Business not found');
    }

    // Google Maps search link, built without an API key.
    const mapsQuery = encodeURIComponent(`${business.name} ${business.address}`);

    // Optional Google Maps Embed: only when the key is present in the environment. The key is
    // never logged and never printed outside the iframe URL.
    const mapsEmbedKey = (process.env.GOOGLE_MAPS_EMBED_KEY || '').trim();
    const mapsEmbedUrl = mapsEmbedKey
      ? `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(mapsEmbedKey)}&q=${mapsQuery}`
      : null;

    await record(prisma, req, 'page_view_detail', {
      businessId: business.id,
      path: `/businesses/${business.slug}`
    });

    res.render('business-detail.html', {
      business: decorate(business),
      mapsQuery,
      mapsEmbedUrl
    });
  } catch (error) {
    failText(res, 'GET /businesses/:slug', error);
  }
});

// Neighborhoods list page
router.get('/neighborhoods', async (req, res) => {
  try {
    const { search, q, sort } = req.query;
    if (search || q) {
      return res.redirect('/search?q=' + encodeURIComponent(search || q));
    }

    const where = {};
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { description: { contains: search } },
        { citySection: { contains: search } }
      ];
    }

    let orderBy = { name: 'asc' };
    if (sort === 'name_desc') orderBy = { name: 'desc' };
    else if (sort === 'section_asc') orderBy = { citySection: 'asc' };

    let neighborhoods = await prisma.neighborhood.findMany({
      where,
      include: {
        _count: { select: { businesses: true, itineraries: true } }
      },
      orderBy
    });

    if (sort === 'businesses_desc') {
      neighborhoods.sort((a, b) => b._count.businesses - a._count.businesses);
    } else if (sort === 'itineraries_desc') {
      neighborhoods.sort((a, b) => b._count.itineraries - a._count.itineraries);
    }

    res.render('neighborhoods.html', {
      neighborhoods,
      selectedSearch: search || '',
      selectedSort: sort || 'name_asc'
    });
  } catch (error) {
    failText(res, 'GET /neighborhoods', error);
  }
});

// Neighborhood detail page
router.get('/neighborhoods/:slug', async (req, res) => {
  try {
    const neighborhood = await prisma.neighborhood.findUnique({
      where: { slug: req.params.slug },
      include: {
        businesses: true,
        itineraries: {
          include: { steps: true }
        }
      }
    });

    if (!neighborhood) {
      return res.status(404).send('Neighborhood not found');
    }

    // Process tags on businesses and page the listing.
    const ordered = sortByCompleteness(neighborhood.businesses);
    const pagination = paginate(ordered, req.query.page, queryBase(req.query));

    // Category breakdown for the header: every listing category, zero counts included.
    const { CATEGORY_OPTIONS } = require('../lib/categories');
    const countMap = new Map(CATEGORY_OPTIONS.map((c) => [c, 0]));
    for (const b of neighborhood.businesses) {
      const key = b.category || 'Other';
      countMap.set(key, (countMap.get(key) || 0) + 1);
    }
    const categoryCounts = [...countMap.entries()]
      .map(([name, count]) => ({ name, count, slug: encodeURIComponent(name) }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    res.render('neighborhood-detail.html', {
      neighborhood,
      businesses: pagination.items.map(decorate),
      pagination,
      itineraries: neighborhood.itineraries,
      categoryCounts
    });
  } catch (error) {
    failText(res, 'GET /neighborhoods/:slug', error);
  }
});

// Search & Businesses directory page
router.get('/businesses', async (req, res) => {
  try {
    const { category, neighborhood, search, q, tag, sort } = req.query;
    if (search || q) {
      return res.redirect('/search?q=' + encodeURIComponent(search || q));
    }

    const where = {};
    if (category) {
      where.category = category;
    }
    if (neighborhood) {
      where.neighborhood = { slug: neighborhood };
    }
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { description: { contains: search } },
        { category: { contains: search } },
        { primaryCategory: { contains: search } },
        { address: { contains: search } },
        { phone: { contains: search } },
        { tags: { contains: search } },
        { neighborhood: { name: { contains: search } } },
        { neighborhood: { citySection: { contains: search } } }
      ];
    }
    if (tag) {
      where.tags = { contains: tag };
    }

    // rating/reviewCount/priceRange are NULL across the directory (nothing free could
    // confirm them), so ordering is by data completeness then name.
    const businesses = sortByCompleteness(await prisma.business.findMany({
      where,
      include: { neighborhood: true },
      orderBy: { name: 'asc' }
    }));

    const neighborhoods = await prisma.neighborhood.findMany({ orderBy: { name: 'asc' } });

    // Hours are stored as an OSM string ("Mo-Fr 08:00-17:00"), so "open now" cannot be a
    // SQL predicate. Decorate first, then filter on the parsed state the row will print
    // anyway - so the badge and the filter can never disagree about whether a place is open.
    const openNow = req.query.open === '1';
    const verifiedOnly = req.query.verified === '1';

    const unfilteredCount = businesses.length;
    let filtered = sortByCompleteness(businesses).map(decorate);
    if (openNow) filtered = filtered.filter((b) => b.openState && b.openState.state === 'open');
    if (verifiedOnly) filtered = filtered.filter((b) => b.isVerified);

    const pagination = paginate(filtered, req.query.page, queryBase(req.query));

    res.render('search.html', {
      businesses: pagination.items,
      pagination,
      neighborhoods,
      categories: require('../lib/categories').CATEGORY_OPTIONS,
      selectedCategory: category || '',
      selectedNeighborhood: neighborhood || '',
      selectedSearch: search || '',
      selectedTag: tag || '',
      selectedSort: sort || 'completeness_desc',
      filterOpen: openNow,
      filterVerified: verifiedOnly,
      unfilteredCount,
      // Anything the user switched on, so the page can say how narrow the view is.
      activeFilterCount: [category, neighborhood, tag, search, openNow, verifiedOnly]
        .filter((v) => v && v !== 'undefined').length
    });
  } catch (error) {
    failText(res, 'GET /businesses', error);
  }
});

// Unified Smart Search Route
router.get('/search', async (req, res) => {
  try {
    const q = req.query.q || req.query.search || '';

    let matchingNeighborhoods = [];
    let matchingBusinesses = [];
    let matchingItineraries = [];
    let businessPagination = null;

    if (q.trim()) {
      // 1. Search Neighborhoods
      matchingNeighborhoods = await prisma.neighborhood.findMany({
        where: {
          OR: [
            { name: { contains: q } },
            { description: { contains: q } },
            { citySection: { contains: q } }
          ]
        },
        include: {
          _count: { select: { businesses: true, itineraries: true } }
        }
      });

      // 2. Search Businesses
      const rawBusinesses = await prisma.business.findMany({
        where: {
          OR: [
            { name: { contains: q } },
            { description: { contains: q } },
            { category: { contains: q } },
            { primaryCategory: { contains: q } },
            { address: { contains: q } },
            { phone: { contains: q } },
            { tags: { contains: q } },
            { neighborhood: { name: { contains: q } } },
            { neighborhood: { citySection: { contains: q } } }
          ]
        },
        include: { neighborhood: true },
        orderBy: { name: 'asc' }
      });

      const scoped = req.query.category
        ? rawBusinesses.filter((b) => b.category === req.query.category || b.primaryCategory === req.query.category)
        : rawBusinesses;
      const ordered = sortByCompleteness(scoped.map(decorate));
      const pagination = paginate(ordered, req.query.page, queryBase(req.query));
      matchingBusinesses = pagination.items;

      // 3. Search Itineraries
      matchingItineraries = await prisma.itinerary.findMany({
        where: {
          OR: [
            { title: { contains: q } },
            { description: { contains: q } },
            { highlights: { contains: q } },
            { neighborhood: { name: { contains: q } } }
          ]
        },
        include: {
          neighborhood: true,
          steps: { include: { business: true }, orderBy: { order: 'asc' } }
        }
      });
      businessPagination = pagination;
    }

    const totalCount = matchingNeighborhoods.length + matchingBusinesses.length + matchingItineraries.length;

    if (q.trim()) {
      await record(prisma, req, 'search', { path: `/search?q=${q.slice(0, 80)}` });
    }

    res.render('search-unified.html', {
      selectedCategory: req.query.category || '',
      categoryOptions: require('../lib/categories').CATEGORY_OPTIONS,
      searchQuery: q,
      totalCount,
      matchingNeighborhoods,
      matchingBusinesses,
      matchingItineraries,
      pagination: businessPagination
    });
  } catch (error) {
    failText(res, 'GET /search', error);
  }
});

// Itineraries list page
router.get('/itineraries', async (req, res) => {
  try {
    const { search, q, neighborhood, difficulty, sort } = req.query;
    if (search || q) {
      return res.redirect('/search?q=' + encodeURIComponent(search || q));
    }

    const where = {};
    if (neighborhood) {
      where.neighborhood = { slug: neighborhood };
    }
    if (difficulty) {
      where.difficulty = difficulty;
    }
    if (search) {
      where.OR = [
        { title: { contains: search } },
        { description: { contains: search } },
        { highlights: { contains: search } }
      ];
    }

    let orderBy = { title: 'asc' };
    if (sort === 'title_desc') orderBy = { title: 'desc' };
    else if (sort === 'duration_asc') orderBy = { duration: 'asc' };

    const itineraries = await prisma.itinerary.findMany({
      where,
      include: {
        neighborhood: true,
        steps: {
          include: { business: true },
          orderBy: { order: 'asc' }
        }
      },
      orderBy
    });

    const neighborhoods = await prisma.neighborhood.findMany({ orderBy: { name: 'asc' } });

    res.render('itineraries.html', {
      itineraries,
      neighborhoods,
      selectedSearch: search || '',
      selectedNeighborhood: neighborhood || '',
      selectedDifficulty: difficulty || '',
      selectedSort: sort || 'title_asc'
    });
  } catch (error) {
    failText(res, 'GET /itineraries', error);
  }
});

// Itinerary detail page
router.get('/itineraries/:slug', async (req, res) => {
  try {
    const itinerary = await prisma.itinerary.findUnique({
      where: { slug: req.params.slug },
      include: {
        neighborhood: true,
        steps: {
          include: { business: true },
          orderBy: { order: 'asc' }
        }
      }
    });

    if (!itinerary) {
      return res.status(404).send('Itinerary not found');
    }

    // Build Google Maps export URL
        const googleMapsUrl = mapsUrl.googleDirectionsUrl(itinerary.steps.map(s => s.business));

    res.render('itinerary-detail.html', {
      itinerary,
      googleMapsUrl
    });
  } catch (error) {
    failText(res, 'GET /itineraries/:slug', error);
  }
});

// AI Planner page
router.get('/concierge', async (req, res) => {
  try {
    const neighborhoods = await prisma.neighborhood.findMany({ orderBy: { name: 'asc' } });
    res.render('concierge.html', { neighborhoods, categoryOptions: require('../lib/categories').CATEGORY_OPTIONS });
  } catch (error) {
    failText(res, 'GET /concierge', error);
  }
});

// Business claim / Portal page
router.get('/claim', (req, res) => {
  res.render('claim.html');
});

router.get('/admin', (req, res) => {
  res.render('admin.html');
});

module.exports = router;
