(function () {
  "use strict";

  /**
   * The $5 unlock.
   *
   * Stripe's payment link redirects back here with ?paid=1. That parameter is
   * an honor gate, not security — anyone can type it. At five dollars, the
   * cost of pretending to have paid is the seller's accepted risk, and the
   * alternative (a server) does not exist in this deployment. The flag is
   * remembered so a refresh does not re-lock a page someone paid for.
   *
   * The compiled page lives in the preview iframe as a blob document, so the
   * download needs no reach into the app's internals at all.
   */

  var KEY = "abracadabra.paid";
  var KEY_LIVE = "abracadabra.alakazam";

  var params = new URLSearchParams(location.search);
  var dirty = false;
  if (params.get("paid") === "1") {
    try { sessionStorage.setItem(KEY, "1"); } catch (_e) { /* private mode */ }
    params.delete("paid");
    dirty = true;
  }
  if (params.get("alakazam") === "1") {
    try {
      sessionStorage.setItem(KEY_LIVE, "1");
      sessionStorage.setItem(KEY, "1"); // the ladder: going live implies the download tier
    } catch (_e) { /* private mode */ }
    params.delete("alakazam");
    dirty = true;
  }
  if (dirty) {
    var clean = location.pathname + (params.toString() ? "?" + params.toString() : "") + location.hash;
    history.replaceState(null, "", clean);
  }

  var paid = false;
  var live = false;
  try {
    paid = sessionStorage.getItem(KEY) === "1";
    live = sessionStorage.getItem(KEY_LIVE) === "1";
  } catch (_e) { paid = false; live = false; }

  if (paid) document.documentElement.classList.add("ss-paid");
  if (live) document.documentElement.classList.add("ss-live");

  /* THE LADDER (owner ruling): free makes and previews; the $5 unlocks the
     download, the style extras, AND the door to Alakazam (it doubles as the
     coupon); Alakazam unlocks the payment-link extras. Honor gates - the
     provisioning human is the real enforcement. */
  function applyEntitlements() {
    document.querySelectorAll("[data-tier]").forEach(function (block) {
      var tier = block.getAttribute("data-tier");
      var unlocked = tier === "paid" ? paid : (paid && live);
      block.classList.toggle("is-locked", !unlocked);
      block.querySelectorAll("input, select, textarea").forEach(function (control) {
        control.disabled = !unlocked;
      });
      var note = block.querySelector("[data-lock-note]");
      if (note) note.hidden = unlocked;
    });
    var golive = document.querySelector("[data-gate-golive]");
    if (golive) {
      if (live) {
        var done = document.createElement("p");
        done.className = "spark-fine";
        done.textContent = "Alakazam is active — your $5 comes off the first invoice.";
        golive.replaceWith(done);
      } else if (!paid) {
        golive.classList.add("is-locked-link");
        golive.setAttribute("aria-disabled", "true");
        golive.removeAttribute("href");
        golive.textContent = "Go live — unlocks after the download";
      }
    }
  }
  /* The room says what state it is in. Post-pay must not look like the free
     maker: a chip under the title names the tier, and for Alakazam it states
     the real mechanism - there are no accounts here, the Stripe receipt email
     is how the owner reaches the customer to provision by hand. */
  function dressRoom() {
    if (!paid) return;
    var title = document.getElementById("spark-title");
    if (!title || document.querySelector(".spark-state-chip")) return;
    var chip = document.createElement("p");
    chip.className = "spark-state-chip" + (live ? " is-live" : "");
    var head = document.createElement("strong");
    var line = document.createElement("span");
    if (live) {
      head.textContent = "✦ Alakazam is active ✦";
      line.textContent = "Alakazam keeps your page alive. Your download is open below — and if anything snags, I\u2019m one call away.";
    } else {
      head.textContent = "✦ The $5 download is yours ✦";
      line.textContent = "Your download and the style kit are unlocked under your page.";
    }
    chip.appendChild(head);
    chip.appendChild(line);
    title.insertAdjacentElement("afterend", chip);
  }

  function wireIncludesModal() {
    var open = document.querySelector("[data-open-includes]");
    var modal = document.querySelector("[data-includes-modal]");
    var close = document.querySelector("[data-close-includes]");
    if (!open || !modal) return;
    open.addEventListener("click", function () { modal.showModal(); });
    if (close) close.addEventListener("click", function () { modal.close(); });
    modal.addEventListener("click", function (event) {
      if (event.target === modal) modal.close(); // backdrop click
    });
  }

  function boot() {
    applyEntitlements();
    dressRoom();
    wireIncludesModal();
    window.dispatchEvent(new CustomEvent("abracadabra:entitlements"));
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  /* FOUNDER ORDER: the account is made right before you pay - one sweep.
     A visitor with no account who presses the $5 gets the account panel,
     then goes straight on to Stripe. An existing account pays directly. */
  var accountApi = window.SiteSourceryAccount || null;
  var freeGate = document.querySelector(".spark-save-gate");
  if (accountApi && freeGate && !paid) {
    var payAnchor = freeGate.querySelector('a[href="https://buy.stripe.com/8x2cN7e9y0wu6OW4fO7kc00"]');
    if (payAnchor) {
      payAnchor.addEventListener("click", function (event) {
        if (accountApi.get()) return; // account exists - straight to pay
        event.preventDefault();
        accountApi.openPanel(freeGate, payAnchor, "pay", payAnchor.getAttribute("href"));
      });
    }
  }

  if (!paid) return; // entitlements above already ran for the free state

  var gate = document.querySelector(".spark-save-gate");
  if (!gate) return;

  var buyLink = gate.querySelector('a[href^="https://buy.stripe.com/"]');
  var fine = gate.querySelector(".spark-fine");
  var secondary = gate.querySelector('a[href="/abracadabra/#plans"]');

  var button = document.createElement("button");
  button.type = "button";
  button.className = "spark-button spark-button-primary";
  button.textContent = "Download your page now";

  var note = document.createElement("p");
  note.className = "spark-fine";
  note.textContent = "Paid — thank you. This button hands you the file, right here.";

  if (buyLink) buyLink.replaceWith(button);
  if (fine) fine.replaceWith(note);
  if (secondary) secondary.textContent = "See the ways to keep it live";
  var intro = gate.querySelector("#save-direction-title + p");
  if (intro) {
    intro.textContent = live
      ? "Alakazam is on. Download your page any time."
      : "The download is paid for this tab. Publishing is a separate service — the Go-live door below is open.";
  }

  button.addEventListener("click", function () {
    // No account, no download - the file belongs to an account (founder order).
    if (accountApi && !accountApi.get()) {
      accountApi.openPanel(gate, button, "claim", null, function () { button.click(); });
      return;
    }
    var preview = document.getElementById("spark-preview");
    var src = preview ? preview.getAttribute("src") : "";
    if (!src) {
      note.textContent = "Make your preview first — then this button hands you the file.";
      return;
    }
    // The preview is a blob document; fetching our own blob URL returns the
    // exact page the customer is looking at.
    fetch(src).then(function (r) { return r.text(); }).then(function (html) {
      var blob = new Blob([html], { type: "text/html" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "your-page.html";
      a.hidden = true;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(url);
        a.remove();
      }, 1000);
      note.textContent = "The scroll is yours. Keep it, host it anywhere, or bring it to Alakazam.";
    }).catch(function () {
      note.textContent = "The download hiccuped — remake the preview and press again.";
    });
  });
}());
