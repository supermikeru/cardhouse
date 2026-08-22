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
    if (group === 'rating') loadRatingTab(value);
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

  /* ---------- HTML escaping ----------
     Tournament title/subtitle/rules (admin-entered) and player nicknames
     (defaulted from a Telegram username/first_name — settable by ANY user
     via /start, no admin privilege needed) all flow into innerHTML below.
     Escape at every such sink; leave textContent assignments alone (already
     auto-escaped — double-escaping there would show literal "&amp;" etc). */
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ---------- Supabase REST helper ---------- */
  function kdFetch(path) {
    var base = (window.KD_SUPABASE_URL || '').replace(/\/$/, '');
    var key = window.KD_SUPABASE_ANON_KEY || '';
    return fetch(base + '/rest/v1/' + path, {
      headers: { apikey: key, Authorization: 'Bearer ' + key }
    }).then(function (res) {
      if (!res.ok) throw new Error('Supabase ' + res.status + ' on ' + path);
      return res.json();
    });
  }

  function kdViewerTelegramId() {
    try {
      return (tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id) || null;
    } catch (e) { return null; }
  }

  var RU_MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  var RU_WEEKDAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  function fmtDate(iso) {
    var d = new Date(iso);
    return d.getDate() + ' ' + RU_MONTHS[d.getMonth()] + ', ' + RU_WEEKDAYS[d.getDay()];
  }
  function fmtTime(iso) {
    var d = new Date(iso), h = d.getHours(), m = d.getMinutes();
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }
  function fmtPoints(n) {
    return Number(n || 0).toLocaleString('en-US');
  }

  /* ---------- Tournaments: loaded from Supabase + list render + detail screen ---------- */
  var TOURNAMENTS = [];

  function mapTournamentRow(row, myResult) {
    var t = {
      id: String(row.id), status: row.status, img: row.image_url || 'assets/img/gate-scene.jpg',
      title: row.title, subtitle: row.subtitle || '',
      date: fmtDate(row.starts_at), time: fmtTime(row.starts_at),
      seatsTaken: row.seats_taken, seatsTotal: row.seats_total, registered: false,
      desc: row.description || '', rules: row.rules || []
    };
    if (row.status === 'past') {
      t.place = myResult ? myResult.place : '—';
      t.points = myResult ? myResult.points : 0;
    }
    return t;
  }

  function loadAndRenderTournaments() {
    var upcomingEl = document.querySelector('[data-panel="tournaments-upcoming"]');
    var pastEl = document.querySelector('[data-panel="tournaments-past"]');
    [upcomingEl, pastEl].forEach(function (el) { if (el) el.innerHTML = '<div class="empty-state">Загрузка…</div>'; });

    var tgId = kdViewerTelegramId();
    var myResultsPromise = tgId
      ? kdFetch('players?telegram_user_id=eq.' + tgId + '&select=id').then(function (players) {
          if (!players.length) return {};
          return kdFetch('tournament_results?player_id=eq.' + players[0].id + '&select=tournament_id,place,points').then(function (results) {
            var map = {};
            results.forEach(function (r) { map[r.tournament_id] = r; });
            return map;
          });
        }).catch(function () { return {}; })
      : Promise.resolve({});

    Promise.all([kdFetch('tournaments?select=*&order=starts_at.asc'), myResultsPromise])
      .then(function (res) {
        TOURNAMENTS = res[0].map(function (row) { return mapTournamentRow(row, res[1][row.id]); });
        renderTournamentLists();
      })
      .catch(function () {
        [upcomingEl, pastEl].forEach(function (el) { if (el) el.innerHTML = '<div class="empty-state">Не удалось загрузить турниры</div>'; });
        showToast('Не удалось загрузить турниры');
      });
  }

  function tCardHTML(t) {
    var titleHTML = escapeHtml(t.title) + (t.subtitle ? '<em>' + escapeHtml(t.subtitle) + '</em>' : '');
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
    document.querySelector('[data-td="title"]').innerHTML = escapeHtml(t.title) + (t.subtitle ? '<em>' + escapeHtml(t.subtitle) + '</em>' : '');
    document.querySelector('[data-td="desc"]').textContent = t.desc;
    document.querySelector('[data-td="rules"]').innerHTML = t.rules.map(function (r) { return '<li>' + escapeHtml(r) + '</li>'; }).join('');

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

  loadAndRenderTournaments();

  /* ---------- Rating: loaded from Supabase + render ---------- */
  var RANK_CLASS = { Rookie: 'rank-rookie', Fish: 'rank-fish', Grinder: 'rank-grinder', Silver: 'rank-silver' };
  var GRAD = [
    'linear-gradient(145deg,#8FB8D6,#4d6f89)',
    'linear-gradient(145deg,var(--brass),#8a6f45)',
    'linear-gradient(145deg,#C69C6D,#7a5a37)',
    'linear-gradient(145deg,#9C8558,#5c4b30)',
    'linear-gradient(145deg,#7FA07C,#3f5a3c)'
  ];

  var RATING = { season: null, all: null, special: null };
  var GOLD_GRAD = 'linear-gradient(145deg,var(--gold),#8a6f2f)';

  function podiumItem(r, grad) {
    return { name: r.name, points: r.points, avatar: r.name.charAt(0).toUpperCase(), grad: grad };
  }
  function mapRatingRow(row) {
    return {
      pos: row.pos, name: row.nickname, rank: row.rank, bounty: row.bounty,
      points: fmtPoints(row.points), base: row.points, bonus: 0,
      telegram_user_id: row.telegram_user_id
    };
  }
  function renderProfileTop3() {
    // Separate static widget on the Профиль screen (not one of the .podium__item
    // elements renderRating() updates) — mirrors the season podium there.
    var wrap = document.querySelector('[data-profile-top3]');
    if (!wrap || !RATING.season) return;
    var podium = RATING.season.podium; // [2nd, 1st, 3rd], see loadRatingTab
    var byRank = { 1: podium[1], 2: podium[0], 3: podium[2] };
    [1, 2, 3].forEach(function (rank) {
      var row = wrap.querySelector('[data-profile-top="' + rank + '"]');
      if (!row) return;
      var p = byRank[rank];
      if (!p) { row.hidden = true; return; }
      row.hidden = false;
      row.querySelector('.avatar').textContent = p.avatar;
      row.querySelector('.avatar').style.background = p.grad;
      row.querySelector('.rate-row__name').textContent = p.name;
      row.querySelector('.rate-row__points').innerHTML = '<svg fill="currentColor"><use href="#i-diamond"/></svg>' + p.points;
    });
  }

  function loadRatingTab(tab) {
    if (RATING[tab]) { renderRating(tab); return; }
    if (rateListEl) rateListEl.innerHTML = '<div class="empty-state">Загрузка…</div>';
    var view = tab === 'season' ? 'v_rating_season' : tab === 'special' ? 'v_rating_special' : 'v_rating_all';
    kdFetch(view + '?select=*&order=pos.asc')
      .then(function (data) {
        var mapped = data.map(mapRatingRow);
        var top3 = mapped.slice(0, 3);
        var podium = top3.length === 3
          ? [podiumItem(top3[1], GRAD[0]), podiumItem(top3[0], GOLD_GRAD), podiumItem(top3[2], GRAD[2])]
          : [];
        var tgId = kdViewerTelegramId();
        var me = tgId ? mapped.filter(function (r) { return r.telegram_user_id === tgId; })[0] : null;
        RATING[tab] = { podium: podium, rows: mapped.slice(3, 9), me: me || null };
        renderRating(tab);
        if (tab === 'season') renderProfileTop3();
      })
      .catch(function () {
        RATING[tab] = { podium: [], rows: [], me: null };
        renderRating(tab);
        if (tab === 'season') renderProfileTop3();
        showToast('Не удалось загрузить рейтинг');
      });
  }

  var podiumEls = document.querySelectorAll('.podium__item');
  var rateListEl = document.querySelector('[data-rate-list]');

  function fmtRank(r) {
    // r is always one of our own rank_tiers names (server-computed), never user text.
    return '<span class="rate-row__rank ' + (RANK_CLASS[r] || '') + '">' + r + '</span>';
  }

  function rowHTML(row, extraClass, grad) {
    // row.name is a player nickname — defaults to the player's own Telegram
    // username/first_name on /start, so it's attacker-controlled text with no
    // admin privilege required. Must be escaped before going into innerHTML.
    var safeName = escapeHtml(row.name);
    return (
      '<div class="rate-row-wrap' + (extraClass ? ' ' + extraClass : '') + '">' +
        '<div class="rate-row' + (extraClass ? ' ' + extraClass : '') + '" data-row-toggle>' +
          '<span class="rate-row__pos">#' + row.pos + '</span>' +
          '<span class="avatar avatar--xs" style="background:' + (grad || GRAD[row.pos % GRAD.length]) + '">' + escapeHtml(row.name.charAt(0)) + '</span>' +
          '<span class="rate-row__body"><span class="rate-row__name">' + safeName + '</span>' + fmtRank(row.rank) + '</span>' +
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
      var ptsEl = el.querySelector('.podium__points');
      if (!p) {
        // No real data yet (e.g. nobody registered/played this season) — clear
        // the design-time placeholder markup instead of leaving fake names
        // (Acidhouze_/starzzen/Randevu) on screen looking like real results.
        el.querySelector('.avatar').textContent = '';
        el.querySelector('.avatar').style.background = 'var(--line, #4a3a3a)';
        el.querySelector('.podium__name').textContent = '—';
        ptsEl.innerHTML = '';
        return;
      }
      el.querySelector('.avatar').textContent = p.avatar;
      el.querySelector('.avatar').style.background = p.grad;
      el.querySelector('.podium__name').textContent = p.name;
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

  loadRatingTab('season');

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

  /* ---------- Deep link from bot announcement: t.me/<bot>/<app>?startapp=t_<id> ----------
     Telegram delivers this via initDataUnsafe.start_param, not the URL hash. TOURNAMENTS
     loads asynchronously (loadAndRenderTournaments), so poll briefly until it's populated
     rather than racing the fetch. */
  (function () {
    var startParam;
    try { startParam = tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param; } catch (e) { startParam = null; }
    if (!startParam || startParam.indexOf('t_') !== 0) return;
    var tid = startParam.slice(2);
    var attempts = 0;
    (function tryOpen() {
      attempts++;
      if (TOURNAMENTS.length) { openTournamentDetail(tid); }
      else if (attempts < 40) { setTimeout(tryOpen, 150); }
    })();
  })();
})();
