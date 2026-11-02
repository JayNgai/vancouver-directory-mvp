/**
 * Directory interactions: the filter disclosure and load-more.
 *
 * Both controls are real first. The filters render open and the load-more link
 * points at page N, so the page works with JavaScript off. This file only
 * upgrades them: it folds the filters on a phone and appends the next page in
 * place instead of moving the reader to page 2.
 *
 * No inline handlers anywhere - the CSP sets script-src-attr 'none'.
 */
(function () {
    'use strict';

    var form = document.getElementById('filterForm');
    var toggle = document.getElementById('filtersToggle');
    var panel = document.getElementById('filterControls');
    var phone = window.matchMedia('(max-width: 599px)');

    // The button ships hidden and the controls ship open. Showing the button is
    // the signal that JavaScript is here, so a no-JS page never carries a control
    // that does nothing.
    function applyFilterState(collapsed) {
        form.setAttribute('data-filters', collapsed ? 'closed' : 'open');
        toggle.hidden = false;
        toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        if (collapsed) panel.setAttribute('hidden', '');
        else panel.removeAttribute('hidden');
    }

    if (form && toggle && panel) {
        applyFilterState(phone.matches);
        toggle.addEventListener('click', function () {
            applyFilterState(form.getAttribute('data-filters') !== 'closed');
        });
        var syncViewport = function () { applyFilterState(phone.matches); };
        if (phone.addEventListener) phone.addEventListener('change', syncViewport);
        else if (phone.addListener) phone.addListener(syncViewport);
    }

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
        if (note) note.textContent = body.length.toLocaleString('en-CA') + ' shown';
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
