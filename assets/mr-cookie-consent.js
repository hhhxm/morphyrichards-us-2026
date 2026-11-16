/*
 * Cookie banner persistence fix.
 * Kalles shows the theme cookie banner again on every page load when the block
 * is set to "All region" (show = 1), even after the visitor accepted it,
 * because the theme only relies on the Shopify consent API callback.
 * This shim remembers the choice via the theme cookie and keeps the banner hidden.
 */
(function () {
  var COOKIE_BASE = 'kalles_cookies_';

  function getBanner() {
    return document.getElementById('t4s-popup__cookies-law');
  }

  function getSettings(el) {
    try {
      return JSON.parse(el.getAttribute('data-stt') || '{}');
    } catch (e) {
      return {};
    }
  }

  function cookieName(el) {
    return COOKIE_BASE + (getSettings(el).pp_version || 1994);
  }

  function hasAccepted(name) {
    return document.cookie.split(';').some(function (item) {
      return item.trim().indexOf(name + '=') === 0;
    });
  }

  function hide(el) {
    el.classList.remove('on--show');
    el.classList.add('on--hide');
  }

  function enforce() {
    var el = getBanner();
    if (el && hasAccepted(cookieName(el))) hide(el);
  }

  function bindClick(el) {
    if (el.getAttribute('data-mr-cookie-bound')) return;
    el.setAttribute('data-mr-cookie-bound', '1');
    el.addEventListener(
      'click',
      function (ev) {
        var target = ev.target;
        if (!target || !target.closest) return;
        var button = target.closest('.t4s-pp_cookies__accept-btn, .t4s-pp_cookies__decline-btn');
        if (!button) return;
        var days = getSettings(el).day_next || 60;
        document.cookie =
          cookieName(el) + '=accepted; path=/; max-age=' + days * 86400 + '; SameSite=Lax';
        hide(el);
      },
      true
    );
  }

  function tick() {
    var el = getBanner();
    if (!el) return;
    bindClick(el);
    enforce();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tick);
  } else {
    tick();
  }

  var observer = new MutationObserver(tick);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(function () {
    observer.disconnect();
    tick();
  }, 20000);
})();
