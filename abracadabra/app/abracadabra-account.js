(function () {
  "use strict";

  /**
   * The browser account, v1 (founder order, 2026-08-01).
   *
   * The account is created RIGHT BEFORE paying - it is what survives. Work
   * and the unlock live under it in this browser (localStorage) until the
   * platform era moves accounts to the server (task #21). Free visitors with
   * no account keep tab-only sessions: the no-account-no-persistence ruling,
   * exactly as written.
   *
   * This script runs BEFORE the app so the account's work and standing are
   * already seeded into the tab when the maker boots - the app itself needs
   * no knowledge of accounts.
   */

  var ACCOUNT_KEY = "abracadabra.account";
  var WORK_KEY = "abracadabra.account.work";
  var TAB_WORK = "abracadabra.tabwork";
  var PAID = "abracadabra.paid";
  var LIVE = "abracadabra.alakazam";

  function read(key) { try { return localStorage.getItem(key); } catch (_e) { return null; } }
  function write(key, value) { try { localStorage.setItem(key, value); return true; } catch (_e) { return false; } }
  function wipe(key) { try { localStorage.removeItem(key); } catch (_e) { /* gone anyway */ } }
  function getAccount() { try { return JSON.parse(read(ACCOUNT_KEY) || "null"); } catch (_e) { return null; } }
  function saveAccount(account) { return write(ACCOUNT_KEY, JSON.stringify(account)); }

  var params = null;
  try { params = new URLSearchParams(location.search); } catch (_e) { params = null; }

  // Owner test key: ?account=reset forgets the browser account and its work.
  if (params && params.get("account") === "reset") {
    wipe(ACCOUNT_KEY);
    wipe(WORK_KEY);
  }

  // ---- boot seeding: the account's standing and work enter this tab ----
  var account = getAccount();
  var urlPaid = params ? params.get("paid") === "1" : false;
  var urlLive = params ? params.get("alakazam") === "1" : false;
  if (account) {
    if (urlPaid) account.paid = true;
    if (urlLive) { account.live = true; account.paid = true; }
    if (urlPaid || urlLive) saveAccount(account);
    try {
      if (account.paid) sessionStorage.setItem(PAID, "1");
      if (account.live) sessionStorage.setItem(LIVE, "1");
      var kept = read(WORK_KEY);
      if (kept && !sessionStorage.getItem(TAB_WORK)) sessionStorage.setItem(TAB_WORK, kept);
    } catch (_e) { /* private mode: tab rules apply */ }
  }

  function mirror() {
    if (!getAccount()) return;
    try {
      var work = sessionStorage.getItem(TAB_WORK);
      if (work) write(WORK_KEY, work);
    } catch (_e) { /* nothing to mirror */ }
  }
  window.addEventListener("abracadabra:versionmade", mirror);
  window.addEventListener("abracadabra:versionselected", mirror);

  function entitledNow() {
    try {
      return {
        paid: sessionStorage.getItem(PAID) === "1",
        live: sessionStorage.getItem(LIVE) === "1"
      };
    } catch (_e) { return { paid: false, live: false }; }
  }

  function createAccount(email) {
    var record = getAccount();
    if (record) return record;
    var standing = entitledNow();
    record = {
      email: email,
      created: new Date().toISOString(),
      paid: standing.paid,
      live: standing.live
    };
    if (!saveAccount(record)) return null; // private mode - never block the pay
    mirror();
    return record;
  }

  // ---- the panel: appears right before paying (or claiming the download) ----
  function openPanel(host, beforeEl, mode, href, onDone) {
    if (document.querySelector(".spark-account-panel")) return;
    var panel = document.createElement("div");
    panel.className = "spark-account-panel";
    var label = document.createElement("p");
    label.className = "spark-panel-label";
    label.textContent = "Your account";
    var line = document.createElement("p");
    line.className = "spark-fine";
    line.textContent = mode === "pay"
      ? "Your account is made right before you pay — it keeps your work and your unlock in this browser."
      : "Name your account to claim the download — it keeps your work and your unlock in this browser.";
    var row = document.createElement("div");
    row.className = "spark-account-row";
    var input = document.createElement("input");
    input.type = "email";
    input.required = true;
    input.placeholder = "you@example.com";
    input.autocomplete = "email";
    input.className = "spark-account-email";
    input.setAttribute("aria-label", "Email for your account");
    var go = document.createElement("button");
    go.type = "button";
    go.className = "spark-button spark-button-primary";
    go.textContent = mode === "pay" ? "Create my account & pay $5" : "Create my account";
    var err = document.createElement("p");
    err.className = "spark-fine spark-account-err";
    err.hidden = true;
    row.append(input, go);
    panel.append(label, line, row, err);
    beforeEl.parentNode.insertBefore(panel, beforeEl);
    input.focus();
    function submit() {
      var email = String(input.value || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        err.textContent = "That email does not look complete — check it and press again.";
        err.hidden = false;
        input.focus();
        return;
      }
      createAccount(email);
      dressAccountState();
      panel.remove();
      if (mode === "pay" && href && !window.__abracadabraHoldNav) location.href = href;
      if (onDone) onDone();
    }
    go.addEventListener("click", submit);
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") { event.preventDefault(); submit(); }
    });
  }

  // ---- standing furniture: the gate names the account, the hint tells the truth ----
  function dressAccountState() {
    var record = getAccount();
    if (!record) return;
    document.querySelectorAll(".spark-tab-hint").forEach(function (hint) {
      hint.textContent = "Saved to your account in this browser.";
    });
    var gate = document.querySelector(".spark-save-gate > div");
    if (gate && !gate.querySelector(".spark-account-standing")) {
      var standing = document.createElement("p");
      standing.className = "spark-fine spark-account-standing";
      standing.textContent = "Account: " + record.email + " — your work stays saved in this browser.";
      gate.appendChild(standing);
    }
  }

  function boot() {
    dressAccountState();
    // Registered at DOM-ready so it runs AFTER the app's own beforeunload
    // save - the mirror must copy fresh tab work, not last minute's.
    window.addEventListener("beforeunload", mirror);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  window.SiteSourceryAccount = Object.freeze({
    get: getAccount,
    create: createAccount,
    openPanel: openPanel,
    mirror: mirror
  });
}());
