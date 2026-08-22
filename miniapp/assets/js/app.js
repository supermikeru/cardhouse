(function () {
  'use strict';

  /* ---------- Telegram WebApp SDK (safe no-op outside Telegram) ---------- */
  try {
    var tg = window.Telegram && window.Telegram.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();
      tg.setHeaderColor && tg.setHeaderColor('#170608');
      tg.setBackgroundColor && tg.setBackgroundColor('#170608');

      /* Some Telegram WebViews (notably iOS) paint the first frame blank
         and only repaint on the next layout event — which is why switching
         tabs "fixes" it. Force a reflow right after init instead of waiting
         for the user to trigger one. */
      var nudge = function () {
        document.body.style.display = 'none';
        void document.body.offsetHeight;
        document.body.style.display = '';
      };
      requestAnimationFrame(function () { requestAnimationFrame(nudge); });
      tg.onEvent && tg.onEvent('viewportChanged', nudge);
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) nudge();
      });

      /* Real Telegram already shows its own WebApp chrome — our fake
         top bar was only a stand-in for previewing outside Telegram. */
      var fakeBar = document.querySelector('.tg-bar');
      if (fakeBar) fakeBar.style.display = 'none';
    }
  } catch (e) { /* running as a plain prototype preview */ }

  /* ---------- Bottom nav + in-page "Все →" / card links ---------- */
  var screens = document.querySelectorAll('.screen');
  var navBtns = document.querySelectorAll('.nav-btn');

  function goScreen(name) {
    screens.forEach(function (s) { s.setAttribute('data-active', s.dataset.screen === name ? 'true' : 'false'); });
    navBtns.forEach(function (b) { b.setAttribute('aria-current', b.dataset.nav === name ? 'true' : 'false'); });
    document.getElementById('app').scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('[data-nav]').forEach(function (el) {
    el.addEventListener('click', function () { goScreen(el.dataset.nav); });
  });

  /* ---------- Generic sub-tabs (tournaments / rating / history) ---------- */
  function selectTab(group, value) {
    document.querySelectorAll('.tab[data-group="' + group + '"]').forEach(function (t) {
      t.setAttribute('aria-selected', t.dataset.subTab === value ? 'true' : 'false');
    });
    document.querySelectorAll('[data-panel^="' + group + '-"]').forEach(function (p) {
      p.hidden = p.dataset.panel !== (group + '-' + value);
    });
    if (group === 'rating') renderRating(value);
  }
  document.querySelectorAll('.tab[data-group]').forEach(function (t) {
    t.addEventListener('click', function () { selectTab(t.dataset.group, t.dataset.subTab); });
  });

  /* ---------- Accordion ---------- */
  document.querySelectorAll('[data-acc-head]').forEach(function (head) {
    head.addEventListener('click', function () {
      var item = head.closest('[data-acc]');
      var open = item.getAttribute('data-open') === 'true';
      item.setAttribute('data-open', open ? 'false' : 'true');
    });
  });

  /* ---------- Bottom sheets ---------- */
  function openSheet(id) {
    var overlay = document.querySelector('[data-sheet-overlay="' + id + '"]');
    if (overlay) overlay.setAttribute('data-open', 'true');
  }
  function closeSheet(id) {
    var overlay = document.querySelector('[data-sheet-overlay="' + id + '"]');
    if (overlay) overlay.setAttribute('data-open', 'false');
  }
  document.querySelectorAll('[data-open-sheet]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      e.preventDefault();
      openSheet(el.dataset.openSheet);
    });
  });
  document.querySelectorAll('[data-close-sheet]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      e.preventDefault();
      closeSheet(el.dataset.closeSheet);
    });
  });
  document.querySelectorAll('.sheet-overlay').forEach(function (overlay) {
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.setAttribute('data-open', 'false');
    });
  });

  /* ---------- Toast ---------- */
  var toastEl = document.querySelector('[data-toast]');
  var toastTimer = null;
  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.setAttribute('data-show', 'true');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.setAttribute('data-show', 'false'); }, 2400);
  }
  document.querySelectorAll('[data-stub]').forEach(function (el) {
    el.addEventListener('click', function () { showToast(el.dataset.stub); });
  });
  var addressRow = document.getElementById('addressRow');
  if (addressRow) {
    addressRow.addEventListener('click', function () { showToast('Откроется карта — Яндекс/Google Maps'); });
  }

  /* ---------- Tournaments: mock data + list render + detail screen ---------- */
  var TOURNAMENTS = [
    {
      id: 't1', status: 'upcoming', img: 'assets/img/gate-scene.jpg',
      title: 'Королевская', subtitle: 'ночь', date: '19 августа, Ср', time: '19:00',
      seatsTaken: 5, seatsTotal: 60, registered: false,
      desc: 'Вечер закрытого стола для постоянных членов клуба и их гостей. Камерная атмосфера, дресс-код black tie приветствуется.',
      rules: ['Формат: NLH, глубокий стек', 'Рассадка случайная, пересадки каждые 40 минут', 'Ребай — в течение первого часа', 'Финальный стол — по достижении 8 игроков']
    },
    {
      id: 't2', status: 'upcoming', img: 'assets/img/manifesto-detail.jpg',
      title: 'Дом полон', subtitle: '', date: '20 августа, Чт', time: '19:00',
      seatsTaken: 4, seatsTotal: 60, registered: false,
      desc: 'Турнир для тех, кто ценит плотную игру и долгую борьбу за столом. Без быстрых выбываний — глубокие стеки с самого старта.',
      rules: ['Формат: NLH, deepstack', 'Уровни блайндов — 25 минут', 'Один дозаезд в первый час', 'Призовые очки — по призовой сетке клуба']
    },
    {
      id: 't3', status: 'upcoming', img: 'assets/img/philosophy-detail.jpg',
      title: 'Чёрная', subtitle: 'метка', date: '24 августа, Пн', time: '19:30',
      seatsTaken: 0, seatsTotal: 60, registered: false,
      desc: 'Закрытый турнир по приглашениям постоянных игроков клуба. Минимум формальностей, максимум концентрации.',
      rules: ['Формат: NLH, турбо', 'Уровни блайндов — 15 минут', 'Без дозаездов', 'Финалисты получают статус в рейтинге сезона']
    },
    {
      id: 't4', status: 'past', img: 'assets/img/philosophy-detail-2.jpg',
      title: 'Пиковый', subtitle: 'интерес', date: '12 августа, Ср', time: '19:00',
      place: 4, points: 320,
      desc: 'Турнир прошёл в формате NLH deepstack, финальный стол собрал 8 сильнейших игроков вечера.',
      rules: ['Формат: NLH, deepstack', 'Уровни блайндов — 25 минут', 'Один дозаезд в первый час']
    },
    {
      id: 't5', status: 'past', img: 'assets/img/format-detail.jpg',
      title: 'Бубновый', subtitle: 'интерес', date: '6 августа, Чт', time: '19:00',
      place: 12, points: 80,
      desc: 'Турнир прошёл в турбо-формате с укороченными уровнями блайндов.',
      rules: ['Формат: NLH, турбо', 'Уровни блайндов — 15 минут', 'Без дозаездов']
    }
  ];

  function tCardHTML(t) {
    var titleHTML = t.title + (t.subtitle ? '<em>' + t.subtitle + '</em>' : '');
    if (t.status === 'upcoming') {
      return (
        '<button type="button" class="t-card" data-open-detail="' + t.id + '">' +
          '<img class="t-card__img" src="' + t.img + '" alt="">' +
          '<span class="t-card__badge"><span></span>Запись</span>' +
          '<span class="t-card__title">' + titleHTML + '</span>' +
          '<span class="t-card__meta">' +
            '<span class="t-card__pill"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><use href="#i-calendar"/></svg>' + t.date + '</span>' +
            '<span class="t-card__pill"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><use href="#i-clock"/></svg>' + t.time + '</span>' +
            '<span class="t-card__pill"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><use href="#i-people"/></svg>' + t.seatsTaken + '/' + t.seatsTotal + '</span>' +
          '</span>' +
        '</button>'
      );
    }
    return (
      '<button type="button" class="t-card" data-open-detail="' + t.id + '">' +
        '<img class="t-card__img" src="' + t.img + '" alt="">' +
        '<span class="t-card__badge t-card__badge--done">Завершён</span>' +
        '<span class="t-card__title">' + titleHTML + '</span>' +
        '<span class="t-card__result">' +
          '<span>Ваше место: <strong style="color:var(--ivory)">' + t.place + '</strong></span>' +
          '<strong>+' + t.points + ' очков</strong>' +
        '</span>' +
      '</button>'
    );
  }

  function renderTournamentLists() {
    var upcoming = TOURNAMENTS.filter(function (t) { return t.status === 'upcoming'; });
    var past = TOURNAMENTS.filter(function (t) { return t.status === 'past'; });
    var upcomingEl = document.querySelector('[data-panel="tournaments-upcoming"]');
    var pastEl = document.querySelector('[data-panel="tournaments-past"]');
    var featuredEl = document.querySelector('[data-featured-tournament]');
    if (upcomingEl) upcomingEl.innerHTML = upcoming.map(tCardHTML).join('');
    if (pastEl) pastEl.innerHTML = past.map(tCardHTML).join('');
    if (featuredEl && upcoming[0]) featuredEl.innerHTML = tCardHTML(upcoming[0]);
    document.querySelectorAll('[data-open-detail]').forEach(function (btn) {
      btn.addEventListener('click', function () { openTournamentDetail(btn.dataset.openDetail); });
    });
  }

  var currentDetailId = null;
  var detailAction = document.querySelector('[data-td="action"]');

  function updateDetailAction(t) {
    if (!detailAction) return;
    if (t.status === 'past') {
      detailAction.parentElement.hidden = true;
      return;
    }
    detailAction.parentElement.hidden = false;
    var full = t.seatsTaken >= t.seatsTotal && !t.registered;
    if (t.registered) {
      detailAction.textContent = 'Отменить запись';
      detailAction.className = 'btn btn--outline';
      detailAction.style.width = '100%';
    } else {
      detailAction.textContent = full ? 'Мест нет' : 'Записаться на турнир';
      detailAction.className = 'btn btn--primary';
      detailAction.style.width = '100%';
      detailAction.disabled = full;
    }
  }

  function openTournamentDetail(id) {
    var t = TOURNAMENTS.filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    currentDetailId = id;
    screens.forEach(function (s) { s.setAttribute('data-active', s.dataset.screen === 'tournament-detail' ? 'true' : 'false'); });
    navBtns.forEach(function (b) { b.setAttribute('aria-current', b.dataset.nav === 'tournaments' ? 'true' : 'false'); });

    document.querySelector('[data-td="img"]').src = t.img;
    var badge = document.querySelector('[data-td="badge"]');
    badge.textContent = t.status === 'upcoming' ? 'Запись' : 'Завершён';
    badge.className = 't-card__badge' + (t.status === 'past' ? ' t-card__badge--done' : '');
    document.querySelector('[data-td="title"]').innerHTML = t.title + (t.subtitle ? '<em>' + t.subtitle + '</em>' : '');
    document.querySelector('[data-td="desc"]').textContent = t.desc;
    document.querySelector('[data-td="rules"]').innerHTML = t.rules.map(function (r) { return '<li>' + r + '</li>'; }).join('');

    var meta = document.querySelector('[data-td="meta"]');
    if (t.status === 'upcoming') {
      meta.innerHTML =
        '<span class="t-card__pill"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><use href="#i-calendar"/></svg>' + t.date + '</span>' +
        '<span class="t-card__pill"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><use href="#i-clock"/></svg>' + t.time + '</span>' +
        '<span class="t-card__pill"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><use href="#i-people"/></svg>' + t.seatsTaken + '/' + t.seatsTotal + '</span>';
    } else {
      meta.innerHTML = '<span class="t-card__pill"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><use href="#i-calendar"/></svg>' + t.date + '</span>';
    }

    var resultWrap = document.querySelector('[data-td="result-wrap"]');
    if (t.status === 'past') {
      resultWrap.hidden = false;
      document.querySelector('[data-td="result"]').innerHTML =
        '<span>Ваше место: <strong style="color:var(--ivory)">' + t.place + '</strong></span><strong>+' + t.points + ' очков</strong>';
    } else {
      resultWrap.hidden = true;
    }

    updateDetailAction(t);
    window.scrollTo(0, 0);
  }

  if (detailAction) {
    detailAction.addEventListener('click', function () {
      var t = TOURNAMENTS.filter(function (x) { return x.id === currentDetailId; })[0];
      if (!t || t.status === 'past' || detailAction.disabled) return;
      t.registered = !t.registered;
      t.seatsTaken += t.registered ? 1 : -1;
      updateDetailAction(t);
      renderTournamentLists();
      showToast(t.registered ? 'Вы записаны на турнир' : 'Запись отменена');
    });
  }

  renderTournamentLists();

  /* ---------- Rating: mock data + render ---------- */
  var RANK_CLASS = { Rookie: 'rank-rookie', Fish: 'rank-fish', Grinder: 'rank-grinder', Silver: 'rank-silver' };
  var GRAD = [
    'linear-gradient(145deg,#8FB8D6,#4d6f89)',
    'linear-gradient(145deg,var(--brass),#8a6f45)',
    'linear-gradient(145deg,#C69C6D,#7a5a37)',
    'linear-gradient(145deg,#9C8558,#5c4b30)',
    'linear-gradient(145deg,#7FA07C,#3f5a3c)'
  ];

  var RATING = {
    season: {
      podium: [
        { name: 'Acidhouze_', points: '5,984', avatar: 'A', grad: GRAD[0] },
        { name: 'starzzen', points: '6,592', avatar: 'S', grad: 'linear-gradient(145deg,var(--gold),#8a6f2f)' },
        { name: 'Randevu', points: '4,525', avatar: 'R', grad: GRAD[2] }
      ],
      rows: [
        { pos: 4, name: 'K♠', rank: 'Grinder', bounty: 900, points: '3,075', base: 3075, bonus: 0 },
        { pos: 5, name: 'Top1CzechRep…', rank: 'Grinder', bounty: 1700, points: '3,065', base: 2600, bonus: 465 },
        { pos: 6, name: 'Мияги', rank: 'Fish', bounty: 0, points: '2,910', base: 2910, bonus: 0 },
        { pos: 7, name: 'AJ', rank: 'Fish', bounty: 900, points: '2,688', base: 2688, bonus: 0 },
        { pos: 8, name: 'daimendos', rank: 'Fish', bounty: 20, points: '2,410', base: 2410, bonus: 0 },
        { pos: 9, name: 'terekkris', rank: 'Fish', bounty: 20, points: '2,105', base: 2105, bonus: 0 }
      ],
      me: { pos: 47, name: 'Михаил', rank: 'Rookie', bounty: 0, points: '0', base: 0, bonus: 0 }
    },
    all: {
      podium: [
        { name: 'starzzen', points: '18,220', avatar: 'S', grad: 'linear-gradient(145deg,var(--gold),#8a6f2f)' },
        { name: 'Randevu', points: '15,940', avatar: 'R', grad: GRAD[2] },
        { name: 'AJ', points: '14,110', avatar: 'A', grad: GRAD[3] }
      ],
      rows: [
        { pos: 4, name: 'Acidhouze_', rank: 'Silver', bounty: 3100, points: '12,884', base: 11500, bonus: 1384 },
        { pos: 5, name: 'Мияги', rank: 'Grinder', bounty: 900, points: '9,910', base: 9910, bonus: 0 },
        { pos: 6, name: 'K♠', rank: 'Grinder', bounty: 900, points: '8,075', base: 8075, bonus: 0 },
        { pos: 7, name: 'daimendos', rank: 'Grinder', bounty: 20, points: '6,410', base: 6410, bonus: 0 },
        { pos: 8, name: 'terekkris', rank: 'Fish', bounty: 20, points: '4,105', base: 4105, bonus: 0 }
      ],
      me: { pos: 71, name: 'Михаил', rank: 'Rookie', bounty: 0, points: '0', base: 0, bonus: 0 }
    },
    special: {
      podium: [
        { name: 'Randevu', points: '2,140', avatar: 'R', grad: GRAD[2] },
        { name: 'starzzen', points: '2,610', avatar: 'S', grad: 'linear-gradient(145deg,var(--gold),#8a6f2f)' },
        { name: 'AJ', points: '1,895', avatar: 'A', grad: GRAD[3] }
      ],
      rows: [
        { pos: 4, name: 'Acidhouze_', rank: 'Silver', bounty: 0, points: '1,410', base: 1410, bonus: 0 },
        { pos: 5, name: 'Мияги', rank: 'Grinder', bounty: 0, points: '980', base: 980, bonus: 0 },
        { pos: 6, name: 'K♠', rank: 'Grinder', bounty: 0, points: '640', base: 640, bonus: 0 }
      ],
      me: null
    }
  };

  var podiumEls = document.querySelectorAll('.podium__item');
  var rateListEl = document.querySelector('[data-rate-list]');

  function fmtRank(r) {
    return '<span class="rate-row__rank ' + (RANK_CLASS[r] || '') + '">' + r + '</span>';
  }

  function rowHTML(row, extraClass, grad) {
    return (
      '<div class="rate-row-wrap' + (extraClass ? ' ' + extraClass : '') + '">' +
        '<div class="rate-row' + (extraClass ? ' ' + extraClass : '') + '" data-row-toggle>' +
          '<span class="rate-row__pos">#' + row.pos + '</span>' +
          '<span class="avatar avatar--xs" style="background:' + (grad || GRAD[row.pos % GRAD.length]) + '">' + row.name.charAt(0) + '</span>' +
          '<span class="rate-row__body"><span class="rate-row__name">' + row.name + '</span>' + fmtRank(row.rank) + '</span>' +
          '<span class="rate-row__bounty">' + row.bounty + '</span>' +
          '<span class="rate-row__points"><svg viewBox="0 0 16 16" fill="currentColor"><use href="#i-diamond"/></svg>' + row.points + '</span>' +
          '<svg class="rate-row__chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><use href="#i-chevron-down"/></svg>' +
        '</div>' +
        '<div class="rate-row__detail">' + row.base + (row.bonus ? '+' + row.bonus : '+0') + '</div>' +
      '</div>'
    );
  }

  function renderRating(tab) {
    var data = RATING[tab] || RATING.season;
    var specialInfo = document.querySelector('[data-panel="rating-special"]');
    if (specialInfo) specialInfo.hidden = tab !== 'special';

    podiumEls.forEach(function (el, i) {
      var order = ['second', 'first', 'third'][i]; // matches DOM order 2nd,1st,3rd
      var idx = order === 'first' ? 1 : order === 'second' ? 0 : 2;
      var p = data.podium[idx];
      if (!p) return;
      el.querySelector('.avatar').textContent = p.avatar;
      el.querySelector('.avatar').style.background = p.grad;
      el.querySelector('.podium__name').textContent = p.name;
      el.querySelector('.podium__points').lastChild ? null : null;
      var ptsEl = el.querySelector('.podium__points');
      ptsEl.innerHTML = '<svg fill="currentColor"><use href="#i-diamond"/></svg>' + p.points;
    });

    if (!rateListEl) return;
    var html = data.rows.map(function (r) { return rowHTML(r); }).join('');
    if (data.me) html += rowHTML(data.me, 'rate-row--me');
    rateListEl.innerHTML = html;

    rateListEl.querySelectorAll('[data-row-toggle]').forEach(function (row) {
      row.addEventListener('click', function () {
        var wrap = row.closest('.rate-row-wrap');
        var open = wrap.getAttribute('data-open') === 'true';
        wrap.setAttribute('data-open', open ? 'false' : 'true');
      });
    });
  }

  renderRating('season');

  /* ---------- Onboarding: nickname validation ---------- */
  var BANNED_WORDS = ['дурак', 'идиот', 'admin', 'moderator', 'support'];
  var nickInput = document.getElementById('nicknameInput');
  var nickError = document.querySelector('[data-nick-error]');
  var nickHint = document.querySelector('[data-nick-hint]');
  var nickConfirm = document.getElementById('nicknameConfirm');

  function validateNickname() {
    if (!nickInput) return true;
    var val = nickInput.value.trim();
    var lower = val.toLowerCase();
    var msg = '';
    if (val.length < 2 || val.length > 20) {
      msg = 'Ник должен быть от 2 до 20 символов.';
    } else if (BANNED_WORDS.some(function (w) { return lower.indexOf(w) !== -1; })) {
      msg = 'Этот ник недопустим — выберите другой.';
    }
    var valid = !msg;
    if (nickError) { nickError.textContent = msg; nickError.hidden = valid; }
    if (nickHint) nickHint.hidden = !valid;
    if (nickConfirm) nickConfirm.disabled = !valid;
    return valid;
  }
  if (nickInput) {
    nickInput.addEventListener('input', validateNickname);
    validateNickname();
  }
  if (nickConfirm) {
    nickConfirm.addEventListener('click', function () {
      if (!validateNickname()) return;
      closeSheet('nickname');
      openSheet('email');
    });
  }

  /* ---------- Onboarding: email → OTP ---------- */
  var emailInput = document.getElementById('emailInput');
  var emailSubmit = document.getElementById('emailSubmit');
  var otpTarget = document.getElementById('otpEmailTarget');
  var otpBoxes = document.querySelectorAll('#otpInputs .otp-box');
  var otpTimerEl = document.getElementById('otpTimer');
  var otpResend = document.getElementById('otpResend');
  var otpConfirm = document.getElementById('otpConfirm');
  var otpCountdown = null;

  function startOtpCountdown() {
    var seconds = 59;
    if (otpResend) otpResend.disabled = true;
    clearInterval(otpCountdown);
    otpCountdown = setInterval(function () {
      seconds--;
      if (otpTimerEl) otpTimerEl.textContent = '00:' + (seconds < 10 ? '0' : '') + seconds;
      if (seconds <= 0) {
        clearInterval(otpCountdown);
        if (otpResend) otpResend.disabled = false;
        if (otpTimerEl) otpTimerEl.textContent = '00:00';
      }
    }, 1000);
  }

  if (emailSubmit) {
    emailSubmit.addEventListener('click', function () {
      var val = emailInput ? emailInput.value.trim() : '';
      var validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
      if (!validEmail) { showToast('Введите корректный email'); return; }
      if (otpTarget) otpTarget.textContent = val;
      closeSheet('email');
      openSheet('otp');
      otpBoxes.forEach(function (b) { b.value = ''; });
      if (otpBoxes[0]) otpBoxes[0].focus();
      startOtpCountdown();
    });
  }
  if (otpResend) {
    otpResend.addEventListener('click', function () {
      if (otpResend.disabled) return;
      showToast('Код отправлен повторно');
      startOtpCountdown();
    });
  }
  otpBoxes.forEach(function (box, i) {
    box.addEventListener('input', function () {
      box.value = box.value.replace(/[^0-9]/g, '');
      if (box.value && otpBoxes[i + 1]) otpBoxes[i + 1].focus();
    });
    box.addEventListener('keydown', function (e) {
      if (e.key === 'Backspace' && !box.value && otpBoxes[i - 1]) otpBoxes[i - 1].focus();
    });
  });
  if (otpConfirm) {
    otpConfirm.addEventListener('click', function () {
      var code = Array.prototype.map.call(otpBoxes, function (b) { return b.value; }).join('');
      if (code.length < 4) { showToast('Введите 4-значный код'); return; }
      clearInterval(otpCountdown);
      closeSheet('otp');
      showToast('Email подтверждён');
    });
  }

  /* ---------- Preview-only deep link: #kd:screen or #kd:sheet:id ----------
     Namespaced so it never collides with Telegram's own hash params
     (#tgWebAppData=...&tgWebAppVersion=...) that a real WebApp launch
     appends to the URL — matching those to a screen name used to blank
     every screen out. Only touch state on an explicit #kd: hash. */
  if (location.hash.indexOf('#kd:') === 0) {
    var target = location.hash.slice(4);
    document.querySelectorAll('.sheet-overlay[data-open="true"]').forEach(function (o) { o.setAttribute('data-open', 'false'); });
    if (target.indexOf('sheet:') === 0) {
      openSheet(target.slice(6));
    } else if (['home', 'tournaments', 'rating', 'profile'].indexOf(target) !== -1) {
      goScreen(target);
    }
  }
})();
