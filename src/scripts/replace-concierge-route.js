/** Replaces the naive POST /concierge mock in src/routes/api.js with the rule-based engine. */
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'routes', 'api.js');
const src = fs.readFileSync(file, 'utf8');
const start = src.indexOf('// POST /api/concierge');
const end = src.indexOf('module.exports = router;');
if (start < 0 || end < 0 || end < start) throw new Error('markers not found');
const handler = `// POST /api/concierge: deterministic rule-based itinerary (see src/lib/concierge.js)
router.post('/concierge', async (req, res) => {
  try {
    const { activity, duration, timeOfDay, neighborhoodId } = req.body || {};
    const businesses = await prisma.business.findMany({ include: { neighborhood: true } });
    const data = buildConcierge({ activity, duration, timeOfDay, neighborhoodId: neighborhoodId || null }, businesses);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

`;
const next = src.slice(0, start) + handler + src.slice(end);
const withImport = next.includes("require('../lib/concierge')")
  ? next
  : next.replace(/\n/, "\nconst { buildConcierge } = require('../lib/concierge');\n");
fs.writeFileSync(file, withImport, 'utf8');
console.log('api.js concierge route replaced; lines now', withImport.split('\n').length);
