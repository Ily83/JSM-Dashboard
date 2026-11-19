// Applies the saved theme before first paint to avoid a flash.
// Kept as a separate file so the production Content-Security-Policy can forbid inline scripts.
(function () {
  try {
    var prefs = JSON.parse(localStorage.getItem('jsm-alert-center:prefs:v1') || '{}');
    var theme = prefs.theme || 'dark';
    if (theme === 'system') theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
  } catch (e) {}
})();
