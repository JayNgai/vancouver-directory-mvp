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

    /**
     * Addresses -> encoded stop list, order preserved.
     * Accepts an address string, a business object, or null, so a caller can hand it whatever it
     * already holds instead of pre-mapping.
     */
    function cleanStops(stops) {
        return (stops || [])
            .map(function (s) { return (typeof s === 'string' ? s : (s && s.address)); })
            .filter(function (a) { return typeof a === 'string' && a.trim() !== ''; })
            .map(function (a) { return encodeURIComponent(a.trim()); });
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

    return { googleDirectionsUrl, appleDirectionsUrl, cleanStops };
});