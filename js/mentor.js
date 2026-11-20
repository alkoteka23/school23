/* =====================================================================
   НАСТАВНИЧЕСТВО — интерфейс
   Подключается из index.html. Данные и правила — в supabase_migration_17.sql
   и supabase_migration_18.sql.

   Что внутри:
   1. Профиль: приглашение стать наставником, «Твой наставник» (помощь,
      открепление), подопечные наставника, копилка баллов, бейджи
   2. Колокольчик: уведомления наставника
   3. Панель «Наставничество» (руководитель, редактор): заявки, сигналы,
      закрепление, архив, настройки (настройки — только редактор)
   4. Отчёт «Эффективность наставников» (вкладка в «Отчётах»)
   ===================================================================== */
(function () {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const plural = (n, a, b, c) => {
    const k = Math.abs(n) % 100, j = k % 10;
    return k > 10 && k < 20 ? c : j === 1 ? a : j > 1 && j < 5 ? b : c;
  };
  const fd = d => d ? new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
  const fs = d => d ? new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) : '';
  /* ФИО у нас «Фамилия Имя»: в тексте уведомлений берём имя */
  const first = n => { const p = String(n || '').trim().split(/\s+/); return p[1] || p[0] || '' };
  const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
  const nz = v => v == null ? '—' : v + '%';
  const nn = v => v == null ? '—' : v;

  let MYM = null, NOTES = null;                         /* подопечные и уведомления наставника */
  let APPS = null, APPST = 'pending', SIG = null, ASG = null, ARC = null, SET = null, RPT = null, RPTERR = false;
  let MTAB = 'apps', MPEND = 0, MSIG = 0, LOADERR = false;

  const REASON = {
    mentor_left: 'наставник отказался от наставничества',
    removed: 'наставника сняли с подопечного',
    mentee_left: 'по просьбе подопечного',
    admin: 'откреплён руководителем',
    completed: 'программа пройдена'
  };

  const errText = e => {
    const s = (e && e.message) || '';
    if (/no_capacity/.test(s)) return 'У наставника уже максимум подопечных.';
    if (/already_has_mentor/.test(s)) return 'У этого сотрудника уже есть наставник.';
    if (/not_mentor/.test(s)) return 'Этот сотрудник не является наставником.';
    if (/not_pending/.test(s)) return 'Заявка уже рассмотрена.';
    if (/self_review/.test(s)) return 'Нельзя рассматривать собственную заявку.';
    if (/course_not_passed/.test(s)) return 'Сначала нужно пройти курс по наставничеству.';
    if (/not_eligible/.test(s)) return 'Пока не выполнены условия для наставника.';
    if (/too_soon/.test(s)) return 'Вы уже просили помощи недавно. Наставник получил сообщение, попробуйте позже.';
    if (/no_mentor/.test(s)) return 'У вас сейчас нет наставника.';
    if (/reason_required/.test(s)) return 'Напишите причину (хотя бы несколько слов).';
    if (/not_found/.test(s)) return 'Запись не найдена: возможно, её уже изменили. Обновите страницу.';
    if (/already/.test(s)) return 'Это уже сделано.';
    if (/not_enabled/.test(s)) return 'Наставничество сейчас выключено.';
    if (/forbidden/.test(s)) return 'Недостаточно прав.';
    return 'Не удалось выполнить действие. Попробуйте ещё раз.';
  };

  /* Правила начисления баллов: один текст для профиля и отчёта */
  const matrixHtml = () => `<details class="mn-how"><summary>Как начисляются баллы наставнику</summary><div class="mn-mx">
    <p>Оцениваются три параметра: срок (от закрепления до сдачи последнего модуля), средний балл подопечного по модулям и среднее число попыток теста на модуль.</p>
    <ul>
      <li><strong>2 балла</strong>: срок до 2 месяцев, средний балл от 80%, не больше 2 попыток на модуль.</li>
      <li><strong>1 балл</strong>: срок 2–3 месяца при среднем балле от 80% и не больше 2 попыток; или срок до 2 месяцев, но попыток больше 2.</li>
      <li><strong>0 баллов</strong>: срок 3–4 месяца, средний балл ниже 70% или другие случаи.</li>
      <li><strong>Провал</strong>: срок больше 4 месяцев. Баллов нет, в профиле появляется флаг «Требует пересмотра статуса».</li>
    </ul>
    <p>За успешное завершение (от 1 балла) наставник получает бонусные жетоны и бейдж «Наставник-год». Если подопечный сменил наставника, баллы и бонус за эту пару не начисляются.</p></div></details>`;

  /* ================= СТАТУС ТЕКУЩЕГО СОТРУДНИКА ================= */
  async function loadNotes() {
    try {
      const r = await sb.rpc('mentor_notes_list');
      NOTES = r.error ? [] : (r.data || []);
    } catch (e) { NOTES = [] }
  }
  async function loadMentees() {
    try {
      const [a, b] = await Promise.all([sb.rpc('mentor_my_mentees'), sb.rpc('mentor_notes_list')]);
      MYM = a.error ? [] : (a.data || []);
      NOTES = b.error ? [] : (b.data || []);
    } catch (e) { MYM = []; NOTES = [] }
  }

  /* Загрузка статуса. Курс по наставничеству скрыт от тех, кто ещё не дорос до него */
  async function load(withMentees) {
    if (!sb || !U) return;
    let st = null;
    try {
      const r = await sb.rpc('mentor_status');
      st = r.error ? { enabled: false, missing: true } : r.data;
    } catch (e) { st = { enabled: false } }
    MENT = st || { enabled: false };
    MENT.edit = !!CAN_EDIT;
    setD(); buildP();
    if (withMentees && (MENT.is_mentor || +MENT.mentees > 0)) await loadMentees();
    renderTop();
  }

  async function onProf() {
    await load(true);
    if (view === 'prof') draw();
  }

  /* после теста: вдруг пройден курс, набран нужный уровень или завершено наставничество */
  function afterTest() {
    load(false).then(() => { if (view === 'prof') draw() });
  }

  const goCourse = () => {
    const d = D.find(x => String(x.id) === String(MENT && MENT.course_module));
    if (d) goModule(d.n); else alert('Курс по наставничеству пока недоступен. Обратитесь к администратору портала.');
  };

  /* ================= 1. ПРОФИЛЬ ================= */
  function menteeCard(x) {
    const p = pct(x.done, x.total), th = (MENT && MENT.notify_below) || 70;
    const need = (x.modules || []).filter(m => !m.done && m.attempts > 0 && m.best != null && m.best < th);
    return `<div class="q mn-m"><div class="mn-h"><b>${esc(x.name)}</b><span class="ex">${esc([x.job_title, x.shop].filter(Boolean).join(' · '))}</span></div>
      <div class="pbar" role="progressbar" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100"><i style="width:${p}%"></i></div>
      <div class="ex">Пройдено модулей: ${x.done} из ${x.total} · средний балл: ${nz(x.avg)} · последняя активность: ${x.last_at ? fd(x.last_at) : 'ещё не начинал(а)'} · с вами с ${fs(x.since)}</div>
      ${need.length ? `<div class="mn-warn">Нужна помощь: ${need.map(m => esc(m.id) + ' (' + m.best + '%)').join(', ')}</div>` : ''}
      <div class="fa" style="margin-top:8px"><button type="button" class="fbtn alt" data-md="${esc(x.id)}">Подробнее</button>
      <button type="button" class="fbtn alt" data-rs="${esc(x.id)}">Сложить полномочия</button></div></div>`;
  }

  function mentorHtml() {
    const badges = (MENT.badges || []).map(b => `<span class="mn-badge">🏅 ${esc(b)}</span>`).join('');
    let h = `<div class="q mn-st mn-ok"><b>Вы наставник</b>
      <div class="ex">Подопечных сейчас: ${+MENT.mentees || 0}. Если результат подопечного ниже ${MENT.notify_below || 70}%, придёт уведомление (значок колокольчика вверху).</div>
      <div class="mn-stats"><span><strong>${+MENT.points || 0}</strong> ${plural(+MENT.points || 0, 'балл', 'балла', 'баллов')} в копилке</span><span><strong>${+MENT.completed || 0}</strong> завершено</span></div>
      ${badges ? '<div class="mn-badges">' + badges + '</div>' : ''}
      ${MENT.flag ? '<div class="mn-warn">Требует пересмотра статуса: срок одного из наставничеств превысил 4 месяца. Руководитель рассмотрит ваш статус.</div>' : ''}
      ${matrixHtml()}</div>`;
    if (!MYM) h += '<div class="q">Загружаю подопечных…</div>';
    else if (!MYM.length) h += '<div class="empty">Пока подопечных нет. Как только руководитель закрепит за вами новичка, он появится здесь.</div>';
    else h += MYM.map(menteeCard).join('');
    return h;
  }

  function menteeHtml() {
    const rq = MENT.leave_request, pend = rq && rq.status === 'pending';
    const rej = rq && rq.status === 'rejected' && rq.decided_at && (Date.now() - new Date(rq.decided_at)) < 7 * 864e5;
    return `<div class="q mn-st"><div class="mn-my"><div class="mn-ico" aria-hidden="true">🤝</div><div><b>Твой наставник: ${esc(MENT.mentor.name)}</b>
      <div class="ex">${esc([MENT.mentor.job_title, MENT.mentor.shop].filter(Boolean).join(' · '))}${MENT.mentor.since ? ' · с ' + fs(MENT.mentor.since) : ''}</div>
      <div class="ex">Если что-то непонятно, обращайся к нему. Наставник видит твой прогресс в обучении.</div></div></div>
      ${pend ? `<div class="ex" style="margin-top:8px">Запрос на смену наставника отправлен ${fd(rq.created_at)}. Ждём решения руководителя.</div>` : ''}
      ${rej ? `<div class="ex" style="margin-top:8px">Запрос на смену наставника отклонён ${fd(rq.decided_at)}.</div>` : ''}
      <div class="fa" style="margin-top:10px"><button type="button" class="btn" data-mn="help">Попросить помощь</button>
      ${pend ? '' : '<button type="button" class="fbtn alt" data-mn="leave">Открепить наставника</button>'}</div></div>`;
  }

  function candidateHtml() {
    const a = MENT.app;
    if (a && a.status === 'pending')
      return `<div class="q mn-st"><b>Заявка на наставничество на рассмотрении</b><div class="ex">Подана ${fd(a.created_at)}. Решение появится здесь, в профиле.</div></div>`;
    let h = '';
    if (a && a.status === 'rejected')
      h += `<div class="q mn-st mn-no"><b>Заявка отклонена</b>${a.reason ? '<div>Причина: ' + esc(a.reason) + '</div>' : ''}<div class="ex">${fd(a.decided_at)}</div></div>`;
    if (!MENT.eligible) return h;
    if (MENT.hidden)
      return h + '<p class="ex mn-lnk">Вы можете стать наставником. <button type="button" class="lnk" data-mn="apply">Подать заявку</button></p>';
    const course = !MENT.course_module
      ? '<div class="ex">Курс по наставничеству пока не настроен. Обратитесь к администратору портала.</div>'
      : MENT.course_ok
        ? `<div class="ex">Курс по наставничеству пройден (${MENT.course_best}%). Осталось отправить заявку.</div>`
        : `<div class="ex">Сначала нужно пройти короткий курс по наставничеству: теория и тест, не меньше ${MENT.course_min}%.</div>`;
    return h + `<div class="mn-ban"><img src="fox/cool.webp" alt=""><div><b>Вы достигли уровня, чтобы стать наставником!</b>
      <p>Хотите помочь новичкам? У вас пройдено модулей: ${MENT.done}, средний балл ${nz(MENT.avg)}.</p>${course}
      <div class="fa" style="margin-top:10px"><button type="button" class="btn" data-mn="apply"${MENT.course_module ? '' : ' disabled'}>${MENT.course_ok ? 'Отправить заявку' : 'Подать заявку'}</button>
      <button type="button" class="fbtn alt" data-mn="hide">Скрыть</button></div></div></div>`;
  }

  function profBox() {
    if (!MENT || MENT.missing) return '';
    let h = '';
    if (MENT.mentor) h += menteeHtml();
    if (MENT.is_mentor || +MENT.mentees > 0) h += mentorHtml();
    else if (MENT.enabled) h += candidateHtml();
    return h ? '<h3 class="psec">Наставничество</h3>' + h : '';
  }

  function detailDlg(id) {
    const x = (MYM || []).find(y => String(y.id) === String(id));
    if (!x) return;
    const th = (MENT && MENT.notify_below) || 70;
    const rows = (x.modules || []).map(m => {
      const st = m.done ? 'Пройден' : m.attempts > 0 ? 'В процессе' : 'Не начат';
      const low = !m.done && m.attempts > 0 && m.best != null && m.best < th;
      return `<div class="hr"><div><b>${esc(m.id)} ${esc(m.title)}</b><span class="ex">${st}${m.attempts ? ' · попыток теста: ' + m.attempts : ''}</span></div>
        <div class="hs ${m.done ? 'ok' : low ? 'no' : ''}"><b>${m.best != null ? m.best + '%' : '—'}</b><span>${m.score != null ? 'итог ' + m.score + '%' : ''}</span></div></div>`;
    }).join('');
    dlg('Прогресс: ' + x.name, `<p class="ex" style="margin-top:0">${esc([x.job_title, x.shop].filter(Boolean).join(' · '))} · с вами с ${fd(x.since)}</p>
      <p>Пройдено модулей: <b>${x.done} из ${x.total}</b> · средний балл: <b>${nz(x.avg)}</b></p>
      ${rows ? '<div class="hl">' + rows + '</div>' : '<div class="empty">Для этого сотрудника пока нет обязательных модулей.</div>'}`);
  }

  /* окно с полем причины: общий шаблон */
  function reasonDlg(title, lead, label, required, btnText, onSend) {
    dlg(title, `<p style="margin-top:0">${lead}</p><label class="fl" for="mnr">${label}</label>
      <textarea id="mnr" rows="4" maxlength="500"></textarea><div class="fmsg" id="mnm" role="status"></div>
      <div class="fa"><button type="button" class="btn" id="mnok">${btnText}</button></div>`, d => {
      $('#mnok', d).onclick = async ev => {
        const v = $('#mnr', d).value.trim();
        if (required && v.length < 3) { $('#mnm', d).textContent = 'Напишите причину (хотя бы несколько слов).'; return }
        ev.target.disabled = true;
        const err = await onSend(v);
        if (err) { $('#mnm', d).textContent = err; ev.target.disabled = false; return }
        d.close();
      };
    });
  }

  const afterAction = async msg => {
    await load(true);
    if (view === 'prof') draw();
    if (msg) alert(msg);
  };

  function helpDlg() {
    reasonDlg('Попросить помощь', 'Наставник получит уведомление. Можно коротко написать, с чем нужна помощь.',
      'Сообщение наставнику (необязательно)', false, 'Отправить', async v => {
        const r = await sb.rpc('mentor_ask_help', { p_text: v });
        if (r.error) return errText(r.error);
        afterAction('Сообщение отправлено наставнику.');
      });
  }
  function leaveDlg() {
    reasonDlg('Открепить наставника',
      'Руководитель рассмотрит запрос и подберёт другого наставника. Пока решения нет, наставник остаётся с вами.',
      'Почему вы хотите сменить наставника?', true, 'Отправить запрос', async v => {
        const r = await sb.rpc('mentor_request_leave', { p_reason: v });
        if (r.error) return errText(r.error);
        afterAction('Запрос отправлен руководителю.');
      });
  }
  function resignDlg(id) {
    const x = (MYM || []).find(y => String(y.id) === String(id)); if (!x) return;
    const days = (MENT && MENT.resign_badge_days) || 30;
    reasonDlg('Сложить полномочия', `Вы перестанете быть наставником сотрудника <strong>${esc(x.name)}</strong>. Руководитель получит уведомление и подберёт нового наставника. Уже заработанные жетоны сохраняются. Если вы наставляли меньше ${days} ${plural(days, 'дня', 'дней', 'дней')}, бейдж не начисляется.`,
      'Причина (необязательно)', false, 'Сложить полномочия', async v => {
        const r = await sb.rpc('mentor_resign', { p_mentee: x.id, p_reason: v });
        if (r.error) return errText(r.error);
        afterAction('Готово. Руководитель уведомлён.');
      });
  }

  async function apply() {
    if (!MENT.course_module) return;
    if (!MENT.course_ok) { goCourse(); return }
    if (!confirm('Отправить заявку на наставничество? Её рассмотрит руководитель или обучающий отдел.')) return;
    const r = await sb.rpc('mentor_apply');
    if (r.error) { alert(errText(r.error)); await load(false); if (view === 'prof') draw(); return }
    await load(false); if (view === 'prof') draw();
  }

  function wireProf() {
    m.querySelectorAll('[data-mn]').forEach(b => b.onclick = async () => {
      const a = b.dataset.mn;
      if (a === 'apply') { b.disabled = true; await apply(); b.disabled = false }
      if (a === 'hide') { b.disabled = true; await sb.rpc('mentor_hide_banner'); MENT.hidden = true; draw() }
      if (a === 'help') helpDlg();
      if (a === 'leave') leaveDlg();
    });
    m.querySelectorAll('[data-md]').forEach(b => b.onclick = () => detailDlg(b.dataset.md));
    m.querySelectorAll('[data-rs]').forEach(b => b.onclick = () => resignDlg(b.dataset.rs));
  }

  /* ================= 2. КОЛОКОЛЬЧИК ================= */
  const bell = () => {
    const show = !!(MENT && !MENT.missing && (MENT.is_mentor || +MENT.mentees > 0 || +MENT.notes_total > 0));
    return { show, n: show ? (+MENT.unread || 0) : 0 };
  };

  function noteHtml(n) {
    const nm = esc(first(n.mentee_name));
    let txt;
    if (n.kind === 'help') txt = `<strong>${nm}</strong> просит помощи.${n.body ? ' «' + esc(n.body) + '»' : ''}`;
    else if (n.kind === 'finished' || n.kind === 'ended') txt = esc(n.body || '');
    else txt = `<strong>${nm}</strong>: модуль ${esc(n.module_id)}${n.module_title ? ' «' + esc(n.module_title) + '»' : ''} сдан(а) на ${n.percent}%. Может быть, нужна помощь?`;
    const ico = { help: '🆘', finished: '🎉', ended: 'ℹ️' }[n.kind] || '⚠️';
    return `<div class="mn-note${n.is_read ? '' : ' new'}"><span class="mn-ni" aria-hidden="true">${ico}</span><div>${txt}<div class="ex">${fdt(n.created_at)}</div></div></div>`;
  }

  function goNotes() {
    view = 'notif'; renderTop(); nav(); draw(); window.scrollTo({ top: 0 });
    loadNotes().then(() => { if (view === 'notif') nview() });
  }

  function nview() {
    document.body.classList.remove('home');
    const unread = (NOTES || []).filter(n => !n.is_read).length;
    m.innerHTML = `<div class="pagehd"><img src="fox/look.webp" alt=""><h2>Уведомления</h2></div>` +
      (!NOTES ? '<div class="q">Загружаю…</div>'
        : !NOTES.length ? '<div class="empty">Уведомлений пока нет. Здесь появятся сообщения о подопечных: низкие результаты, просьбы о помощи, завершение наставничества.</div>'
          : `<div class="q mn-notes">${NOTES.map(noteHtml).join('')}</div>`
            + (unread ? '<div class="fa"><button type="button" class="btn" id="mnrd">Отметить все прочитанными</button></div>' : ''));
    const b = $('#mnrd');
    if (b) b.onclick = async () => {
      b.disabled = true; await sb.rpc('mentor_notes_read');
      MENT.unread = 0; (NOTES || []).forEach(n => { n.is_read = true }); renderTop(); nview();
    };
  }

  /* ---- напоминание на главной ---- */
  function homeAlert() {
    if (!MENT || !(+MENT.unread > 0)) return '';
    const n = +MENT.unread;
    return `<div class="q mn-st mn-alert" role="status"><span>🔔 Новых уведомлений о подопечных: <strong>${n}</strong>.</span> <button type="button" class="fbtn alt" data-mnh="1">Открыть</button></div>`;
  }
  function wireHome() { const b = $('[data-mnh]'); if (b) b.onclick = goNotes }

  /* ================= 3. ПАНЕЛЬ РУКОВОДИТЕЛЯ / РЕДАКТОРА ================= */
  const visible = () => !!(MENT && !MENT.missing && (MENT.enabled || CAN_EDIT) && CAN_REP);
  const pend = () => MPEND + MSIG;

  function refreshPend() {
    if (!CAN_REP || !sb) return;
    sb.rpc('mentor_counts').then(r => {
      const a = r.error ? 0 : (+r.data.apps || 0), s = r.error ? 0 : (+r.data.signals || 0);
      if (a !== MPEND || s !== MSIG) { MPEND = a; MSIG = s; renderTop() }
    });
  }

  function go(tabName) {
    if (tabName) MTAB = tabName;
    view = 'mnt'; renderTop(); nav(); draw(); window.scrollTo({ top: 0 });
    loadTab();
  }

  function loadTab() {
    LOADERR = false;
    const done = () => { if (view === 'mnt') mview() };
    const call = (name, args, set, empty) => {
      sb.rpc(name, args).then(r => { if (r.error) { LOADERR = true; set(empty) } else set(r.data); done() });
    };
    if (MTAB === 'apps') { APPS = null; call('mentor_applications_list', { p_status: APPST }, v => { APPS = v || [] }, []) }
    else if (MTAB === 'sig') { SIG = null; call('mentor_signals', undefined, v => { SIG = v || {} }, {}) }
    else if (MTAB === 'asg') { ASG = null; call('mentor_assign_data', undefined, v => { ASG = v }, { newbies: [], mentors: [], pairs: [], max: 3 }) }
    else if (MTAB === 'arc') { ARC = null; call('mentor_archive', undefined, v => { ARC = v || [] }, []) }
    else if (MTAB === 'cfg') { SET = null; call('mentor_get_settings', undefined, v => { SET = v || {} }, {}) }
    refreshPend();
  }

  const failMsg = 'Не удалось загрузить данные. Проверьте, что в базе выполнены миграции 17 и 18.';

  /* ---- заявки ---- */
  function appCard(a) {
    const stat = `пройдено ${a.modules_done} ${plural(a.modules_done, 'модуль', 'модуля', 'модулей')}, средний балл ${nz(a.avg_score)}`;
    const course = `курс по наставничеству: ${nz(a.course_percent)}`;
    let act = '';
    if (a.status === 'pending')
      act = `<div class="fa"><button type="button" class="btn" data-ok="${a.id}">Одобрить</button><button type="button" class="fbtn alt" data-no="${a.id}">Отклонить</button></div>`;
    else if (a.status === 'approved')
      act = `<div class="ex">Одобрено ${fd(a.decided_at)}${a.decided_by_name ? ' · ' + esc(a.decided_by_name) : ''} · подопечных: ${a.mentees}</div>
             <div class="fa"><button type="button" class="fbtn alt" data-rv="${esc(a.user_id)}" data-nm="${esc(a.full_name)}">Снять статус наставника</button></div>`;
    else
      act = `<div class="ex">Отклонено ${fd(a.decided_at)}${a.decided_by_name ? ' · ' + esc(a.decided_by_name) : ''}${a.reason ? '<br>Причина: ' + esc(a.reason) : ''}</div>`;
    return `<div class="q mn-app"><div class="ex">${esc([a.job_title, a.shop].filter(Boolean).join(' · '))}</div><div><strong>${esc(a.full_name)}</strong> (${stat}) подал(а) заявку ${fd(a.created_at)}, ${course}.</div>${act}</div>`;
  }

  function appsHtml() {
    const ST = { pending: 'Ожидают', approved: 'Одобрено', rejected: 'Отклонено' };
    const chips = '<div class="tchips">' + Object.keys(ST).map(s => `<button type="button" aria-pressed="${APPST === s}" data-as="${s}">${ST[s]}${s === 'pending' && MPEND ? ' (' + MPEND + ')' : ''}</button>`).join('') + '</div>';
    if (!APPS) return chips + '<div class="q">Загружаю…</div>';
    if (LOADERR) return chips + `<div class="q">${failMsg}</div>`;
    if (!APPS.length) return chips + `<div class="empty">${APPST === 'pending' ? 'Новых заявок нет.' : 'Здесь пока пусто.'}</div>`;
    return chips + APPS.map(appCard).join('');
  }

  function rejectDlg(id) {
    reasonDlg('Отклонить заявку', 'Причину увидит сотрудник в своём профиле.', 'Причина (необязательно)', false, 'Отклонить заявку', async v => {
      const r = await sb.rpc('mentor_decide', { p_id: id, p_approve: false, p_reason: v });
      if (r.error) return errText(r.error);
      loadTab();
    });
  }

  function wireApps() {
    m.querySelectorAll('[data-as]').forEach(b => b.onclick = () => { APPST = b.dataset.as; loadTab(); mview() });
    m.querySelectorAll('[data-ok]').forEach(b => b.onclick = async () => {
      if (!confirm('Одобрить заявку? Сотрудник станет наставником и его можно будет закрепить за новичком.')) return;
      b.disabled = true;
      const r = await sb.rpc('mentor_decide', { p_id: +b.dataset.ok, p_approve: true, p_reason: '' });
      if (r.error) { alert(errText(r.error)); b.disabled = false; return }
      loadTab();
    });
    m.querySelectorAll('[data-no]').forEach(b => b.onclick = () => rejectDlg(+b.dataset.no));
    m.querySelectorAll('[data-rv]').forEach(b => b.onclick = () => revoke(b.dataset.rv, b.dataset.nm));
  }

  async function revoke(id, nm) {
    if (!confirm('Снять статус наставника с ' + nm + '? Все его подопечные будут откреплены и останутся без наставника.')) return;
    const r = await sb.rpc('mentor_revoke', { p_user: id, p_reason: '' });
    if (r.error) { alert(errText(r.error)); return }
    loadTab();
  }

  /* ---- сигналы ---- */
  function sigHtml() {
    if (!SIG) return '<div class="q">Загружаю…</div>';
    if (LOADERR) return `<div class="q">${failMsg}</div>`;
    const rq = SIG.requests || [], nd = SIG.need || [], ig = SIG.ignoring || [], fl = SIG.flags || [];
    if (!rq.length && !nd.length && !ig.length && !fl.length) return '<div class="empty">Сигналов нет: все наставничества идут по плану.</div>';
    let h = '';
    if (rq.length) {
      h += '<h3 class="psec">Запросы на смену наставника</h3>' + rq.map(r => `<div class="q mn-st"><div><strong>${esc(r.mentee)}</strong> хочет сменить наставника (${esc(r.mentor)}).</div>
        <div class="ex">Причина: ${esc(r.reason)} · ${esc(r.shop || '')} · ${fd(r.created_at)}</div>
        <div class="fa" style="margin-top:8px"><button type="button" class="btn" data-qa="${r.id}">Одобрить</button><button type="button" class="fbtn alt" data-qr="${r.id}">Отклонить</button></div></div>`).join('');
    }
    if (nd.length) {
      h += '<h3 class="psec">Нужен новый наставник</h3>' + nd.map(n => {
        const late = n.overdue, dl = n.deadline ? (late ? `<span class="mn-warn">срок назначения истёк ${fd(n.deadline)}</span>` : `назначить до ${fd(n.deadline)}`) : '';
        const why = n.reason === 'mentor_left' ? `Наставник ${esc(n.mentor)} отказался(лась) от наставничества` : n.reason === 'removed' ? `Наставника ${esc(n.mentor)} сняли с подопечного` : `Смена наставника по просьбе подопечного (был: ${esc(n.mentor)})`;
        return `<div class="q mn-st${late ? ' mn-no' : ''}"><div><strong>${esc(n.mentee)}</strong> остался(ась) без наставника.</div><div class="ex">${why}${n.note ? ': ' + esc(n.note) : ''} · ${esc(n.shop || '')}</div>${dl ? `<div class="ex">${dl}</div>` : ''}
          <div class="fa" style="margin-top:8px"><button type="button" class="btn" data-ga="1">Назначить наставника</button></div></div>`;
      }).join('');
    }
    if (ig.length) {
      h += '<h3 class="psec">Наставник не отвечает</h3>' + ig.map(i => `<div class="q mn-st mn-no"><div><strong>${esc(i.mentor)}</strong> не отвечает подопечному <strong>${esc(i.mentee)}</strong>.</div>
        <div class="ex">Сообщение без ответа с ${fd(i.since)}${i.last_seen ? ', наставник заходил в портал ' + fd(i.last_seen) : ', наставник в портал не заходил'}.</div>
        <div class="fa" style="margin-top:8px"><button type="button" class="fbtn alt" data-ig="${esc(i.mentee_id)}" data-nm="${esc(i.mentee)}">Снять наставника с подопечного</button><button type="button" class="btn" data-ga="1">Назначить другого</button></div></div>`).join('');
    }
    if (fl.length) {
      h += '<h3 class="psec">Требует пересмотра статуса</h3>' + fl.map(f => `<div class="q mn-st mn-no"><div><strong>${esc(f.mentor)}</strong> ${esc(f.shop || '')}</div>
        <div class="ex">Срок наставничества ${nn(f.term_days)} дн. (больше 4 месяцев), баллы не начислены · ${fd(f.created_at)}</div>
        <div class="fa" style="margin-top:8px"><button type="button" class="fbtn alt" data-fc="${f.id}">Оставить статус</button><button type="button" class="fbtn alt" data-fr="${esc(f.user_id)}" data-nm="${esc(f.mentor)}">Снять статус</button></div></div>`).join('');
    }
    return h;
  }

  function wireSig() {
    const dec = (id, ok) => async () => {
      if (!confirm(ok ? 'Одобрить смену наставника? Пара будет завершена, баллы за неё не начисляются.' : 'Отклонить запрос? Подопечный останется с этим наставником.')) return;
      const r = await sb.rpc('mentor_request_decide', { p_id: +id, p_approve: ok });
      if (r.error) { alert(errText(r.error)); return }
      loadTab();
    };
    m.querySelectorAll('[data-qa]').forEach(b => b.onclick = dec(b.dataset.qa, true));
    m.querySelectorAll('[data-qr]').forEach(b => b.onclick = dec(b.dataset.qr, false));
    m.querySelectorAll('[data-ga]').forEach(b => b.onclick = () => { MTAB = 'asg'; mview(); loadTab() });
    m.querySelectorAll('[data-ig]').forEach(b => b.onclick = async () => {
      if (!confirm('Снять наставника с подопечного ' + b.dataset.nm + '? Подопечный попадёт в список «Нужен новый наставник».')) return;
      const r = await sb.rpc('mentor_remove', { p_mentee: b.dataset.ig, p_reason: 'Не отвечал на сообщения подопечного' });
      if (r.error) { alert(errText(r.error)); return }
      loadTab();
    });
    m.querySelectorAll('[data-fc]').forEach(b => b.onclick = async () => {
      const r = await sb.rpc('mentor_flag_clear', { p_id: +b.dataset.fc });
      if (r.error) { alert(errText(r.error)); return }
      loadTab();
    });
    m.querySelectorAll('[data-fr]').forEach(b => b.onclick = () => revoke(b.dataset.fr, b.dataset.nm));
  }

  /* ---- закрепление ---- */
  function asgHtml() {
    if (!ASG) return '<div class="q">Загружаю…</div>';
    if (LOADERR) return `<div class="q">${failMsg}</div>`;
    const mentors = ASG.mentors || [];
    const opts = mentors.map(x => `<option value="${esc(x.id)}"${x.mentees >= ASG.max ? ' disabled' : ''}>${x.flag ? '⚠ ' : ''}${esc(x.name)} (${x.mentees}/${ASG.max})</option>`).join('');
    let h = '<h3 class="psec">Новички без наставника</h3>';
    if (!(ASG.newbies || []).length) h += '<div class="empty">Новых сотрудников без наставника нет.</div>';
    else if (!mentors.length) h += '<div class="empty">Нет одобренных наставников. Сначала одобрите хотя бы одну заявку.</div>';
    else h += (ASG.newbies || []).map(n => {
      const l = n.lost;
      const lost = l ? `<div class="${l.deadline && new Date(l.deadline) < new Date() ? 'mn-warn' : 'ex'}">Без наставника: ${REASON[l.reason] || ''}${l.deadline ? ' · назначить до ' + fd(l.deadline) : ''}</div>` : '';
      return `<div class="q mn-row"><div><strong>${esc(n.name)}</strong><br><span class="ex">${esc([n.job_title, n.shop].filter(Boolean).join(' · '))} · в системе с ${fs(n.created_at)}</span>${lost}</div>
      <div class="fa"><select data-nb="${esc(n.id)}" aria-label="Наставник для ${esc(n.name)}"><option value="">Выберите наставника</option>${opts}</select>
      <button type="button" class="btn" data-set="${esc(n.id)}">Закрепить</button></div></div>`;
    }).join('');
    h += '<h3 class="psec">Текущие пары</h3>';
    if (!(ASG.pairs || []).length) h += '<div class="empty">Пар пока нет.</div>';
    else h += '<div class="hl">' + ASG.pairs.map(p => `<div class="hr"><div><b>${esc(p.mentee)}</b><span class="ex">${esc([p.mentee_shop, 'наставник: ' + p.mentor, 'с ' + fd(p.since), 'модулей: ' + nn(p.done) + ' из ' + nn(p.total)].filter(Boolean).join(' · '))}</span></div>
      <div class="fa"><button type="button" class="fbtn alt" data-cm="${esc(p.mentee_id)}" data-nm="${esc(p.mentee)}">Завершить наставничество</button>
      <button type="button" class="fbtn alt" data-un="${esc(p.mentee_id)}" data-nm="${esc(p.mentee)}">Открепить</button></div></div>`).join('') + '</div>';
    return h;
  }

  function wireAsg() {
    m.querySelectorAll('[data-set]').forEach(b => b.onclick = async () => {
      const sel = m.querySelector(`select[data-nb="${b.dataset.set}"]`);
      if (!sel || !sel.value) { alert('Выберите наставника.'); return }
      b.disabled = true;
      const r = await sb.rpc('mentor_assign', { p_mentee: b.dataset.set, p_mentor: sel.value });
      if (r.error) { alert(errText(r.error)); b.disabled = false; return }
      loadTab();
    });
    m.querySelectorAll('[data-un]').forEach(b => b.onclick = async () => {
      if (!confirm('Открепить ' + b.dataset.nm + ' от наставника? Это для ошибочного закрепления: баллы не начисляются, на наставника это не влияет.')) return;
      const r = await sb.rpc('mentor_unassign', { p_mentee: b.dataset.un });
      if (r.error) { alert(errText(r.error)); return }
      loadTab();
    });
    m.querySelectorAll('[data-cm]').forEach(b => b.onclick = async () => {
      if (!confirm('Завершить наставничество для ' + b.dataset.nm + '? Наставнику начислятся баллы по текущим результатам подопечного, пара уйдёт в архив.')) return;
      b.disabled = true;
      const r = await sb.rpc('mentor_complete', { p_mentee: b.dataset.cm });
      if (r.error) { alert(errText(r.error)); b.disabled = false; return }
      const d = r.data || {};
      alert('Наставничество завершено. ' + (d.failed ? 'Срок превысил 4 месяца: баллов нет, статус наставника отмечен для пересмотра.' : 'Баллов наставнику: ' + (d.points || 0) + '.'));
      loadTab();
    });
  }

  /* ---- архив ---- */
  function arcHtml() {
    if (!ARC) return '<div class="q">Загружаю…</div>';
    if (LOADERR) return `<div class="q">${failMsg}</div>`;
    if (!ARC.length) return '<div class="empty">Архив пуст. Завершённые пары появятся здесь.</div>';
    return '<div class="hl">' + ARC.map(a => {
      const r = a.result || {}, done = a.reason === 'completed';
      const det = done ? `срок ${nn(r.term_days)} дн., средний балл ${nz(r.avg)}, попыток на модуль ${nn(r.attempts)}${r.failed ? ' · срок больше 4 месяцев' : ''}` : (a.note ? esc(a.note) : '');
      return `<div class="hr"><div><b>${esc(a.mentee)}</b><span class="ex">${esc([a.shop, 'наставник: ' + a.mentor, fd(a.assigned_at) + ' — ' + fd(a.ended_at), REASON[a.reason] || ''].filter(Boolean).join(' · '))}</span>${det ? `<span class="ex">${det}</span>` : ''}</div>
        <div class="hs ${done ? (a.points >= 1 ? 'ok' : 'no') : ''}"><b>${done ? nn(a.points) + ' ' + plural(a.points || 0, 'балл', 'балла', 'баллов') : '—'}</b></div></div>`;
    }).join('') + '</div>';
  }

  /* ---- настройки ---- */
  function cfgHtml() {
    if (!SET) return '<div class="q">Загружаю…</div>';
    if (LOADERR) return `<div class="q">${failMsg}</div>`;
    const mods = (MODS || []).filter(x => x && x.id).slice().sort((a, b) => cmpCode(String(a.id), String(b.id)));
    const num = (id, label, v, min, max, hint) => `<label class="fl" for="${id}">${label}</label><input id="${id}" type="number" min="${min}" max="${max}" value="${esc(v == null ? '' : v)}" style="max-width:140px">${hint ? '<div class="ex">' + hint + '</div>' : ''}`;
    return `<div class="q mn-form"><label class="mn-chk"><input type="checkbox" id="mc-en"${SET.enabled ? ' checked' : ''}> Наставничество включено</label>
      <div class="ex">Пока выключено, сотрудники не видят приглашений и курса.</div>
      <h3 class="psec">Кто может стать наставником</h3>
      <label class="fl" for="mc-sec">Раздел, по которому считаем успехи</label>
      <select id="mc-sec">${ROLES.map(r => `<option value="${r.id}"${SET.section === r.id ? ' selected' : ''}>${esc(r.t)}</option>`).join('')}</select>
      ${num('mc-mm', 'Сколько модулей нужно пройти', SET.min_modules, 1, 100)}
      ${num('mc-ma', 'Минимальный средний балл, %', SET.min_avg, 0, 100)}
      <label class="fl" for="mc-ti">Должность содержит (необязательно)</label><input id="mc-ti" maxlength="80" value="${esc(SET.candidate_title || '')}" placeholder="например: администратор">
      <div class="ex">Если поле пустое, подходит любая должность.</div>
      <h3 class="psec">Курс по наставничеству</h3>
      <label class="fl" for="mc-cm">Модуль с курсом</label>
      <select id="mc-cm"><option value="">— не выбран —</option>${mods.map(x => `<option value="${esc(x.id)}"${String(SET.course_module) === String(x.id) ? ' selected' : ''}>${esc(x.id)} ${esc(x.title)}</option>`).join('')}</select>
      <div class="ex">Создайте обычный модуль (теория и тест) в разделе, который вы выбрали выше. Не скрывайте его: показ нужным людям портал берёт на себя.</div>
      ${num('mc-cp', 'Минимальный балл за тест курса, %', SET.course_min_percent, 0, 100)}
      <h3 class="psec">Работа с подопечными</h3>
      ${num('mc-nb', 'Уведомлять наставника, если результат ниже, %', SET.notify_below, 1, 100)}
      ${num('mc-nd', 'Новичок: сколько дней после появления в системе', SET.newbie_days, 1, 365)}
      ${num('mc-mx', 'Максимум подопечных у одного наставника', SET.max_mentees, 1, 50)}
      ${num('mc-ig', 'Сигнал «наставник игнорирует»: через сколько дней без ответа', SET.ignore_days, 1, 60)}
      ${num('mc-ra', 'Сколько дней на назначение нового наставника', SET.reassign_days, 1, 30)}
      <h3 class="psec">Награды</h3>
      ${num('mc-bt', 'Бонусные жетоны за успешное завершение', SET.bonus_tokens, 0, 10000, 'Начисляются от 1 балла по матрице. 0 = без бонуса. В рейтинг магазинов не входят.')}
      ${num('mc-rb', 'Бейдж при отказе от наставничества: минимум дней работы', SET.resign_badge_days, 0, 365, 'Если наставник сложил полномочия раньше, бейдж не начисляется.')}
      ${matrixHtml()}
      <div class="fmsg" id="mc-msg" role="status"></div>
      <div class="fa"><button type="button" class="btn" id="mc-save">Сохранить настройки</button></div></div>`;
  }

  function wireCfg() {
    const b = $('#mc-save'); if (!b) return;
    b.onclick = async () => {
      const g = id => $('#' + id).value, msg = $('#mc-msg');
      const p = {
        enabled: $('#mc-en').checked, section: g('mc-sec'), candidate_title: g('mc-ti').trim(),
        min_modules: +g('mc-mm'), min_avg: +g('mc-ma'), course_module: g('mc-cm'),
        course_min_percent: +g('mc-cp'), notify_below: +g('mc-nb'), newbie_days: +g('mc-nd'), max_mentees: +g('mc-mx'),
        ignore_days: +g('mc-ig'), reassign_days: +g('mc-ra'), bonus_tokens: +g('mc-bt'), resign_badge_days: +g('mc-rb')
      };
      if (p.enabled && !p.course_module && !confirm('Курс по наставничеству не выбран: сотрудники не смогут подать заявку. Сохранить так?')) return;
      b.disabled = true; msg.textContent = 'Сохраняю…';
      const r = await sb.rpc('mentor_set_settings', { p });
      b.disabled = false;
      if (r.error) { msg.textContent = /check|violates|invalid/i.test(r.error.message || '') ? 'Проверьте значения: числа вне допустимых пределов.' : errText(r.error); return }
      msg.textContent = 'Сохранено.'; Object.assign(SET, p);
      await load(false); if (view === 'mnt') renderTop();
    };
  }

  function mview() {
    document.body.classList.remove('home');
    const tabs = [['apps', 'Заявки' + (MPEND ? ' (' + MPEND + ')' : '')], ['sig', 'Сигналы' + (MSIG ? ' (' + MSIG + ')' : '')], ['asg', 'Закрепление'], ['arc', 'Архив']];
    if (CAN_EDIT) tabs.push(['cfg', 'Настройки']);
    if (!tabs.some(t => t[0] === MTAB)) MTAB = 'apps';
    const body = { apps: appsHtml, sig: sigHtml, asg: asgHtml, arc: arcHtml, cfg: cfgHtml }[MTAB]();
    m.innerHTML = `<div class="pagehd"><img src="fox/look.webp" alt=""><h2>Наставничество</h2></div>
      <div class="tabs" role="tablist">${tabs.map(t => `<button type="button" role="tab" aria-selected="${MTAB === t[0]}" data-mt="${t[0]}">${t[1]}</button>`).join('')}</div>${body}`;
    m.querySelectorAll('[data-mt]').forEach(b => b.onclick = () => { MTAB = b.dataset.mt; mview(); loadTab() });
    ({ apps: wireApps, sig: wireSig, asg: wireAsg, arc: () => 0, cfg: wireCfg }[MTAB])();
  }

  /* ================= 4. ОТЧЁТ «ЭФФЕКТИВНОСТЬ НАСТАВНИКОВ» ================= */
  function repView() {
    document.body.classList.remove('home');
    const head = `<div class="pagehd"><img src="fox/info.webp" alt=""><h2>Отчёты по обучению</h2></div><div class="tabs" role="tablist">${repTabs()}</div>`;
    const wire = () => m.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { repMode = b.dataset.rm; draw() });
    if (RPT === null && !RPTERR) {
      m.innerHTML = head + '<div class="q">Загружаю…</div>'; wire();
      sb.rpc('mentor_report').then(r => { if (r.error) { RPTERR = true; RPT = {} } else RPT = r.data; if (view === 'rep' && repMode === 'mnt') repView() });
      return;
    }
    if (RPTERR) { m.innerHTML = head + `<div class="q">${failMsg}</div>`; wire(); return }
    const rows = RPT.mentors || [], mt = RPT.mentees || [], b = RPT.baseline || {};
    const medal = ['🥇', '🥈', '🥉'];
    const bar = v => `<span class="mn-bar"><i style="width:${Math.max(0, Math.min(100, +v || 0))}%"></i></span>${nz(v)}`;
    const base = b && b.n ? `<div class="q mn-base">Для сравнения: новички без наставника за последние ${RPT.newbie_days} дн. (${b.n} чел.): средний балл ${nz(b.avg)}, прогресс ${nz(b.progress)}.</div>` : '';
    let h = head;
    h += '<p class="ex" style="margin:0 0 8px">Сводка по наставникам: места по баллам копилки, затем по среднему баллу подопечных. Если модули пройдены не с первой попытки, растёт число попыток на модуль и итоговые баллы наставника снижаются. «Сигналы» — сколько раз наставник получал уведомление о низком результате или просьбе о помощи.</p>' + matrixHtml();
    if (!rows.length) return (m.innerHTML = h + '<div class="empty">Пока нет закреплённых подопечных. Отчёт появится, когда наставникам назначат новичков.</div>' + base, wire());
    h += `<div class="mn-scroll"><table class="mn-tbl"><thead><tr><th>#</th><th>Наставник</th><th>Подопечных</th><th>Завершено</th><th>Баллы</th><th>Средний балл</th><th>Попыток на модуль</th><th>С первой попытки</th><th>Срок, дн.</th><th>Сигналы</th></tr></thead><tbody>`
      + rows.map((r, i) => `<tr><td>${medal[i] || i + 1}</td><td><strong>${esc(r.mentor)}</strong>${r.flag ? '<div class="mn-warn">Требует пересмотра статуса</div>' : ''}</td><td>${r.active}</td><td>${r.completed}</td><td><strong>${r.points}</strong></td><td>${bar(r.avg)}</td><td>${nn(r.attempts)}</td><td>${nz(r.first_try)}</td><td>${nn(r.term_days)}</td><td>${r.alerts || 0}</td></tr>`).join('')
      + '</tbody></table></div>' + base;
    h += '<h3 class="psec">Подопечные</h3><div class="mn-scroll"><table class="mn-tbl"><thead><tr><th>Подопечный</th><th>Наставник</th><th>Статус</th><th>Модулей</th><th>Средний балл</th><th>Попыток на модуль</th><th>Баллы</th></tr></thead><tbody>'
      + mt.slice().sort((a, b2) => String(a.mentor).localeCompare(String(b2.mentor)) || String(a.mentee).localeCompare(String(b2.mentee)))
        .map(x => `<tr><td><strong>${esc(x.mentee)}</strong><div class="ex">${esc(x.shop || '')}</div></td><td>${esc(x.mentor)}</td><td>${x.status === 'completed' ? 'Завершено' + (x.term_days != null ? ' за ' + x.term_days + ' дн.' : '') : 'Идёт'}</td><td>${nn(x.done)} из ${nn(x.total)}</td><td>${nz(x.avg)}</td><td>${nn(x.attempts)}</td><td>${x.status === 'completed' ? nn(x.points) : '—'}</td></tr>`).join('')
      + '</tbody></table></div>';
    m.innerHTML = h; wire();
  }
  const resetReport = () => { RPT = null; RPTERR = false };

  window.MN = { load, onProf, afterTest, profBox, wireProf, homeAlert, wireHome, visible, pend, refreshPend, go, mview, repView, resetReport, bell, goNotes, nview };
})();
