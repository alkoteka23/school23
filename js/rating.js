/* =====================================================================
   ЖЕТОНЫ И РЕЙТИНГ МАГАЗИНОВ — интерфейс
   Подключается из index.html. Данные и правила — в supabase_migration_15.sql.

   Что внутри:
   1. Мои жетоны: всего, за месяц, последние начисления (карточка в профиле)
   2. Сообщение «+N жетонов» под результатом теста
   3. Страница «Рейтинг»: итоги месяца по магазинам, выбор месяца
   4. Настройки правил (только редактор / администратор)
   ===================================================================== */
(function () {
  'use strict';

  const MEDAL = ['🥇', '🥈', '🥉'];
  let MY = null, MYERR = '', RK = null, RKERR = '', RKM = null, loadingRk = false;

  const $ = (s, r) => (r || document).querySelector(s);
  const isMissing = e => !!e && (e.code === '42883' || e.code === 'PGRST202' || /my_tokens|shop_rating|function/i.test(e.message || ''));
  const monthName = d => {
    const x = new Date(String(d).slice(0, 10) + 'T12:00:00');
    if (isNaN(x)) return '';
    const t = x.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
  const plural = (n, a, b, c) => {
    const k = Math.abs(n) % 100, j = k % 10;
    return k > 10 && k < 20 ? c : j === 1 ? a : j > 1 && j < 5 ? b : c;
  };
  const tokWord = n => plural(n, 'жетон', 'жетона', 'жетонов');
  const fdate = d => new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });

  /* ================= 1. МОИ ЖЕТОНЫ ================= */
  async function loadMine() {
    if (!sb || !U) return null;
    try {
      const r = await sb.rpc('my_tokens');
      if (r.error) { MY = null; MYERR = isMissing(r.error) ? 'missing' : 'fail' }
      else { MY = r.data; MYERR = '' }
    } catch (e) { MY = null; MYERR = 'fail' }
    return MY;
  }
  const visible = () => !(MY && MY.enabled === false);
  async function warm() { await loadMine(); if (typeof renderTop === 'function') renderTop() }

  function profileBox() {
    if (!U) return '';
    if (MYERR === 'missing') return CAN_EDIT ? '<div class="q rt-warn">Жетоны ещё не подключены: выполните в Supabase файл <b>supabase_migration_15.sql</b>, затем обновите страницу.</div>' : '';
    if (!MY || MY.enabled === false) return '';
    const last = (MY.last || []).slice(0, 8);
    const hist = last.length
      ? '<ul class="rt-hist">' + last.map(x => '<li><span class="rt-plus">+' + x.amount + '</span><span>' + esc(x.note || '') + (x.module_title ? ' · ' + esc(x.module_title) : '') + '</span><span class="ex">' + esc(fdate(x.created_at)) + '</span></li>').join('') + '</ul>'
      : '<p class="ex">Жетоны появятся после первого сданного теста.</p>';
    return '<div class="rep rt-stat"><div><b>' + MY.total + '</b><span>' + tokWord(MY.total) + ' всего</span></div><div><b>' + MY.month + '</b><span>за этот месяц</span></div></div>' +
      '<div class="q"><b>Мои жетоны</b>' + hist + '<p class="ex"><a href="#" id="rtgo">Рейтинг магазинов →</a></p></div>';
  }
  function wireProfile() { const a = $('#rtgo'); if (a) a.onclick = ev => { ev.preventDefault(); goRating() } }

  /* ================= 2. «+N жетонов» ПОСЛЕ ТЕСТА ================= */
  function gainHolder() { return '<div class="rt-gain" id="rtgain" role="status" hidden></div>' }
  async function afterTest(passed) {
    const before = MY ? MY.total : null;
    await loadMine();
    const el = document.getElementById('rtgain');
    if (!el || !MY || MY.enabled === false || before == null) return;
    const d = MY.total - before;
    if (passed && d > 0) { el.hidden = false; el.innerHTML = '<b>+' + d + ' ' + tokWord(d) + '</b> Всего у вас: ' + MY.total + '.' }
  }
  /* Жетоны за кейс начисляются после проверки; обновить счёт при следующем заходе */

  /* ================= 3. СТРАНИЦА «РЕЙТИНГ» ================= */
  function goRating(month) {
    view = 'rating'; RK = null; RKERR = '';
    renderTop(); nav(); draw(); window.scrollTo({ top: 0 });
    loadRating(month);
  }
  async function loadRating(month) {
    if (!sb || loadingRk) return;
    loadingRk = true;
    try {
      const r = await sb.rpc('shop_rating', { p_month: month || null });
      if (r.error) { RK = null; RKERR = isMissing(r.error) ? 'missing' : 'fail' }
      else { RK = r.data; RKM = r.data && r.data.month; RKERR = '' }
    } catch (e) { RK = null; RKERR = 'fail' }
    loadingRk = false;
    if (view === 'rating') draw();
  }

  function viewRating() {
    document.body.classList.remove('home');
    const head = '<div class="crumb"><a href="#" data-cr="h">Главная</a> › Рейтинг</div><h2>Рейтинг магазинов</h2>';
    let body;
    if (RKERR === 'missing') {
      body = '<div class="q rt-warn">Рейтинг ещё не подключён' + (CAN_EDIT ? ': выполните в Supabase файл <b>supabase_migration_15.sql</b>, затем обновите страницу.' : '. Обратитесь в обучающий отдел.') + '</div>';
    } else if (RKERR) {
      body = '<div class="q">Не удалось загрузить рейтинг. Попробуйте обновить страницу.</div>';
    } else if (!RK) {
      body = '<div class="q">Загружаю рейтинг…</div>';
    } else if (RK.enabled === false) {
      body = '<div class="q">Рейтинг сейчас отключён.</div>';
    } else {
      body = ratingBody();
    }
    m.innerHTML = head + body;
    m.querySelectorAll('[data-cr]').forEach(a => a.onclick = ev => { ev.preventDefault(); goHome() });
    const sel = $('#rtm'); if (sel) sel.onchange = () => goRating(sel.value);
    const st = $('#rtset'); if (st) st.onclick = openSettings;
  }

  function ratingBody() {
    const cur = RK.month, rows = RK.rows || [], w = RK.weights || {}, mine = RK.my_shop;
    const set = new Set((RK.months || []).map(x => String(x).slice(0, 10)));
    set.add(String(cur).slice(0, 10));
    const nowM = new Date(); const curM = nowM.getFullYear() + '-' + String(nowM.getMonth() + 1).padStart(2, '0') + '-01';
    set.add(curM);
    const opts = [...set].sort().reverse().map(x => '<option value="' + x + '"' + (x === String(cur).slice(0, 10) ? ' selected' : '') + '>' + esc(monthName(x)) + '</option>').join('');
    const bar = '<div class="rt-bar"><label>Месяц <select id="rtm">' + opts + '</select></label>' +
      (RK.fixed ? '<span class="rt-chip">Итоги зафиксированы</span>' : '<span class="rt-chip live">Идёт сейчас</span>') +
      (CAN_EDIT ? '<button type="button" class="fbtn alt" id="rtset">Настройки</button>' : '') + '</div>';
    const how = '<p class="ex rt-how">Балл складывается из двух частей: жетоны на одного участника (вес ' + (w.tokens || 0) + '%) и доля сотрудников магазина, получивших жетоны в этом месяце (вес ' + (w.share || 0) + '%). Участник — сотрудник, получивший хотя бы один жетон.</p>';
    if (!rows.length) return bar + '<div class="q">За этот месяц данных пока нет. Рейтинг появится, когда сотрудники начнут получать жетоны.</div>' + how;
    const any = rows.some(r => r.tokens > 0);
    let win = '';
    if (any && rows[0]) {
      const top = rows.filter(r => r.place === 1 && r.tokens > 0);
      if (top.length) win = '<div class="rt-win"><img src="fox/cool.webp" alt="" width="96"><div><b>' + (RK.current ? 'Сейчас лидирует' : 'Победитель месяца') + ': ' + top.map(r => esc(r.shop)).join(', ') + '</b><span class="ex">' + top[0].score + ' из 100 баллов</span></div></div>';
    }
    const list = '<ol class="rt-list">' + rows.map(r => {
      const me = mine && r.shop === mine, pct = r.staff ? Math.round(100 * r.participants / r.staff) : 0;
      const per = r.participants ? Math.round(r.tokens / r.participants) : 0;
      return '<li class="rt-row' + (me ? ' me' : '') + (r.place <= 3 && r.tokens > 0 ? ' top' : '') + '"><span class="rt-pl">' + (r.place <= 3 && r.tokens > 0 ? MEDAL[r.place - 1] : r.place) + '</span>' +
        '<div class="rt-main"><div class="rt-name"><b>' + esc(r.shop) + '</b>' + (me ? ' <span class="rt-chip">ваш магазин</span>' : '') + '</div>' +
        '<div class="rt-prog" aria-hidden="true"><i style="width:' + Math.max(0, Math.min(100, r.score)) + '%"></i></div>' +
        '<div class="ex">Участвуют: ' + r.participants + ' из ' + r.staff + ' (' + pct + '%) · жетонов: ' + r.tokens + ' · на участника: ' + per + '</div></div>' +
        '<span class="rt-sc"><b>' + r.score + '</b><span class="ex">балл.</span></span></li>';
    }).join('') + '</ol>';
    return bar + win + list + how;
  }

  /* ================= 4. НАСТРОЙКИ (редактор) ================= */
  const FIELDS = [
    ['tokens_test', 'За сданный тест'],
    ['tokens_test_high', 'Бонус за высокий результат теста'],
    ['tokens_test_first', 'Бонус за сдачу с первой попытки'],
    ['tokens_case', 'За зачтённый кейс'],
    ['tokens_case_high', 'Бонус за высокую оценку кейса'],
    ['tokens_module', 'За полностью пройденный модуль'],
    ['tokens_high_pct', 'Порог «высокого результата», %'],
    ['weight_tokens', 'Вес жетонов в рейтинге, %'],
    ['weight_share', 'Вес доли участников, %'],
    ['min_staff', 'Минимум сотрудников в магазине для рейтинга']
  ];
  async function openSettings() {
    const r = await sb.rpc('get_gamification');
    if (r.error || !r.data) { alert('Не удалось загрузить настройки.'); return }
    const s = r.data;
    const html = '<div class="q fm">' + FIELDS.map(f => '<label class="rt-f">' + esc(f[1]) + '<input type="number" min="0" id="rs_' + f[0] + '" value="' + s[f[0]] + '"></label>').join('') +
      '<label class="rt-f"><span><input type="checkbox" id="rs_enabled"' + (s.enabled ? ' checked' : '') + '> Жетоны и рейтинг включены</span></label>' +
      '<p class="ex">Новые правила действуют на жетоны, начисленные после сохранения. Уже начисленное и зафиксированные итоги прошлых месяцев не пересчитываются.</p>' +
      '<div class="fmsg" id="rsm" role="status"></div></div><div class="dact">' + dbtn('rsv', 'Сохранить', 'btn') + '</div>';
    dlg('Настройки жетонов и рейтинга', html, d => {
      d.querySelector('#rsv').onclick = async () => {
        const p = { enabled: d.querySelector('#rs_enabled').checked };
        for (const f of FIELDS) { const v = parseInt(d.querySelector('#rs_' + f[0]).value, 10); if (isNaN(v) || v < 0) { d.querySelector('#rsm').textContent = 'Проверьте числа: нужны целые значения от 0.'; return } p[f[0]] = v }
        if (p.weight_tokens + p.weight_share === 0) { d.querySelector('#rsm').textContent = 'Хотя бы один вес должен быть больше нуля.'; return }
        if (p.tokens_high_pct < 1 || p.tokens_high_pct > 100) { d.querySelector('#rsm').textContent = 'Порог должен быть от 1 до 100.'; return }
        if (p.min_staff < 1) { d.querySelector('#rsm').textContent = 'Минимум сотрудников — не меньше 1.'; return }
        const x = await sb.rpc('set_gamification', { p });
        if (x.error) { d.querySelector('#rsm').textContent = 'Не удалось сохранить.'; return }
        d.close(); await loadMine(); goRating(RKM);
      };
    });
  }

  window.RT = { warm, loadMine, visible, goRating, viewRating, profileBox, wireProfile, gainHolder, afterTest };
})();
