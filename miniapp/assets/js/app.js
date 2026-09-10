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
        if (document.hidden) return;
        nudge();
        // Coming back from the background after tournaments/rating failed
        // to load (or never got the chance to, if the WebView was
        // suspended mid-fetch) — retry instead of leaving the screen
        // stuck on its error state until the user force-closes the app.
        if (tournamentsFailed) loadAndRenderTournaments();
        if (ratingFailed.season) { RATING.season = null; loadRatingTab('season'); }
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
    var ADDRESS_TEXT = 'Санкт-Петербург, Полтавская ул., 7';
    var ADDRESS_MAP_URL = 'https://yandex.ru/maps/-/CThKz-07';
    var addressSub = addressRow.querySelector('.list-row__sub');
    addressRow.addEventListener('click', function () {
      // First tap just reveals the address (deliberately hidden by default,
      // same "invite-only" spirit as the marketing site's location section).
      // Only a tap once it's showing — i.e. on the address itself — opens the map.
      if (addressSub && !addressSub.textContent) {
        addressSub.textContent = ADDRESS_TEXT;
        return;
      }
      if (tg && tg.openLink) tg.openLink(ADDRESS_MAP_URL);
      else window.open(ADDRESS_MAP_URL, '_blank');
    });
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
    // A request that never settles (e.g. the WebView got backgrounded
    // mid-fetch and the connection died silently on resume) used to leave
    // the screen on "Загрузка…" forever — nothing downstream ever got a
    // resolve or a reject to react to. Abort after 12s so it always ends
    // up in the existing .catch() error handling instead.
    var controller = window.AbortController ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 12000) : null;
    return fetch(base + '/rest/v1/' + path, {
      headers: { apikey: key, Authorization: 'Bearer ' + key },
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error('Supabase ' + res.status + ' on ' + path);
      return res.json();
    }, function (err) {
      clearTimeout(timer);
      throw err;
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

  function mapTournamentRow(row, myResult, isRegistered) {
    // row.status only flips to 'past' when the admin uploads results for the
    // tournament (bot/handlers/results.py, mark_tournament_finished) — that
    // can happen a day or more after the event. Treat a tournament as past
    // the moment its start time has elapsed too, so it moves to the "Прошедшие"
    // list right away instead of waiting on that upload. myResult naturally
    // stays undefined until results actually land, so the place/points fall
    // back to the existing "—" placeholder below.
    var isPast = row.status === 'past' || new Date(row.starts_at).getTime() <= Date.now();
    var t = {
      id: String(row.id), status: isPast ? 'past' : 'upcoming', img: row.image_url || 'assets/img/gate-scene.jpg',
      title: row.title, subtitle: row.subtitle || '',
      date: fmtDate(row.starts_at), time: fmtTime(row.starts_at),
      seatsTaken: row.seats_taken, seatsTotal: row.seats_total, registered: !!isRegistered,
      desc: row.description || '', rules: row.rules || []
    };
    if (isPast) {
      t.place = myResult ? myResult.place : '—';
      t.points = myResult ? myResult.points : 0;
    }
    return t;
  }

  var tournamentsFailed = false;

  function loadAndRenderTournaments() {
    tournamentsFailed = false;
    var upcomingEl = document.querySelector('[data-panel="tournaments-upcoming"]');
    var pastEl = document.querySelector('[data-panel="tournaments-past"]');
    [upcomingEl, pastEl].forEach(function (el) { if (el) el.innerHTML = '<div class="empty-state">Загрузка…</div>'; });

    // Registration itself only ever happens via the "Записаться на игру"
    // button on the bot's own announcement message (a real Telegram
    // callback, so the bot always knows exactly who tapped it) — the mini
    // app only reads tournament_registrations here, to show "Вы записаны"
    // context and populate История игр → Активные.
    var tgId = kdViewerTelegramId();
    var myDataPromise = tgId
      ? kdFetch('players?telegram_user_id=eq.' + tgId + '&select=id').then(function (players) {
          if (!players.length) return { results: {}, registered: {} };
          var pid = players[0].id;
          // Каждый подзапрос со своим catch: если, скажем, tournament_registrations
          // ещё не существует (миграция 003 не применена), это не должно
          // портить уже рабочие tournament_results, и наоборот.
          var resultsP = kdFetch('tournament_results?player_id=eq.' + pid + '&select=tournament_id,place,points')
            .then(function (rows) { var m = {}; rows.forEach(function (r) { m[r.tournament_id] = r; }); return m; })
            .catch(function () { return {}; });
          var registeredP = kdFetch('tournament_registrations?player_id=eq.' + pid + '&select=tournament_id')
            .then(function (rows) { var m = {}; rows.forEach(function (r) { m[r.tournament_id] = true; }); return m; })
            .catch(function () { return {}; });
          return Promise.all([resultsP, registeredP]).then(function (res) {
            return { results: res[0], registered: res[1] };
          });
        }).catch(function () { return { results: {}, registered: {} }; })
      : Promise.resolve({ results: {}, registered: {} });

    Promise.all([kdFetch('tournaments?select=*&order=starts_at.asc'), myDataPromise])
      .then(function (res) {
        var mine = res[1];
        TOURNAMENTS = res[0].map(function (row) { return mapTournamentRow(row, mine.results[row.id], mine.registered[row.id]); });
        renderTournamentLists();
        renderHistory();
      })
      .catch(function () {
        tournamentsFailed = true;
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

  /* ---------- "История игр" on the Профиль screen: Активные is upcoming
     tournaments the player registered for via the bot's own announcement
     button (bot/handlers/registrations.py — a real Telegram callback, not
     anything the mini app writes); Прошедшие is tournaments actually played
     (place !== '—' means a tournament_results row exists for the viewer).
     Both reuse tCardHTML, the same card Турниры → Актуальные/Прошедшие
     already render. ---------- */
  function fillHistoryPanel(panelSelector, list) {
    var el = document.querySelector(panelSelector);
    if (!el || !list.length) return; // leave the "Турниров ещё нет" placeholder
    el.innerHTML = list.map(tCardHTML).join('');
    el.querySelectorAll('[data-open-detail]').forEach(function (btn) {
      btn.addEventListener('click', function () { openTournamentDetail(btn.dataset.openDetail); });
    });
  }

  function renderHistory() {
    fillHistoryPanel('[data-panel="history-active"]', TOURNAMENTS.filter(function (t) { return t.status === 'upcoming' && t.registered; }));
    fillHistoryPanel('[data-panel="history-past"]', TOURNAMENTS.filter(function (t) { return t.status === 'past' && t.place !== undefined && t.place !== '—'; }));
  }

  var currentDetailId = null;

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

    window.scrollTo(0, 0);
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

  /* ---------- Avatars: real Telegram photo if we have one (players.avatar_url,
     fetched once by the bot at registration — see bot/avatars.py), else the
     existing colored-initial placeholder. Two variants: one mutates an
     existing DOM element (podium/profile widgets), one builds an HTML string
     (rating list rows, built via innerHTML). ---------- */
  function setAvatar(el, name, avatarUrl, grad) {
    if (!el) return;
    if (avatarUrl) {
      el.classList.add('avatar--photo');
      el.style.background = '';
      el.style.backgroundImage = 'url(' + avatarUrl + ')';
      el.textContent = '';
    } else {
      el.classList.remove('avatar--photo');
      el.style.backgroundImage = '';
      if (grad) el.style.background = grad; // grad omitted = leave the element's own default alone
      el.textContent = name ? name.charAt(0).toUpperCase() : '';
    }
  }
  function avatarHTML(name, avatarUrl, grad, sizeClass) {
    var cls = 'avatar' + (sizeClass ? ' ' + sizeClass : '') + (avatarUrl ? ' avatar--photo' : '');
    var style = avatarUrl ? 'background-image:url(' + escapeHtml(avatarUrl) + ')' : 'background:' + grad;
    var inner = avatarUrl ? '' : escapeHtml(name.charAt(0));
    return '<span class="' + cls + '" style="' + style + '">' + inner + '</span>';
  }

  function podiumItem(r, grad) {
    return { name: r.name, points: r.points, avatarUrl: r.avatar_url, grad: grad };
  }
  function mapRatingRow(row) {
    return {
      pos: row.pos, name: row.nickname, rank: row.rank, bounty: row.bounty,
      points: fmtPoints(row.points), base: row.points, bonus: 0,
      telegram_user_id: row.telegram_user_id, player_id: row.player_id, avatar_url: row.avatar_url
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
      if (!p) {
        // row.hidden isn't enough here — .rate-row's own display rule in
        // styles.css has equal specificity to [hidden] and wins by cascade
        // order, so the row would stay visible with blank fields. Use a
        // placeholder instead, same as the main podium fallback above.
        setAvatar(row.querySelector('.avatar'), '', null, 'var(--line, #4a3a3a)');
        row.querySelector('.rate-row__name').textContent = '—';
        row.querySelector('.rate-row__points').innerHTML = '';
        return;
      }
      setAvatar(row.querySelector('.avatar'), p.name, p.avatarUrl, p.grad);
      row.querySelector('.rate-row__name').textContent = p.name;
      row.querySelector('.rate-row__points').innerHTML = '<svg fill="currentColor"><use href="#i-diamond"/></svg>' + p.points;
    });
  }

  /* ---------- Personal profile card: name/avatar/points/rank come from the
     viewer's own row in the season rating (already fetched for the rating
     screen); handle, tier progress and games/wins/streak are separate,
     cheap follow-up queries so they don't hold up the fields above. ---------- */
  function renderMyProfile() {
    var me = RATING.season && RATING.season.me;
    if (!me) return; // never /start'ed the bot — leave the design-time placeholder

    document.querySelectorAll('.mini-profile__name, .profile-card__name, .qr-sheet__name').forEach(function (el) {
      el.textContent = me.name;
    });
    // No grad passed here — falls back to whichever placeholder gradient is
    // already on the element rather than picking a new one for "yourself".
    setAvatar(document.querySelector('.mini-profile .avatar'), me.name, me.avatar_url, null);
    setAvatar(document.querySelector('.profile-card > .avatar'), me.name, me.avatar_url, null);

    var miniPoints = document.querySelector('.mini-profile__points');
    if (miniPoints) miniPoints.innerHTML = '<svg fill="currentColor"><use href="#i-diamond"/></svg>' + me.points;
    var cardPoints = document.querySelector('.profile-card__points');
    if (cardPoints) cardPoints.innerHTML = '<svg fill="currentColor"><use href="#i-diamond"/></svg>' + me.points + ' очков';

    var badgeHTML = '<span class="rank-badge__icon"><svg viewBox="0 0 16 16" fill="currentColor"><use href="#i-diamond"/></svg></span>' + me.rank;
    document.querySelectorAll('.mini-profile .rank-badge, .profile-card .rank-badge').forEach(function (el) {
      el.className = 'rank-badge ' + (RANK_CLASS[me.rank] || '');
      el.innerHTML = badgeHTML;
    });

    kdFetch('rank_tiers?select=name,min_points&order=min_points.asc')
      .then(function (tiers) {
        var nextEl = document.querySelector('.profile-card__next');
        if (!nextEl) return;
        var next = tiers.filter(function (t) { return t.min_points > me.base; })[0];
        nextEl.hidden = !next;
        if (next) nextEl.textContent = 'до ' + next.name + ': ' + (next.min_points - me.base);
      })
      .catch(function () { /* leave design-time placeholder */ });

    if (!me.player_id) return;

    var handleEl = document.querySelector('.profile-card__handle');
    if (handleEl) {
      kdFetch('players?id=eq.' + me.player_id + '&select=telegram_username')
        .then(function (rows) {
          var username = rows[0] && rows[0].telegram_username;
          handleEl.hidden = !username;
          if (username) handleEl.textContent = '@' + username;
        })
        .catch(function () { handleEl.hidden = true; });
    }

    // Career totals across every tournament the player has a result in — not
    // scoped to the current season like the points above, since "games
    // played" / "win streak" read naturally as lifetime stats.
    kdFetch('tournament_results?player_id=eq.' + me.player_id + '&select=place,tournaments(starts_at)')
      .then(function (rows) {
        rows.sort(function (a, b) { return new Date(a.tournaments.starts_at) - new Date(b.tournaments.starts_at); });
        var wins = rows.filter(function (r) { return r.place === 1; }).length;
        var streak = 0;
        for (var i = rows.length - 1; i >= 0 && rows[i].place === 1; i--) streak++;

        var gamesEl = document.querySelector('[data-stat="games"]');
        var winsEl = document.querySelector('[data-stat="wins"]');
        var streakEl = document.querySelector('[data-stat="streak"]');
        if (gamesEl) gamesEl.textContent = rows.length;
        if (winsEl) winsEl.textContent = wins;
        if (streakEl) streakEl.textContent = streak > 0 ? streak : '—';
      })
      .catch(function () { /* leave design-time placeholder */ });
  }

  var ratingFailed = { season: false, all: false, special: false };

  function loadRatingTab(tab) {
    if (RATING[tab]) { renderRating(tab); return; }
    ratingFailed[tab] = false;
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
        if (tab === 'season') { renderProfileTop3(); renderMyProfile(); }
      })
      .catch(function () {
        ratingFailed[tab] = true;
        RATING[tab] = { podium: [], rows: [], me: null };
        renderRating(tab);
        if (tab === 'season') { renderProfileTop3(); renderMyProfile(); }
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
          avatarHTML(row.name, row.avatar_url, grad || GRAD[row.pos % GRAD.length], 'avatar--xs') +
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
        setAvatar(el.querySelector('.avatar'), '', null, 'var(--line, #4a3a3a)');
        el.querySelector('.podium__name').textContent = '—';
        ptsEl.innerHTML = '';
        return;
      }
      setAvatar(el.querySelector('.avatar'), p.name, p.avatarUrl, p.grad);
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

  /* ---------- Onboarding: nickname (shown once, prefilled with the real nickname) ---------- */
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
  if (nickInput) nickInput.addEventListener('input', validateNickname);
  if (nickConfirm) {
    nickConfirm.addEventListener('click', function () {
      if (!validateNickname()) return;
      closeSheet('nickname');
    });
  }

  (function () {
    var overlay = document.querySelector('[data-sheet-overlay="nickname"]');
    if (!overlay || !nickInput) return;

    // "First launch" is tracked per Telegram user in localStorage (there's no
    // server-side flag for it) — covers confirm, the Отмена button, and
    // tapping outside the sheet, since all three just flip data-open to
    // false rather than funnelling through one handler.
    var tgId = kdViewerTelegramId();
    var onboardKey = 'kd_nickname_onboarded_' + (tgId || 'guest');
    var alreadySeen;
    try { alreadySeen = localStorage.getItem(onboardKey) === '1'; } catch (e) { alreadySeen = false; }
    new MutationObserver(function () {
      if (overlay.getAttribute('data-open') !== 'true') {
        try { localStorage.setItem(onboardKey, '1'); } catch (e) { /* ignore */ }
      }
    }).observe(overlay, { attributes: true, attributeFilter: ['data-open'] });

    if (alreadySeen) return;

    var fallbackName = (tg && tg.initDataUnsafe && tg.initDataUnsafe.user &&
      (tg.initDataUnsafe.user.username || tg.initDataUnsafe.user.first_name)) || '';
    var currentNickname = tgId
      ? kdFetch('players?telegram_user_id=eq.' + tgId + '&select=nickname').then(function (rows) {
          return (rows[0] && rows[0].nickname) || fallbackName;
        }).catch(function () { return fallbackName; })
      : Promise.resolve(fallbackName);

    currentNickname.then(function (name) {
      nickInput.value = name;
      validateNickname();
      openSheet('nickname');
    });
  })();

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
