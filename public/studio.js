/**
 * The itinerary result surface: steps, route canvas, export links, swap options.
 *
 * ONE implementation, shared by /concierge and the homepage Experience Studio dock. Both pages include
 * templates/_studio_results.html for the markup and drive it through this file, so the two cannot
 * render the same itinerary differently.
 *
 * Loaded as a CLASSIC script (not a module) on purpose: the markup uses inline handlers
 * (ondrop="drop(event, 1)"), which resolve against globals. Keep those functions top-level.
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
      <div class="step-card" ondragover="allowDrop(event)" ondragleave="dragLeave(event)" ondrop="drop(event, ${idx})" onclick="tapStep(${idx})" id="step-${idx}">
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
      <div draggable="true" ondragstart="drag(event, ${idx})" ondragend="dragEnd(event)" onclick="tapSwap(${idx})"
           class="swap-card${selectedSwap === idx ? ' selected' : ''}" id="swap-${idx}">
          <div style="font-weight: 700; margin-bottom: 4px;">${esc(biz.name)}</div>
          <div style="color: var(--muted-foreground, #555); margin-bottom: 4px;">${esc(biz.category)}${biz.displayHours ? ' &bull; 🕒 ' + esc(biz.displayHours) : ''}</div>
          ${biz.distanceFromStopMetres != null ? `<div style="color: var(--muted-foreground, #555); font-size: 0.85em;">${esc(biz.distanceFromStopMetres)} m from ${esc(biz.swapForStop)}</div>` : ''}
          <div style="color: var(--accent, #007bff); font-size: 0.85em; margin-top: 6px;">Tap, then tap a stop &middot; or drag on a computer</div>
      </div>
  `).join('');
  document.getElementById('swapOptions').innerHTML = swapsHtml || '<p style="color: var(--muted-foreground, #777);">No extra options available.</p>';
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

  const bounds = routeLayer.getBounds();
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
function allowDrop(ev) {
  ev.preventDefault();
  ev.currentTarget.style.background = '#e6f2ff';
}
function dragLeave(ev) {
  ev.currentTarget.style.background = '#fff';
}
function drag(ev, swapIdx) {
  ev.dataTransfer.setData('swapIdx', swapIdx);
  ev.target.style.opacity = '0.5';
}
function dragEnd(ev) {
  ev.target.style.opacity = '1';
}
function drop(ev, stepIdx) {
  ev.preventDefault();
  ev.currentTarget.style.background = '#fff';
  const swapIdx = ev.dataTransfer.getData('swapIdx');
  if (swapIdx !== '') {
    swapInto(stepIdx, Number(swapIdx));
    renderResults();
  }
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
