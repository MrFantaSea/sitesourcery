(function () {
  'use strict';

  var doc = document;
  var body = doc.body;
  if (!body || (!body.classList.contains('page-pricing') && !body.classList.contains('page-hive'))) return;

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (body.classList.contains('page-pricing')) {
    var billingRoot = doc.querySelector('[data-billing]');
    var chapterToggle = doc.querySelector('.toggle');
    var syncChapter = function () {
      body.setAttribute('data-chapter', billingRoot ? billingRoot.getAttribute('data-billing') || 'once' : 'once');
    };
    syncChapter();
    if (billingRoot && 'MutationObserver' in window) {
      new MutationObserver(syncChapter).observe(billingRoot, { attributes: true, attributeFilter: ['data-billing'] });
    } else if (chapterToggle) {
      chapterToggle.addEventListener('click', function () { window.setTimeout(syncChapter, 340); });
    }
  }

  var chamber = doc.querySelector('[data-hive-chamber]');
  if (chamber) {
    var tabs = Array.prototype.slice.call(chamber.querySelectorAll('[role="tab"][data-cell]'));
    var panels = Array.prototype.slice.call(chamber.querySelectorAll('[role="tabpanel"]'));
    var live = chamber.querySelector('[aria-live]');

    function activate(tab, announce) {
      var target = tab.getAttribute('aria-controls');
      tabs.forEach(function (candidate) {
        var active = candidate === tab;
        candidate.setAttribute('aria-selected', String(active));
        candidate.setAttribute('tabindex', active ? '0' : '-1');
      });
      panels.forEach(function (panel) {
        var active = panel.id === target;
        panel.hidden = !active;
        panel.classList.toggle('is-active', active);
      });
      chamber.setAttribute('data-active', tab.getAttribute('data-cell'));
      if (announce && live) live.textContent = tab.textContent.trim() + ' concept selected.';
    }

    tabs.forEach(function (tab, index) {
      tab.addEventListener('click', function (event) {
        event.preventDefault();
        activate(tab, true);
      });
      tab.addEventListener('keydown', function (event) {
        var targetIndex = index;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') targetIndex = (index + 1) % tabs.length;
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') targetIndex = (index - 1 + tabs.length) % tabs.length;
        else if (event.key === 'Home') targetIndex = 0;
        else if (event.key === 'End') targetIndex = tabs.length - 1;
        else return;
        event.preventDefault();
        tabs[targetIndex].focus();
        activate(tabs[targetIndex], true);
      });
    });

    if (tabs.length) activate(tabs[0], false);
  }

  body.classList.add('commerce-ready');

  if (!reduce && window.matchMedia && window.matchMedia('(pointer:fine)').matches) {
    var artifacts = Array.prototype.slice.call(doc.querySelectorAll('.commission-grimoire,.hive-chamber'));
    artifacts.forEach(function (artifact) {
      artifact.addEventListener('pointermove', function (event) {
        var box = artifact.getBoundingClientRect();
        var x = ((event.clientX - box.left) / box.width - 0.5) * 8;
        var y = ((event.clientY - box.top) / box.height - 0.5) * 6;
        artifact.style.setProperty('--commerce-x', x.toFixed(2) + 'px');
        artifact.style.setProperty('--commerce-y', y.toFixed(2) + 'px');
      }, { passive: true });
      artifact.addEventListener('pointerleave', function () {
        artifact.style.removeProperty('--commerce-x');
        artifact.style.removeProperty('--commerce-y');
      });
    });
  }
})();
