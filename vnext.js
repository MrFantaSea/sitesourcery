(function () {
  "use strict";

  var doc = document;
  var root = doc.documentElement;
  root.classList.add("js");

  function normalizePath(value) {
    if (!value) return "/";
    var path = value.split("#")[0].split("?")[0];
    if (path.endsWith(".html")) return path;
    return path.endsWith("/") ? path : path + "/";
  }

  function markCurrentNavigation() {
    var current = normalizePath(window.location.pathname);
    var nav = doc.querySelector("[data-primary-nav]");
    if (!nav) return;
    Array.prototype.forEach.call(nav.querySelectorAll("a[href]"), function (link) {
      var href = link.getAttribute("href");
      if (!href || href === "/") return;
      var route = normalizePath(href);
      var websitesSection = link.getAttribute("data-nav-section") === "websites";
      var selected = current === route
        || (route !== "/" && current.startsWith(route))
        || (
          websitesSection
          && (current.startsWith("/custom/") || current.startsWith("/abracadabra/"))
        );
      if (selected) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }

  function setupMenu() {
    var button = doc.querySelector("[data-menu-button]");
    var menu = doc.querySelector("[data-menu]");
    if (!button || !menu) return;

    var firstLink = menu.querySelector("a[href]");
    var pageRegions = Array.prototype.slice.call(doc.querySelectorAll("main, .site-footer"));
    var wideViewport = window.matchMedia("(min-width: 56.001rem)");

    function setPageInert(inert) {
      pageRegions.forEach(function (region) {
        region.inert = inert;
      });
    }

    function isOpen() {
      return button.getAttribute("aria-expanded") === "true";
    }

    function closeMenu(returnFocus) {
      button.setAttribute("aria-expanded", "false");
      menu.removeAttribute("data-open");
      setPageInert(false);
      if (returnFocus) button.focus({ preventScroll: true });
    }

    function openMenu() {
      button.setAttribute("aria-expanded", "true");
      menu.setAttribute("data-open", "");
      setPageInert(true);
      if (firstLink) firstLink.focus({ preventScroll: true });
    }

    button.setAttribute("aria-expanded", "false");
    menu.removeAttribute("data-open");

    button.addEventListener("click", function () {
      if (isOpen()) closeMenu(true);
      else openMenu();
    });

    menu.addEventListener("click", function (event) {
      if (!event.target.closest("a[href]")) return;
      closeMenu(false);
    });

    doc.addEventListener("keydown", function (event) {
      if (!isOpen()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu(true);
        return;
      }
      if (event.key !== "Tab") return;
      var focusable = [button].concat(Array.prototype.slice.call(menu.querySelectorAll("a[href]")));
      var current = focusable.indexOf(doc.activeElement);
      if (event.shiftKey && (current <= 0)) {
        event.preventDefault();
        focusable[focusable.length - 1].focus({ preventScroll: true });
      } else if (!event.shiftKey && current === focusable.length - 1) {
        event.preventDefault();
        button.focus({ preventScroll: true });
      }
    });

    function cleanupWideMenu(event) {
      if (event.matches) closeMenu(false);
    }
    if (typeof wideViewport.addEventListener === "function") {
      wideViewport.addEventListener("change", cleanupWideMenu);
    } else {
      wideViewport.addListener(cleanupWideMenu);
    }
    cleanupWideMenu(wideViewport);
  }

  function watchHeader() {
    var header = doc.querySelector("[data-header]") || doc.querySelector(".site-header");
    if (!header) return;
    var queued = false;
    function paint() {
      if (window.scrollY > 12) header.setAttribute("data-scrolled", "true");
      else header.removeAttribute("data-scrolled");
      queued = false;
    }
    function queue() {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(paint);
    }
    paint();
    window.addEventListener("scroll", queue, { passive: true });
  }

  function revealSections() {
    var items = Array.prototype.slice.call(doc.querySelectorAll(".reveal"));
    if (!items.length) return;
    if (
      !("IntersectionObserver" in window)
      || window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      items.forEach(function (item) {
        item.setAttribute("data-revealed", "true");
      });
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.setAttribute("data-revealed", "true");
        observer.unobserve(entry.target);
      });
    }, {
      rootMargin: "0px 0px -8% 0px",
      threshold: 0.08
    });
    items.forEach(function (item) {
      observer.observe(item);
    });
  }

  function setupStartChooser() {
    var chooser = doc.querySelector("[data-start-chooser]");
    if (!chooser) return;

    var needStep = chooser.querySelector('[data-start-step="need"]');
    var detailStep = chooser.querySelector('[data-start-step="detail"]');
    var question = chooser.querySelector("[data-start-question]");
    var options = chooser.querySelector("[data-start-options]");
    var result = chooser.querySelector("[data-start-result]");
    var resultTitle = chooser.querySelector("[data-start-result-title]");
    var resultCopy = chooser.querySelector("[data-start-result-copy]");
    var resultAction = chooser.querySelector("[data-start-result-action]");
    var firstPath = chooser.querySelector("[data-start-path]");
    var detailTrail = [];
    var revealGeneration = 0;

    doc.documentElement.classList.add("start-chooser-page");

    if (
      !needStep
      || !detailStep
      || !question
      || !options
      || !result
      || !resultTitle
      || !resultCopy
      || !resultAction
      || !firstPath
    ) return;

    chooser.hidden = false;

    var pathChoices = {
      website: {
        question: "Is this a new website or a replacement?",
        options: [
          {
            key: "website-new",
            label: "A new website",
            note: "There is no existing website to replace: no URLs need preserving, no content needs migrating, and no provider cutover needs managing. Brochure copy or brand facts can still be entered manually."
          },
          {
            key: "website-replace",
            label: "Replace an existing site",
            note: "Something already exists and the change may involve migration or cutover."
          }
        ]
      },
      "website-new": {
        question: "How do you want the new website made?",
        options: [
          {
            key: "custom",
            label: "Make it for me",
            note: "I want professional judgment, art direction, delivery, or a human revision loop."
          },
          {
            key: "website-self-service",
            label: "Let me make one bounded page",
            note: "I will enter the facts or reusable source material manually; no existing URLs need preserving, no content needs migrating, and no provider cutover needs managing."
          }
        ]
      },
      "website-self-service": {
        question: "Does the exact self-service boundary fit?",
        options: [
          {
            key: "abracadabra",
            label: "Yes · no live-site replacement risk",
            note: "One page and manual entry fit; no existing URLs need preserving, no content needs migrating, no provider cutover needs managing, and no integrations or human revision are required."
          },
          {
            key: "self-service-uncertain",
            label: "I am not completely sure",
            note: "Keep the decision with a person instead of risking lost content or URLs."
          }
        ]
      },
      "website-replace": {
        question: "What must survive or change?",
        options: [
          {
            key: "replace-redirects",
            label: "Existing URLs or search history",
            note: "I need an inventory, redirect map, or search-safe replacement."
          },
          {
            key: "replace-migration",
            label: "Existing pages, words, or media",
            note: "Content must be reviewed, moved, reshaped, or preserved."
          },
          {
            key: "replace-cutover",
            label: "Providers, integrations, or cutover",
            note: "The existing host, domain, forms, tools, or release timing matter."
          },
          {
            key: "replace-uncertain",
            label: "I do not know what must survive",
            note: "I want a human to inspect the replacement risk before choosing a product."
          }
        ]
      },
      system: {
        question: "Which handoff keeps falling through?",
        options: [
          {
            key: "hive-missed-call",
            label: "Missed calls",
            note: "A legitimate caller reaches nobody and the reason may disappear."
          },
          {
            key: "hive-booking",
            label: "Booking",
            note: "Service, timing, location, or confirmation needs a bounded handoff."
          },
          {
            key: "hive-review-request",
            label: "Review requests",
            note: "Eligible customers need one neutral, permission-aware request."
          },
          {
            key: "hive-after-hours",
            label: "After-hours questions",
            note: "People need approved facts without invented answers or urgency."
          },
          {
            key: "hive-follow-up",
            label: "Follow-up",
            note: "A promised next step keeps disappearing during the day."
          },
          {
            key: "hive-getting-paid",
            label: "Getting paid",
            note: "An exact invoice needs a factual reminder and dispute path."
          },
          {
            key: "commission",
            label: "A different workflow",
            note: "The channels, rules, or handoff need to fit my business."
          }
        ]
      },
      service: {
        question: "Which supporting job is closest?",
        options: [
          {
            key: "assessment",
            label: "Website assessment",
            note: "I want evidence and ranked findings before choosing repairs."
          },
          {
            key: "foundations",
            label: "Website foundations",
            note: "Structure, accessibility, speed, metadata, or release quality."
          },
          {
            key: "care",
            label: "Care",
            note: "Maintenance, changes, monitoring, recovery, handoff, and exit."
          },
          {
            key: "domains",
            label: "Domains",
            note: "Buy, connect, renew, or transfer an address."
          },
          {
            key: "email",
            label: "Business email",
            note: "Addresses, routing, authentication, recovery, or migration."
          },
          {
            key: "commerce",
            label: "Commerce",
            note: "Catalog, buying, fulfillment, receipt, refund, or processor path."
          },
          {
            key: "interfaces",
            label: "Interfaces",
            note: "Focused controls for a phone, tablet, counter, kiosk, or display."
          },
          {
            key: "studio",
            label: "Studio",
            note: "Art direction, illustration, motion, editorial, or a campaign piece."
          },
          {
            key: "network",
            label: "Connections",
            note: "Listings, directories, referrals, resources, or community discovery."
          }
        ]
      }
    };

    var recommendations = {
      custom: {
        title: "Custom — made for you",
        copy: "Choose Custom when the work needs professional judgment, distinctive art direction, migration, integrations, or a human revision loop.",
        action: "Explore Custom",
        href: "/custom/"
      },
      abracadabra: {
        title: "Abracadabra — make it yourself",
        copy: "Make and download real HTML for one page from facts you enter in this device-local rehearsal. It neither hosts nor publicly publishes; it does not preserve existing URLs, migrate content, manage provider cutover, change DNS, add integrations, or include human revisions.",
        action: "Open the local Abracadabra path",
        href: "/abracadabra/"
      },
      "self-service-uncertain": {
        title: "Ask a human before choosing",
        copy: "If the one-page, manual-entry boundary is not certain, keep the decision with the studio. Nothing needs to be forced into Abracadabra.",
        action: "Contact the studio",
        href: "/contact/"
      },
      "replace-redirects": {
        title: "Custom — preserve the route",
        copy: "Existing URLs, redirects, and search history make this replacement work. Custom inventories what must survive and plans the cutover.",
        action: "Explore Custom",
        href: "/custom/"
      },
      "replace-migration": {
        title: "Custom — migrate the content",
        copy: "Existing pages, words, or media need human inventory, judgment, and migration. Abracadabra does not promise that work.",
        action: "Explore Custom",
        href: "/custom/"
      },
      "replace-cutover": {
        title: "Custom — plan the cutover",
        copy: "Provider changes, integrations, forms, domains, and release timing require an explicit migration and cutover plan.",
        action: "Explore Custom",
        href: "/custom/"
      },
      "replace-uncertain": {
        title: "Start with a human review",
        copy: "An uncertain replacement stays out of self-service until the existing URLs, content, providers, integrations, and cutover risks are understood.",
        action: "Contact the studio",
        href: "/contact/"
      },
      "hive-missed-call": {
        title: "Hive · Missed-call responder",
        copy: "Inspect the exact trigger, allowed acknowledgement, consent boundary, human handoff, and cell-level pause for an unanswered call.",
        action: "Inspect missed-call responder",
        href: "/hive/#missed-call"
      },
      "hive-booking": {
        title: "Hive · Booking guide",
        copy: "Inspect a booking handoff that keeps availability provisional and never claims confirmation without the exact provider receipt.",
        action: "Inspect booking guide",
        href: "/hive/#booking"
      },
      "hive-review-request": {
        title: "Hive · Review request",
        copy: "Inspect a neutral review request with eligibility, permission, suppression, and dispute boundaries visible.",
        action: "Inspect review request",
        href: "/hive/#review-request"
      },
      "hive-after-hours": {
        title: "Hive · After-hours information",
        copy: "Inspect a bounded information path that answers only from approved facts and routes uncertainty or urgency to a person.",
        action: "Inspect after-hours information",
        href: "/hive/#after-hours"
      },
      "hive-follow-up": {
        title: "Hive · Follow-up",
        copy: "Inspect a permission-aware follow-up that preserves the original purpose, owner, due time, and human decision path.",
        action: "Inspect follow-up",
        href: "/hive/#follow-up"
      },
      "hive-getting-paid": {
        title: "Hive · Getting-paid reminder",
        copy: "Inspect a factual invoice reminder that fails closed on disputes, credits, identity, or balance uncertainty.",
        action: "Inspect getting-paid reminder",
        href: "/hive/#getting-paid"
      },
      commission: {
        title: "Commission a working system",
        copy: "A commission is the better fit when the channels, rules, providers, interface, or handoff need to match the way your business actually works.",
        action: "Discuss the system",
        href: "/contact/"
      },
      assessment: {
        title: "Website assessment",
        copy: "Choose the assessment for written, severity-ranked findings with screenshot evidence before remediation is scoped.",
        action: "Explore the assessment",
        href: "/solutions/#assessment"
      },
      foundations: {
        title: "Website foundations",
        copy: "Choose foundations for structure, accessibility, performance, metadata, measurement, or release readiness.",
        action: "Explore foundations",
        href: "/solutions/#foundations"
      },
      care: {
        title: "Care",
        copy: "Choose Care for a named maintenance, change, monitoring, recovery, handoff, and exit arrangement.",
        action: "Explore Care",
        href: "/solutions/#care"
      },
      domains: {
        title: "Domains",
        copy: "Buy with you named as registrant, connect an address you own, manage renewal, plan a transfer, or license monthly use of a Site Sourcery-owned address.",
        action: "Explore Domains",
        href: "/solutions/#domains"
      },
      email: {
        title: "Business email",
        copy: "Choose business email for address roles, domain authentication, routing, recovery, migration, and exit documentation.",
        action: "Explore business email",
        href: "/solutions/#email"
      },
      commerce: {
        title: "Commerce",
        copy: "Choose Commerce for the catalog, buying, fulfillment, receipt, refund, and client-owned processor path.",
        action: "Explore Commerce",
        href: "/solutions/#commerce"
      },
      interfaces: {
        title: "Interfaces",
        copy: "Choose Interfaces for operator-centered controls, permission-aware states, visible failure, and a manual fallback.",
        action: "Explore Interfaces",
        href: "/solutions/#interfaces"
      },
      studio: {
        title: "Studio",
        copy: "Choose Studio for a focused art-direction, illustration, motion, editorial, campaign, or physical-to-digital piece.",
        action: "Explore Studio",
        href: "/solutions/#studio"
      },
      network: {
        title: "Connections",
        copy: "Choose Connections for local listings, directories, referrals, shared resources, or community discovery with removal explicit.",
        action: "Explore Connections",
        href: "/solutions/#network"
      }
    };

    function focusAndReveal(element) {
      var generation = ++revealGeneration;
      element.focus({ preventScroll: true });
      chooser.setAttribute("data-start-reveal", "pending");

      function correctPosition() {
        if (generation !== revealGeneration) return;
        if (!element.isConnected || element.hidden) {
          chooser.setAttribute("data-start-reveal", "failed");
          return;
        }
        var header = doc.querySelector("[data-header]");
        var headerBottom = header ? header.getBoundingClientRect().bottom : 0;
        var clearTop = headerBottom + 8;
        var targetTop = headerBottom + 16;
        var bottomInset = 16;
        var rect = element.getBoundingClientRect();
        var visiblePixels = Math.max(
          0,
          Math.min(rect.bottom, window.innerHeight - bottomInset) - Math.max(rect.top, clearTop)
        );
        var requiredPixels = Math.min(rect.height, 88);
        if (rect.top < clearTop || visiblePixels < requiredPixels) {
          window.scrollTo({
            top: Math.max(0, window.scrollY + rect.top - targetTop),
            left: 0,
            behavior: "auto"
          });
        }

        rect = element.getBoundingClientRect();
        visiblePixels = Math.max(
          0,
          Math.min(rect.bottom, window.innerHeight - bottomInset) - Math.max(rect.top, clearTop)
        );
        var positionReady = rect.top >= clearTop
          && visiblePixels >= requiredPixels;
        chooser.setAttribute("data-start-reveal", positionReady ? "ready" : "failed");
      }

      correctPosition();
      window.requestAnimationFrame(correctPosition);
    }

    function showNeedStep(returnFocus) {
      detailTrail = [];
      needStep.hidden = false;
      detailStep.hidden = true;
      result.hidden = true;
      if (returnFocus) focusAndReveal(firstPath);
    }

    function renderDetail(path) {
      var choice = pathChoices[path];
      if (!choice) return;
      question.textContent = choice.question;
      options.replaceChildren();
      choice.options.forEach(function (option) {
        var button = doc.createElement("button");
        var label = doc.createElement("strong");
        var note = doc.createElement("small");
        button.type = "button";
        button.setAttribute("data-start-answer", option.key);
        label.textContent = option.label;
        note.textContent = option.note;
        button.append(label, note);
        options.append(button);
      });
      needStep.hidden = true;
      result.hidden = true;
      detailStep.hidden = false;
      focusAndReveal(question);
    }

    function showDetail(path, resetTrail) {
      if (!pathChoices[path]) return;
      if (resetTrail) detailTrail = [path];
      else detailTrail.push(path);
      renderDetail(path);
    }

    function showPreviousDetail() {
      if (detailTrail.length <= 1) {
        showNeedStep(true);
        return;
      }
      detailTrail.pop();
      renderDetail(detailTrail[detailTrail.length - 1]);
    }

    function showRecommendation(key) {
      var recommendation = recommendations[key];
      if (!recommendation) return;
      resultTitle.textContent = recommendation.title;
      resultCopy.textContent = recommendation.copy;
      resultAction.textContent = recommendation.action;
      resultAction.setAttribute("href", recommendation.href);
      needStep.hidden = true;
      detailStep.hidden = true;
      result.hidden = false;
      focusAndReveal(result);
    }

    chooser.addEventListener("click", function (event) {
      var path = event.target.closest("[data-start-path]");
      if (path && chooser.contains(path)) {
        event.preventDefault();
        showDetail(path.getAttribute("data-start-path"), true);
        return;
      }
      var answer = event.target.closest("[data-start-answer]");
      if (answer && chooser.contains(answer)) {
        var answerKey = answer.getAttribute("data-start-answer");
        if (pathChoices[answerKey]) showDetail(answerKey, false);
        else showRecommendation(answerKey);
        return;
      }
      if (event.target.closest("[data-start-back]")) {
        showPreviousDetail();
        return;
      }
      if (event.target.closest("[data-start-restart]")) {
        showNeedStep(true);
      }
    });

    showNeedStep(false);
  }

  function setupSolutionShelf() {
    var shelf = doc.getElementById("service-shelf");
    if (!shelf) return;

    function openTarget(hash) {
      if (!hash || hash === "#service-shelf") return;
      var id;
      try {
        id = decodeURIComponent(hash.slice(1));
      } catch (_error) {
        return;
      }
      var target = doc.getElementById(id);
      if (!target || !target.hasAttribute("data-solution-anchor")) return;
      var disclosure = target.querySelector("[data-solution-disclosure]");
      if (disclosure) disclosure.open = true;
    }

    doc.addEventListener("click", function (event) {
      var link = event.target.closest('a[href^="#"]');
      if (!link) return;
      openTarget(link.getAttribute("href"));
    });
    window.addEventListener("hashchange", function () {
      openTarget(window.location.hash);
    });
    openTarget(window.location.hash);
  }

  function setupDeepLinkedDisclosures() {
    function openTarget(hash) {
      if (!hash || hash === "#") return;
      var id;
      try {
        id = decodeURIComponent(hash.slice(1));
      } catch (_error) {
        return;
      }
      var target = doc.getElementById(id);
      if (!target || !target.matches("details[data-faq-anchor]")) return;
      target.open = true;
    }

    doc.addEventListener("click", function (event) {
      var link = event.target.closest('.faq-anchor-nav a[href^="#"]');
      if (!link) return;
      openTarget(link.getAttribute("href"));
    });
    window.addEventListener("hashchange", function () {
      openTarget(window.location.hash);
    });
    openTarget(window.location.hash);
  }

  function watchAbracadabraBoot() {
    var status = doc.getElementById("spark-boot-status");
    var maker = doc.getElementById("spark-maker");
    if (!status || !maker) return;
    var openingMessage = status.textContent;
    window.setTimeout(function () {
      var locked = maker.inert || maker.getAttribute("aria-disabled") !== "false";
      if (!locked || status.textContent !== openingMessage) return;
      status.textContent = "Abracadabra did not finish opening. Reload this page to try again.";
    }, 4000);
  }

  markCurrentNavigation();
  setupMenu();
  setupStartChooser();
  setupSolutionShelf();
  setupDeepLinkedDisclosures();
  watchAbracadabraBoot();
  watchHeader();
  revealSections();
}());
