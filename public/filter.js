/**
 * Load-more for the directory table.
 *
 * The link is a real link first: it points at page N, so it works with JavaScript
 * off and in a new tab. This only upgrades it to append the next page in place, so
 * a reader does not lose their scroll position every 24 rows.
 *
 * No inline handlers anywhere - the CSP sets script-src-attr 'none'.
 */
(function () {
    'use strict';

    var btn = document.getElementById('loadMore');
    var rows = document.getElementById('listingRows');
    if (!btn || !rows) return;

    var note = document.querySelector('.morerow-note');

    function renumber() {
        var body = rows.querySelectorAll('.atlas-row:not(.hd)');
        for (var i = 0; i < body.length; i++) {
            var rk = body[i].querySelector('.rk');
            if (rk) rk.textContent = (i + 1 < 10 ? '0' : '') + (i + 1);
        }
        if (note) note.textContent = body.length + ' shown';
    }

    function setBusy(busy, label) {
        if (busy) {
            btn.setAttribute('aria-busy', 'true');
            btn.textContent = 'Loading…';
        } else {
            btn.removeAttribute('aria-busy');
            btn.textContent = label;
        }
    }

    btn.addEventListener('click', function (event) {
        event.preventDefault();
        if (btn.getAttribute('aria-busy') === 'true') return;

        var next = Number(btn.dataset.next || 0);
        var totalPages = Number(btn.dataset.totalPages || 0);
        var base = btn.dataset.base || '/businesses?';
        if (!next) return;

        setBusy(true);

        fetch(base + 'page=' + next, { headers: { 'X-Requested-With': 'fetch' } })
            .then(function (response) {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.text();
            })
            .then(function (html) {
                var doc = new DOMParser().parseFromString(html, 'text/html');
                var incoming = doc.querySelectorAll('#listingRows .atlas-row:not(.hd)');
                if (!incoming.length) { btn.remove(); return; }

                var frag = document.createDocumentFragment();
                for (var i = 0; i < incoming.length; i++) {
                    frag.appendChild(document.importNode(incoming[i], true));
                }
                rows.appendChild(frag);
                renumber();

                if (next + 1 > totalPages) {
                    btn.remove();
                } else {
                    setBusy(false, 'Load more');
                    btn.dataset.next = String(next + 1);
                    btn.href = base + 'page=' + (next + 1);
                }
            })
            .catch(function () {
                // The link still points at the right page, so the fallback is to follow it.
                setBusy(false, 'Load more');
                btn.textContent = 'Could not load — open page ' + next;
            });
    });
})();
