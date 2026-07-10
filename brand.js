/* ============================================================
   Site Sourcery — BRAND (the ONE place to edit)
   ------------------------------------------------------------
   Every page pulls its name, domain, tagline, offer, phone and
   email from the BRAND object below — change a value here and it
   propagates site-wide at load, including the <title> + social
   meta tags. This is the single edit to rename the business.

   Self-contained: this is one of the site's OWN files (like
   style.css). No third-party / remote loads anywhere.

   Literal fallbacks are baked into each HTML file (marked with a
   comment) so the pages still read correctly with JavaScript off
   and for social-scrapers — after a rename you may update those
   too, but the live rendered site only needs this one edit.
   ============================================================ */
(function () {
  "use strict";

  var BRAND = {
    name: "Site Sourcery",          // ← rename here
    domain: "sitesourcery.com",
    tagline: "A beautiful website for your business — built for you, live today.",
    offer: "$79/mo all-in: we build it, host it, keep it updated. You just send photos.",
    price: "$79",
    per: "/mo",
    region: "South Jersey",
    // Contact — placeholders until the real line/inbox is live.
    phone: "(856) 555-0199",
    email: "hello@sitesourcery.com",
  };

  // expose for the customizer + any page script
  window.BRAND = BRAND;

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  ready(function () {
    // Fill text slots: <span data-brand>, data-domain, data-tagline,
    // data-offer, data-price, data-per, data-region, data-email-text.
    var map = {
      "brand": BRAND.name,
      "domain": BRAND.domain,
      "tagline": BRAND.tagline,
      "offer": BRAND.offer,
      "price": BRAND.price,
      "per": BRAND.per,
      "region": BRAND.region,
      "phone-text": BRAND.phone,
      "email-text": BRAND.email,
    };
    Object.keys(map).forEach(function (key) {
      var nodes = document.querySelectorAll("[data-" + key + "]");
      for (var i = 0; i < nodes.length; i++) nodes[i].textContent = map[key];
    });

    // Fill href slots for phone / email / domain links.
    document.querySelectorAll("[data-tel]").forEach(function (a) {
      a.setAttribute("href", "tel:" + BRAND.phone.replace(/[^\d+]/g, ""));
    });
    document.querySelectorAll("[data-mailto]").forEach(function (a) {
      a.setAttribute("href", "mailto:" + BRAND.email);
    });

    // Keep the document title + meta description + social tags in sync,
    // so a rename here propagates without touching each <head>.
    // A page opts in with data-brand-title="…{name}…" on <body>.
    var body = document.body;
    if (body && body.getAttribute("data-brand-title")) {
      document.title = body.getAttribute("data-brand-title").replace(/\{name\}/g, BRAND.name);
    }
    var desc = body && body.getAttribute("data-brand-desc");
    if (desc) {
      desc = desc.replace(/\{name\}/g, BRAND.name)
                 .replace(/\{tagline\}/g, BRAND.tagline)
                 .replace(/\{offer\}/g, BRAND.offer);
      ["description", "og:description", "twitter:description"].forEach(function (n) {
        var m = document.querySelector('meta[name="' + n + '"], meta[property="' + n + '"]');
        if (m) m.setAttribute("content", desc);
      });
      document.querySelectorAll('meta[property="og:title"],meta[name="twitter:title"]').forEach(function (m) {
        m.setAttribute("content", BRAND.name + " — " + BRAND.tagline);
      });
      var sn = document.querySelector('meta[property="og:site_name"]');
      if (sn) sn.setAttribute("content", BRAND.name);
    }
  });
})();
