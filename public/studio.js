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

/** Read a design token at runtime. Leaflet and element.style need a real value, not var(). */
function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** "1:00 PM" -> 780. Returns null rather than guessing. */
function parseClockLabel(label) {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(label || '').trim());
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (/pm/i.test(m[3])) h += 12;
  return h * 60 + Number(m[2]);
}

/** 258 -> "4h 18m". Plain arithmetic, no locale surprises. */
function spanLabel(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function clockLabel(minutes) {
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h24 = Math.floor(total / 60);
  const m = total % 60;
  const suffix = h24 >= 12 ? 'pm' : 'am';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** The itinerary total: stops, elapsed time, distance walked, and when it ends. */
function renderSummary() {
  const box = document.getElementById('itiSummary');
  if (!box) return;

  if (!currentSteps.length) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }

  const dwell = currentSteps.reduce((sum, s) => sum + (parseInt(s.estimatedDuration, 10) || 0), 0);
  const walk = currentSteps.reduce((sum, s) => sum + (s.walkToNextMinutes || 0), 0);
  const total = dwell + walk;
  const metres = walk * 80; // the same 80 m/min the scheduler walks at
  const start = parseClockLabel(currentSteps[0].time);

  const distance = metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres)} m`;
  const ends = start == null ? null : clockLabel(start + total);

  const bits = [
    `<span><b>${currentSteps.length} stops</b></span>`,
    `<span><b>${spanLabel(total)}</b> out</span>`,
    `<span><b>${distance}</b> walked</span>`,
    ends ? `<span>ends <b>${ends}</b></span>` : '',
  ].filter(Boolean);

  box.innerHTML = bits.join('');
  box.hidden = false;
}

function renderResults() {
  // No inline style attributes and no colour literals here. This markup is the
  // most visible surface on the site and it used to carry `var(--accent, #007bff)`
  // in six places. The token guard scanned templates and CSS only, so a page
  // script shipping hardcoded colour was a hole; it scans page scripts now.
  const stepsHtml = currentSteps.map((step, idx) => {
    const reasons = Array.isArray(step.reasons) ? step.reasons : [];
    const reasonsHtml = reasons.length
      ? `<ul class="stop-reasons">${reasons.map((r) => `<li>${esc(r.text)}</li>`).join('')}</ul>`
      : '';
    const meta = [step.business.category, step.business.address].filter(Boolean).map(esc).join(' &bull; ');
    const hours = step.business.displayHours ? ` &bull; ${esc(step.business.displayHours)}` : '';
    return `
      <div class="step-card" data-step-idx="${idx}" id="step-${idx}">
          <div class="step-head">
              <span class="step-time">${esc(step.time)}</span>
              <span class="step-dur">${esc(step.estimatedDuration)}</span>
          </div>
          <strong class="step-name">${esc(step.business.name)}</strong>
          <p class="step-meta">${meta}${hours}</p>
          ${reasonsHtml}
          ${step.walkToNextMinutes != null ? `<div class="step-walk">${esc(step.walkToNextMinutes)} min walk to the next stop</div>` : ''}
      </div>
  `;
  }).join('');
  document.getElementById('itinerarySteps').innerHTML = stepsHtml || '<p class="empty-note">No spots found. Try broader terms.</p>';

  // The per-card "tap, then tap a stop" instruction is gone: it was repeated on
  // every card while one instruction already sits above the row.
  const swapsHtml = currentSwaps.map((biz, idx) => `
      <div draggable="true" data-swap-idx="${idx}"
           class="swap-card${selectedSwap === idx ? ' selected' : ''}" id="swap-${idx}">
          <div class="swap-name">${esc(biz.name)}</div>
          <div class="swap-meta">${esc(biz.category)}${biz.displayHours ? ' &bull; ' + esc(biz.displayHours) : ''}</div>
          ${biz.distanceFromStopMetres != null ? `<div class="swap-dist">${esc(biz.distanceFromStopMetres)} m from ${esc(biz.swapForStop)}</div>` : ''}
      </div>
  `).join('');
  document.getElementById('swapOptions').innerHTML = swapsHtml || '<p class="empty-note">No extra options available.</p>';
  renderSummary();
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
  // Basemap, with one fallback.

  // Primary: OpenStreetMap tiles. Free, no key, and their policy REQUIRES the
  // attribution on the map surface, so Leaflet's control is left as it comes.
  //
  // Why the fallback: osm.org serves a 403 "Access blocked" tile when its policy
  // engine decides a client is not compliant, and it did so on this site on
  // 2026-11-02. The block is not reproducible from here (every header combination
  // returns 200 on request), which is the point: a volunteer-run tile server can
  // refuse browser traffic for reasons a page cannot see. A route map that silently
  // turns into a wall of "Access blocked" images is worse than a different basemap,
  // so the first tile error swaps once and never flaps back.
  const primary = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(routeMap);

  let swapped = false;
  primary.on('tileerror', () => {
    if (swapped) return;
    swapped = true;
    routeMap.removeLayer(primary);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd',
      maxZoom: 20,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
    }).addTo(routeMap);
  });

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
    L.polyline(latlngs, { color: token('--marker'), weight: 3, opacity: 0.75, dashArray: '6, 8' }).addTo(routeLayer);
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
  card.classList.remove('is-drop-target');
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
    card.classList.add('is-drop-target');
  });
  stepsBox.addEventListener('dragleave', (ev) => {
    const card = ev.target.closest('.step-card');
    if (card) card.classList.remove('is-drop-target');
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
