/* ============================================================
   Site Sourcery — shared UI behaviour
   Theme toggle (light / dark, remembered), a subtle nav shadow on
   scroll, and scroll-reveal for [data-reveal] elements. Progressive:
   with JS off the OS theme still wins, the nav is simply borderless,
   and every reveal element shows immediately. One of the site's OWN files.
   ============================================================ */
(function () {
  "use strict";
  var root = document.documentElement;
  var KEY = "sourcery-theme";

  // Apply a stored preference early (a tiny inline pre-script also
  // does this in <head> to avoid a flash; this is the safety net).
  try {
    var saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") root.setAttribute("data-theme", saved);
  } catch (e) {}

  function effective() {
    var attr = root.getAttribute("data-theme");
    if (attr === "light" || attr === "dark") return attr;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark" : "light";
  }

  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.querySelector(".theme-btn");
    if (btn) {
      btn.addEventListener("click", function () {
        var next = effective() === "dark" ? "light" : "dark";
        root.setAttribute("data-theme", next);
        try { localStorage.setItem(KEY, next); } catch (e) {}
        btn.setAttribute("aria-label", "Switch to " + (next === "dark" ? "light" : "dark") + " mode");
      });
    }

    var nav = document.querySelector(".nav");
    if (nav) {
      var onScroll = function () {
        if (window.scrollY > 8) nav.classList.add("scrolled");
        else nav.classList.remove("scrolled");
      };
      onScroll();
      window.addEventListener("scroll", onScroll, { passive: true });
    }

    // current year in any [data-year] slot (footer © line)
    var y = String(new Date().getFullYear());
    document.querySelectorAll("[data-year]").forEach(function (e) { e.textContent = y; });

    // ── scroll-reveal ──────────────────────────────────────────
    // Elements marked [data-reveal] fade + rise into place the first
    // time they enter view. Reduced-motion or no-IO → shown at once.
    window.__ssReveal = 1;   // tells the head failsafe that reveal is handled
    var reveals = [].slice.call(document.querySelectorAll("[data-reveal]"));
    var noMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reveals.length) return;
    if (noMotion || !("IntersectionObserver" in window)) {
      reveals.forEach(function (el) { el.classList.add("in"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
    reveals.forEach(function (el) { io.observe(el); });
  });
})();
