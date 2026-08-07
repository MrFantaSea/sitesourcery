(function () {
  "use strict";

  /**
   * Domain availability search.
   *
   * This is a DNS preflight, not a storefront. It gives a visitor a useful
   * first signal from a static page, then routes every possible registration
   * to an inquiry. A registrar's fresh availability and price readback, written
   * terms, and customer authorization are still required before anything can
   * be bought.
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
   * "available", and the registrar's own answer is what settles it. Claiming
   * certainty here would be the same failure as quoting a price nobody checked.
   *
   * Cloudflare's resolver is used because it is CORS-enabled and needs no key.
   * It receives the three cleaned candidate names plus ordinary request and
   * network metadata under its own terms and privacy practices.
   */

  var RESOLVER = "https://cloudflare-dns.com/dns-query";

  var ENDINGS = ["com", "net", "org"];

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
    return fetch(url, { method: "GET", headers: { accept: "application/dns-json" } })
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

  function row(domain, state) {
    var li = document.createElement("li");
    li.className = "domain-result domain-result-" + state;

    var name = document.createElement("strong");
    name.textContent = domain;
    li.appendChild(name);

    var verdict = document.createElement("span");
    if (state === "free") {
      verdict.textContent = "Looks unused in public DNS — registrar confirmation still required";
    } else if (state === "taken") {
      verdict.textContent = "Appears registered in public DNS";
    } else {
      verdict.textContent = "DNS preflight was inconclusive — ask for a registrar check";
    }
    li.appendChild(verdict);

    if (state === "free") {
      var ask = document.createElement("a");
      ask.className = "button button-primary";
      ask.href = "/contact/#about-customer-domain";
      ask.textContent = "Ask to verify " + domain;
      li.appendChild(ask);
    } else if (state === "taken") {
      var alt = document.createElement("span");
      alt.className = "domain-result-note";
      alt.textContent = "Try a different word, or ask about the address options.";
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

    var domains = ENDINGS.map(function (ending) { return name + "." + ending; });
    Promise.all(domains.map(check)).then(function (states) {
      results.replaceChildren.apply(
        results,
        domains.map(function (domain, index) { return row(domain, states[index]); })
      );
      var free = states.filter(function (s) { return s === "free"; }).length;
      say(
        free
          ? free + " of " + domains.length + " look unused in public DNS. This is not a reservation, registrar result, quote, or authorization to buy. Ask for a fresh provider check and written terms."
          : "None of those looked unused in public DNS. Try another word, or ask about the address options."
      );
      button.disabled = false;
    });
  }

  // No <form> element: this site is static and carries none. Enter and the
  // button both run the same search.
  button.addEventListener("click", run);
  input.addEventListener("keydown", function (event) {
    if (event.key === "Enter") run(event);
  });
}());
