/**
 * The itinerary result surface: steps, route canvas, export links, swap options.
 *
 * ONE implementation, shared by /concierge and the homepage Experience Studio dock. Both pages include
 * templates/_studio_results.html for the markup and drive it through this file, so the two cannot
 * render the same itinerary differently.
 *
 * Loaded as a CLASSIC script (not a module), but it wires its events with addEventListener on
 * delegated containers. It must NOT use inline handlers (ondrop="..."/onclick="..."): this app serves
 * `script-src-attr 'none'`, which makes every inline handler attribute INERT. The browser says so
 * outright - "Executing inline event handler violates ... 'script-src-attr 'none''" - and the
 * attributes still READ correctly in the DOM, so the page looks wired and does nothing. That is
 * exactly how drag-to-swap shipped broken while a DOM-stub test passed.
 *
 * Depends on: public/maps-url.js (window.MapsUrl) and Leaflet (window.L) — both loaded before this.
 */
let currentSteps = [];
let currentSwaps = [];
let selectedSwap = null;

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderResults() {
  const stepsHtml = currentSteps.map((step, idx) => `
      <div class="step-card" data-step-idx="${idx}" id="step-${idx}">
          <h4 style="margin: 0 0 4px; color: var(--accent, #007bff); font-size: 1.05em;">${esc(step.time)}</h4>
          <strong style="font-size: 1.1em;">${esc(step.business.name)}</strong>
          <p style="margin: 2px 0; color: var(--muted-foreground, #555);">${esc(step.business.category)} &bull; ${esc(step.business.address)}${step.business.displayHours ? ' &bull; 🕒 ' + esc(step.business.displayHours) : ''}</p>
          <div style="margin-top: 10px; background: #f8fafc; padding: 10px; border-radius: 8px; font-size: 0.9em;">
              <div style="margin-bottom: 4px;"><strong>⏳ Est. time:</strong> ${esc(step.estimatedDuration)}</div>
              <div><strong>💡 Why here:</strong> ${esc(step.why)}</div>
          </div>
          ${step.walkToNextMinutes != null ? `<div style="font-size: 0.85em; color: var(--muted-foreground, #64748b); margin-top: 6px;">Walk to next stop: about ${esc(step.walkToNextMinutes)} min</div>` : ''}
      </div>
  `).join('');
  document.getElementById('itinerarySteps').innerHTML = stepsHtml || '<p>No spots found. Try broader terms.</p>';

  const swapsHtml = currentSwaps.map((biz, idx) => `
      <div draggable="true" data-swap-idx="${idx}"
           class="swap-card${selectedSwap === idx ? ' selected' : ''}" id="swap-${idx}">
          <div style="font-weight: 700; margin-bottom: 4px;">${esc(biz.name)}</div>
          <div style="color: var(--muted-foreground, #555); margin-bottom: 4px;">${esc(biz.category)}${biz.displayHours ? ' &bull; 🕒 ' + esc(biz.displayHours) : ''}</div>
          ${biz.distanceFromStopMetres != null ? `<div style="color: var(--muted-foreground, #555); font-size: 0.85em;">${esc(biz.distanceFromStopMetres)} m from ${esc(biz.swapForStop)}</div>` : ''}
          <div style="color: var(--accent, #007bff); font-size: 0.85em; margin-top: 6px;">Tap, then tap a stop &middot; or drag on a computer</div>
      </div>
  `).join('');
  document.getElementById('swapOptions').innerHTML = swapsHtml || '<p style="color: var(--muted-foreground, #777);">No extra options available.</p>';
  installWiring();
  updateExportLinks();
  drawRoute();
}

// ---- navigation export: keep the link in step with the itinerary ON SCREEN ----
// Recomputed on EVERY render, including after each swap. A URL built once when the itinerary was
// generated would point at a route the user has since changed. Same rule the server uses
// (public/maps-url.js), so the two cannot disagree.
function updateExportLinks() {
  const stops = currentSteps.map((s) => s.business);
  const g = window.MapsUrl.googleDirectionsUrl(stops);
  const a = window.MapsUrl.appleDirectionsUrl(stops);
  const row = document.getElementById('exportRow');
  if (!g) { row.style.display = 'none'; return; }
  document.getElementById('exportGoogle').href = g;
  document.getElementById('exportApple').href = a;
  row.style.display = 'flex';
}

// ---- route canvas: Leaflet, VENDORED into public/vendor/ (no npm package, no key, no account) ----
let routeMap = null;
let routeLayer = null;

function ensureMap() {
  if (routeMap) return routeMap;
  if (typeof L === 'undefined') return null;
  routeMap = L.map('routeMap', { scrollWheelZoom: false });
  // OpenStreetMap tiles: free, no key - and the tile policy REQUIRES attribution on the map surface,
  // so Leaflet's default control is left exactly as it comes.
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(routeMap);
  return routeMap;
}

