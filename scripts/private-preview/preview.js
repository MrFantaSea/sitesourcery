(function () {
  "use strict";

  var documentElement = document.documentElement;
  documentElement.classList.add("has-js");

  var menuButton = document.querySelector("[data-menu-button]");
  var menu = document.querySelector("[data-menu]");
  if (menuButton && menu) {
    function setMenu(open, restoreFocus) {
      menuButton.setAttribute("aria-expanded", String(open));
      menu.toggleAttribute("data-open", open);
      documentElement.toggleAttribute("data-menu-open", open);
      if (open) {
        window.requestAnimationFrame(function () {
          var firstLink = menu.querySelector("a");
          if (firstLink) firstLink.focus();
        });
      } else if (restoreFocus) {
        menuButton.focus();
      }
    }
    menuButton.addEventListener("click", function () {
      setMenu(menuButton.getAttribute("aria-expanded") !== "true", false);
    });
    menu.addEventListener("click", function (event) {
      if (!event.target.closest("a")) return;
      setMenu(false, false);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape" || menuButton.getAttribute("aria-expanded") !== "true") return;
      setMenu(false, true);
    });
    window.addEventListener("resize", function () {
      if (window.innerWidth > 928 && menuButton.getAttribute("aria-expanded") === "true") {
        setMenu(false, false);
      }
    });
  }

  var header = document.querySelector("[data-header]");
  function paintHeader() {
    if (header) header.toggleAttribute("data-scrolled", window.scrollY > 18);
  }
  paintHeader();
  window.addEventListener("scroll", paintHeader, { passive: true });

  var maker = document.querySelector("[data-maker]");
  var vibeCopy = {
    clear: {
      heading: "Objects for a calmer room.",
      copy: "Plants, pottery, and useful pieces selected with a clear eye.",
      action: "Browse the collection"
    },
    warm: {
      heading: "A slower kind of Saturday.",
      copy: "Plants, pottery, and small-batch objects chosen to make a room feel lived in.",
      action: "Plan a visit"
    },
    arcane: {
      heading: "Curious things find curious homes.",
      copy: "Botanical oddities, storied objects, and quiet treasures for rooms with a point of view.",
      action: "Enter the collection"
    }
  };
  if (maker) {
    maker.querySelectorAll("[data-vibe]").forEach(function (button) {
      button.addEventListener("click", function () {
        var vibe = button.getAttribute("data-vibe");
        var content = vibeCopy[vibe];
        maker.setAttribute("data-vibe", vibe);
        maker.querySelectorAll(".vibe-tabs button").forEach(function (item) {
          item.classList.toggle("is-selected", item === button);
          item.setAttribute("aria-pressed", String(item === button));
        });
        maker.querySelector("[data-sample-heading]").textContent = content.heading;
        maker.querySelector("[data-phone-heading]").textContent = content.heading;
        maker.querySelector("[data-sample-copy]").textContent = content.copy;
        maker.querySelector("[data-sample-action]").textContent = content.action;
        maker.querySelector("[data-phone-action]").textContent = content.action;
        maker.querySelector("[data-review-vibe]").textContent =
          vibe.charAt(0).toUpperCase() + vibe.slice(1);
      });
    });
    var reviewButton = maker.querySelector("[data-review-page]");
    var editButton = maker.querySelector("[data-edit-page]");
    var review = maker.querySelector("[data-maker-review]");
    var makerStatus = maker.querySelector("[data-maker-state]");
    if (reviewButton && editButton && review && makerStatus) {
      reviewButton.addEventListener("click", function () {
        maker.setAttribute("data-reviewing", "");
        review.hidden = false;
        makerStatus.textContent = "Reviewing fictional page · not published";
        review.focus();
      });
      editButton.addEventListener("click", function () {
        maker.removeAttribute("data-reviewing");
        review.hidden = true;
        makerStatus.textContent = "Fictional data · not published";
        reviewButton.focus();
      });
    }
  }

  var workflow = document.querySelector("[data-workflow]");
  if (workflow) {
    var run = workflow.querySelector("[data-run]");
    var pause = workflow.querySelector("[data-pause]");
    var reset = workflow.querySelector("[data-reset]");
    var label = workflow.querySelector("[data-state-label]");
    var note = workflow.querySelector("[data-workflow-note]");
    var receipt = workflow.querySelector("[data-workflow-receipt]");
    var steps = Array.prototype.slice.call(workflow.querySelectorAll("[data-workflow-step]"));
    var timer = null;
    var currentStep = 0;
    var state = "ready";

    function clearWorkflowTimer() {
      if (timer === null) return;
      window.clearTimeout(timer);
      timer = null;
    }

    function paintWorkflow(nextState) {
      state = nextState;
      workflow.setAttribute("data-state", state);
      workflow.setAttribute("data-step", String(currentStep));
      steps.forEach(function (step, index) {
        step.toggleAttribute("data-complete", index < currentStep);
        step.toggleAttribute("data-active", state === "running" && index === currentStep);
      });
      pause.disabled = state === "ready" || state === "complete";
      pause.setAttribute("aria-pressed", String(state === "paused"));
      run.disabled = state === "running" || state === "paused";
      receipt.hidden = state !== "complete";

      if (state === "ready") {
        label.innerHTML = "<i></i> Ready to demonstrate";
        run.innerHTML = "<span aria-hidden=\"true\">▶</span> Run local demonstration";
        pause.innerHTML = "<span aria-hidden=\"true\">Ⅱ</span> Pause demonstration";
        note.textContent = "No outside message is sent. The sequence exists only in this browser tab.";
      } else if (state === "running") {
        label.innerHTML = "<i></i> Local step " + String(Math.min(currentStep + 1, steps.length)) + " of " + String(steps.length);
        pause.innerHTML = "<span aria-hidden=\"true\">Ⅱ</span> Pause demonstration";
        note.textContent = "The highlighted step is simulated locally. No provider or customer is contacted.";
      } else if (state === "paused") {
        label.innerHTML = "<i></i> Paused safely";
        pause.innerHTML = "<span aria-hidden=\"true\">▶</span> Resume demonstration";
        note.textContent = "The local sequence is stopped. Completed steps remain visible.";
      } else {
        label.innerHTML = "<i></i> Demonstration complete";
        run.innerHTML = "<span aria-hidden=\"true\">↻</span> Run again";
        pause.innerHTML = "<span aria-hidden=\"true\">Ⅱ</span> Pause demonstration";
        note.textContent = "Receipt complete. No outside message was sent.";
      }
    }

    function advanceWorkflow() {
      clearWorkflowTimer();
      if (state !== "running") return;
      timer = window.setTimeout(function () {
        timer = null;
        currentStep += 1;
        if (currentStep >= steps.length) {
          paintWorkflow("complete");
          return;
        }
        paintWorkflow("running");
        advanceWorkflow();
      }, 850);
    }

    function resetWorkflow() {
      clearWorkflowTimer();
      currentStep = 0;
      paintWorkflow("ready");
    }

    run.addEventListener("click", function () {
      if (state === "complete") resetWorkflow();
      currentStep = 0;
      paintWorkflow("running");
      advanceWorkflow();
    });

    pause.addEventListener("click", function () {
      if (state === "running") {
        clearWorkflowTimer();
        paintWorkflow("paused");
      } else if (state === "paused") {
        paintWorkflow("running");
        advanceWorkflow();
      }
    });
    reset.addEventListener("click", resetWorkflow);
    paintWorkflow("ready");
  }

  var chooser = document.querySelector("[data-chooser]");
  if (chooser) {
    var needStep = chooser.querySelector('[data-chooser-step="need"]');
    var detailStep = chooser.querySelector('[data-chooser-step="detail"]');
    var chooserQuestion = chooser.querySelector("[data-chooser-question]");
    var chooserOptions = chooser.querySelector("[data-chooser-options]");
    var chooserResult = chooser.querySelector("[data-chooser-result]");
    var resultTitle = chooser.querySelector("[data-result-title]");
    var resultCopy = chooser.querySelector("[data-result-copy]");
    var resultAction = chooser.querySelector("[data-result-action]");
    var pathChoices = {
      website: {
        question: "Who should own the making decisions?",
        options: [
          { key: "custom", label: "Make it for me", note: "I want professional judgment, art direction, and delivery." },
          { key: "abracadabra", label: "Let me make it", note: "I want a guided product and direct control." }
        ]
      },
      system: {
        question: "Is this the ready-made After-Hours job or a custom fit?",
        options: [
          { key: "after-hours", label: "After-Hours fits", note: "The accepted reply and owner handoff match the job." },
          { key: "commission", label: "My workflow is different", note: "The channels, rules, data, or handoff need to fit my business." }
        ]
      },
      service: {
        question: "Which supporting job is closest?",
        options: [
          { key: "domains", label: "A domain", note: "Buy, connect, renew, or transfer an address." },
          { key: "temporary", label: "A temporary site", note: "Rent a public or private pop-up site and address for a fixed term." },
          { key: "care", label: "Care or setup", note: "Keep a site healthy or establish the business foundations." },
          { key: "studio", label: "Specialist work", note: "A focused interface, migration, rescue, or partner commission." }
        ]
      }
    };
    var recommendations = {
      custom: {
        title: "Custom — made for you",
        copy: "Start with Custom when the work needs professional judgment, a distinctive visual language, migration, integrations, or a human revision loop.",
        action: "Explore Custom",
        href: "#custom"
      },
      abracadabra: {
        title: "Abracadabra — make it yourself",
        copy: "Start with Abracadabra when you can supply the facts and want a guided way to shape, review, publish, and keep control of the site.",
        action: "Explore Abracadabra",
        href: "#maker"
      },
      "after-hours": {
        title: "Hive · After-Hours",
        copy: "Inspect the ready-made After-Hours path when an approved reply and a clear owner handoff solve the real problem without inventing a broader workflow.",
        action: "See the demonstration",
        href: "#systems"
      },
      commission: {
        title: "Commission a working system",
        copy: "A commission is the honest path when the channels, rules, providers, interface, or handoff need to fit the way your business actually works.",
        action: "See the Hive pattern",
        href: "#systems"
      },
      domains: {
        title: "Domains",
        copy: "Choose Domains to buy or connect an address, manage renewal, bring a domain in, or leave with it later.",
        action: "See Domains",
        href: "#services"
      },
      temporary: {
        title: "Temporary sites",
        copy: "Choose a fixed-term pop-up site when the public or private digital place should have a deliberate beginning, address, and ending.",
        action: "See temporary sites",
        href: "#services"
      },
      care: {
        title: "Care & business foundations",
        copy: "Choose this path for monitoring, backups, updates, support, email, forms, search, analytics, commerce, or provider setup.",
        action: "See the service shelf",
        href: "#services"
      },
      studio: {
        title: "Studio & Interfaces",
        copy: "Choose specialist work for a focused tool, rescue, migration, integration, or website-specific partner commission.",
        action: "See the service shelf",
        href: "#services"
      }
    };

    function showNeedStep() {
      needStep.hidden = false;
      detailStep.hidden = true;
      chooserResult.hidden = true;
      var firstChoice = needStep.querySelector("[data-chooser-path]");
      if (firstChoice) firstChoice.focus();
    }

    function showDetail(path) {
      var choice = pathChoices[path];
      if (!choice) return;
      chooserQuestion.textContent = choice.question;
      chooserOptions.replaceChildren();
      choice.options.forEach(function (option) {
        var button = document.createElement("button");
        var strong = document.createElement("strong");
        var small = document.createElement("small");
        button.type = "button";
        button.setAttribute("data-chooser-answer", option.key);
        strong.textContent = option.label;
        small.textContent = option.note;
        button.append(strong, small);
        chooserOptions.append(button);
      });
      needStep.hidden = true;
      chooserResult.hidden = true;
      detailStep.hidden = false;
      chooserQuestion.setAttribute("tabindex", "-1");
      chooserQuestion.focus();
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
      chooserResult.hidden = false;
      chooserResult.focus();
    }

    chooser.addEventListener("click", function (event) {
      var pathButton = event.target.closest("[data-chooser-path]");
      if (pathButton) {
        showDetail(pathButton.getAttribute("data-chooser-path"));
        return;
      }
      var answerButton = event.target.closest("[data-chooser-answer]");
      if (answerButton) {
        showRecommendation(answerButton.getAttribute("data-chooser-answer"));
        return;
      }
      if (event.target.closest("[data-chooser-back], [data-chooser-restart]")) {
        showNeedStep();
      }
    });
  }

  var reveals = Array.prototype.slice.call(document.querySelectorAll("[data-reveal]"));
  if (!("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    reveals.forEach(function (item) { item.setAttribute("data-visible", "true"); });
  } else {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.setAttribute("data-visible", "true");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.08, rootMargin: "0px 0px -5% 0px" });
    reveals.forEach(function (item) { observer.observe(item); });
  }
}());
