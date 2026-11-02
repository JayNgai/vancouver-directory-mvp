// Route map for the preset itinerary pages.
//
// The concierge result has had a map since it was built; a preset itinerary had
// only a timeline and two Google links, so the one surface a visitor is most
// likely to follow on foot was the one with no picture of the walk.
//
// Stops come from the rendered timeline (`data-lat` / `data-lng` on each step), so
// this file needs no server data and the page works from the same markup a reader
// sees. Leaflet and its stylesheet are loaded by the template.
(function () {
  const el = document.getElementById('routeMap');
  if (!el || typeof L === 'undefined') return;

  const stops = [...document.querySelectorAll('.timeline-step')]
    .map((node, index) => ({
      index: index + 1,
      name: node.dataset.name || `Stop ${index + 1}`,
      lat: parseFloat(node.dataset.lat),
      lng: parseFloat(node.dataset.lng),
    }))
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));

  if (!stops.length) {
    el.hidden = true;
    return;
  }

  const map = L.map(el, { scrollWheelZoom: false });
  const bounds = L.latLngBounds(stops.map((s) => [s.lat, s.lng]));

  // Same two-step basemap as public/studio.js: OpenStreetMap first, and one swap
  // to CARTO if their policy engine refuses the tiles. Kept in step with that file
  // by hand, because there are two map surfaces and only one tile policy.
  const primary = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  let swapped = false;
  primary.on('tileerror', () => {
    if (swapped) return;
    swapped = true;
    map.removeLayer(primary);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd',
      maxZoom: 20,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
    }).addTo(map);
  });

  // Colour comes from the token layer: check-design-tokens.js fails the build on a
  // hex literal outside tokens.css, and it should.
  const brand = getComputedStyle(document.documentElement).getPropertyValue('--brand').trim();

  L.polyline(stops.map((s) => [s.lat, s.lng]), {
    color: brand || 'darkgreen',
    weight: 2,
    opacity: 0.7,
    dashArray: '4 6',
  }).addTo(map);

  stops.forEach((stop) => {
    L.marker([stop.lat, stop.lng], {
      icon: L.divIcon({
        className: '',
        html: `<span class="pin-badge">${stop.index}</span>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        popupAnchor: [0, -14],
      }),
    }).addTo(map).bindPopup(`<strong>${stop.name}</strong>`);
  });

  map.fitBounds(bounds, { padding: [32, 32] });
})();
