(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SiteSourceryCareCatalog = api;
}(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  var LABELS = { plan_host: "Host", plan_care_lite: "Care Lite", plan_care: "Care", plan_care_plus: "Care Plus", plan_partner: "Partner" };
  var FIELDS = { siteUrl: "Website URL", hosting: "Hosting responsibilities", monitoring: "Monitoring responsibilities", backups: "Backup responsibilities", includedWork: "Included work", responseTarget: "Response target", outsideCosts: "Outside costs and responsibilities" };
  function money(n) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n / 100); }
  function date(value) { return value ? new Date(value).toLocaleString() : "Not recorded"; }
  function checkoutUrl(value) {
    try { var u = new URL(value); return u.protocol === "https:" && u.hostname === "checkout.stripe.com" && !u.username && !u.password && !u.hash ? u.href : null; } catch (_) { return null; }
  }
  function validate(snapshot, organizationId) {
    if (!snapshot || snapshot.schema !== "sitesourcery.care-agreements/v1" || snapshot.organizationId !== organizationId ||
        ![snapshot.eligibleProjects, snapshot.offers, snapshot.agreements].every(Array.isArray) ||
        snapshot.catalog?.schema !== "sitesourcery.care-catalog/v1" || !Array.isArray(snapshot.catalog.plans) ||
        snapshot.catalog.legalAuthority?.schema !== "sitesourcery.project-legal-authority/v7" ||
        typeof snapshot.catalog.acceptanceStatement !== "string" || !snapshot.readiness) throw new Error("Care details could not be verified. Refresh before continuing.");
    var bad = function () { throw new Error("Care details could not be verified. Refresh before continuing."); };
    var validPlan = function (p) { return p && Object.hasOwn(LABELS,p.planId) && p.currency === "USD" && p.billingCadence === "month" && [p.monthlyAmountMinor,p.includedMinutes,p.editCap].every(function (n) { return Number.isSafeInteger(n) && n >= 0; }); };
    if (!snapshot.catalog.plans.every(validPlan) || snapshot.offers.length > 100 || snapshot.agreements.length > 100 || !snapshot.eligibleProjects.every(function (p) { return UUID.test(p.projectId) && typeof p.name === "string"; })) bad();
    snapshot.offers.forEach(function (o) { if (!UUID.test(o.offerId) || o.organizationId !== organizationId || !UUID.test(o.projectId) || !validPlan(o.plan) || !/^[a-f0-9]{64}$/.test(o.offerDigest) || !o.writtenPlan || typeof o.acceptanceStatement !== "string" || !Number.isFinite(Date.parse(o.expiresAt))) bad(); });
    snapshot.agreements.forEach(function (a) {
      if (!UUID.test(a.agreementId) || a.organizationId !== organizationId || !UUID.test(a.projectId) || !validPlan(a.plan) || !a.writtenPlan || !["awaiting_payment","active","cancellation_pending","cancelled","past_due","suspended"].includes(a.state) || ![a.requests,a.periods,a.attempts].every(Array.isArray)) bad();
      if (a.currentPeriodId !== null && !UUID.test(a.currentPeriodId)) bad();
      if (a.capacity && ![a.capacity.minutes,a.capacity.usedMinutes,a.capacity.edits,a.capacity.usedEdits].every(function (n) { return Number.isSafeInteger(n) && n >= 0; })) bad();
      a.requests.forEach(function (r) { if (!UUID.test(r.requestId) || r.agreementId !== a.agreementId || !UUID.test(r.periodId) || !Number.isSafeInteger(r.revision) || r.revision < 1 || !Number.isSafeInteger(r.minutes) || r.minutes < 0 || !["requested","in_progress","completed","declined"].includes(r.state)) bad(); });
    });
    return snapshot;
  }
  function createWorkspace(options) {
    var doc = options.documentRef, container = options.container, client = options.client, api = options.api;
    var owner = options.audience === "operator", org = options.organizationId;
    if (!UUID.test(org) || !doc || !container || !client || !api) throw new Error("A signed-in Care workspace is required.");
    var base = owner ? "/operator/care/organizations/" + org : "/care";
    var snapshot = null, generation = 0, closed = false, busy = false, uncertain = null;
    var root = el("section", "care-catalog"), status = el("p", "care-catalog-status"), retry = el("div", "care-catalog-retry"), body = el("div", "care-catalog-body");
    status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    root.append(el("h2", "", owner ? "Care plans and work" : "Your Care plans"));
    root.append(el("p", "", "Care starts with a written plan for your completed Custom website. Acceptance and payment are separate steps."));
    var refresh = button("Refresh Care", function () { load(); }); refresh.dataset.careRefresh = "true";
    root.append(refresh, status, retry, body); container.replaceChildren(root);
    function el(tag, cls, text) { var node = doc.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = String(text); return node; }
    function say(text, error) { if (closed) return; status.textContent = text; status.classList.toggle("is-error", !!error); }
    function button(label, action, write) { var b = el("button", "", label); b.type = "button"; if (write) b.dataset.careWrite = "true"; b.addEventListener("click", action); return b; }
    function sync() { root.querySelectorAll("[data-care-write]").forEach(function (b) { b.disabled = busy || !!uncertain || b.dataset.unavailable === "true"; }); refresh.disabled = busy; }
    function control(form, name, label, type, choices, initial) {
      var wrap = el("label", "care-catalog-field"), node;
      if (choices) { node = el("select"); choices.forEach(function (entry) { var o = el("option", "", entry.label); o.value = entry.value; node.append(o); }); }
      else node = el(type === "textarea" ? "textarea" : "input");
      if (!choices && type !== "textarea") node.type = type || "text";
      node.name = name; node.required = true;
      if (type === "textarea") { node.minLength = 10; node.maxLength = 2000; node.rows = 3; }
      if (initial !== undefined) node.value = initial;
      wrap.append(el("span", "", label), node); form.append(wrap); return node;
    }
    function form(label, fields, submit, unavailable) {
      var f = el("form", "care-catalog-form"); fields(f);
      var b = el("button", "", label); b.type = "submit"; b.dataset.careWrite = "true";
      if (unavailable) b.dataset.unavailable = "true";
      f.append(b); f.addEventListener("submit", function (event) { event.preventDefault(); if (!busy && !uncertain && !unavailable && f.reportValidity()) { try { submit(f); } catch (error) { say(error.message, true); } } });
      return f;
    }
    function val(f, key) { return String(f.elements.namedItem(key).value).trim(); }
    function details(parent, plan) {
      var list = el("dl", "care-catalog-details");
      Object.keys(FIELDS).forEach(function (key) { list.append(el("dt", "", FIELDS[key]), el("dd", "", plan[key])); });
      parent.append(list, el("p", "", "Renews monthly until cancelled. Cancel without a cancellation fee at the end of the paid month. Partial-month refunds apply only when required by law or the accepted plan. Additional work needs separate approval before any extra charge."));
    }
    function price(plan) { return (LABELS[plan.planId] || "Care") + " · " + money(plan.monthlyAmountMinor) + "/month"; }
    function projectName(id) { return snapshot.eligibleProjects.find(function (p) { return p.projectId === id; })?.name || "Custom website"; }
    function command(path, data, label) {
      if (closed || busy || uncertain) return;
      var crypto = options.crypto || doc.defaultView?.crypto;
      if (!crypto || typeof crypto.randomUUID !== "function") { say("A secure browser is required for this action.", true); return; }
      return send({ path: path, body: data, key: "care-" + crypto.randomUUID(), label: label });
    }
    async function send(record) {
      if (closed || busy) return;
      busy = true; retry.replaceChildren(); sync(); say(record.label + "…");
      var confirmed = false;
      try {
        await client.request("POST", record.path, { body: record.body, idempotencyKey: record.key, headers: { "X-SiteSourcery-Organization-Id": org } });
        confirmed = true; uncertain = null; say("Saved. Refreshing the verified Care state…");
      } catch (error) {
        if (closed) return;
        // Transport/server failure may occur after commit. Retain exact body and key;
        // no automatic replay, changed-input retry or fresh checkout is allowed.
        if (!error.status || error.status >= 500 || error.code === "CARE_RECONCILIATION_REQUIRED") {
          uncertain = record;
          retry.append(el("p", "", "The result is unconfirmed. Refresh to inspect it, or retry this exact action. Do not start another payment."));
          retry.append(button("Retry the same action", function () { send(record); }));
        }
        say(error.message || "Care could not confirm this action.", true);
      } finally { busy = false; if (!closed) sync(); }
      if (confirmed && !closed) await load();
    }
    function offerCard(offer) {
      var card = el("article", "care-catalog-card"); card.dataset.careOffer = "true";
      card.append(el("h3", "", price(offer.plan)), el("p", "", projectName(offer.projectId)), el("p", "", "Offer expires " + date(offer.expiresAt)));
      details(card, offer.writtenPlan);
      var available = !offer.voidedAt && !offer.acceptanceId && Date.parse(offer.expiresAt) > Date.now();
      if (!available) card.append(el("p", "", offer.voidedAt ? "Withdrawn: " + offer.voidReason : offer.acceptanceId ? "Accepted — see your agreement below." : "This offer has expired."));
      else if (owner) card.append(form("Withdraw offer", function (f) { control(f, "reason", "Reason shown to the customer", "textarea"); }, function (f) { command(base + "/offers/" + offer.offerId + "/void", { reason: val(f, "reason") }, "Withdrawing offer"); }));
      else {
        var terms = el("div", "care-catalog-terms");
        // Validate the exact legal authority using the same canonical client as all
        // existing customer agreements. Links never come from an arbitrary plan URL.
        var legal = api.projectLegalAcceptanceFromAuthority(offer.legalAuthority);
        legal.documents.forEach(function (d) { var a = el("a", "", d.kind === "privacy" ? "Privacy notice" : d.kind === "website" ? "Website terms" : "Product terms"); a.href = d.contentUri; a.target = "_blank"; a.rel = "noopener noreferrer"; terms.append(a); });
        card.append(terms, form("Accept this written plan", function (f) {
          var check = control(f, "accept", offer.acceptanceStatement + " I have read the linked terms and acknowledge the privacy notice.", "checkbox"); check.dataset.careAcceptance = "true";
        }, function (f) {
          if (!f.elements.namedItem("accept").checked) return;
          command("/care/offers/" + offer.offerId + "/acceptance", { expectedOfferDigest: offer.offerDigest, acceptanceStatement: offer.acceptanceStatement, legalAcceptance: legal }, "Accepting written plan");
        }));
        card.append(el("p", "", "Accepting records your agreement. It does not charge you or start paid Care. Payment is a separate action."));
      }
      return card;
    }
    function agreementCard(a) {
      var card = el("article", "care-catalog-card"); card.dataset.careAgreement = "true";
      var labels = { awaiting_payment: "Awaiting payment", active: "Active paid Care", cancellation_pending: "Cancels at the end of the paid month", cancelled: "Cancelled", past_due: "Payment needs attention", suspended: "Care paused — payment needs review" };
      card.append(el("h3", "", price(a.plan)), el("p", "", projectName(a.projectId)), el("strong", "care-catalog-state", labels[a.state] || "Status unavailable"));
      if (a.paidThrough) card.append(el("p", "", "Verified paid period ends " + date(a.paidThrough)));
      if (a.cancelRequestedAt && !a.cancelAtPeriodEnd && !a.cancelledAt) card.append(el("p", "", "Cancellation requested. Provider confirmation is pending."));
      var scope = el("details"); scope.append(el("summary", "", "Your accepted responsibilities and terms")); details(scope, a.writtenPlan); card.append(scope);
      if (a.capacity) card.append(el("p", "", a.capacity.usedMinutes + " of " + a.capacity.minutes + " included minutes used; " + a.capacity.usedEdits + " of " + a.capacity.edits + " requests used this paid period. No automatic overage charges."));
      var active = ["active", "cancellation_pending"].includes(a.state) && a.currentPeriodId;
      var pending = a.attempts.find(function (attempt) { return attempt.state !== "expired"; });
      if (!owner && a.state === "awaiting_payment" && !a.cancelRequestedAt) {
        if (!pending) {
          var checkout = button("Continue to monthly payment", function () { command("/care/agreements/" + a.agreementId + "/checkout", {}, "Preparing secure checkout"); }, true);
          checkout.dataset.unavailable = String(snapshot.readiness.commercialReady !== true); card.append(checkout);
          if (!snapshot.readiness.commercialReady) card.append(el("p", "", "New Care payments are currently unavailable. Your accepted plan is saved."));
        } else {
          var url = checkoutUrl(pending.checkoutUrl);
          if (pending.state === "ready" && url && Date.parse(pending.expiresAt) > Date.now()) {
            var link = el("a", "care-catalog-checkout", "Open your existing secure checkout"); link.href = url; link.rel = "noopener noreferrer"; card.append(link);
          } else card.append(el("p", "", "A checkout already exists or its result is uncertain. Check payment status before starting another."));
        }
      }
      if (pending || a.state !== "awaiting_payment") card.append(button("Check payment status", function () { command((owner ? base : "/care") + "/agreements/" + a.agreementId + "/reconciliation", {}, "Checking payment status"); }, true));
      if (!owner && a.state !== "cancelled" && !a.cancelAtPeriodEnd) card.append(form(a.cancelRequestedAt ? "Confirm pending cancellation" : "Cancel at paid-month end", function (f) { control(f, "confirm", "I want to stop future monthly renewals. Any already-paid service remains through its paid month.", "checkbox"); }, function (f) { if (f.elements.namedItem("confirm").checked) command("/care/agreements/" + a.agreementId + "/cancellation", {}, "Requesting cancellation"); }));
      if (!owner && active && a.capacity && a.capacity.minutes > a.capacity.usedMinutes && a.capacity.usedEdits < a.capacity.edits) card.append(form("Send Care request", function (f) { control(f, "summary", "Describe the included work you need. Do not include passwords or credentials.", "textarea"); }, function (f) { command("/care/agreements/" + a.agreementId + "/requests", { summary: val(f, "summary") }, "Recording Care request"); }));
      card.append(el("h4", "", "Work requests"));
      if (!a.requests.length) card.append(el("p", "", "No work requests have been recorded."));
      a.requests.forEach(function (r) {
        var item = el("section", "care-catalog-request"); item.append(el("h5", "", r.summary), el("p", "", r.state.replaceAll("_", " ") + " · " + r.minutes + " minutes"));
        if (r.ownerNote) item.append(el("p", "", r.ownerNote));
        if (owner && active && r.periodId === a.currentPeriodId && !["completed", "declined"].includes(r.state)) item.append(form("Save work update", function (f) {
          control(f, "state", "Work state", "select", [{value:"in_progress",label:"In progress"},{value:"completed",label:"Completed"},{value:"declined",label:"Declined — no work performed"}], r.state === "requested" ? "in_progress" : r.state);
          var minutes = control(f, "minutes", "Total minutes spent on this request (cumulative)", "number", null, r.minutes); minutes.min = r.minutes; minutes.max = a.plan.includedMinutes; minutes.step = "1";
          control(f, "note", "Customer-visible work note", "textarea", null, r.ownerNote || "");
        }, function (f) { command(base + "/agreements/" + a.agreementId + "/requests/" + r.requestId + "/work", { expectedRevision: r.revision, state: val(f, "state"), minutes: Number(val(f, "minutes")), note: val(f, "note") }, "Saving work update"); }));
        card.append(item);
      });
      var periods = el("details"); periods.append(el("summary", "", "Verified payment periods"));
      a.periods.forEach(function (p) { periods.append(el("p", "", date(p.startsAt) + " – " + date(p.endsAt) + " · " + money(p.amountMinor) + (p.invalidatedAt ? " · payment reversed or under review" : " · verified paid"))); });
      if (!a.periods.length) periods.append(el("p", "", "No verified paid period yet.")); card.append(periods); return card;
    }
    function render() {
      body.replaceChildren();
      if (snapshot.readiness.ready !== true || snapshot.readiness.verified !== true) { body.append(el("p", "", "Care storage is temporarily unavailable. Refresh before continuing.")); return; }
      var catalog = el("details", "care-catalog-plans"); catalog.append(el("summary", "", "Monthly plans and included capacity"));
      snapshot.catalog.plans.forEach(function (p) { catalog.append(el("p", "", price(p) + " · " + p.includedMinutes + " minutes / " + p.editCap + " requests. Responsibilities are defined in your written offer.")); }); body.append(catalog);
      if (owner) {
        var offer = el("section", "care-catalog-card"); offer.append(el("h3", "", "Prepare a written offer"));
        if (!snapshot.eligibleProjects.length) offer.append(el("p", "", "No eligible completed Custom websites in this organization. A completed handoff and current customer membership are required."));
        else offer.append(form("Issue written offer", function (f) {
          control(f, "projectId", "Completed Custom website", "select", snapshot.eligibleProjects.map(function (p) { return {value:p.projectId,label:p.name}; }));
          control(f, "planId", "Monthly Care plan", "select", snapshot.catalog.plans.map(function (p) { return {value:p.planId,label:price(p)}; }));
          Object.keys(FIELDS).forEach(function (key) { control(f, key, FIELDS[key], key === "siteUrl" ? "url" : "textarea"); });
          control(f, "expiresAt", "Offer expiry (your local time, within 30 days)", "datetime-local");
          f.append(el("p", "", "Write the actual agreed responsibilities. Do not put credentials in the plan. Issuing an offer does not charge the customer or activate Care."));
        }, function (f) {
          var writtenPlan = {}; Object.keys(FIELDS).forEach(function (key) { writtenPlan[key] = val(f, key); });
          command(base + "/offers", { projectId:val(f,"projectId"), planId:val(f,"planId"), writtenPlan:writtenPlan, expiresAt:new Date(val(f,"expiresAt")).toISOString() }, "Issuing written offer");
        })); body.append(offer);
      }
      body.append(el("h3", "", "Written offers"));
      if (!snapshot.offers.length) body.append(el("p", "", "No written Care offers yet. Contact Site Sourcery to agree on responsibilities for your completed Custom website."));
      snapshot.offers.forEach(function (o) { body.append(offerCard(o)); });
      body.append(el("h3", "", "Agreements and paid work"));
      if (!snapshot.agreements.length) body.append(el("p", "", "No Care agreements yet."));
      snapshot.agreements.forEach(function (a) { body.append(agreementCard(a)); }); sync();
    }
    async function load() {
      if (closed) return; var current = ++generation; say("Loading Care…");
      try {
        var value = await client.request("GET", owner ? base + "/catalog" : "/care/agreements", { headers:{"X-SiteSourcery-Organization-Id":org} });
        if (closed || current !== generation) return;
        snapshot = validate(value, org); render(); say(uncertain ? "Care refreshed. The earlier action is still unconfirmed; retry only that same action." : "Care details are current.");
      } catch (error) { if (!closed && current === generation) { body.replaceChildren(); say(error.message || "Care is temporarily unavailable.", true); } }
    }
    return Object.freeze({ load:load, destroy:function () { closed = true; generation += 1; container.replaceChildren(); } });
  }
  return Object.freeze({ createWorkspace:createWorkspace, checkoutUrl:checkoutUrl, validate:validate });
}));
