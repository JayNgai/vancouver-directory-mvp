const express = require('express');
const { buildConcierge } = require('../lib/concierge');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { sortByCompleteness } = require('../lib/business-order');
const { decorate } = require('../lib/format');
// One navigation-export implementation shared with the itinerary route and the browser —
// see public/maps-url.js. It replaced a byte-identical copy that lived in this file.
const mapsUrl = require('../../public/maps-url');
const prisma = new PrismaClient();

/** Public shape: no price/rating/review-count fields and no raw OSM codes. */
function publicBusiness(business) {
  const { priceRange, rating, reviewCount, hours, liquorServiceHours, ...rest } = decorate(business);
  return {
    ...rest,
    displayHours: rest.displayHours,
    displayPhone: rest.displayPhone,
    displayLiquorHours: rest.displayLiquorHours
  };
}

// Health check
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// GET /api/neighborhoods
router.get('/neighborhoods', async (req, res) => {
  try {
    const neighborhoods = await prisma.neighborhood.findMany({
      include: {
        _count: {
          select: { businesses: true, itineraries: true }
        }
      },
      orderBy: { name: 'asc' }
    });
    res.json({ success: true, data: neighborhoods });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/neighborhoods/:slug
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
      return res.status(404).json({ success: false, error: 'Neighborhood not found' });
    }

    res.json({ success: true, data: neighborhood });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/businesses
router.get('/businesses', async (req, res) => {
  try {
    const { category, neighborhood, search } = req.query;

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
        { primaryCategory: { contains: search } },
        { tags: { contains: search } }
      ];
    }

    const businesses = sortByCompleteness(await prisma.business.findMany({
      where,
      include: { neighborhood: true },
      orderBy: { name: 'asc' }
    }));

    res.json({ success: true, count: businesses.length, data: businesses.map(publicBusiness) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/itineraries
router.get('/itineraries', async (req, res) => {
  try {
    const itineraries = await prisma.itinerary.findMany({
      include: {
        neighborhood: true,
        steps: {
          include: { business: true },
          orderBy: { order: 'asc' }
        }
      }
    });
    const publicItineraries = itineraries.map((itinerary) => ({
      ...itinerary,
      steps: itinerary.steps.map((step) => ({
        ...step,
        business: step.business ? publicBusiness(step.business) : null
      }))
    }));
    res.json({ success: true, data: publicItineraries });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/itineraries/:slug
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
      return res.status(404).json({ success: false, error: 'Itinerary not found' });
    }

    // Build Google Maps directions export URL
        const googleMapsUrl = mapsUrl.googleDirectionsUrl(itinerary.steps.map(s => s.business));

    res.json({
      success: true,
      data: {
        ...itinerary,
        steps: itinerary.steps.map((step) => ({
          ...step,
          business: step.business ? publicBusiness(step.business) : null
        })),
        googleMapsUrl
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/concierge: deterministic rule-based itinerary (see src/lib/concierge.js)
router.post('/concierge', async (req, res) => {
  try {
    const { activity, duration, timeOfDay, neighborhoodId, categories } = req.body || {};
    const businesses = await prisma.business.findMany({ include: { neighborhood: true } });
    const data = buildConcierge({ activity, duration, timeOfDay, neighborhoodId: neighborhoodId || null, categories: Array.isArray(categories) ? categories : null }, businesses);
        // Navigation export. Until now an outing could be BUILT and then not taken anywhere: the
            // itinerary pages had a maps link, the concierge result had none — a dead end at the exact
            // moment the user had something worth keeping. Same builder as those pages.
            // The browser also recomputes these after a swap, because the itinerary is edited client-side;
            // these values are the API's answer for the itinerary AS GENERATED, for non-browser consumers.
            const stops = data.steps.map((s) => s.business);
            res.json({
              success: true,
              data: {
                ...data,
                googleMapsUrl: mapsUrl.googleDirectionsUrl(stops),
                appleMapsUrl: mapsUrl.appleDirectionsUrl(stops)
              }
            });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
