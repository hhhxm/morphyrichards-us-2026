/* Cookie / 隐私合规自检面板（供客户自助验证）
 * 启用：?mr_consent_probe=1（不带参数时不执行任何逻辑）
 * 说明：
 *   - 不依赖主题任何主脚本，独立运行
 *   - 通道 B：面板自门控，先读 Shopify Customer Privacy API，允许才发 GA4
 *   - 通道 A：面板只显示状态，配合后台 Shopify Pixel Helper 观察 custom pixel
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
  var ga4Id = cfg.ga4Id || root.getAttribute('data-mrcp-ga4-id') || params.get('mr_ga4_id') || 'G-WFEGYXT7QE';

  var EVENT_LABELS = {
    probe_pageview: '页面加载',
    probe_click: '点击按钮',
    probe_scroll: '滚动页面',
    probe_dwell: '停留时长',
    probe_toggle: '收起 / 展开',
    probe_manage: '打开偏好',
    probe_state_change: '切换分类'
  };

  /* 各项说明（问号气泡 / 按钮悬停提示） */
  var HELP = {
    region: 'Shopify 按访客 IP 判断的地区。只有美国加州等已立法州才会判断「出售/共享」；其他地区显示「不适用」。',
    banner: 'Shopify 原生 Cookie 横幅是否正在显示。新访客首次访问会弹出，做过选择后不再自动弹；点下方「重置横幅」可重新叫出。',
    gpc: '浏览器发出的「全球隐私控制」信号，需安装 GPC 扩展或使用 Brave 等默认支持的浏览器。识别后 Shopify 会标记为退出出售/共享。',
    analytics: 'GA4 等分析类 Cookie 是否允许。点横幅 Accept 变「已允许」，Decline 变「已拦截」。',
    marketing: '广告 / 再营销类 Cookie 是否允许。本站未装 Meta Pixel，此项主要用于展示同意状态。',
    preferences: '记住语言、地区等偏好类 Cookie。还没做过选择时显示「未选择」。',
    saleOfData: '美国州法（CCPA/CPRA）的「退出出售/共享」。可共享=尚未退出；已退出=已按退出处理（GPC 或 Decline 触发）；不适用=当前地区无此法律。',
    shopify: 'Shopify 平台自带的像素管理器，用于加载商家配置的第三方像素。本站未配置额外像素，GA4 由主题单独加载，它本身不等于正在追踪；页面还会向 Shopify 发送 monorail 运营数据，属平台必要请求。',
    detail: '查看最近一次 GA4 请求的 URL 和参数。',
    send: '发送一个 GA4 测试事件：允许就发得出去，拦截就发不出去，用来验证 consent 是否生效。',
    manage: '打开 Shopify 原生 Cookie 偏好面板，逐项修改分析、广告、偏好等选择。',
    reset: '把 Cookie 横幅重新弹出来，方便再次做选择。不会清除已记录的退出状态。',
    buttons: '详情：查看最近一次 GA4 请求。发送测试事件：验证 consent 是否放行或拦截。管理偏好：打开原生偏好面板逐项修改。重置横幅：重新弹出横幅（不清除已记录的退出状态）。'
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

  /* 横幅是否真的出现在页面上（不看 shouldShowBanner 状态） */
  function bannerVisible() {
    var el = document.getElementById('shopify-pc__banner');
    if (!el) return false;
    var cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function hasGPC() {
    var v = navigator.globalPrivacyControl;
    return v === true || v === '1';
  }

  /* 访客是否已做过选择（Shopify 的 shouldShowBanner() 不会因为已选择而变 false） */
  function isDecided() {
    return (
      consentValue('marketing') !== '' ||
      consentValue('analytics') !== '' ||
      consentValue('preferences') !== '' ||
      consentValue('sale_of_data') !== ''
    );
  }

  /* ---------------- 浮标 DOM ---------------- */

  function helpBtn(key) {
    return '<button type="button" class="mrcp-help" data-help-key="' + key + '" aria-label="说明">?</button>';
  }

  function row(key, label, helpKey) {
    return (
      '<div class="mrcp-row mrcp-unset" data-key="' + key + '">' +
        '<span class="mrcp-label">' + label + (helpKey ? helpBtn(helpKey) : '') + '</span>' +
        '<span class="mrcp-state"><i class="mrcp-dot"></i><span class="mrcp-state-txt">未选择</span></span>' +
      '</div>'
    );
  }

  /* ---------------- 说明区（点问号在按钮下方展开） ---------------- */

  var currentHelpKey = '';

  function helpTrigger(target) {
    var el = target;
    while (el && el !== document.body) {
      if (el.getAttribute && el.getAttribute('data-help-key')) return el;
      el = el.parentElement;
    }
    return null;
  }

  function showHelp(key) {
    var box = document.getElementById('mrcp-helpbox');
    if (!box || !HELP[key]) return;
    box.textContent = HELP[key];
    box.hidden = false;
    currentHelpKey = key;
    root.querySelectorAll('.mrcp-help').forEach(function (b) {
      b.classList.toggle('mrcp-help-active', b.getAttribute('data-help-key') === key);
    });
  }

  function hideHelp() {
    var box = document.getElementById('mrcp-helpbox');
    if (box) box.hidden = true;
    currentHelpKey = '';
    root.querySelectorAll('.mrcp-help').forEach(function (b) {
      b.classList.remove('mrcp-help-active');
    });
  }

  function toggleHelp(key) {
    if (currentHelpKey === key) hideHelp();
    else showHelp(key);
  }

  function onHelpClick(e) {
    var t = helpTrigger(e.target);
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    toggleHelp(t.getAttribute('data-help-key'));
  }

  function bindHelp() {
    root.addEventListener('click', onHelpClick);
    document.addEventListener('click', function (e) {
      if (!helpTrigger(e.target) && !(e.target.closest && e.target.closest('.mrcp-helpbox'))) {
        hideHelp();
      }
    });
  }

  function build() {
    root.innerHTML =
      '<div class="mrcp-panel">' +
        '<div class="mrcp-head">' +
          '<span class="mrcp-head-title">🔒 隐私合规自检</span>' +
          '<button type="button" class="mrcp-collapse" id="mrcp-collapse" title="收起">›</button>' +
          '<span class="mrcp-mini" id="mrcp-mini"></span>' +
        '</div>' +
        '<div class="mrcp-body">' +
          '<div class="mrcp-region">地区：<span id="mrcp-region">—</span>' + helpBtn('region') + '</div>' +
          '<div class="mrcp-consent" id="mrcp-consent">同意记录：—</div>' +
          row('banner', '横幅', 'banner') +
          row('gpc', 'GPC 信号', 'gpc') +
          row('analytics', '分析统计', 'analytics') +
          row('marketing', '营销广告', 'marketing') +
          row('preferences', '偏好设置', 'preferences') +
          row('saleOfData', '出售 / 共享', 'saleOfData') +
          row('shopify', 'Shopify 像素', 'shopify') +
          '<div class="mrcp-sep"></div>' +
          '<div class="mrcp-actions">' +
            '<button type="button" class="mrcp-btn" id="mrcp-detail-btn">详情</button>' +
            '<button type="button" class="mrcp-btn mrcp-btn-primary" id="mrcp-send">发送测试事件</button>' +
            '<button type="button" class="mrcp-btn" id="mrcp-manage">管理偏好</button>' +
            '<button type="button" class="mrcp-btn mrcp-btn-reset" id="mrcp-reset">重置横幅</button>' +
          '</div>' +
          '<div class="mrcp-btnhelp" data-help-key="buttons" role="button" tabindex="0">' +
            helpBtn('buttons') + '<span>按钮用途</span>' +
          '</div>' +
          '<div class="mrcp-helpbox" id="mrcp-helpbox" hidden></div>' +
          '<div class="mrcp-detail" id="mrcp-detail" hidden></div>' +
          '<div class="mrcp-sep"></div>' +
          '<div class="mrcp-last">' +
            '<div>最近触发：<span id="mrcp-last-event">—</span></div>' +
            '<div>结果：<span id="mrcp-last-result">—</span></div>' +
            '<div class="mrcp-req" id="mrcp-req-count">已捕获 GA4 请求：0 条</div>' +
            '<div class="mrcp-req" id="mrcp-last-req"></div>' +
          '</div>' +
          '<div class="mrcp-flashwrap" id="mrcp-flashwrap" hidden>' +
            '<div class="mrcp-sep"></div>' +
            '<div class="mrcp-flash" id="mrcp-flash"></div>' +
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

    var resetBtn = document.getElementById('mrcp-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        resetBanner();
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

    bindHelp();
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
    var mini = document.getElementById('mrcp-mini');

    // API 未就绪时不要假装成“已拦截”，直接标明未知
    if (!apiReady) {
      if (regionEl) regionEl.textContent = 'API 未就绪';
      var c0 = document.getElementById('mrcp-consent');
      if (c0) c0.textContent = '同意记录：API 未就绪';
      setRow('banner', null, '显示中', '', '未知');
      setRow('analytics', null, '已允许', '已拦截', '未知');
      setRow('marketing', null, '已允许', '已拦截', '未知');
      setRow('preferences', null, '已允许', '已拦截', '未知');
      setRow('saleOfData', null, '可共享', '已退出', '未知');
      setRow('gpc', hasGPC() ? true : null, '已识别', '', '未识别');
      setRow('shopify', window.webPixelsManager ? true : null, '已加载', '', '未加载');
      if (mini) {
        mini.classList.remove('mrcp-ok', 'mrcp-bad');
      }
      return;
    }

    if (regionEl) regionEl.textContent = state.region || '未知';

    var cEl = document.getElementById('mrcp-consent');
    if (cEl) {
      var raw = JSON.stringify(state.consent || {});
      cEl.textContent = '同意记录：' + raw.replace(/","/g, '", "');
    }

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

    // 横幅：区分“真的显示了”和“只是状态说应该显示”
    var decided = isDecided();

    if (bannerVisible()) {
      setRow('banner', true, '显示中');
    } else if (state.shouldShowBanner && !decided) {
      setRow('banner', false, '', '应显示 · 未出现', '');
    } else {
      setRow('banner', null, '显示中', '', '已关闭');
    }

    // GPC：只反映浏览器信号，不代表同意状态
    if (hasGPC()) {
      setRow('gpc', true, '已识别');
    } else {
      setRow('gpc', null, '已识别', '', '未识别');
    }

    // Shopify 平台像素管理器是否加载（信息性，不代表正在追踪）
    if (window.webPixelsManager) {
      setRow('shopify', true, '已加载');
    } else {
      setRow('shopify', null, '已加载', '', '未加载');
    }

    var miniEl = document.getElementById('mrcp-mini');
    if (miniEl) {
      miniEl.classList.toggle('mrcp-ok', !!state.analytics);
      miniEl.classList.toggle('mrcp-bad', !state.analytics);
    }
  }

  function flash(kind, text) {
    var wrap = document.getElementById('mrcp-flashwrap');
    var el = document.getElementById('mrcp-flash');
    if (!wrap || !el) return;
    el.className = 'mrcp-flash mrcp-flash-' + kind;
    el.textContent = text;
    wrap.hidden = false;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () {
      wrap.hidden = true;
    }, 2600);
  }

  function updateLast(label, resultKind) {
    var e = document.getElementById('mrcp-last-event');
    var r = document.getElementById('mrcp-last-result');
    var q = document.getElementById('mrcp-last-req');
    if (e && label) e.textContent = label;
    if (r) {
      if (resultKind === 'pending') {
        r.className = 'mrcp-result-pending';
        r.textContent = '… 等待请求';
      } else if (resultKind === 'ok') {
        r.className = 'mrcp-result-ok';
        r.textContent = '✓ 已发送（已观测到 GA4 请求）';
      } else {
        r.className = 'mrcp-result-bad';
        r.textContent = '✗ 已拦截（未发送）';
      }
    }
    if (q && resultKind === 'bad') q.textContent = '';
  }

  /* 只有真的看到网络请求，才允许显示“已发送”。
   * 用事件通知（recordRequest 触发），不靠轮询，避免后台标签页定时器被节流。 */
  var pendingSends = [];

  function matchRealRequest(name, entry) {
    if (!entry) return false;
    var hay = (entry.url || '') + ' ' + (entry.body || '');
    return (
      hay.indexOf('en=' + name) !== -1 ||
      hay.indexOf('en=' + encodeURIComponent(name)) !== -1
    );
  }

  function awaitRealRequest(name, sinceIndex, done) {
    var w = { name: name, sinceIndex: sinceIndex, done: done, timer: null };

    function finish(entry) {
      if (w.timer) clearTimeout(w.timer);
      var i = pendingSends.indexOf(w);
      if (i !== -1) pendingSends.splice(i, 1);
      done(entry);
    }

    w.finish = finish;
    pendingSends.push(w);

    w.timer = setTimeout(function () {
      // 超时：只要之后出现过任意 GA4 请求，也算发出了；否则明确报未观测到
      finish(recentRequests.length > sinceIndex ? recentRequests[sinceIndex] : null);
    }, 6000);

    // 先注册观察者，再补查一次，避免请求比观察者更早到达
    for (var i = sinceIndex; i < recentRequests.length; i++) {
      if (matchRealRequest(name, recentRequests[i])) {
        finish(recentRequests[i]);
        return;
      }
    }

    while (pendingSends.length > 6) {
      var old = pendingSends.shift();
      if (old.timer) clearTimeout(old.timer);
    }
  }

  function notifyRealRequest(entry) {
    if (!pendingSends.length || !entry) return;
    pendingSends.slice().forEach(function (w) {
      if (matchRealRequest(w.name, entry)) w.finish(entry);
    });
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

  function sendProbe(name, extra, silent) {
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
      if (silent) return;
      updateLast(label, 'bad');
      flash('bad', 'API 未就绪');
      return;
    }

    if (!state.analytics) {
      if (silent) return;
      updateLast(label, 'bad');
      flash('bad', '已拦截（未发送）');
      return;
    }

    if (!ga4Id) {
      if (silent) return;
      updateLast(label, 'bad');
      flash('bad', '未配置 GA4 ID');
      return;
    }

    ensureGtag();
    var sinceIndex = recentRequests.length;
    if (!silent) updateLast(label, 'pending');

    // 后台自动事件（滚动/停留等）不抢“最近触发”这一栏，只保留用户可见结果
    if (silent) {
      try {
        window.gtag('event', name, payload);
      } catch (e) {
        /* 静默 */
      }
      return;
    }

    // 先挂观察者再发事件，避免请求比观察者更早到达
    // 不直接判成功：等真实请求出现再给结论
    awaitRealRequest(name, sinceIndex, function (hit) {
      if (hit) {
        updateLast(label, 'ok');
        var q = document.getElementById('mrcp-last-req');
        if (q) q.textContent = '请求：' + shortUrl(hit.url);
        flash('ok', '已发送');
      } else {
        updateLast(label, 'bad');
        var r = document.getElementById('mrcp-last-result');
        if (r) r.textContent = '✗ 未观测到请求（可能被拦截）';
        flash('bad', '未观测到 GA4 请求');
      }
    });

    try {
      window.gtag('event', name, payload);
    } catch (e) {
      /* 静默 */
    }
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

  function updateReqCount() {
    var el = document.getElementById('mrcp-req-count');
    if (el) el.textContent = '已捕获 GA4 请求：' + recentRequests.length + ' 条';
  }

  function recordRequest(url, body) {
    if (!url) return;
    var u = String(url);
    if (!/google-analytics\.com|googletagmanager\.com/i.test(u)) return;

    var entry = { url: u, body: normalizeBody(body), ts: Date.now() };
    recentRequests.push(entry);
    if (recentRequests.length > 30) recentRequests.shift();
    updateReqCount();
    notifyRealRequest(entry);

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

  /* 重置横幅：让 Shopify 原生 Cookie 横幅重新出现
   * 说明：HttpOnly 的 visitor cookie 与同意的服务端记录无法用 JS 删除，
   * 所以普通网页里做不到“删干净 + 刷新自动弹”；
   * 这里直接调 Shopify 的 showBanner() 强制显示，并清掉客户端可读的 _shopify_cmp，
   * 便于访客重新做选择（服务端可能重建该 cookie，属预期行为）。 */
  function resetBanner() {
    try {
      ['', '; domain=' + location.hostname, '; domain=.' + location.hostname].forEach(function (d) {
        document.cookie = '_shopify_cmp=; Max-Age=0; path=/' + d;
      });
    } catch (e) {
      /* 静默 */
    }

    var shown = false;
    try {
      if (window.privacyBanner && typeof window.privacyBanner.showBanner === 'function') {
        window.privacyBanner.showBanner();
        shown = true;
      } else if (
        window.Shopify &&
        window.Shopify.privacyBanner &&
        typeof window.Shopify.privacyBanner.showBanner === 'function'
      ) {
        window.Shopify.privacyBanner.showBanner();
        shown = true;
      }
    } catch (e) {
      /* 静默 */
    }

    if (shown) {
      flash('ok', '横幅已重新弹出');
      setTimeout(function () {
        readState();
        updateState();
      }, 400);
    } else {
      flash('bad', '未找到横幅接口');
    }
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
        sendProbe('probe_scroll', { scroll_percent: m }, true);
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
          sendProbe('probe_dwell', { dwell_seconds: sec }, true);
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
      }, true);
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
    pendingSends.forEach(function (w) {
      clearTimeout(w.timer);
    });
    pendingSends = [];
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
        var key = [state.analytics, state.marketing, state.preferences, state.saleOfData, state.shouldShowBanner, state.region, bannerVisible(), hasGPC(), isDecided()].join('|');
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
    requests: function () {
      return recentRequests.slice();
    },
    debug: function () {
      return {
        pending: pendingSends.map(function (w) {
          return { name: w.name, since: w.sinceIndex };
        }),
        reqs: recentRequests.map(function (e, i) {
          var hay = (e.url || '') + ' ' + (e.body || '');
          var m = hay.match(/en=[A-Za-z0-9_]+/g);
          return { i: i, en: m ? m.join(',') : '' };
        })
      };
    },
    openPreferences: openPreferences,
    resetBanner: resetBanner
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
