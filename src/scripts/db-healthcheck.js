const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const neighborhoods = await p.neighborhood.count();
  const businesses = await p.business.count();
  const itineraries = await p.itinerary.count();
  const steps = await p.itineraryStep.count();
  console.log(JSON.stringify({ neighborhoods, businesses, itineraries, steps }));

  const ns = await p.neighborhood.findMany({ select: { name: true }, orderBy: { name: 'asc' } });
  console.log('NEIGHBORHOODS: ' + ns.map((x) => x.name).join(' | '));

  const withBiz = await p.neighborhood.findMany({
    select: { name: true, _count: { select: { businesses: true, itineraries: true } } },
    orderBy: { name: 'asc' }
  });
  console.log('COVERAGE: ' + withBiz.map((n) => `${n.name}=${n._count.businesses}b/${n._count.itineraries}i`).join(', '));

  const sample = await p.business.findMany({ select: { name: true, address: true, latitude: true }, take: 3 });
  console.log('SAMPLE: ' + JSON.stringify(sample));

  await p.$disconnect();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
