(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module && module.exports) {
    module.exports = api;
  } else {
    root.AbracadabraCompiler = api;
  }
}(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  var SCHEMA = "abracadabra.spark/v1";
  var THEME_IDS = Object.freeze(["clear", "warm", "arcane"]);
  var THEME_SET = new Set(THEME_IDS);
  var ACTION_IDS = Object.freeze(["none", "phone", "email", "website"]);
  var ACTION_SET = new Set(ACTION_IDS);
  var MAXIMUMS = Object.freeze({
    businessName: 80,
    summary: 180,
    about: 800,
    offering: 100,
    offerings: 6,
    location: 160,
    hours: 240,
    phone: 32,
    email: 254,
    website: 2048
  });

  var THEMES = Object.freeze({
    clear: Object.freeze({
      label: "Clear",
      css: [
        ":root{--paper:#f7f9fc;--ink:#172033;--muted:#58647a;--line:#dce3ed;--accent:#275bd6;--wash:#eaf0ff;--panel:#fff;--radius:18px}",
        "body{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif}",
        "html.look-clear{color-scheme:light}",
        ".look-clear .hero{align-items:center;background:linear-gradient(135deg,var(--wash),transparent 58%)}",
        ".look-clear .hero .wrap{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(18rem,.72fr);gap:clamp(2rem,7vw,6rem);align-items:end}",
        ".look-clear .hero h1{grid-row:1/3;margin:0;font-weight:760;letter-spacing:-.065em}",
        ".look-clear .hero .lede{align-self:end}.look-clear .hero .actions{grid-column:2;margin-top:0}",
        ".look-clear .section .wrap{display:grid;grid-template-columns:minmax(9rem,.4fr) minmax(0,1fr);gap:0 2rem}",
        ".look-clear .section .eyebrow{grid-column:1}.look-clear .section h2,.look-clear .section .offers,.look-clear .section .prose,.look-clear .section .facts,.look-clear .section .actions{grid-column:2}",
        "@media(max-width:48rem){.look-clear .hero .wrap,.look-clear .section .wrap{display:block}.look-clear .hero h1{margin-bottom:1.2rem}.look-clear .hero .actions{margin-top:2rem}}"
      ].join("")
    }),
    warm: Object.freeze({
      label: "Warm",
      css: [
        ":root{--paper:#fbf4e9;--ink:#32251e;--muted:#735f52;--line:#e5d2be;--accent:#a6482d;--wash:#f4dfcc;--panel:#fffaf3;--radius:24px}",
        "body{font-family:Georgia,\"Times New Roman\",serif}.eyebrow,.action,.facts,.sitebar{font-family:ui-sans-serif,system-ui,sans-serif}",
        "html.look-warm{color-scheme:light}",
        ".look-warm .hero{text-align:center;background:radial-gradient(circle at 50% 18%,#fff4df,transparent 24rem),var(--wash)}",
        ".look-warm .hero .wrap{width:min(100% - 2rem,54rem)}",
        ".look-warm .hero h1,.look-warm .hero .lede{margin-inline:auto}",
        ".look-warm .hero .actions{justify-content:center}",
        ".look-warm .section .wrap{text-align:center}.look-warm .section h2,.look-warm .section .prose{margin-inline:auto}",
        ".look-warm .offers,.look-warm .facts,.look-warm .actions{justify-content:center;text-align:left}"
      ].join("")
    }),
    arcane: Object.freeze({
      label: "Arcane",
      css: [
        ":root{--paper:#0d0915;--ink:#fbf5ff;--muted:#c7b7d2;--line:#3b2a4b;--accent:#c29aff;--wash:#1d112b;--panel:#15101f;--radius:20px}",
        "body{font-family:Georgia,\"Times New Roman\",serif;background-image:radial-gradient(circle at 80% 10%,#2a1640 0,transparent 34rem)}.eyebrow,.action,.facts,.sitebar{font-family:ui-sans-serif,system-ui,sans-serif}",
        "html.look-arcane{color-scheme:dark}",
        ".look-arcane .hero{align-items:end;min-height:clamp(36rem,78svh,52rem);background:radial-gradient(circle at 78% 22%,#3a1e58 0,transparent 27rem),linear-gradient(145deg,var(--wash),transparent 68%)}",
        ".look-arcane .hero h1{max-width:11ch;font-style:italic;font-weight:500}",
        ".look-arcane .section:nth-of-type(even){background:rgba(194,154,255,.035)}",
        ".look-arcane .offers li{min-height:9rem;background:linear-gradient(155deg,var(--panel),rgba(194,154,255,.08))}",
        ".look-arcane .section:nth-of-type(odd) .wrap{padding-left:clamp(0rem,8vw,7rem)}"
      ].join("")
    })
  });

  function SparkValidationError(errors) {
    this.name = "SparkValidationError";
    this.message = "Abracadabra Spark facts did not pass validation.";
    this.errors = errors.slice();
    if (Error.captureStackTrace) Error.captureStackTrace(this, SparkValidationError);
  }
  SparkValidationError.prototype = Object.create(Error.prototype);
  SparkValidationError.prototype.constructor = SparkValidationError;

  function codePointLength(value) {
    return Array.from(value).length;
  }

  function canonicalText(value) {
    return String(value == null ? "" : value)
      .normalize("NFC")
      .replace(/\r\n?/gu, "\n")
      .replace(/[\u2028\u2029]/gu, "\n")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
      .replace(/[ \t\f\v\u00a0]+/gu, " ")
      .replace(/ *\n */gu, "\n")
      .trim();
  }

  function oneLine(value) {
    return canonicalText(value).replace(/\s*\n+\s*/gu, " ").replace(/ {2,}/gu, " ");
  }

  function boundedText(value, field, maximum, errors, required) {
    var normalized = oneLine(value);
    if (!normalized && required) errors.push({ field: field, message: "This fact is required." });
    if (codePointLength(normalized) > maximum) {
      errors.push({ field: field, message: "Keep this fact to " + maximum + " characters or fewer." });
    }
    return normalized;
  }

  function boundedParagraphText(value, field, maximum, errors) {
    var normalized = canonicalText(value).replace(/\n{3,}/gu, "\n\n");
    if (codePointLength(normalized) > maximum) {
      errors.push({ field: field, message: "Keep this fact to " + maximum + " characters or fewer." });
    }
    return normalized;
  }

  function normalizeOfferings(value, errors) {
    var source = Array.isArray(value) ? value : canonicalText(value).split("\n");
    var offerings = source.map(oneLine).filter(Boolean);
    if (offerings.length > MAXIMUMS.offerings) {
      errors.push({
        field: "offerings",
        message: "Abracadabra supports up to " + MAXIMUMS.offerings + " offerings."
      });
    }
    offerings = offerings.slice(0, MAXIMUMS.offerings);
    offerings.forEach(function (offering, index) {
      if (codePointLength(offering) > MAXIMUMS.offering) {
        errors.push({
          field: "offerings",
          message: "Offering " + (index + 1) + " must be " + MAXIMUMS.offering + " characters or fewer."
        });
      }
    });
    return offerings;
  }

  function normalizePhone(value, errors) {
    var display = boundedText(value, "phone", MAXIMUMS.phone, errors, false);
    if (!display) return null;
    if (!/^\+?[0-9().\-\s]+$/u.test(display)) {
      errors.push({ field: "phone", message: "Use only an ordinary phone number and punctuation." });
      return null;
    }
    var digits = display.replace(/\D/gu, "");
    if (digits.length < 7 || digits.length > 15) {
      errors.push({ field: "phone", message: "Enter a phone number containing 7 to 15 digits." });
      return null;
    }
    return Object.freeze({
      display: display,
      href: "tel:" + (display.startsWith("+") ? "+" : "") + digits
    });
  }

  function normalizeEmail(value, errors) {
    var display = boundedText(value, "email", MAXIMUMS.email, errors, false);
    if (!display) return null;
    if (
      !/^[^\s@<>()[\]\\,;:"]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/u.test(display)
      || display.startsWith(".")
      || display.includes("..")
    ) {
      errors.push({ field: "email", message: "Enter one ordinary email address." });
      return null;
    }
    return Object.freeze({ display: display, href: "mailto:" + display });
  }

  function normalizeWebsite(value, errors) {
    var display = boundedText(value, "website", MAXIMUMS.website, errors, false);
    if (!display) return null;
    var candidate = /^[a-z][a-z0-9+.-]*:/iu.test(display) ? display : "https://" + display;
    var parsed;
    try {
      parsed = new URL(candidate);
    } catch (error) {
      errors.push({ field: "website", message: "Enter a complete website address." });
      return null;
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      errors.push({ field: "website", message: "Website links must use http or https." });
      return null;
    }
    if (!parsed.hostname || parsed.username || parsed.password) {
      errors.push({ field: "website", message: "The website address cannot contain credentials." });
      return null;
    }
    return Object.freeze({ display: display, href: parsed.href });
  }

  function normalizeFacts(input) {
    var source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    var errors = [];
    var theme = oneLine(source.theme).toLowerCase();
    if (!THEME_SET.has(theme)) {
      errors.push({ field: "theme", message: "Choose Clear, Warm, or Arcane." });
    }
    var phone = normalizePhone(source.phone, errors);
    var email = normalizeEmail(source.email, errors);
    var website = normalizeWebsite(source.website, errors);
    var primaryAction = oneLine(source.primaryAction || "none").toLowerCase();
    if (!ACTION_SET.has(primaryAction)) {
      errors.push({ field: "primaryAction", message: "Choose phone, email, website, or no emphasized action." });
    } else if (primaryAction !== "none" && !({ phone: phone, email: email, website: website })[primaryAction]) {
      errors.push({
        field: "primaryAction",
        message: "Enter the matching contact detail before emphasizing this action."
      });
    }
    var normalized = {
      schema: SCHEMA,
      theme: theme,
      businessName: boundedText(source.businessName, "businessName", MAXIMUMS.businessName, errors, true),
      summary: boundedText(source.summary, "summary", MAXIMUMS.summary, errors, true),
      about: boundedParagraphText(source.about, "about", MAXIMUMS.about, errors),
      offerings: normalizeOfferings(source.offerings, errors),
      location: boundedText(source.location, "location", MAXIMUMS.location, errors, false),
      hours: boundedText(source.hours, "hours", MAXIMUMS.hours, errors, false),
      phone: phone,
      email: email,
      website: website,
      primaryAction: primaryAction
    };
    if (
      !normalized.about
      && !normalized.offerings.length
      && !normalized.location
      && !normalized.hours
    ) {
      errors.push({
        field: "pageDetails",
        message: "Add About text, an offering, a location, or hours so the page has useful supporting detail."
      });
    }
    if (!normalized.phone && !normalized.email && !normalized.website) {
      errors.push({
        field: "contact",
        message: "Add a phone number, email address, or outside website so visitors have a next step."
      });
    }
    if (errors.length) throw new SparkValidationError(errors);
    return deepFreeze(normalized);
  }

  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.keys(value).forEach(function (key) { deepFreeze(value[key]); });
    return Object.freeze(value);
  }

  function stableStringify(value) {
    if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
    if (value && typeof value === "object") {
      return "{" + Object.keys(value).sort().map(function (key) {
        return JSON.stringify(key) + ":" + stableStringify(value[key]);
      }).join(",") + "}";
    }
    return JSON.stringify(value);
  }

  function utf8Bytes(value) {
    var bytes = [];
    for (var index = 0; index < value.length; index += 1) {
      var code = value.charCodeAt(index);
      if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
        var next = value.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          code = ((code - 0xd800) * 0x400) + (next - 0xdc00) + 0x10000;
          index += 1;
        }
      }
      if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
      if (code <= 0x7f) bytes.push(code);
      else if (code <= 0x7ff) {
        bytes.push(0xc0 | (code >>> 6), 0x80 | (code & 0x3f));
      } else if (code <= 0xffff) {
        bytes.push(
          0xe0 | (code >>> 12),
          0x80 | ((code >>> 6) & 0x3f),
          0x80 | (code & 0x3f)
        );
      } else {
        bytes.push(
          0xf0 | (code >>> 18),
          0x80 | ((code >>> 12) & 0x3f),
          0x80 | ((code >>> 6) & 0x3f),
          0x80 | (code & 0x3f)
        );
      }
    }
    return bytes;
  }

  function rotateRight(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }

  function sha256(value) {
    var constants = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    var hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var bytes = utf8Bytes(String(value));
    var bitLength = bytes.length * 8;
    bytes.push(0x80);
    while ((bytes.length % 64) !== 56) bytes.push(0);
    var high = Math.floor(bitLength / 0x100000000);
    var low = bitLength >>> 0;
    for (var highShift = 24; highShift >= 0; highShift -= 8) bytes.push((high >>> highShift) & 0xff);
    for (var lowShift = 24; lowShift >= 0; lowShift -= 8) bytes.push((low >>> lowShift) & 0xff);

    var words = new Array(64);
    for (var offset = 0; offset < bytes.length; offset += 64) {
      for (var wordIndex = 0; wordIndex < 16; wordIndex += 1) {
        var byteIndex = offset + (wordIndex * 4);
        words[wordIndex] = (
          (bytes[byteIndex] << 24)
          | (bytes[byteIndex + 1] << 16)
          | (bytes[byteIndex + 2] << 8)
          | bytes[byteIndex + 3]
        ) >>> 0;
      }
      for (var scheduleIndex = 16; scheduleIndex < 64; scheduleIndex += 1) {
        var previous15 = words[scheduleIndex - 15];
        var previous2 = words[scheduleIndex - 2];
        var sigma0 = rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^ (previous15 >>> 3);
        var sigma1 = rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^ (previous2 >>> 10);
        words[scheduleIndex] = (
          words[scheduleIndex - 16] + sigma0 + words[scheduleIndex - 7] + sigma1
        ) >>> 0;
      }

      var a = hash[0];
      var b = hash[1];
      var c = hash[2];
      var d = hash[3];
      var e = hash[4];
      var f = hash[5];
      var g = hash[6];
      var h = hash[7];
      for (var round = 0; round < 64; round += 1) {
        var sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
        var choice = (e & f) ^ ((~e) & g);
        var temporary1 = (h + sum1 + choice + constants[round] + words[round]) >>> 0;
        var sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
        var majority = (a & b) ^ (a & c) ^ (b & c);
        var temporary2 = (sum0 + majority) >>> 0;
        h = g;
        g = f;
        f = e;
        e = (d + temporary1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (temporary1 + temporary2) >>> 0;
      }
      hash[0] = (hash[0] + a) >>> 0;
      hash[1] = (hash[1] + b) >>> 0;
      hash[2] = (hash[2] + c) >>> 0;
      hash[3] = (hash[3] + d) >>> 0;
      hash[4] = (hash[4] + e) >>> 0;
      hash[5] = (hash[5] + f) >>> 0;
      hash[6] = (hash[6] + g) >>> 0;
      hash[7] = (hash[7] + h) >>> 0;
    }
    return hash.map(function (word) { return word.toString(16).padStart(8, "0"); }).join("");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/gu, "&amp;")
      .replace(/</gu, "&lt;")
      .replace(/>/gu, "&gt;")
      .replace(/"/gu, "&quot;")
      .replace(/'/gu, "&#39;");
  }

  function section(title, body, className) {
    return '<section class="section ' + className + '" id="' + className + '"><div class="wrap"><p class="eyebrow">'
      + escapeHtml(title) + "</p>" + body + "</div></section>";
  }

  function renderParagraphs(value) {
    return value.split(/\n+/gu).map(function (paragraph) {
      return '<p class="prose">' + escapeHtml(paragraph) + "</p>";
    }).join("");
  }

  function contentFacts(normalized) {
    return {
      schema: normalized.schema,
      businessName: normalized.businessName,
      summary: normalized.summary,
      about: normalized.about,
      offerings: normalized.offerings,
      location: normalized.location,
      hours: normalized.hours,
      phone: normalized.phone,
      email: normalized.email,
      website: normalized.website,
      primaryAction: normalized.primaryAction
    };
  }

  function renderHtml(normalized, contentDigest) {
    var theme = THEMES[normalized.theme];
    var sections = [];
    var navigation = [];
    if (normalized.offerings.length) {
      navigation.push({ href: "#offerings", label: "Offerings" });
      sections.push(section(
        "Offerings",
        "<h2>What we offer</h2><ul class=\"offers\">" + normalized.offerings.map(function (offering) {
          return "<li>" + escapeHtml(offering) + "</li>";
        }).join("") + "</ul>",
        "offerings"
      ));
    }
    if (normalized.about) {
      navigation.push({ href: "#about", label: "About" });
      sections.push(section(
        "About",
        "<h2>About " + escapeHtml(normalized.businessName) + "</h2>" + renderParagraphs(normalized.about),
        "about"
      ));
    }
    if (normalized.location || normalized.hours) {
      navigation.push({ href: "#practical", label: "Details" });
      var facts = [];
      if (normalized.location) {
        facts.push("<div><dt>Location or service area</dt><dd>" + escapeHtml(normalized.location) + "</dd></div>");
      }
      if (normalized.hours) facts.push("<div><dt>Hours</dt><dd>" + escapeHtml(normalized.hours) + "</dd></div>");
      var practicalHeading = normalized.location && normalized.hours
        ? "Location and hours"
        : normalized.location
          ? "Location or service area"
          : "Hours";
      sections.push(section(
        "Details",
        "<h2>" + practicalHeading + "</h2><dl class=\"facts\">" + facts.join("") + "</dl>",
        "practical"
      ));
    }
    var actions = [];
    var primaryHeroAction = "";
    if (normalized.phone) {
      var phoneAction = '<a class="action' + (normalized.primaryAction === "phone" ? " primary" : "")
        + '" href="' + escapeHtml(normalized.phone.href) + '">Call '
        + escapeHtml(normalized.phone.display) + "</a>";
      actions.push(phoneAction);
      if (normalized.primaryAction === "phone") primaryHeroAction = phoneAction;
    }
    if (normalized.email) {
      var emailAction = '<a class="action' + (normalized.primaryAction === "email" ? " primary" : "")
        + '" href="' + escapeHtml(normalized.email.href) + '">Email '
        + escapeHtml(normalized.email.display) + "</a>";
      actions.push(emailAction);
      if (normalized.primaryAction === "email") primaryHeroAction = emailAction;
    }
    if (normalized.website) {
      var websiteAction = '<a class="action' + (normalized.primaryAction === "website" ? " primary" : "")
        + '" href="' + escapeHtml(normalized.website.href)
        + '" target="_blank" rel="noopener noreferrer">Visit ' + escapeHtml(normalized.website.display) + "</a>";
      actions.push(websiteAction);
      if (normalized.primaryAction === "website") primaryHeroAction = websiteAction;
    }
    if (actions.length) {
      navigation.push({ href: "#contact", label: "Contact" });
      sections.push(section(
        "Contact",
        "<h2>Get in touch</h2><div class=\"actions\">" + actions.join("") + "</div>",
        "contact"
      ));
    }

    var baseCss = [
      "*{box-sizing:border-box}",
      "html{scroll-behavior:smooth}",
      "body{margin:0;color:var(--ink);background:var(--paper);font-size:clamp(1rem,.96rem + .2vw,1.12rem);line-height:1.65}",
      "a{color:inherit}",
      ".wrap{width:min(100% - 2rem,68rem);margin-inline:auto}",
      ".skip{position:fixed;z-index:20;top:.75rem;left:.75rem;padding:.65rem .8rem;border-radius:.55rem;color:var(--paper);background:var(--ink);font-weight:750;transform:translateY(-180%)}.skip:focus{transform:none}",
      ".sitebar{position:sticky;z-index:10;top:0;border-bottom:1px solid var(--line);background:var(--paper);background:color-mix(in srgb,var(--paper) 92%,transparent);backdrop-filter:blur(14px)}",
      ".sitebar .wrap{display:flex;min-height:4rem;align-items:center;justify-content:space-between;gap:1rem}.sitebar strong{min-width:0;font-size:.9rem;overflow-wrap:anywhere}.sitebar nav{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:.2rem .65rem}.sitebar a{display:inline-flex;min-height:44px;align-items:center;padding:.2rem;color:var(--muted);font-size:.78rem;font-weight:750;text-decoration:none}.sitebar a:hover,.sitebar a:focus-visible{color:var(--accent)}",
      ".hero{display:grid;min-height:clamp(32rem,65svh,46rem);align-items:center;padding:clamp(4rem,10vw,8rem) 0;background:linear-gradient(145deg,var(--wash),transparent 62%)}",
      ".eyebrow{margin:0 0 .75rem;color:var(--accent);font-size:.78rem;font-weight:800;letter-spacing:.13em;text-transform:uppercase}",
      "h1,h2,p{margin-top:0}h1{max-width:13ch;margin-bottom:1.2rem;font-size:clamp(2.8rem,8vw,6.6rem);line-height:.94;letter-spacing:-.055em;overflow-wrap:anywhere}.long-title{max-width:18ch;font-size:clamp(2.2rem,6vw,4.7rem)}",
      "h2{max-width:18ch;font-size:clamp(2rem,5vw,3.6rem);line-height:1.05;letter-spacing:-.035em}",
      ".lede{max-width:42rem;margin:0;color:var(--muted);font-size:clamp(1.15rem,2.6vw,1.55rem);overflow-wrap:anywhere}",
      ".section{padding:clamp(4rem,9vw,7rem) 0;border-top:1px solid var(--line);scroll-margin-top:5rem}",
      ".prose{max-width:48rem;margin-bottom:1rem;color:var(--muted);font-size:1.08em}.prose:last-child{margin-bottom:0}",
      ".offers{display:grid;grid-template-columns:repeat(auto-fit,minmax(14rem,1fr));gap:1rem;margin:2rem 0 0;padding:0;list-style:none}",
      ".offers li,.facts>div{min-width:0;padding:1.25rem;border:1px solid var(--line);border-radius:var(--radius);background:var(--panel);overflow-wrap:anywhere}",
      ".facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(14rem,1fr));gap:1rem;margin:2rem 0 0}",
      ".facts dt{color:var(--accent);font-size:.76rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.facts dd{margin:.35rem 0 0;overflow-wrap:anywhere}",
      ".actions{display:flex;flex-wrap:wrap;gap:.8rem;margin-top:1.5rem}",
      ".hero .actions{margin-top:2rem}",
      ".action{display:inline-flex;min-height:48px;align-items:center;padding:.7rem 1rem;border:1px solid var(--accent);border-radius:999px;background:var(--panel);font-weight:750;text-decoration:none;overflow-wrap:anywhere}",
      ".action.primary{color:var(--paper);background:var(--accent)}",
      ".action:focus-visible{outline:3px solid var(--accent);outline-offset:3px}",
      ".footer{padding:2rem 0;color:var(--muted);border-top:1px solid var(--line);font-size:.82rem}.footer strong{color:var(--ink)}",
      "@media(max-width:36rem){.sitebar .wrap{align-items:flex-start;flex-direction:column;padding-block:.8rem}.sitebar nav{justify-content:flex-start}.hero{min-height:0}.actions{align-items:stretch;flex-direction:column}.action{justify-content:center;text-align:center}}",
      "@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}",
      "@media(forced-colors:active){.offers li,.facts>div,.action{border:1px solid CanvasText}.action.primary{forced-color-adjust:auto}}"
    ].join("");

    return [
      "<!DOCTYPE html>",
      '<html lang="en" class="look-' + normalized.theme + '">',
      "<head>",
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      "<title>" + escapeHtml(normalized.businessName) + "</title>",
      '<meta name="description" content="' + escapeHtml(normalized.summary) + '">',
      "<style>" + baseCss + theme.css + "</style>",
      "</head>",
      "<body>",
      '<a class="skip" href="#main">Skip to content</a>',
      '<header class="sitebar"><div class="wrap"><strong>' + escapeHtml(normalized.businessName)
        + "</strong>" + (navigation.length ? '<nav aria-label="Page">' + navigation.map(function (item) {
          return '<a href="' + item.href + '">' + item.label + "</a>";
        }).join("") + "</nav>" : "") + "</div></header>",
      '<main id="main">',
      '<header class="hero"><div class="wrap"><h1'
        + (codePointLength(normalized.businessName) > 32 ? ' class="long-title"' : "")
        + ">" + escapeHtml(normalized.businessName) + '</h1><p class="lede">'
        + escapeHtml(normalized.summary) + "</p>"
        + (primaryHeroAction ? '<div class="actions">' + primaryHeroAction + "</div>" : "")
        + "</div></header>",
      sections.join(""),
      "</main>",
      '<footer class="footer"><div class="wrap"><strong>' + escapeHtml(normalized.businessName) + "</strong></div></footer>",
      "</body>",
      "</html>"
    ].join("");
  }

  function compileSite(input) {
    var normalized = normalizeFacts(input);
    var facts = contentFacts(normalized);
    var contentDigest = sha256(stableStringify(facts));
    var normalizedDigest = sha256(stableStringify(normalized));
    var html = renderHtml(normalized, contentDigest);
    var artifactDigest = sha256(html);
    return deepFreeze({
      schema: SCHEMA,
      versionId: "spark-" + artifactDigest.slice(0, 12),
      theme: normalized.theme,
      facts: facts,
      contentDigest: contentDigest,
      normalizedDigest: normalizedDigest,
      artifactDigest: artifactDigest,
      html: html
    });
  }

  return Object.freeze({
    SCHEMA: SCHEMA,
    THEME_IDS: THEME_IDS,
    ACTION_IDS: ACTION_IDS,
    MAXIMUMS: MAXIMUMS,
    SparkValidationError: SparkValidationError,
    normalizeFacts: normalizeFacts,
    stableStringify: stableStringify,
    sha256: sha256,
    escapeHtml: escapeHtml,
    compileSite: compileSite
  });
}));
