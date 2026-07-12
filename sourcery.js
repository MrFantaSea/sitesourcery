/* ════════════════════════════════════════════════════════════════════════
   SITE SOURCERY — sourcery.js · the shared behavior ("SPELLCAST")
   Self-contained, zero deps, defer-safe. Load once per page:
     <script src="/sourcery.js" defer></script>

   Everything is progressive: with this file absent the page reads and works
   fully resolved (styles hide nothing without the html.js class).

   Owns: html.js gate · theme toggle (localStorage, both-way override) ·
   mobile nav sheet · reveal-on-scroll (60ms sibling stagger, fire once) ·
   THE CAST sweep (window.sourcery.cast) · monthly/once billing toggle ·
   Meter count-ups · a reusable typewriter for any [data-type] element.
   All motion sits behind prefers-reduced-motion.

   NO-FLASH NOTE: theme is applied at the top of this file; for a guaranteed
   zero-flash first paint you may optionally inline this one-liner in <head>:
     <script>try{var t=localStorage.getItem('ss-theme');if(t)document.documentElement.dataset.theme=t}catch(e){}</script>
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var d = document, root = d.documentElement;
  var THEME_KEY = 'ss-theme';
  var THEME_COLORS = { dark: '#0B0912', light: '#FBFAFF' };
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── 0 · js gate — reveal styles only apply when JS is truly here ──────── */
  root.classList.add('js');

  /* ── 1 · THEME — persist, override the system preference both ways ─────── */
  function currentTheme() {
    if (root.dataset.theme) return root.dataset.theme;
    return (window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
  }
  function paintMeta(theme) {
    var m = d.querySelector('meta[name="theme-color"]');
    if (!m) { m = d.createElement('meta'); m.name = 'theme-color'; d.head.appendChild(m); }
    m.content = THEME_COLORS[theme] || THEME_COLORS.dark;
  }
  function setTheme(theme, persist) {
    root.dataset.theme = theme;
    paintMeta(theme);
    if (persist) { try { localStorage.setItem(THEME_KEY, theme); } catch (e) {} }
  }
  (function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) {}
    if (saved === 'light' || saved === 'dark') setTheme(saved, false);
    else paintMeta(currentTheme());
  })();

  function wireThemeButtons() {
    d.querySelectorAll('[data-theme-toggle], .theme-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setTheme(currentTheme() === 'dark' ? 'light' : 'dark', true);
      });
    });
  }

  /* ── 2 · THE CAST — the site's only transition-of-proof ────────────────── */
  /* cast(el, swap): sweep the charm shimmer across el; run swap() mid-sweep
     so the new content is "simply there" behind it. Reduced-motion: swap only. */
  function cast(el, swap) {
    if (!el) { if (swap) swap(); return; }
    if (reduce || !el.classList.contains('cast')) { if (swap) swap(); return; }
    el.classList.remove('casting');
    void el.offsetWidth;                      /* restart the animation */
    el.classList.add('casting');
    if (swap) setTimeout(swap, 280);          /* behind the sweep's leading edge */
    setTimeout(function () { el.classList.remove('casting'); }, 700);
  }

  /* ── 3 · MOBILE NAV — sheet + aria, closes on Escape / link tap ─────────── */
  function wireNav() {
    var toggle = d.querySelector('.nav-toggle');
    var menu = d.getElementById('nav-menu') || d.querySelector('.nav-menu');
    if (!toggle || !menu) return;
    function setOpen(open) {
      toggle.setAttribute('aria-expanded', String(open));
      menu.classList.toggle('open', open);
    }
    toggle.addEventListener('click', function () {
      setOpen(toggle.getAttribute('aria-expanded') !== 'true');
    });
    menu.addEventListener('click', function (e) {
      if (e.target.closest('a')) setOpen(false);
    });
    d.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
        setOpen(false); toggle.focus();
      }
    });
  }

  /* ── 4 · REVEALS — rise+fade once at 20% viewport, 60ms sibling stagger ── */
  function wireReveals() {
    var nodes = d.querySelectorAll('.reveal');
    if (!nodes.length) return;
    if (reduce || !('IntersectionObserver' in window)) {
      nodes.forEach(function (n) { n.classList.add('in'); });
      return;
    }
    /* stagger siblings that reveal together */
    var groups = new Map();
    nodes.forEach(function (n) {
      var p = n.parentElement || d.body;
      if (!groups.has(p)) groups.set(p, 0);
      n.style.setProperty('--reveal-delay', (groups.get(p) * 60) + 'ms');
      groups.set(p, groups.get(p) + 1);
    });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { threshold: 0.2 });
    nodes.forEach(function (n) { io.observe(n); });
  }

  /* ── 5 · METER COUNT-UPS — [data-count-to="14"], counts once in view ───── */
  function wireCounters() {
    var nodes = d.querySelectorAll('[data-count-to]');
    if (!nodes.length) return;
    function finish(n) { n.textContent = n.dataset.countTo; }
    if (reduce || !('IntersectionObserver' in window)) { nodes.forEach(finish); return; }
    function run(n) {
      var to = parseFloat(n.dataset.countTo);
      if (isNaN(to)) { finish(n); return; }
      var dec = (n.dataset.countTo.split('.')[1] || '').length;
      var t0 = null, DUR = 600;
      function step(t) {
        if (t0 === null) t0 = t;
        var p = Math.min((t - t0) / DUR, 1);
        var eased = 1 - Math.pow(1 - p, 3);
        n.textContent = (to * eased).toFixed(dec);
        if (p < 1) requestAnimationFrame(step); else finish(n);
      }
      requestAnimationFrame(step);
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { run(en.target); io.unobserve(en.target); }
      });
    }, { threshold: 0.4 });
    nodes.forEach(function (n) { io.observe(n); });
  }

  /* ── 6 · BILLING TOGGLE — .toggle buttons drive [data-billing] + a cast ──
     Markup:
       <div data-billing="monthly">
         <div class="toggle" role="group" aria-label="Billing">
           <button type="button" data-value="monthly" aria-pressed="true">Pay monthly</button>
           <button type="button" data-value="once" aria-pressed="false">Pay once</button>
         </div>
         <div class="grid cols-3 cast"> …cards using .when-monthly / .when-once… </div>
       </div>                                                             */
  function wireToggles() {
    d.querySelectorAll('.toggle').forEach(function (seg) {
      var scope = seg.closest('[data-billing]');
      seg.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-value]');
        if (!btn || btn.getAttribute('aria-pressed') === 'true') return;
        seg.querySelectorAll('button[data-value]').forEach(function (b) {
          b.setAttribute('aria-pressed', String(b === btn));
        });
        if (scope) {
          var target = scope.querySelector('.cast');
          cast(target, function () { scope.dataset.billing = btn.dataset.value; });
        }
      });
    });
  }

  /* ── 7 · TYPEWRITER — any element with data-type='["msg one","msg two"]' ──
     Types each string (types → holds → clears → next, looping). Optional:
       data-type-target="#sel"  → element to .cast when a message completes
       data-type-once           → type the list once, then stop
     Reduced-motion / bad JSON: renders the first string, fully resolved.  */
  function wireTypewriters() {
    d.querySelectorAll('[data-type]').forEach(function (el) {
      var msgs;
      try { msgs = JSON.parse(el.dataset.type); } catch (e) { msgs = null; }
      if (!msgs || !msgs.length) return;
      msgs = msgs.map(String);

      if (reduce) { el.textContent = msgs[0]; return; }  /* resolved, no motion */

      var castSel = el.dataset.typeTarget;
      var once = el.hasAttribute('data-type-once');
      var caret = d.createElement('span');
      caret.className = 'caret'; caret.setAttribute('aria-hidden', 'true');
      var textNode = d.createTextNode('');
      el.textContent = '';
      el.setAttribute('aria-label', msgs[0]);
      el.appendChild(textNode); el.appendChild(caret);

      var mi = 0, ci = 0, alive = true;
      /* pause politely while off-screen */
      var visible = true;
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (en) { visible = en[0].isIntersecting; })
          .observe(el);
      }
      function tick(fn, ms) { if (alive) setTimeout(fn, ms); }
      function typeChar() {
        if (!visible) { tick(typeChar, 400); return; }
        var msg = msgs[mi];
        if (ci <= msg.length) {
          textNode.data = msg.slice(0, ci); ci++;
          tick(typeChar, 42 + Math.random() * 46);
        } else {
          /* message done — the change is simply cast */
          if (castSel) {
            var t = d.querySelector(castSel);
            if (t) { cast(t); if (t.dataset.demoStep !== undefined) t.dataset.demoStep = String(mi); }
          }
          if (once && mi === msgs.length - 1) { caret.remove(); alive = false; return; }
          tick(hold, 2600);
        }
      }
      function hold() {
        mi = (mi + 1) % msgs.length; ci = 0;
        textNode.data = '';
        el.setAttribute('aria-label', msgs[mi]);
        tick(typeChar, 500);
      }
      tick(typeChar, 700);
    });
  }

  /* ── 8b · THE STOREFRONT — the signature "one window still glowing" ──────
     A four-point sigil-spark eases toward the pointer inside .spellstage and
     the window's warmth (--lit, 0→1) tracks how near the spark is. Untouched,
     the spark drifts a slow orbit and the window breathes warmly lit. No
     pointer / reduced-motion: the window simply stays lit, spark parked.       */
  function wireStorefront() {
    var stage = d.querySelector('.spellstage');
    if (!stage) return;
    var svg = stage.querySelector('svg');
    var spark = stage.querySelector('.spell-spark');
    if (!svg || !svg.viewBox || !svg.viewBox.baseVal) return;
    var vb = svg.viewBox.baseVal;
    var wx = parseFloat(stage.dataset.winX) || vb.width * 0.5;
    var wy = parseFloat(stage.dataset.winY) || vb.height * 0.52;
    var range = parseFloat(stage.dataset.range) || 380;

    if (reduce) { stage.style.setProperty('--lit', '1'); return; }

    var coarse = window.matchMedia &&
      matchMedia('(hover: none), (pointer: coarse)').matches;

    var px = wx - range * 0.7, py = wy - range * 0.5;   // spark position
    var tx = px, ty = py;                                // target
    var idle = true, running = false, visible = true;

    function toVB(e) {
      var r = svg.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      return {
        x: (e.clientX - r.left) / r.width * vb.width,
        y: (e.clientY - r.top) / r.height * vb.height
      };
    }
    if (!coarse) {
      stage.addEventListener('pointermove', function (e) {
        var p = toVB(e); if (!p) return;
        tx = p.x; ty = p.y; idle = false; start();
      });
      stage.addEventListener('pointerleave', function () { idle = true; });
    }

    function frame(now) {
      if (!visible) { running = false; return; }     // pause off-screen
      if (idle) {
        var t = now / 1000;
        tx = wx + Math.cos(t * 0.62) * range * 0.92;
        ty = wy + Math.sin(t * 0.94) * range * 0.42 - 30;
      }
      px += (tx - px) * 0.12;
      py += (ty - py) * 0.12;
      if (spark) spark.setAttribute('transform', 'translate(' + px.toFixed(1) + ',' + py.toFixed(1) + ')');
      var dx = px - wx, dy = py - wy;
      var lit = 1 - Math.sqrt(dx * dx + dy * dy) / range;
      lit = lit < 0 ? 0 : lit > 1 ? 1 : lit;
      if (idle) lit = Math.max(lit, 0.58 + 0.14 * Math.sin(now / 1500)); // breathing floor
      stage.style.setProperty('--lit', lit.toFixed(3));
      requestAnimationFrame(frame);
    }
    function start() { if (!running) { running = true; requestAnimationFrame(frame); } }

    // only spend frames while the stage is on screen
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (en) {
        visible = en[0].isIntersecting;
        if (visible) start();
      }, { threshold: 0.05 }).observe(stage);
    } else { start(); }
  }

  /* ── 8 · manual cast triggers — [data-cast="#target"] on any button/link ── */
  function wireCastTriggers() {
    d.querySelectorAll('[data-cast]').forEach(function (el) {
      el.addEventListener('click', function () {
        cast(d.querySelector(el.dataset.cast));
      });
    });
  }

  /* ── boot ───────────────────────────────────────────────────────────────── */
  function boot() {
    wireThemeButtons();
    wireNav();
    wireReveals();
    wireCounters();
    wireToggles();
    wireTypewriters();
    wireCastTriggers();
    wireStorefront();
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', boot);
  else boot();

  /* small public surface for page-specific scripts */
  window.sourcery = { cast: cast, setTheme: setTheme };
})();
