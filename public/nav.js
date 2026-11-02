// Mobile navigation: the search field and the six links live behind one button
// below 600px.
//
// Why a file and not an inline block: the CSP forbids inline event handlers
// (check-swap-wiring.js fails the build if scriptSrcAttr is ever re-enabled), so
// every listener is bound here, with addEventListener.
(function () {
  const toggle = document.getElementById('navToggle');
  const panel = document.getElementById('navPanel');
  if (!toggle || !panel) return;

  function isOpen() {
    return toggle.getAttribute('aria-expanded') === 'true';
  }

  function setOpen(open, returnFocus) {
    toggle.setAttribute('aria-expanded', String(open));
    panel.dataset.open = open ? 'true' : 'false';
    if (open) {
      const first = panel.querySelector('input, a');
      if (first) first.focus();
    } else if (returnFocus) {
      toggle.focus();
    }
  }

  toggle.addEventListener('click', () => setOpen(!isOpen(), false));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isOpen()) setOpen(false, true);
  });

  // Choosing a destination closes the panel. Without this the panel stays open
  // over the page the visitor just asked for.
  panel.addEventListener('click', (event) => {
    if (event.target.closest('a')) setOpen(false, false);
  });

  // Above the breakpoint the panel does not exist; a resize must not leave the
  // button claiming an open state that nothing displays.
  const wide = window.matchMedia('(min-width: 601px)');
  const closeIfWide = () => {
    if (wide.matches && isOpen()) setOpen(false, false);
  };
  if (wide.addEventListener) wide.addEventListener('change', closeIfWide);
  closeIfWide();
})();
