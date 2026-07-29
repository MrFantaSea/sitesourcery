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
        question: "Is this a new website or a replacement?",
        options: [
          {
            key: "website-new",
            label: "A new website",
            note: "Nothing is being replaced. No old links or content need to move, and no host or domain switch is needed. You can still enter facts from a brochure or brand guide."
          },
          {
            key: "website-replace",
            label: "Replace an existing site",
            note: "A site already exists, so links, content, tools, hosting, or the domain may need a safe move."
          }
        ]
      },
      "website-new": {
        question: "How do you want the new website made?",
        options: [
          {
            key: "custom",
            label: "Make it for me",
            note: "I want professional planning, design, delivery, and human review."
          },
          {
            key: "website-self-service",
            label: "Let me make one page",
            note: "I will type in the facts myself. No old links or content need to move, and no host or domain switch is needed."
          }
        ]
      },
      "website-self-service": {
        question: "Does this one-page option fit?",
        options: [
          {
            key: "abracadabra",
            label: "Yes · nothing old needs replacing",
            note: "One page is enough. I can type the facts myself and do not need old links, content, outside tools, or human revisions."
          },
          {
            key: "self-service-uncertain",
            label: "I am not completely sure",
            note: "I want a person to check before I risk losing content or links."
          }
        ]
      },
      "website-replace": {
        question: "What must survive or change?",
        options: [
          {
            key: "replace-redirects",
            label: "Old links or search traffic",
            note: "Old page addresses need to keep working or point to the right new page."
          },
          {
            key: "replace-migration",
            label: "Existing pages, words, or media",
            note: "Content must be reviewed, moved, reshaped, or preserved."
          },
          {
            key: "replace-cutover",
            label: "Hosting, tools, or the switch",
            note: "The current host, domain, forms, tools, or launch timing matter."
          },
          {
            key: "replace-uncertain",
            label: "I do not know what must survive",
            note: "I want a person to check the old site before I choose."
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
            note: "Service, timing, location, or confirmation keeps getting lost."
          },
          {
            key: "hive-review-request",
            label: "Review requests",
            note: "The right customers need one fair request at the right time."
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
            note: "An unpaid invoice needs a clear reminder and a way to raise a problem."
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
            label: "Commerce",
            note: "Products, buying, delivery, receipts, refunds, or a payment service."
          },
          {
            key: "interfaces",
            label: "Interfaces",
            note: "Focused controls for a phone, tablet, counter, kiosk, or screen."
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
        copy: "Choose Custom when you want the site planned, designed, built, and reviewed with you, or when an old site must be replaced safely.",
        action: "See Custom websites",
        href: "/custom/"
      },
      abracadabra: {
        title: "Abracadabra — make it yourself",
        copy: "Make and download one real web page from facts you type into this browser. It does not put the page online, replace an old site, move content, change a domain, connect outside tools, or include human revisions.",
        action: "Try Abracadabra",
        href: "/abracadabra/"
      },
      "self-service-uncertain": {
        title: "Ask a human before choosing",
        copy: "If you are not sure one page and manual entry are enough, ask the studio to check first.",
        action: "Contact the studio",
        href: "/contact/"
      },
      "replace-redirects": {
        title: "Custom — protect old links",
        copy: "Old page addresses and search traffic need a careful list and redirect plan before the new site replaces the old one.",
        action: "See Custom websites",
        href: "/custom/"
      },
      "replace-migration": {
        title: "Custom — move the content",
        copy: "Existing pages, words, or images need a person to review what stays, what changes, and where it belongs.",
        action: "See Custom websites",
        href: "/custom/"
      },
      "replace-cutover": {
        title: "Custom — plan the switch",
        copy: "Hosting, forms, outside tools, domains, and launch timing need a written moving plan.",
        action: "See Custom websites",
        href: "/custom/"
      },
      "replace-uncertain": {
        title: "Start with a human review",
        copy: "Ask the studio to inspect the old links, content, hosting, tools, and domain before choosing how to replace the site.",
        action: "Contact the studio",
        href: "/contact/"
      },
      "hive-missed-call": {
        title: "Hive · Missed-call responder",
        copy: "See a plan for recording a missed call, sending an allowed reply, handing it to a person, and stopping the system.",
        action: "Inspect missed-call responder",
        href: "/hive/#missed-call"
      },
      "hive-booking": {
        title: "Hive · Booking guide",
        copy: "See a booking plan that treats times as open until the booking service confirms them.",
        action: "Inspect booking guide",
        href: "/hive/#booking"
      },
      "hive-review-request": {
        title: "Hive · Review request",
        copy: "See a fair review-request plan with clear timing, permission, stop rules, and a path for problems.",
        action: "Inspect review request",
        href: "/hive/#review-request"
      },
      "hive-after-hours": {
        title: "Hive · After-hours information",
        copy: "See an after-hours plan that uses approved facts and sends unclear or urgent questions to a person.",
        action: "Inspect after-hours information",
        href: "/hive/#after-hours"
      },
      "hive-follow-up": {
        title: "Hive · Follow-up",
        copy: "See a follow-up plan that keeps the reason, owner, due time, permission, and human decision clear.",
        action: "Inspect follow-up",
        href: "/hive/#follow-up"
      },
      "hive-getting-paid": {
        title: "Hive · Getting-paid reminder",
        copy: "See an invoice reminder plan that stops when the balance, identity, credit, or dispute is unclear.",
        action: "Inspect getting-paid reminder",
        href: "/hive/#getting-paid"
      },
      commission: {
        title: "Ask about a working system",
        copy: "A separate project may fit when the messages, rules, outside services, controls, or handoff must match your business.",
        action: "Discuss the system",
        href: "/contact/"
      },
      assessment: {
        title: "Website assessment",
        copy: "Choose the assessment for written findings, screenshots, and a clear order of importance before deciding on fixes.",
        action: "Explore the assessment",
        href: "/solutions/#assessment"
      },
      foundations: {
        title: "Website foundations",
        copy: "Ask about foundations for site structure, basic accessibility, speed, page information, measurement, or launch quality.",
        action: "Explore foundations",
        href: "/solutions/#foundations"
      },
      care: {
        title: "Care",
        copy: "Ask about Care for a written maintenance, change, monitoring, recovery, handoff, and exit agreement.",
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
        copy: "Ask about business email for role addresses, delivery checks, routing, recovery, moving mail, and exit notes.",
        action: "Explore business email",
        href: "/solutions/#email"
      },
      commerce: {
        title: "Commerce",
        copy: "Ask whether help is available for product pages and a path to a client-owned payment service.",
        action: "See possible commerce help",
        href: "/solutions/#commerce"
      },
      interfaces: {
        title: "Interfaces",
        copy: "Ask about a focused screen with clear permissions, visible errors, and a manual backup.",
        action: "Explore Interfaces",
        href: "/solutions/#interfaces"
      },
      studio: {
        title: "Studio",
        copy: "Ask about one focused design, illustration, motion, story, campaign, or printed-and-digital piece.",
        action: "Explore Studio",
        href: "/solutions/#studio"
      },
      network: {
        title: "Connections",
        copy: "Ask about local listings, directories, referrals, shared resources, or community discovery.",
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
