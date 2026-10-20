/**
 * Navigation export URLs for an ordered list of stops.
 *
 * ONE implementation, deliberately loadable by BOTH runtimes:
 *   - the server (Node) `require`s this file;
 *   - `/concierge` loads it with a <script> tag, because the itinerary is edited IN THE BROWSER —
 *     tap/drag swaps replace a stop client-side. A URL computed once on the server would go stale the
 *     moment a user swapped a stop, and an export that does not match the itinerary on screen is
 *     exactly the "plausible but wrong" failure this project bans. So the rule has to be callable
 *     where the edit happens.
 *
 * It replaces a byte-identical copy of the Google builder that had been pasted into TWO route files;
 * a third caller was about to make a third copy.
 *
 * Keep this file DEPENDENCY-FREE and SIDE-EFFECT-FREE: it ships to the browser as-is and is required
 * by the server, so it must not reach for anything a browser does not have.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.MapsUrl = api;
})(typeof self !== 'undefined' ? self : this, function () {

    // Some records carry a PLACEHOLDER where a street address should be, e.g.
    // "Commercial Drive, Vancouver, BC (street address not mapped)". Re-derived and reproducible:
    // 147 carry that literal placeholder, 44 carry a city-level address with no street number, and
    // 220 of 2,958 records (7.4%) have no digit anywhere in the address at all. An earlier comment
    // here said 153; that was a private regex that also matched a six-record variant
    // ("... (no street address in source)"), so it was neither the placeholder count nor the total.
    // The rule below matches none of them, because it tests the address, not a count.
    // No maps app can resolve that text, so sending it as a waypoint produces a
    // route with a stop that silently does not exist.
    const NOT_AN_ADDRESS = /not mapped/i;

    /**
     * The best usable token for one stop, or '' if there is nothing usable.
     *
     * Falls back to "lat,lng" rather than dropping the stop, because coordinates are present on
     * every record while a real street address is not — and both Google and Apple accept a
     * coordinate pair as a stop. A stop is only omitted when it has neither.
     */
    function stopToken(s) {
        if (typeof s === 'string') return NOT_AN_ADDRESS.test(s) ? '' : s.trim();
        if (!s) return '';
        const address = typeof s.address === 'string' ? s.address.trim() : '';
        if (address && !NOT_AN_ADDRESS.test(address)) return address;
        if (typeof s.latitude === 'number' && typeof s.longitude === 'number') {
            return s.latitude + ',' + s.longitude;
        }
        return '';
    }

    /**
     * Stops -> encoded stop list, order preserved.
     * Accepts an address string, a business object, or null, so a caller can hand it whatever it
     * already holds instead of pre-mapping.
     */
    function cleanStops(stops) {
        return (stops || [])
            .map(stopToken)
            .filter(function (t) { return t !== ''; })
            .map(function (t) { return encodeURIComponent(t); });
    }

    /**
     * Google Maps walking directions.
     *
     * The threshold is `length === 0` and NOT `< 2`: the two call sites this replaces produced a URL
     * even for a single stop (origin == destination), so tightening it would silently change the live
     * itinerary page for any one-step itinerary. Preserved deliberately, not accidentally.
     */
    function googleDirectionsUrl(stops) {
        const w = cleanStops(stops);
        if (w.length === 0) return '';
        const origin = w[0];
        const destination = w[w.length - 1];
        const intermediate = w.slice(1, -1).join('|');
        return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${intermediate ? `&waypoints=${intermediate}` : ''}&travelmode=walking`;
    }

    /**
     * Apple Maps equivalent — a URL SCHEME, not an API: no key, no account, no cost, no quota.
     * Apple takes saddr/daddr plus an intermediate `via` chain, `+to:` separated.
     */
    function appleDirectionsUrl(stops) {
        const w = cleanStops(stops);
        if (w.length === 0) return '';
        const saddr = w[0];
        const daddr = w[w.length - 1];
        const via = w.slice(1, -1);
        return `https://maps.apple.com/?saddr=${saddr}&daddr=${daddr}${via.length ? `&via=${via.join('+to:')}` : ''}&dirflg=w`;
    }

    return { googleDirectionsUrl, appleDirectionsUrl, cleanStops, stopToken };
});
