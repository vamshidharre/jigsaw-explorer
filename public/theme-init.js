// Apply the saved theme, density and motion preference before first paint.
(function () {
  try {
    var s = JSON.parse(localStorage.getItem('jigsaw.settings.v1') || '{}').state || {};
    var t = s.theme || 'system';
    if (t === 'system') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    var d = document.documentElement;
    d.dataset.theme = t;
    d.dataset.density = s.density || 'comfortable';
    d.dataset.motion = s.motion || 'system';
  } catch (e) {
    /* storage unavailable: defaults apply */
  }
})();
