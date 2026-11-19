/* Cookie / Consent 测试探针（仅测试期使用）
 * 启用：?mr_consent_probe=1
 * 说明：
 *   - 不依赖主题任何主脚本，独立运行
 *   - 通道 B：探针自门控，先读 Shopify Customer Privacy API，允许才发 GA4
 *   - 通道 A：探针只显示状态，配合后台 Shopify Pixel Helper 观察 custom pixel
 *   - window.MRConsentProbe.destroy() 可立即还原所有 hook 并移除浮标
 */
(function () {
  'use strict';

  var root = document.getElementById('mr-consent-probe-root');
  var cfg = window.MR_CONSENT_PROBE_CONFIG || {};
  var params = new URLSearchParams(window.location.search);

  // 双重保险：即使 Liquid 判断失效，JS 也再检查一次
  if (!root || params.get('mr_consent_probe') !== '1' || cfg.enabled === false) {
    return;
  }

  var channel = cfg.channel || root.getAttribute('data-mrcp-channel') || params.get('probe_channel') || 'both';
  var verbose = String(cfg.verbose || root.getAttribute('data-mrcp-verbose') || params.get('probe_verbose') || '0') === '1';
  var ga4Id = cfg.ga4Id || root.getAttribute('data-mrcp-ga4-id') || params.get('mr_ga4_id') || '';

  var EVENT_LABELS = {
    probe_pageview: '页面加载',
    probe_click: '点击按钮',
    probe_scroll: '滚动页面',
    probe_dwell: '停留时长',
    probe_toggle: '收起 / 展开',
    probe_manage: '打开偏好',
    probe_state_change: '切换分类'
  };

  var sessionId = (function () {
    try {
      var k = 'mrcp_sid';
      var v = sessionStorage.getItem(k);
      if (!v) {
        v = 'mrcp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
        sessionStorage.setItem(k, v);
      }
      return v;
    } catch (e) {
      return 'mrcp_' + Date.now().toString(36);
    }
  })();

  var apiReady = false;
  var gtagReady = false;
  var hooks = [];
  var recentRequests = [];
  var flashTimer = null;
  var pollTimer = null;
  var fired = { scroll: {}, dwell: {} };
  var state = {
    region: '',
    shouldShowBanner: false,
    saleOfDataRegion: false,
    consent: {},
    analytics: false,
    marketing: false,
    preferences: false,
    saleOfData: false
  };

  /* ---------------- Customer Privacy API ---------------- */

  function loadPrivacyApi() {
    return new Promise(function (resolve) {
      if (window.Shopify && window.Shopify.customerPrivacy) {
        return resolve(window.Shopify.customerPrivacy);
      }
      var tries = 0;
      var timer = setInterval(function () {
        if (window.Shopify && window.Shopify.loadFeatures) {
          clearInterval(timer);
          window.Shopify.loadFeatures(
            [{ name: 'consent-tracking-api', version: '1.0' }],
            function (err) {
              resolve(err ? null : (window.Shopify && window.Shopify.customerPrivacy) || null);
            }
          );
        } else if (++tries > 80) {
          clearInterval(timer);
          resolve(null);
        }
      }, 250);
    });
  }

  function readState() {
    var cp = window.Shopify && window.Shopify.customerPrivacy;
    if (!cp) return;
    state.region = cp.getRegion ? cp.getRegion() || '' : '';
    state.shouldShowBanner = cp.shouldShowBanner ? !!cp.shouldShowBanner() : false;
    state.saleOfDataRegion = cp.saleOfDataRegion ? !!cp.saleOfDataRegion() : false;
    try {
      state.consent = cp.currentVisitorConsent ? cp.currentVisitorConsent() || {} : {};
    } catch (e) {
      state.consent = {};
    }
    state.analytics = cp.analyticsProcessingAllowed ? !!cp.analyticsProcessingAllowed() : false;
    state.marketing = cp.marketingAllowed ? !!cp.marketingAllowed() : false;
    state.preferences = cp.preferencesProcessingAllowed ? !!cp.preferencesProcessingAllowed() : false;
    state.saleOfData = cp.saleOfDataAllowed ? !!cp.saleOfDataAllowed() : false;
  }

  function consentValue(key) {
    var v = state.consent ? state.consent[key] : '';
    return v == null ? '' : v;
  }

  /* ---------------- 浮标 DOM ---------------- */

  function row(key, label) {
    return (
      '<div class="mrcp-row mrcp-unset" data-key="' + key + '">' +
        '<span class="mrcp-label">' + label + '</span>' +
        '<span class="mrcp-state"><i class="mrcp-dot"></i><span class="mrcp-state-txt">未选择</span></span>' +
      '</div>'
    );
  }

  function build() {
    root.innerHTML =
      '<div class="mrcp-panel">' +
        '<div class="mrcp-head">' +
          '<span class="mrcp-head-title">🧪 Cookie 状态测试</span>' +
          '<button type="button" class="mrcp-collapse" id="mrcp-collapse" title="收起">›</button>' +
          '<span class="mrcp-mini" id="mrcp-mini"></span>' +
        '</div>' +
        '<div class="mrcp-body">' +
          '<div class="mrcp-region">地区：<span id="mrcp-region">—</span></div>' +
          row('analytics', '分析统计') +
          row('marketing', '营销广告') +
          row('preferences', '偏好设置') +
          row('saleOfData', '出售 / 共享') +
          row('banner', '横幅') +
          '<div class="mrcp-sep"></div>' +
          '<div class="mrcp-last">' +
            '<div>最近触发：<span id="mrcp-last-event">—</span></div>' +
            '<div>结果：<span id="mrcp-last-result">—</span></div>' +
            '<div class="mrcp-req" id="mrcp-last-req"></div>' +
          '</div>' +
          '<div class="mrcp-flash" id="mrcp-flash" hidden></div>' +
          '<div class="mrcp-detail" id="mrcp-detail" hidden></div>' +
          '<div class="mrcp-actions">' +
            '<button type="button" class="mrcp-btn" id="mrcp-detail-btn">详情</button>' +
            '<button type="button" class="mrcp-btn mrcp-btn-primary" id="mrcp-send">发送测试事件</button>' +
            '<button type="button" class="mrcp-btn" id="mrcp-manage">管理偏好</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    root.dataset.built = '1';

    var collapseBtn = document.getElementById('mrcp-collapse');
    if (collapseBtn) {
      collapseBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var collapsed = !root.classList.contains('mrcp-collapsed');
        root.classList.toggle('mrcp-collapsed', collapsed);
        sendProbe('probe_toggle', { collapsed: collapsed });
      });
    }

    // 收起态点击任意位置展开
    root.addEventListener('click', function (e) {
      if (root.classList.contains('mrcp-collapsed') && e.target.closest('.mrcp-head')) {
        root.classList.remove('mrcp-collapsed');
      }
    });

    var sendBtn = document.getElementById('mrcp-send');
    if (sendBtn) {
      sendBtn.addEventListener('click', function () {
        sendProbe('probe_click');
      });
    }

    var manageBtn = document.getElementById('mrcp-manage');
    if (manageBtn) {
      manageBtn.addEventListener('click', function () {
        if (openPreferences()) {
          sendProbe('probe_manage');
        } else {
          flash('bad', '未找到偏好接口');
        }
      });
    }

    var detailBtn = document.getElementById('mrcp-detail-btn');
    if (detailBtn) {
      detailBtn.addEventListener('click', function () {
        var d = document.getElementById('mrcp-detail');
        if (!d) return;
        d.hidden = !d.hidden;
        if (!d.hidden) renderDetail();
      });
    }

    if (verbose) {
      var d = document.getElementById('mrcp-detail');
      if (d) d.hidden = false;
    }
  }

  function setRow(key, ok, okText, badText, unsetText) {
    var el = root.querySelector('.mrcp-row[data-key="' + key + '"]');
    if (!el) return;
    var txt = el.querySelector('.mrcp-state-txt');
    el.classList.remove('mrcp-ok', 'mrcp-bad', 'mrcp-unset');
    if (ok === null) {
      el.classList.add('mrcp-unset');
      if (txt) txt.textContent = unsetText || '未选择';
    } else if (ok) {
      el.classList.add('mrcp-ok');
      if (txt) txt.textContent = okText;
    } else {
      el.classList.add('mrcp-bad');
      if (txt) txt.textContent = badText;
    }
  }

  function updateState() {
    var regionEl = document.getElementById('mrcp-region');
    if (regionEl) regionEl.textContent = state.region || '未知';

    setRow('analytics', state.analytics, '已允许', '已拦截');
    setRow('marketing', state.marketing, '已允许', '已拦截');

    var pref = consentValue('preferences');
    setRow('preferences', pref === '' ? null : state.preferences, '已允许', '已拦截', '未选择');

    // 出售/共享：不在适用区域时显示“不适用”
    if (!state.saleOfDataRegion) {
      setRow('saleOfData', null, '可共享', '已退出', '不适用');
    } else {
      setRow('saleOfData', state.saleOfData, '可共享', '已退出', '未选择');
    }

    setRow('banner', state.shouldShowBanner, '显示中', '已关闭', '已关闭');

    var mini = document.getElementById('mrcp-mini');
    if (mini) {
      mini.classList.toggle('mrcp-ok', !!state.analytics);
      mini.classList.toggle('mrcp-bad', !state.analytics);
    }
  }

  function flash(kind, text) {
    var el = document.getElementById('mrcp-flash');
    if (!el) return;
    el.className = 'mrcp-flash mrcp-flash-' + kind;
    el.textContent = text;
    el.hidden = false;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () {
      el.hidden = true;
    }, 2600);
  }

  function updateLast(label, resultKind) {
    var e = document.getElementById('mrcp-last-event');
    var r = document.getElementById('mrcp-last-result');
    var q = document.getElementById('mrcp-last-req');
    if (e && label) e.textContent = label;
    if (r) {
      r.className = resultKind === 'ok' ? 'mrcp-result-ok' : 'mrcp-result-bad';
      r.textContent = resultKind === 'ok' ? '✓ 已发送' : '✗ 已拦截（未发送）';
    }
    if (q) q.textContent = '';
  }

  /* ---------------- GA4 发送（通道 B，自门控） ---------------- */

  function ensureGtag() {
    window.dataLayer = window.dataLayer || [];
    if (typeof window.gtag !== 'function') {
      window.gtag = function () {
        window.dataLayer.push(arguments);
      };
    }
    if (gtagReady || !ga4Id) return;
    gtagReady = true;
    window.gtag('js', new Date());
    window.gtag('config', ga4Id, { send_page_view: false, debug_mode: true });
    if (!document.querySelector('script[data-mrcp-gtag]')) {
      var s = document.createElement('script');
      s.async = true;
      s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(ga4Id);
      s.setAttribute('data-mrcp-gtag', '1');
      document.head.appendChild(s);
      hooks.push({ type: 'node', node: s });
    }
  }

  function buildLabel(name, extra) {
    var label = EVENT_LABELS[name] || name;
    if (extra && extra.scroll_percent != null) label += '（' + extra.scroll_percent + '%）';
    if (extra && extra.dwell_seconds != null) label += '（' + extra.dwell_seconds + 's）';
    return label;
  }

  function sendProbe(name, extra) {
    if (channel === 'a') return;

    var label = buildLabel(name, extra);
    var payload = Object.assign(
      {
        region: state.region,
        analytics_allowed: state.analytics,
        marketing_allowed: state.marketing,
        preferences_allowed: state.preferences,
        probe_session_id: sessionId,
        probe_channel: channel
      },
      extra || {}
    );

    if (!apiReady) {
      updateLast(label, 'bad');
      flash('bad', 'API 未就绪');
      return;
    }

    if (!state.analytics) {
      updateLast(label, 'bad');
      flash('bad', '已拦截（未发送）');
      return;
    }

    if (!ga4Id) {
      updateLast(label, 'bad');
      flash('bad', '未配置 GA4 ID');
      return;
    }

    ensureGtag();
    try {
      window.gtag('event', name, payload);
    } catch (e) {
      /* 静默 */
    }
    updateLast(label, 'ok');
    flash('ok', '已发送');
  }

  /* ---------------- 请求捕获（GA4 only） ---------------- */

  function normalizeBody(body) {
    if (!body) return '';
    try {
      if (typeof body === 'string') return body.slice(0, 2000);
      if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
        return body.toString().slice(0, 2000);
      }
      if (typeof FormData !== 'undefined' && body instanceof FormData) {
        var parts = [];
        body.forEach(function (v, k) {
          parts.push(k + '=' + v);
        });
        return parts.join('&').slice(0, 2000);
      }
      return JSON.stringify(body).slice(0, 2000);
    } catch (e) {
      return '';
    }
  }

  function shortUrl(u) {
    try {
      var a = document.createElement('a');
      a.href = u;
      return a.hostname + (a.pathname || '');
    } catch (e) {
      return String(u).slice(0, 80);
    }
  }

  function recordRequest(url, body) {
    if (!url) return;
    var u = String(url);
    if (!/google-analytics\.com|googletagmanager\.com/i.test(u)) return;

    var entry = { url: u, body: normalizeBody(body), ts: Date.now() };
    recentRequests.push(entry);
    if (recentRequests.length > 30) recentRequests.shift();

    var detail = document.getElementById('mrcp-detail');
    if (detail && !detail.hidden) renderDetail();

    var q = document.getElementById('mrcp-last-req');
    if (q) q.textContent = '请求：' + shortUrl(entry.url);
  }

  function renderDetail() {
    var d = document.getElementById('mrcp-detail');
    if (!d) return;
    if (!recentRequests.length) {
      d.textContent = '暂无 GA4 请求';
      return;
    }
    var e = recentRequests[recentRequests.length - 1];
    d.textContent =
      '时间：' + new Date(e.ts).toLocaleTimeString() + '\n' +
      'URL：' + e.url +
      (e.body ? '\n\n参数：\n' + e.body : '');
  }

  function hookRequests() {
    if (window.fetch) {
      var origFetch = window.fetch;
      window.fetch = function (input, init) {
        try {
          var url = typeof input === 'string' ? input : input && input.url;
          var body = init && init.body;
          recordRequest(url, body);
        } catch (e) {
          /* 静默 */
        }
        return origFetch.apply(this, arguments);
      };
      hooks.push({ type: 'fetch', orig: origFetch });
    }

    if (navigator.sendBeacon) {
      var origBeacon = navigator.sendBeacon.bind(navigator);
      navigator.sendBeacon = function (url, data) {
        try {
          recordRequest(url, data);
        } catch (e) {
          /* 静默 */
        }
        return origBeacon(url, data);
      };
      hooks.push({ type: 'beacon', orig: origBeacon });
    }

    if (window.XMLHttpRequest) {
      var origOpen = XMLHttpRequest.prototype.open;
      var origSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (method, url) {
        this.__mrcpUrl = url;
        return origOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function (body) {
        try {
          recordRequest(this.__mrcpUrl, body);
        } catch (e) {
          /* 静默 */
        }
        return origSend.apply(this, arguments);
      };
      hooks.push({ type: 'xhr', open: origOpen, send: origSend });
    }
  }

  /* ---------------- 偏好入口 ---------------- */

  function openPreferences() {
    try {
      if (window.privacyBanner && typeof window.privacyBanner.showPreferences === 'function') {
        window.privacyBanner.showPreferences();
        return true;
      }
      if (
        window.Shopify &&
        window.Shopify.privacyBanner &&
        typeof window.Shopify.privacyBanner.showPreferences === 'function'
      ) {
        window.Shopify.privacyBanner.showPreferences();
        return true;
      }
    } catch (e) {
      /* 静默 */
    }
    return false;
  }

  /* ---------------- 触发动作 ---------------- */

  function onScroll() {
    var doc = document.documentElement;
    var top = window.pageYOffset || doc.scrollTop || 0;
    var height = doc.scrollHeight - window.innerHeight;
    if (height <= 0) return;
    var pct = Math.min(100, Math.round((top / height) * 100));
    [25, 50, 75, 100].forEach(function (m) {
      if (pct >= m && !fired.scroll[m]) {
        fired.scroll[m] = true;
        sendProbe('probe_scroll', { scroll_percent: m });
      }
    });
  }

  function bindScroll() {
    window.addEventListener('scroll', onScroll, { passive: true });
    hooks.push({ type: 'listener', target: window, event: 'scroll', fn: onScroll });
  }

  function bindDwell() {
    [10, 30, 60].forEach(function (sec) {
      var id = setTimeout(function () {
        if (!fired.dwell[sec]) {
          fired.dwell[sec] = true;
          sendProbe('probe_dwell', { dwell_seconds: sec });
        }
      }, sec * 1000);
      hooks.push({ type: 'timeout', id: id });
    });
  }

  function bindConsentChange() {
    var onConsent = function () {
      readState();
      updateState();
      sendProbe('probe_state_change', {
        analytics_allowed: state.analytics,
        marketing_allowed: state.marketing,
        preferences_allowed: state.preferences,
        sale_of_data_allowed: state.saleOfData
      });
    };
    document.addEventListener('visitorConsentCollected', onConsent);
    hooks.push({ type: 'listener', target: document, event: 'visitorConsentCollected', fn: onConsent });
  }

  /* ---------------- 销毁 ---------------- */

  function destroy() {
    hooks.forEach(function (h) {
      try {
        if (h.type === 'fetch') window.fetch = h.orig;
        else if (h.type === 'beacon') navigator.sendBeacon = h.orig;
        else if (h.type === 'xhr') {
          XMLHttpRequest.prototype.open = h.open;
          XMLHttpRequest.prototype.send = h.send;
        } else if (h.type === 'node' && h.node && h.node.parentNode) {
          h.node.parentNode.removeChild(h.node);
        } else if (h.type === 'listener') {
          h.target.removeEventListener(h.event, h.fn);
        } else if (h.type === 'timeout') {
          clearTimeout(h.id);
        }
      } catch (e) {
        /* 静默 */
      }
    });
    hooks = [];
    if (pollTimer) clearInterval(pollTimer);
    if (root) root.innerHTML = '';
  }

  /* ---------------- 初始化 ---------------- */

  function init() {
    build();
    hookRequests();
    bindScroll();
    bindDwell();

    loadPrivacyApi().then(function (cp) {
      apiReady = !!cp;
      readState();
      updateState();
      bindConsentChange();

      // 页面加载探针事件
      sendProbe('probe_pageview', { page_type: window.Shopify && window.Shopify.template ? window.Shopify.template.name : '' });

      // 兜底轮询：某些情况下 visitorConsentCollected 不一定触发
      var prevKey = '';
      pollTimer = setInterval(function () {
        readState();
        var key = [state.analytics, state.marketing, state.preferences, state.saleOfData, state.shouldShowBanner, state.region].join('|');
        if (key !== prevKey) {
          prevKey = key;
          updateState();
        }
      }, 1000);
      hooks.push({ type: 'interval', id: pollTimer });
    });
  }

  // destroy 里补 interval 清理
  var baseDestroy = destroy;

  window.MRConsentProbe = {
    destroy: function () {
      if (pollTimer) clearInterval(pollTimer);
      baseDestroy();
    },
    state: function () {
      return state;
    },
    send: sendProbe,
    openPreferences: openPreferences
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
