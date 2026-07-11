/* ══════════════════════════════════════════════════════════════════════════
   SITE SOURCERY — sourcery.js  ·  the shared behavior (self-contained, no deps)
   Same-origin file — NOT an external load. Load once per page: <script
   src="sourcery.js" defer></script>. Every interaction is progressive: the
   page reads and works perfectly with this file absent (that's the moat proof).

   Encodes: the scroll-settle backbone · nav state · the theme toggle · THE TWO
   READINGS (signature) · the Meter tick · the plate-wipe slider. Reduced-motion
   is honored everywhere — motion resolves to its end-state, never withheld info.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var d = document, root = d.documentElement;
  root.classList.add('js');                                   // belt-and-suspenders
  window.__sourceryReady = true;         // tells the head-inline net to stand down (IO has this)
  var reduce = matchMedia('(prefers-reduced-motion:reduce)').matches;

  /* ── 1 · SCROLL-SETTLE — reveals settle in; JS-off/reduced → already resolved ── */
  var settle = d.querySelectorAll('.reveal,.stagger,.chassis');
  if (reduce || !('IntersectionObserver' in window)) {
    settle.forEach(function (e) { e.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function (ents) {
      ents.forEach(function (x) {
        if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); }
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.12 });
    settle.forEach(function (e) { io.observe(e); });
  }
  // inscribing-hand: draw the rubric stroke once its block is in view
  d.querySelectorAll('.inscribe').forEach(function (el) {
    if (reduce) { el.classList.add('drawn'); return; }
    if (!('IntersectionObserver' in window)) { el.classList.add('drawn'); return; }
    var o = new IntersectionObserver(function (ents) {
      ents.forEach(function (x) { if (x.isIntersecting) { x.target.classList.add('drawn'); o.unobserve(x.target); } });
    }, { threshold: 0.6 });
    o.observe(el);
  });

  /* ── 2 · NAV — condense on scroll ── */
  var nav = d.querySelector('.nav');
  if (nav) {
    var onScroll = function () { nav.classList.toggle('scrolled', (window.scrollY || 0) > 20); };
    onScroll(); addEventListener('scroll', onScroll, { passive: true });
  }

  /* ── 3 · THEME TOGGLE — light-led, override wins both ways, persisted ──
     (The no-flash pre-paint read lives inline in <head>; this only toggles.) */
  d.querySelectorAll('.theme-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var sysDark = matchMedia('(prefers-color-scheme:dark)').matches;
      var cur = root.getAttribute('data-theme');
      var effectiveDark = cur ? cur === 'dark' : sysDark;
      var next = effectiveDark ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('sourcery-theme', next); } catch (e) {}
    });
  });

  /* ── 4 · THE TWO READINGS — flip any answer-card human ⇄ machine ──
     Both readings are real DOM. Default (JS on) = human; the button reveals the
     machine skeleton. A real <button aria-pressed>; keyboard-operable; the flip
     is CSS (compositor-only), disabled under reduced-motion via the stylesheet. */
  d.querySelectorAll('[data-answer]').forEach(function (card) {
    var btn = card.querySelector('.twobtn');
    if (!btn) return;
    var label = btn.querySelector('.label-txt');
    var state = btn.querySelector('.state');
    var set = function (machine) {
      card.classList.toggle('is-machine', machine);
      btn.setAttribute('aria-pressed', machine ? 'true' : 'false');
      if (label) label.textContent = machine ? 'Read it the way a person reads it' : 'Read it the way a machine reads it';
      if (state) state.textContent = machine ? 'machine' : 'human';
      // replay the settle on the now-visible face (skipped under reduced-motion by CSS)
      var vis = card.querySelector(machine ? '.reading-machine' : '.reading-human');
      if (vis && !reduce) { vis.style.animation = 'none'; void vis.offsetWidth; vis.style.animation = ''; }
    };
    btn.addEventListener('click', function () { set(!card.classList.contains('is-machine')); });
    set(false);
  });

  /* ── 5 · THE METER TICK — tabular numerals roll up to their honest final ──
     Values sit in the DOM as their true final figure (JS-off shows final). We
     only animate the roll, and only once in view. Reduced-motion → no roll. */
  var ticks = d.querySelectorAll('[data-tick]');
  if (ticks.length) {
    var rollOne = function (el) {
      var raw = (el.textContent || '').trim();
      var m = raw.match(/^(\D*)(\d[\d,]*)(.*)$/);        // optional prefix, integer, suffix
      if (!m) return;
      var pre = m[1], suf = m[3], target = parseInt(m[2].replace(/,/g, ''), 10);
      if (reduce || isNaN(target)) { return; }           // leave the final value
      var dur = 780, t0 = 0;
      var frame = function (ts) {
        if (!t0) t0 = ts;
        var p = Math.min(1, (ts - t0) / dur);
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = pre + Math.round(eased * target).toLocaleString() + suf;
        if (p < 1) requestAnimationFrame(frame);
        else el.textContent = raw;
      };
      requestAnimationFrame(frame);
    };
    if (reduce || !('IntersectionObserver' in window)) {
      // values already correct in DOM; nothing to do
    } else {
      var mio = new IntersectionObserver(function (ents) {
        ents.forEach(function (x) { if (x.isIntersecting) { rollOne(x.target); mio.unobserve(x.target); } });
      }, { threshold: 0.9 });
      ticks.forEach(function (e) { mio.observe(e); });
    }
  }

  /* ── 6 · THE PLATE-WIPE — before/after slider (Work page; shared primitive) ──
     The handle IS a range input (keyboard-operable for free). Purely visual. */
  d.querySelectorAll('[data-compare]').forEach(function (box) {
    var range = box.querySelector('.range');
    if (!range) return;
    var apply = function () { box.style.setProperty('--split', range.value + '%'); };
    range.addEventListener('input', apply);
    apply();
  });
})();
