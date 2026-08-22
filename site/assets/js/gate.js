(function () {
  'use strict';

  var gate = document.getElementById('gate');
  var trigger = document.getElementById('gateTrigger');
  var site = document.getElementById('site');
  var hero = document.getElementById('top');
  if (!gate || !trigger || !site) return;

  var video = gate.querySelector('.gate__video');
  if (video && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    video.removeAttribute('autoplay');
    video.pause();
  }

  var STORAGE_KEY = 'kd-entered';
  var alreadyEntered = false;
  try { alreadyEntered = sessionStorage.getItem(STORAGE_KEY) === 'true'; } catch (e) { /* storage unavailable, always show gate */ }

  function showSite() {
    site.hidden = false;
    requestAnimationFrame(function () {
      site.setAttribute('data-visible', 'true');
    });
  }

  function finalizeEntry(withHeroReveal) {
    try { sessionStorage.setItem(STORAGE_KEY, 'true'); } catch (e) {}
    gate.setAttribute('data-open', 'true');
    document.body.style.overflow = '';
    site.hidden = false;
    if (withHeroReveal && hero) { hero.classList.add('hero--enter'); }
    requestAnimationFrame(function () {
      site.setAttribute('data-visible', 'true');
      if (withHeroReveal && hero) {
        requestAnimationFrame(function () {
          hero.classList.add('hero--enter-active');
        });
      }
    });
    window.setTimeout(function () { gate.hidden = true; }, 950);
  }

  function openGate() {
    if (gate.hasAttribute('data-stage')) { return; }
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      finalizeEntry(false);
      return;
    }
    trigger.disabled = true;
    gate.setAttribute('data-stage', 'closing');
    window.setTimeout(function () { finalizeEntry(true); }, 700);
  }

  if (alreadyEntered) {
    gate.hidden = true;
    gate.setAttribute('data-open', 'true');
    showSite();
    return;
  }

  document.body.style.overflow = 'hidden';
  trigger.addEventListener('click', openGate);
})();
