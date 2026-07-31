(function () {
  "use strict";

  /**
   * Domain availability search.
   *
   * The site talked about four ways to have an address and gave the visitor no
   * way to look one up — every route ended in "call Zack". This is the smallest
   * honest thing that actually works from a static page with no server.
   *
   * HOW IT DECIDES, AND WHY IT IS HONEST ABOUT IT
   *
   * It asks a public DNS resolver whether the name has nameservers. That is a
   * strong signal, not proof:
   *
   *   - NS records present  -> the name is registered. Reliable.
   *   - NXDOMAIN            -> almost certainly nobody owns it, BUT a name can
   *                            be registered and never pointed anywhere, which
   *                            also answers NXDOMAIN.
   *
   * So a free-looking name is reported as "looks available" and never as
   * "available", and the registrar's own answer is what settles it before any
   * money moves. Claiming certainty here would be the same failure as quoting a
   * price nobody checked.
   *
   * Cloudflare's resolver is used because it is CORS-enabled, needs no key, and
   * receives only the name the visitor typed in order to look it up.
   */

  var RESOLVER = "https://cloudflare-dns.com/dns-query";

  /**
   * Endings are NOT all the same price. Registries charge different wholesale
   * for each, so a single flat retail number is fat margin on one ending and a
   * loss on another. Prices come from domains/domain-prices.json, which is
   * derived from data/public-catalog.json — never hand-typed here.
   *
   * `checkout` is null for any band that has no Stripe price yet. A band
   * without a price cannot be sold, so the row offers to get a quote instead of
   * charging the wrong amount. Undercharging silently is the failure this
   * avoids.
   */
  var PRICES = null;
  var CHECKOUT_BY_BAND = {
    standard: "https://buy.stripe.com/dRm9AV0iIfroddk5jS7kc03",
    plus: null
  };

  var form = document.querySelector("[data-domain-search]");
  if (!form) return;

  var input = form.querySelector("[data-domain-input]");
  var button = form.querySelector("[data-domain-submit]");
  var results = document.querySelector("[data-domain-results]");
  var status = document.querySelector("[data-domain-status]");
  if (!input || !button || !results || !status) return;

  /** Strip anything that is not a hostname label. Never trust typed input. */
  function cleanName(raw) {
    var value = String(raw || "").trim().toLowerCase();
    value = value.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    value = value.split(".")[0];
    value = value.replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    return value;
  }

  function say(message) {
    status.textContent = message;
  }

  function check(domain) {
    var url = RESOLVER + "?name=" + encodeURIComponent(domain) + "&type=NS";
    return fetch(url, { headers: { accept: "application/dns-json" } })
      .then(function (response) {
        if (!response.ok) throw new Error("resolver_unavailable");
        return response.json();
      })
      .then(function (data) {
        // 3 is NXDOMAIN. Anything with an answer section is registered.
        if (data.Status === 3) return "free";
        if (data.Answer && data.Answer.length) return "taken";
        // 0 with no answer, or any other status, is genuinely unclear.
        return "unclear";
      })
      .catch(function () {
        return "unclear";
      });
  }

  function money(cents) {
    return "$" + (cents / 100).toFixed(cents % 100 ? 2 : 0);
  }

  function priceFor(ending) {
    return PRICES && PRICES.endings ? PRICES.endings[ending] : null;
  }

  function row(domain, state) {
    var ending = domain.split(".").slice(1).join(".");
    var price = priceFor(ending);
    var li = document.createElement("li");
    li.className = "domain-result domain-result-" + state;

    var name = document.createElement("strong");
    name.textContent = domain;
    li.appendChild(name);

    var verdict = document.createElement("span");
    if (state === "free") {
      verdict.textContent = price
        ? "Looks available · " + money(price.firstYearCents) + " a year"
        : "Looks available · priced for this ending";
    } else if (state === "taken") {
      verdict.textContent = "Already taken";
    } else {
      verdict.textContent = "Could not tell — Zack will check by hand";
    }
    li.appendChild(verdict);

    if (state === "free") {
      var checkout = price ? CHECKOUT_BY_BAND[price.band] : null;
      if (checkout) {
        var buy = document.createElement("a");
        buy.className = "button button-primary";
        // The name travels to Stripe so the order says which domain was bought.
        buy.href = checkout + "?client_reference_id=" + encodeURIComponent(domain);
        buy.rel = "noopener";
        buy.textContent = "Buy " + domain;
        li.appendChild(buy);
      } else {
        // Priced but not yet sellable at that price. Ask rather than undercharge.
        var ask = document.createElement("a");
        ask.className = "button";
        ask.href = "/contact/#about-domain-help";
        ask.textContent = "Ask about " + domain;
        li.appendChild(ask);
      }
    } else if (state === "taken") {
      var alt = document.createElement("span");
      alt.className = "domain-result-note";
      alt.textContent = "Try a different word, or rent an address instead.";
      li.appendChild(alt);
    }
    return li;
  }

  function run(event) {
    event.preventDefault();
    var name = cleanName(input.value);
    if (!name) {
      say("Type the name you would like, without the ending.");
      return;
    }

    results.replaceChildren();
    button.disabled = true;
    say("Checking for “" + name + "”…");

    var endings = Object.keys((PRICES && PRICES.endings) || { com: 1 });
    var domains = endings.map(function (ending) { return name + "." + ending; });
    Promise.all(domains.map(check)).then(function (states) {
      results.replaceChildren.apply(
        results,
        domains.map(function (domain, index) { return row(domain, states[index]); })
      );
      var free = states.filter(function (s) { return s === "free"; }).length;
      say(
        free
          ? free + " of " + domains.length + " look available. Availability is confirmed with the registrar before you are charged."
          : "None of those look available. Try another word, or rent an address at sitesourcery.me."
      );
      button.disabled = false;
    });
  }

  // No <form> element: this site is static and carries none. Enter and the
  // button both run the same search.
  fetch("/domains/domain-prices.json")
    .then(function (r) { return r.json(); })
    .then(function (data) { PRICES = data; })
    .catch(function () { PRICES = null; });

  button.addEventListener("click", run);
  input.addEventListener("keydown", function (event) {
    if (event.key === "Enter") run(event);
  });
}());
