/* Influencer page video wall behaviour
   - autoplay the first card when it scrolls into view
   - hover to play, leave to pause on hover-capable devices
   - click / control button toggles playback */
(function () {
  'use strict';

  var HOVER_DELAY = 120;
  var AUTOPLAY_RATIO = 0.25;

  function each(list, fn) {
    Array.prototype.forEach.call(list, fn);
  }

  function hoverCapable() {
    return !window.matchMedia || window.matchMedia('(hover: hover)').matches;
  }

  function createCard(el, manager) {
    var video = el.querySelector('video');
    if (!video) return null;

    var card = {
      el: el,
      video: video,
      manager: manager,
      pinned: false,
      hoverTimer: null
    };

    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');

    video.addEventListener('playing', function () {
      el.classList.add('is-playing');
    });
    video.addEventListener('pause', function () {
      el.classList.remove('is-playing');
    });
    video.addEventListener('ended', function () {
      el.classList.remove('is-playing');
      if (video.loop) play(card);
    });

    if (hoverCapable()) {
      el.addEventListener('mouseenter', function () {
        el.classList.add('is-over');
        // start buffering right away so playback begins without a stall
        if (video.preload !== 'auto') video.preload = 'auto';
        clearHover(card);
        card.hoverTimer = setTimeout(function () {
          card.hoverTimer = null;
          if (video.paused && !card.pinned) manager.activate(card);
        }, HOVER_DELAY);
      });
      el.addEventListener('mouseleave', function () {
        el.classList.remove('is-over');
        clearHover(card);
        if (!card.pinned) manager.stop(card);
      });
    }

    var button = el.querySelector('[data-mr-toggle]');
    if (button) {
      button.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        manager.toggle(card, true);
      });
    }

    el.addEventListener('click', function (event) {
      var target = event.target;
      if (target && target.closest && target.closest('[data-mr-toggle]')) return;
      manager.toggle(card, false);
    });

    return card;
  }

  function clearHover(card) {
    if (card.hoverTimer) {
      clearTimeout(card.hoverTimer);
      card.hoverTimer = null;
    }
  }

  function play(card) {
    var result;
    try {
      result = card.video.play();
    } catch (err) {
      return;
    }
    if (result && typeof result.then === 'function') {
      result.then(null, function () {
        card.el.classList.remove('is-playing');
      });
    }
  }

  function pause(card) {
    if (!card.video.paused) card.video.pause();
  }

  function Manager(root) {
    this.root = root;
    this.cards = [];
    this.active = null;
    this.firstCard = null;
    this.firstVisible = false;
    this.suppressed = false;
    this.observer = null;
    this.allowAutoplay = true;
  }

  Manager.prototype.start = function () {
    var self = this;
    var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection || {};
    var reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    this.allowAutoplay = !conn.saveData && !/(^|-)2g$/.test(conn.effectiveType || '') && !reducedMotion;

    each(this.root.querySelectorAll('[data-mr-card]'), function (el) {
      var card = createCard(el, self);
      if (card) self.cards.push(card);
    });

    if (!this.cards.length) return;
    this.firstCard = this.cards[0];

    if ('IntersectionObserver' in window) {
      this.observer = new IntersectionObserver(function (entries) {
        each(entries, function (entry) {
          var card = self.cardFor(entry.target);
          if (!card) return;
          if (card === self.firstCard) {
            self.firstVisible = entry.intersectionRatio >= AUTOPLAY_RATIO;
          }
          if (entry.intersectionRatio < 0.05) {
            if (self.active === card) self.stop(card, true);
          } else if (card === self.firstCard && self.firstVisible) {
            self.maybeAutoplay();
          }
        });
      }, { threshold: [0, 0.05, AUTOPLAY_RATIO, 0.5, 1] });

      each(this.cards, function (card) {
        self.observer.observe(card.el);
      });
    }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) self.pauseAll();
      else self.maybeAutoplay();
    });
  };

  Manager.prototype.cardFor = function (el) {
    for (var i = 0; i < this.cards.length; i++) {
      if (this.cards[i].el === el) return this.cards[i];
    }
    return null;
  };

  Manager.prototype.maybeAutoplay = function () {
    if (!this.allowAutoplay || this.suppressed || document.hidden || !this.firstCard || !this.firstVisible) return;
    if (this.active) return;
    this.firstCard.pinned = true;
    this.activate(this.firstCard);
  };

  Manager.prototype.activate = function (card) {
    if (this.active && this.active !== card) this.stop(this.active, true);
    this.active = card;
    play(card);
  };

  Manager.prototype.stop = function (card, silent) {
    if (!card) return;
    card.pinned = false;
    pause(card);
    if (this.active === card) this.active = null;
    if (!silent) this.maybeAutoplay();
  };

  Manager.prototype.toggle = function (card, fromButton) {
    if (card === this.firstCard) this.suppressed = true;

    if (card.video.paused) {
      card.pinned = true;
      this.activate(card);
      return;
    }

    if (fromButton || card.pinned) {
      this.stop(card);
    } else {
      card.pinned = true;
    }
  };

  Manager.prototype.pauseAll = function () {
    var self = this;
    each(this.cards, function (card) {
      clearHover(card);
      card.pinned = false;
      pause(card);
    });
    this.active = null;
  };

  function init() {
    each(document.querySelectorAll('[data-mr-influencer]'), function (root) {
      if (root.getAttribute('data-mr-inited') === '1') return;
      root.setAttribute('data-mr-inited', '1');
      var manager = new Manager(root);
      manager.start();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  document.addEventListener('shopify:section:load', init);
})();