function numberedIcon(n) {
  return L.divIcon({
    className: '',
    html: `<span class="pin-badge">${n}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14]
  });
}

function drawRoute() {
  const col = document.getElementById('mapCol');
  if (!col) return;
  const pts = currentSteps
    .map((s) => s.business)
    .filter((b) => b && b.latitude != null && b.longitude != null);
  const map = pts.length ? ensureMap() : null;
  if (!map) { col.classList.remove('ready'); return; }

  col.classList.add('ready');
  if (routeLayer) { routeLayer.remove(); routeLayer = null; }
  routeLayer = L.layerGroup().addTo(map);

  pts.forEach((b, i) => {
    L.marker([b.latitude, b.longitude], { icon: numberedIcon(i + 1), title: b.name })
      .bindPopup(`<div class="map-popup"><strong>${i + 1}. ${esc(b.name)}</strong><span class="map-popup-addr">${esc(b.address)}</span></div>`)
      .addTo(routeLayer);
  });

  const latlngs = pts.map((b) => [b.latitude, b.longitude]);
  if (latlngs.length > 1) {
    // DASHED deliberately. These are STRAIGHT segments between stops - this app uses no routing API
    // anywhere, so a solid line would imply a turn-by-turn path we cannot produce. Walking times are
    // NOT repeated here; the step cards already say "Walk to next stop".
    L.polyline(latlngs, { color: '#e05638', weight: 3, opacity: 0.75, dashArray: '6, 8' }).addTo(routeLayer);
  }

  // Bounds from the POINTS, not from the layer. `L.layerGroup()` has no getBounds() - only
  // L.FeatureGroup does - so asking the group threw a TypeError here, which propagated out of
  // renderResults and killed the render: the map never drew a single pin, and every swap's redraw
  // died mid-way. A stub that gave the group a getBounds() it does not really have is why the unit
  // tests passed while the page was broken.
  const bounds = L.latLngBounds(latlngs);
  requestAnimationFrame(() => {
    map.invalidateSize();
    if (latlngs.length > 1 && bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24] });
    else if (latlngs.length === 1) map.setView(latlngs[0], 15);
  });
}

// ---- tap-to-swap (touch screens) ----
function tapSwap(idx) {
  selectedSwap = selectedSwap === idx ? null : idx;
  renderResults();
}
function tapStep(idx) {
  if (selectedSwap === null) return;
  swapInto(idx, selectedSwap);
  selectedSwap = null;
  renderResults();
}

// ---- drag and drop (computers) ----
// A drop carries no swap index if the drag BEGAN somewhere this code did not handle, so the index is
// kept locally as well as in dataTransfer. DataTransfer is the source of truth; the local is the
// fallback for engines that drop a custom type.
let draggingSwapIdx = null;

function dragStartFrom(ev, card) {
  draggingSwapIdx = Number(card.dataset.swapIdx);
  try {
    // 'text/plain' is a real MIME type. The old key ('swapIdx') is not, and although Chrome happens to
    // accept it, relying on that is relying on unspecified behaviour.
    ev.dataTransfer.setData('text/plain', String(draggingSwapIdx));
    ev.dataTransfer.effectAllowed = 'move';
  } catch (e) { /* some engines restrict setData; the local fallback still applies */ }
  card.style.opacity = '0.5';
}

function dropOnStep(ev, card) {
  ev.preventDefault();
  card.style.background = '#fff';
  let raw = '';
  try { raw = ev.dataTransfer.getData('text/plain'); } catch (e) { /* fall through to the local */ }
  const idx = raw !== '' ? Number(raw) : draggingSwapIdx;
  draggingSwapIdx = null;
  // A failed read and a legitimate value must be DISTINGUISHABLE. Silently doing nothing here is what
  // made this defect take a browser to find, so an unusable drop says so out loud.
  if (idx === null || Number.isNaN(idx)) {
    console.warn('[studio] a drop arrived carrying no swap index - nothing swapped');
    return;
  }
  swapInto(Number(card.dataset.stepIdx), idx);
  renderResults();
}

/** Wires the delegated listeners ONCE per container. Idempotent, and safe to call before the
 *  containers exist (it simply does nothing until they do). */
function installWiring() {
  if (installWiring.done) return;
  const stepsBox = document.getElementById('itinerarySteps');
  const swapsBox = document.getElementById('swapOptions');
  if (!stepsBox || !swapsBox) return;
  installWiring.done = true;

  stepsBox.addEventListener('click', (ev) => {
    const card = ev.target.closest('.step-card');
    if (card) tapStep(Number(card.dataset.stepIdx));
  });
  stepsBox.addEventListener('dragover', (ev) => {
    const card = ev.target.closest('.step-card');
    if (!card) return;
    ev.preventDefault();                       // REQUIRED, or the drop never fires
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
    card.style.background = '#e6f2ff';
  });
  stepsBox.addEventListener('dragleave', (ev) => {
    const card = ev.target.closest('.step-card');
    if (card) card.style.background = '#fff';
  });
  stepsBox.addEventListener('drop', (ev) => {
    const card = ev.target.closest('.step-card');
    if (card) dropOnStep(ev, card);
  });

  swapsBox.addEventListener('click', (ev) => {
    const card = ev.target.closest('.swap-card');
    if (card) tapSwap(Number(card.dataset.swapIdx));
  });
  swapsBox.addEventListener('dragstart', (ev) => {
    const card = ev.target.closest('.swap-card');
    if (card) dragStartFrom(ev, card);
  });
  swapsBox.addEventListener('dragend', (ev) => {
    const card = ev.target.closest('.swap-card');
    if (card) card.style.opacity = '1';
  });
}

function swapInto(stepIdx, swapIdx) {
  const oldBusiness = currentSteps[stepIdx].business;
  currentSteps[stepIdx].business = currentSwaps[swapIdx];
  currentSwaps[swapIdx] = oldBusiness;
}

/** The only entry point a page needs. */
window.Studio = {
  setData(steps, swaps) {
    currentSteps = Array.isArray(steps) ? steps : [];
    currentSwaps = Array.isArray(swaps) ? swaps : [];
    selectedSwap = null;
  },
  render: renderResults,
  steps() { return currentSteps; },
  show() { document.getElementById('resultsArea').classList.add('is-open'); },
  hide() { document.getElementById('resultsArea').classList.remove('is-open'); },
};

// The containers live in templates/_studio_results.html, which both pages include.
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installWiring);
else installWiring();
