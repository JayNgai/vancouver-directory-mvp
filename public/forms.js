/**
 * Auto-submit for filter controls, the CSP-safe way.
 *
 * WHY THIS FILE EXISTS: this used to be `onchange="this.form.submit()"` on the category select. This app
 * serves `script-src-attr 'none'` (helmet defaults), so inline handler ATTRIBUTES are inert - the filter
 * silently did nothing. Inline <script> BLOCKS are allowed (`script-src 'self' 'unsafe-inline'`), which is
 * why the page still looked and felt alive; only the handler was dead.
 *
 * Contract: mark a control with `data-autosubmit` and it submits its form on change.
 */
(function () {
  function wire() {
    document.querySelectorAll('[data-autosubmit]').forEach(function (el) {
      el.addEventListener('change', function () {
        if (el.form) el.form.submit();
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
