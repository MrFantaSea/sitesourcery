(function () {
  "use strict";

  var maker = window.AbracadabraCompiler;
  var frames = Array.prototype.slice.call(
    document.querySelectorAll("[data-abracadabra-showcase]")
  );
  if (!frames.length) return;

  var sample = Object.freeze({
    businessName: "Juniper & Clay",
    summary: "Plants, pottery, and useful objects for calmer rooms.",
    about: "Juniper & Clay is a fictional neighborhood shop used to demonstrate Abracadabra.\n\nThe sample contains no real customer or business claims.",
    offerings: "Indoor plants\nHandmade pottery\nPlant care supplies",
    location: "South Jersey",
    hours: "Tuesday–Saturday, 10–6",
    phone: "(856) 555-0142",
      email: "sitesourcery@proton.me",
    website: "",
    primaryAction: "email"
  });

  function prepare(frame) {
    if (frame.getAttribute("data-showcase-started") === "true") return;
    frame.setAttribute("data-showcase-started", "true");
    var shell = frame.closest("[data-showcase-shell]");
    var status = shell ? shell.querySelector("[data-showcase-status]") : null;
    var look = frame.getAttribute("data-look") || "warm";
    if (shell) shell.setAttribute("data-showcase-state", "loading");
    if (status) status.textContent = "Opening the generated example…";
    if (!maker) {
      if (shell) shell.setAttribute("data-showcase-state", "failed");
      if (status) status.textContent = "The generated example did not open. Reload this page to try again.";
      return;
    }
    try {
      var result = maker.compileSite(Object.assign({}, sample, { theme: look }));
      frame.addEventListener("load", function () {
        if (!frame.getAttribute("srcdoc")) return;
        window.requestAnimationFrame(function () {
          window.requestAnimationFrame(function () {
            if (shell) {
              shell.setAttribute("data-ready", "true");
              shell.setAttribute("data-rendered", "true");
              shell.setAttribute("data-showcase-state", "ready");
            }
            if (status) status.textContent = look.charAt(0).toUpperCase() + look.slice(1) + " generated example ready.";
          });
        });
      });
      frame.srcdoc = result.html;
    } catch (error) {
      if (shell) shell.setAttribute("data-showcase-state", "failed");
      if (status) status.textContent = "The generated example did not open. Reload this page to try again.";
    }
  }

  if (typeof window.IntersectionObserver === "function") {
    var observer = new window.IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        prepare(entry.target);
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "320px 0px" });
    frames.forEach(function (frame) { observer.observe(frame); });
  } else {
    frames.forEach(prepare);
  }
}());
