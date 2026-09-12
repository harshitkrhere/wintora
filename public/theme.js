/*
 * Applies the saved appearance before the first paint.
 *
 * Loaded as a plain same-origin file from the document head, so it runs under
 * the site's Content-Security-Policy (script-src 'self', no 'unsafe-inline')
 * on the statically prerendered pages as well as the nonced ones. It mirrors
 * src/lib/theme.ts; keep the two in step. No saved choice means the device
 * setting applies, through CSS alone.
 */
(function () {
  try {
    var choice = localStorage.getItem('wintora:theme');
    var root = document.documentElement;
    if (choice === 'dark' || choice === 'light') {
      root.setAttribute('data-theme', choice);
    } else {
      root.removeAttribute('data-theme');
    }
  } catch (e) {
    /* Storage unavailable: the device setting applies. */
  }
})();
