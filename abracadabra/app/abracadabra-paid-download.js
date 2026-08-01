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

  var params = new URLSearchParams(location.search);
  if (params.get("paid") === "1") {
    try { sessionStorage.setItem(KEY, "1"); } catch (_e) { /* private mode */ }
    params.delete("paid");
    var clean = location.pathname + (params.toString() ? "?" + params.toString() : "") + location.hash;
    history.replaceState(null, "", clean);
  }

  var paid = false;
  try { paid = sessionStorage.getItem(KEY) === "1"; } catch (_e) { paid = params.get("paid") === "1"; }
  if (!paid) return;

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

  button.addEventListener("click", function () {
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
      note.textContent = "Downloaded. The same file is yours to keep, host anywhere, or bring to Alakazam.";
    }).catch(function () {
      note.textContent = "The download hiccuped — remake the preview and press again.";
    });
  });
}());
