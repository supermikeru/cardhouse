(function () {
  'use strict';

  /* ---------- Sticky header ---------- */
  var header = document.getElementById('siteHeader');
  if (header) {
    var onScroll = function () {
      header.setAttribute('data-scrolled', window.scrollY > 40 ? 'true' : 'false');
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---------- Mobile nav ---------- */
  var burger = document.getElementById('navBurger');
  var mobileNav = document.getElementById('navMobile');
  if (burger && mobileNav) {
    var toggleNav = function (open) {
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      mobileNav.setAttribute('data-open', open ? 'true' : 'false');
      document.body.style.overflow = open ? 'hidden' : '';
    };
    burger.addEventListener('click', function () {
      toggleNav(burger.getAttribute('aria-expanded') !== 'true');
    });
    mobileNav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () { toggleNav(false); });
    });
  }

  /* ---------- Scroll reveal ---------- */
  var revealTargets = document.querySelectorAll(
    '.manifesto, .values__grid .panel, .format__text, .format__diagram, .admission, .philosophy__line, .location, .contact__frame'
  );
  revealTargets.forEach(function (el) { el.setAttribute('data-reveal', ''); });

  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if ('IntersectionObserver' in window && !prefersReducedMotion) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -60px 0px' });
    revealTargets.forEach(function (el) { io.observe(el); });
  } else {
    revealTargets.forEach(function (el) { el.classList.add('is-visible'); });
  }

  /* ---------- Lazy-load ambient background videos ---------- */
  var ambientVideos = document.querySelectorAll('.ambient-media[data-src]');
  if (ambientVideos.length) {
    var loadVideo = function (video) {
      video.src = video.dataset.src;
      video.removeAttribute('data-src');
      video.load();
      var playPromise = video.play();
      if (playPromise) { playPromise.catch(function () {}); }
    };
    if ('IntersectionObserver' in window && !prefersReducedMotion) {
      var videoIo = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            loadVideo(entry.target);
            videoIo.unobserve(entry.target);
          }
        });
      }, { rootMargin: '200px 0px' });
      ambientVideos.forEach(function (v) { videoIo.observe(v); });
    } else if (!prefersReducedMotion) {
      ambientVideos.forEach(loadVideo);
    }
  }

  /* ---------- Application form ---------- */
  var form = document.getElementById('applicationForm');
  if (form) {
    var noteDefault = form.querySelector('.form__note') ? form.querySelector('.form__note').textContent : '';
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var button = form.querySelector('button[type="submit"]');
      var note = form.querySelector('.form__note');
      if (button) { button.disabled = true; button.textContent = 'Отправка…'; }
      if (note) { note.textContent = noteDefault; }

      fetch(form.getAttribute('action') || 'send.php', {
        method: 'POST',
        body: new FormData(form),
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      })
        .then(function (res) {
          return res.json().catch(function () { return {}; });
        })
        .then(function (data) {
          if (data && data.ok) {
            form.reset();
            if (button) { button.textContent = 'Заявка отправлена'; }
            if (note) { note.textContent = 'Спасибо. Рассмотрение заявки занимает до 5 рабочих дней — мы свяжемся с вами в Telegram.'; }
          } else {
            if (button) { button.disabled = false; button.textContent = 'Отправить заявку'; }
            if (note) { note.textContent = (data && data.message) || 'Не удалось отправить заявку. Попробуйте ещё раз или напишите нам в Telegram.'; }
          }
        })
        .catch(function () {
          if (button) { button.disabled = false; button.textContent = 'Отправить заявку'; }
          if (note) { note.textContent = 'Не удалось отправить заявку. Проверьте соединение и попробуйте ещё раз.'; }
        });
    });
  }
})();
