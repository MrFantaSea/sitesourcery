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
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return;
      var route = normalizePath(href);
      var selected = current === route;
      if (selected) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }

  function setupMenu() {
    var button = doc.querySelector("[data-menu-button]");
    var menu = doc.querySelector("[data-menu]");
    if (!button || !menu) return;

    var firstLink = menu.querySelector("a[href]");
    var pageRegions = Array.prototype.slice.call(doc.querySelectorAll("main, .site-footer, .site-brand"));
    var wideViewport = window.matchMedia("(min-width: 88.001rem)");

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
    root.classList.add("menu-ready");
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
      root.classList.add("reveal-ready");
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
    root.classList.add("reveal-ready");
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
        question: "How do you want the website made?",
        options: [
          {
            key: "made-for-you",
            label: "Make it for me",
            note: "I want a person to plan, design, build, test, and review the site with me."
          },
          {
            key: "abracadabra",
            label: "Let me build one page",
            note: "I will enter the facts and shape a private preview myself. Download is $20 once per editor project."
          },
          {
            key: "website-unsure",
            label: "I am not sure",
            note: "I want to compare the two paths or ask Zack before choosing."
          }
        ]
      },
      system: {
        question: "Which task needs attention?",
        options: [
          {
            key: "hive-missed-call",
            label: "Missed calls",
            note: "People call when nobody is available to answer."
          },
          {
            key: "hive-booking",
            label: "Booking",
            note: "Service, timing, location, or confirmation keeps getting lost."
          },
          {
            key: "hive-review-request",
            label: "Review requests",
            note: "I want to ask customers for a review after the work is done."
          },
          {
            key: "hive-after-hours",
            label: "After-hours questions",
            note: "Customers ask questions when the business is closed."
          },
          {
            key: "hive-follow-up",
            label: "Follow-up",
            note: "We forget to follow up when we said we would."
          },
          {
            key: "hive-getting-paid",
            label: "Getting paid",
            note: "An unpaid invoice needs a clear reminder and a way to raise a problem."
          },
          {
            key: "commission",
            label: "A different workflow",
            note: "I need help with a task that is not listed here."
          }
        ]
      },
      service: {
        question: "What kind of website help do you need?",
        options: [
          {
            key: "assessment",
            label: "Website assessment",
            note: "I want evidence and ranked findings before choosing repairs."
          },
          {
            key: "foundations",
            label: "Website fixes",
            note: "Structure, basic accessibility, speed, page information, or launch quality."
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
            note: "Addresses, delivery checks, routing, recovery, or moving mail."
          },
          {
            key: "commerce",
            label: "Selling online",
            note: "Products, buying, delivery, receipts, refunds, or a payment service."
          },
          {
            key: "interfaces",
            label: "Staff tools",
            note: "Focused controls for a phone, tablet, counter, kiosk, or screen."
          },
          {
            key: "studio",
            label: "Design and artwork",
            note: "Art direction, illustration, motion, editorial, or a campaign piece."
          },
          {
            key: "network",
            label: "Local listings",
            note: "Listings, directories, referrals, resources, or community discovery."
          }
        ]
      }
    };

    var recommendations = {
      "made-for-you": {
        title: "A made-for-you website",
        copy: "Choose this path for original design, more than one page, outside tools, or an old site that needs a careful replacement. Scope and price come in writing before paid work begins.",
        action: "See made-for-you websites",
        href: "/websites/made-for-you/"
      },
      abracadabra: {
        title: "Build one page yourself",
        copy: "Build and preview privately for free. Download is $20 once per editor project, not per click or version. The full $20 is a one-time non-cash credit toward the same account and project's first separately released Alakazam invoice. The downloaded HTML may be modified and hosted anywhere you choose without repaying Site Sourcery.",
        action: "See the one-page maker",
        href: "/abracadabra/"
      },
      "website-unsure": {
        title: "Compare website options",
        copy: "See the made-for-you and build-it-yourself choices side by side, or contact Zack without choosing first.",
        action: "Compare website options",
        href: "/websites/"
      },
      "hive-missed-call": {
        title: "Hive · Missed-call responder",
        copy: "Review how missed calls could be followed up and when a person should take over.",
        action: "Review this task",
        href: "/hive/#missed-call"
      },
      "hive-booking": {
        title: "Hive · Booking guide",
        copy: "Review which details to collect before a person confirms a booking.",
        action: "Review this task",
        href: "/hive/#booking"
      },
      "hive-review-request": {
        title: "Hive · Review request",
        copy: "Review when to ask for a review, who may be contacted, and how requests can stop.",
        action: "Review this task",
        href: "/hive/#review-request"
      },
      "hive-after-hours": {
        title: "Hive · After-hours information",
        copy: "Review which questions can be answered after hours and which need a person.",
        action: "Review this task",
        href: "/hive/#after-hours"
      },
      "hive-follow-up": {
        title: "Hive · Follow-up",
        copy: "Review who should follow up, when, and what needs a personal decision.",
        action: "Review this task",
        href: "/hive/#follow-up"
      },
      "hive-getting-paid": {
        title: "Hive · Getting-paid reminder",
        copy: "Review when to remind a customer about an invoice and how to handle questions or disputes.",
        action: "Review this task",
        href: "/hive/#getting-paid"
      },
      commission: {
        title: "Ask about another business task",
        copy: "A separate project may fit when the messages, rules, outside services, controls, or handoff must match your business.",
        action: "Describe the task",
        href: "/contact/"
      },
      assessment: {
        title: "Website assessment",
        copy: "Choose the assessment for written findings, screenshots, and a clear order of importance before deciding on fixes.",
        action: "Explore the assessment",
        href: "/solutions/#assessment"
      },
      foundations: {
        title: "Website fixes",
        copy: "Ask about fixing page structure, phone layouts, accessibility, speed, or page titles.",
        action: "See website fixes",
        href: "/solutions/#foundations"
      },
      care: {
        title: "Care",
        copy: "Ask about a written Care plan covering upkeep, changes, monitoring, backups, and how to leave.",
        action: "Explore Care",
        href: "/solutions/#care"
      },
      domains: {
        title: "Domains",
        copy: "Ask whether help is available for registration, connection, renewal, or transfer. Ownership, price, and provider terms must be confirmed first.",
        action: "See possible domain help",
        href: "/solutions/#domains"
      },
      email: {
        title: "Business email",
        copy: "Ask about setting up business email, checking delivery, recovering access, or moving mail.",
        action: "Explore business email",
        href: "/solutions/#email"
      },
      commerce: {
        title: "Selling online",
        copy: "Ask about product pages and connecting a payment service your business controls.",
        action: "See help with selling online",
        href: "/solutions/#commerce"
      },
      interfaces: {
        title: "Staff tools",
        copy: "Ask about a focused screen with clear permissions, visible errors, and a manual backup.",
        action: "See staff tools",
        href: "/solutions/#interfaces"
      },
      studio: {
        title: "Design and artwork",
        copy: "Ask about one focused design, illustration, motion, story, campaign, or printed-and-digital piece.",
        action: "See design services",
        href: "/solutions/#studio"
      },
      network: {
        title: "Local listings",
        copy: "Ask about local listings, directories, referrals, shared resources, or community discovery.",
        action: "See local-listing help",
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
      needStep.hidden = true;
      detailStep.hidden = true;
      result.hidden = false;
      resultTitle.textContent = recommendation.title;
      resultCopy.textContent = recommendation.copy;
      resultAction.textContent = recommendation.action;
      resultAction.setAttribute("href", recommendation.href);
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
