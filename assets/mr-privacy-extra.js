/*
 * 隐私合规补充组件
 *   1) GPC 可见提示（仅美国访客 + 检测到信号时显示）
 *   2) 页脚 “Cookie preferences” 入口 → 打开 Shopify 原生偏好面板
 *
 * 不修改任何同意状态，只做“显示”和“入口”，避免与 Shopify 的 GPC 处理逻辑冲突。
 */
(function () {
  'use strict';

  var OPT_OUT_PAGE = '/pages/data-sharing-opt-out';

  /* ---------------- GPC 检测 ---------------- */

  function hasGPC() {
    var v = navigator.globalPrivacyControl;
    return v === true || v === '1';
  }

  // Shopify 只在适用的国家/地区处理 GPC 的 sale_of_data，这里用国家做前置判断
  function isUS() {
    try {
      var country = (window.Shopify && window.Shopify.country) || '';
      if (country) return country.toUpperCase() === 'US';
      // 兜底：从 _shopify_cmp 里取地区标识（形如 3.ampS_USCA_t_t_...）
      var m = document.cookie.match(/_shopify_cmp=([^;]+)/);
      return m ? /_US[A-Z]{0,2}_/.test(decodeURIComponent(m[1])) : false;
    } catch (e) {
      return false;
    }
  }

  function showGpcNotice() {
    var el = document.getElementById('mr-gpc-notice');
    if (!el) return;
    if (!(hasGPC() && isUS())) return;

    // 优先放进页脚底栏（左侧版权栏下方），避免悬浮条压住页面内容
    var host = document.querySelector('.t4s-bottom-bar .t4s-custom-col .t4s-col-inner') ||
               document.querySelector('.t4s-bottom-bar .t4s-custom-col');
    if (host) {
      if (el.parentNode !== host) host.appendChild(el);
      el.classList.remove('mr-gpc-notice--fixed');
    } else {
      el.classList.add('mr-gpc-notice--fixed');
    }

    el.hidden = false;
    document.documentElement.classList.add('mr-gpc-on');
  }

  /* ---------------- 偏好面板入口 ---------------- */

  function getBanner() {
    return window.privacyBanner || (window.Shopify && window.Shopify.privacyBanner) || null;
  }

  function openPreferences() {
    var pb = getBanner();
    if (pb && typeof pb.showPreferences === 'function') {
      try {
        pb.showPreferences();
        return true;
      } catch (e) {
        /* 继续走兜底 */
      }
    }
    return false;
  }

  function onPreferencesClick(e) {
    if (e) e.preventDefault();

    if (openPreferences()) return;

    // 兜底：api 尚未初始化时先加载，再重试一次，仍失败则跳转退出页
    if (window.Shopify && typeof window.Shopify.loadFeatures === 'function') {
      window.Shopify.loadFeatures(
        [{ name: 'consent-tracking-api', version: '1.0' }],
        function (err) {
          if (!err && openPreferences()) return;
          window.location.href = OPT_OUT_PAGE;
        }
      );
      return;
    }

    window.location.href = OPT_OUT_PAGE;
  }

  // 页脚有多组菜单，优先找包含隐私/退出链接的那一组（底部政策条）
  function findFooterList() {
    var lists = document.querySelectorAll('ul.t4s-footer-linklist');
    if (!lists.length) return null;

    for (var i = 0; i < lists.length; i++) {
      var links = lists[i].querySelectorAll('a');
      for (var j = 0; j < links.length; j++) {
        var href = links[j].getAttribute('href') || '';
        if (/data-sharing-opt-out|privacy-policy|cookie-policy/.test(href)) return lists[i];
      }
    }
    return lists[lists.length - 1];
  }

  function addFooterLink() {
    var ul = findFooterList();
    if (!ul || ul.querySelector('[data-mr-cookie-prefs]')) return;

    var li = document.createElement('li');
    var a = document.createElement('a');
    a.href = '#cookie-preferences';
    a.className = 't4s-footer-link';
    a.setAttribute('data-mr-cookie-prefs', '1');
    a.setAttribute('role', 'button');
    a.textContent = 'Cookie preferences';
    a.addEventListener('click', onPreferencesClick);

    li.appendChild(a);
    ul.appendChild(li);

    // "Your privacy choices"（带官方退出图标）固定排在最后，避免夹在两条政策链接中间
    var optOut = ul.querySelector('a[href*="data-sharing-opt-out"]');
    if (optOut) {
      var optOutLi = optOut.closest('li');
      if (optOutLi && optOutLi !== ul.lastElementChild) ul.appendChild(optOutLi);
    }
  }

  /* ---------------- 页脚可见时隐藏“回到顶部” ---------------- */

  // 尾屏的“回到顶部”按钮会压住 GPC 提示与页脚菜单，页脚进入视口后淡出即可
  function watchBottomBar() {
    var bar = document.querySelector('.t4s-bottom-bar');
    if (!bar || !('IntersectionObserver' in window)) return;

    var io = new IntersectionObserver(function (entries) {
      var e = entries[0];
      document.documentElement.classList.toggle('mr-footer-in-view', e.isIntersecting && e.intersectionRatio > 0.05);
    }, { threshold: [0, 0.05, 0.2] });

    io.observe(bar);
  }

  /* ---------------- 初始化 ---------------- */

  function init() {
    showGpcNotice();
    addFooterLink();
    watchBottomBar();
  }

  // 供探针或其他脚本调用
  window.MRPrivacyExtra = {
    hasGPC: hasGPC,
    openPreferences: openPreferences,
    refresh: init
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
