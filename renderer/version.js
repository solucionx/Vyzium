'use strict';

// The package version is the authoritative runtime version. Static text remains
// only as an offline/development fallback so release numbers cannot drift across
// Electron, Python engines and the renderer again.
(() => {
  const fallback = '3.3.3';
  const valid = value => /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(String(value || '').trim());
  const paint = version => {
    const safe = valid(version) ? String(version).trim() : fallback;
    window.vyziumAppVersion = safe;
    document.querySelectorAll('[data-app-version]').forEach(element => {
      const prefix = element.dataset.appVersionPrefix || '';
      element.textContent = `${prefix}${safe}`;
    });
  };

  paint(fallback);
  Promise.resolve(window.followup?.appVersion?.())
    .then(version => { if (valid(version)) paint(version); })
    .catch(error => {
      try {
        window.followup?.logRendererError?.({
          page: 'version',
          message: error?.message || String(error || 'Falha ao obter versão do aplicativo.'),
          stack: error?.stack || ''
        });
      } catch (_) {}
    });
})();
