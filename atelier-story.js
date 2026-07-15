(function () {
  "use strict";

  var root = document.documentElement;
  root.classList.add("story-js");

  function wireTabs(tabSelector, panelSelector, keyAttribute, onChange) {
    var tabs = Array.prototype.slice.call(document.querySelectorAll(tabSelector));
    var panels = Array.prototype.slice.call(document.querySelectorAll(panelSelector));
    if (!tabs.length || !panels.length) return;

    function activate(tab, focus) {
      var key = tab.getAttribute(keyAttribute);
      tabs.forEach(function (item) {
        var selected = item === tab;
        item.setAttribute("aria-selected", String(selected));
        item.tabIndex = selected ? 0 : -1;
      });
      panels.forEach(function (panel) {
        panel.hidden = panel.getAttribute(keyAttribute.replace("tab", "panel")) !== key;
      });
      if (onChange) onChange(key);
      if (focus) tab.focus();
    }

    activate(tabs[0], false);
    tabs.forEach(function (tab, index) {
      tab.addEventListener("click", function () { activate(tab, false); });
      tab.addEventListener("keydown", function (event) {
        var next = index;
        if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % tabs.length;
        else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + tabs.length) % tabs.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = tabs.length - 1;
        else return;
        event.preventDefault();
        activate(tabs[next], true);
      });
    });
  }

  var consoleWord = document.querySelector(".console-word");
  wireTabs("[data-stage-tab]", "[data-stage-panel]", "data-stage-tab", function (key) {
    if (consoleWord) consoleWord.textContent = key.toUpperCase();
  });
  wireTabs("[data-proof-tab]", "[data-proof-panel]", "data-proof-tab");
}());
