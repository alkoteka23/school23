/* =====================================================================
   НАСТАВНИЧЕСТВО — интерфейс
   Подключается из index.html. Данные и правила — в supabase_migration_17.sql.

   Что внутри:
   1. Профиль сотрудника: приглашение стать наставником, статус заявки,
      «Твой наставник», подопечные с прогрессом, уведомления наставнику
   2. Панель «Наставничество» (руководитель, редактор): заявки, закрепление
      новичков, настройки (настройки — только редактор / администратор)
   3. Отчёт «Эффективность наставников» (вкладка в «Отчётах»)
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

  let MYM = null, NOTES = null;                 /* подопечные и уведомления наставника */
  let APPS = null, APPST = 'pending', ASG = null, SET = null, RPT = null, RPTERR = false;
  let MTAB = 'apps', MPEND = 0, LOADERR = false;

  const errText = e => {
    const s = (e && e.message) || '';
    if (/no_capacity/.test(s)) return 'У наставника уже максимум подопечных.';
    if (/already_has_mentor/.test(s)) return 'У этого сотрудника уже есть наставник.';
    if (/not_mentor/.test(s)) return 'Этот сотрудник не является наставником.';
    if (/not_pending/.test(s)) return 'Заявка уже рассмотрена.';
    if (/self_review/.test(s)) return 'Нельзя рассматривать собственную заявку.';
    if (/course_not_passed/.test(s)) return 'Сначала нужно пройти курс по наставничеству.';
    if (/not_eligible/.test(s)) return 'Пока не выполнены условия для наставника.';
    if (/already/.test(s)) return 'Заявка уже подана.';
    if (/not_enabled/.test(s)) return 'Наставничество сейчас выключено.';
    if (/forbidden/.test(s)) return 'Недостаточно прав.';
    return 'Не удалось выполнить действие. Попробуйте ещё раз.';
  };

  /* ================= СТАТУС ТЕКУЩЕГО СОТРУДНИКА ================= */
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

  /* после теста: вдруг пройден курс или набран нужный уровень */
  function afterTest() {
    load(false).then(() => { if (view === 'mod' && tab === 't') return; if (view === 'prof') draw() });
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
      <div class="ex">Пройдено модулей: ${x.done} из ${x.total} · средний балл: ${nz(x.avg)} · последняя активность: ${x.last_at ? fd(x.last_at) : 'ещё не начинал(а)'}</div>
      ${need.length ? `<div class="mn-warn">Нужна помощь: ${need.map(m => esc(m.id) + ' (' + m.best + '%)').join(', ')}</div>` : ''}
      <div class="fa" style="margin-top:8px"><button type="button" class="fbtn alt" data-md="${esc(x.id)}">Подробнее</button></div></div>`;
  }

  function notesHtml() {
    if (!NOTES || !NOTES.length) return '';
    const unread = NOTES.filter(n => !n.is_read).length;
    return `<div class="q"><b>Уведомления</b>${NOTES.slice(0, 8).map(n =>
      `<div class="mn-note${n.is_read ? '' : ' new'}"><strong>${esc(first(n.mentee_name))}</strong>: модуль ${esc(n.module_id)}${n.module_title ? ' «' + esc(n.module_title) + '»' : ''} сдан(а) на ${n.percent}%. Может быть, нужна помощь? <span class="ex">${fd(n.created_at)}</span></div>`).join('')}
      ${unread ? '<div class="fa" style="margin-top:8px"><button type="button" class="fbtn alt" data-mn="read">Отметить прочитанными</button></div>' : ''}</div>`;
  }

  function mentorHtml() {
    let h = `<div class="q mn-st mn-ok"><b>Вы наставник</b><div class="ex">Подопечных сейчас: ${+MENT.mentees || 0}. Здесь виден их прогресс; если результат ниже ${MENT.notify_below || 70}%, придёт уведомление.</div></div>`;
    if (!MYM) h += '<div class="q">Загружаю подопечных…</div>';
    else if (!MYM.length) h += '<div class="empty">Пока подопечных нет. Как только руководитель закрепит за вами новичка, он появится здесь.</div>';
    else h += MYM.map(menteeCard).join('');
    return h + notesHtml();
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
    if (MENT.mentor)
      h += `<div class="q mn-st mn-my"><div class="mn-ico" aria-hidden="true">🤝</div><div><b>Твой наставник: ${esc(MENT.mentor.name)}</b>
        <div class="ex">${esc([MENT.mentor.job_title, MENT.mentor.shop].filter(Boolean).join(' · '))}</div>
        <div class="ex">Если что-то непонятно, обращайся к нему. Наставник видит твой прогресс в обучении.</div></div></div>`;
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
      if (a === 'hide') {
        b.disabled = true; await sb.rpc('mentor_hide_banner'); MENT.hidden = true; draw();
      }
      if (a === 'read') {
        b.disabled = true; await sb.rpc('mentor_notes_read');
        MENT.unread = 0; (NOTES || []).forEach(n => { n.is_read = true }); renderTop(); draw();
      }
    });
    m.querySelectorAll('[data-md]').forEach(b => b.onclick = () => detailDlg(b.dataset.md));
  }

  /* ---- напоминание на главной ---- */
  function homeAlert() {
    if (!MENT || !(+MENT.unread > 0)) return '';
    const n = +MENT.unread;
    return `<div class="q mn-st mn-alert" role="status"><span>🔔 Новых уведомлений о подопечных: <b>${n}</b>.</span> <button type="button" class="fbtn alt" data-mnh="1">Открыть</button></div>`;
  }
  function wireHome() { const b = $('[data-mnh]'); if (b) b.onclick = goProf }

  /* ================= 2. ПАНЕЛЬ РУКОВОДИТЕЛЯ / РЕДАКТОРА ================= */
  const visible = () => !!(MENT && !MENT.missing && (MENT.enabled || CAN_EDIT) && CAN_REP);
  const pend = () => MPEND;

  function refreshPend() {
    if (!CAN_REP || !sb) return;
    sb.rpc('mentor_pending_count').then(r => {
      const n = r.error ? 0 : (+r.data || 0);
      if (n !== MPEND) { MPEND = n; renderTop() }
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
    if (MTAB === 'apps') {
      APPS = null;
      sb.rpc('mentor_applications_list', { p_status: APPST }).then(r => { if (r.error) { LOADERR = true; APPS = [] } else APPS = r.data || []; done() });
      refreshPend();
    } else if (MTAB === 'asg') {
      ASG = null;
      sb.rpc('mentor_assign_data').then(r => { if (r.error) { LOADERR = true; ASG = { newbies: [], mentors: [], pairs: [], max: 3 } } else ASG = r.data; done() });
    } else if (MTAB === 'cfg') {
      SET = null;
      sb.rpc('mentor_get_settings').then(r => { if (r.error) { LOADERR = true; SET = {} } else SET = r.data || {}; done() });
    }
  }

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
    if (LOADERR) return chips + '<div class="q">Не удалось загрузить заявки. Проверьте, что в базе выполнена миграция 17.</div>';
    if (!APPS.length) return chips + `<div class="empty">${APPST === 'pending' ? 'Новых заявок нет.' : 'Здесь пока пусто.'}</div>`;
    return chips + APPS.map(appCard).join('');
  }

  function rejectDlg(id) {
    dlg('Отклонить заявку', `<label class="fl" for="mnr">Причина (необязательно, её увидит сотрудник)</label>
      <textarea id="mnr" rows="4" maxlength="500"></textarea><div class="fmsg" id="mnm" role="status"></div>
      <div class="fa"><button type="button" class="btn" id="mnok">Отклонить заявку</button></div>`, d => {
      $('#mnok', d).onclick = async ev => {
        ev.target.disabled = true;
        const r = await sb.rpc('mentor_decide', { p_id: id, p_approve: false, p_reason: $('#mnr', d).value });
        if (r.error) { $('#mnm', d).textContent = errText(r.error); ev.target.disabled = false; return }
        d.close(); loadTab();
      };
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
    m.querySelectorAll('[data-rv]').forEach(b => b.onclick = async () => {
      if (!confirm('Снять статус наставника с ' + b.dataset.nm + '? Все его подопечные будут откреплены.')) return;
      const r = await sb.rpc('mentor_revoke', { p_user: b.dataset.rv, p_reason: '' });
      if (r.error) { alert(errText(r.error)); return }
      loadTab();
    });
  }

  function asgHtml() {
    if (!ASG) return '<div class="q">Загружаю…</div>';
    if (LOADERR) return '<div class="q">Не удалось загрузить данные. Проверьте, что в базе выполнена миграция 17.</div>';
    const mentors = ASG.mentors || [];
    const opts = mentors.map(x => `<option value="${esc(x.id)}"${x.mentees >= ASG.max ? ' disabled' : ''}>${esc(x.name)} (${x.mentees}/${ASG.max})</option>`).join('');
    let h = '<h3 class="psec">Новички без наставника</h3>';
    if (!(ASG.newbies || []).length) h += '<div class="empty">Новых сотрудников без наставника нет.</div>';
    else if (!mentors.length) h += '<div class="empty">Нет одобренных наставников. Сначала одобрите хотя бы одну заявку.</div>';
    else h += (ASG.newbies || []).map(n => `<div class="q mn-row"><div><strong>${esc(n.name)}</strong><br><span class="ex">${esc([n.job_title, n.shop].filter(Boolean).join(' · '))} · в системе с ${fs(n.created_at)}</span></div>
      <div class="fa"><select data-nb="${esc(n.id)}" aria-label="Наставник для ${esc(n.name)}"><option value="">Выберите наставника</option>${opts}</select>
      <button type="button" class="btn" data-set="${esc(n.id)}">Закрепить</button></div></div>`).join('');
    h += '<h3 class="psec">Текущие пары</h3>';
    if (!(ASG.pairs || []).length) h += '<div class="empty">Пар пока нет.</div>';
    else h += '<div class="hl">' + ASG.pairs.map(p => `<div class="hr"><div><b>${esc(p.mentee)}</b><span class="ex">${esc([p.mentee_shop, 'наставник: ' + p.mentor, 'с ' + fd(p.since)].filter(Boolean).join(' · '))}</span></div>
      <button type="button" class="fbtn alt" data-un="${esc(p.mentee_id)}" data-nm="${esc(p.mentee)}">Открепить</button></div>`).join('') + '</div>';
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
      if (!confirm('Открепить ' + b.dataset.nm + ' от наставника?')) return;
      const r = await sb.rpc('mentor_unassign', { p_mentee: b.dataset.un });
      if (r.error) { alert(errText(r.error)); return }
      loadTab();
    });
  }

  function cfgHtml() {
    if (!SET) return '<div class="q">Загружаю…</div>';
    if (LOADERR) return '<div class="q">Не удалось загрузить настройки. Проверьте, что в базе выполнена миграция 17.</div>';
    const mods = (MODS || []).filter(x => x && x.id).slice().sort((a, b) => cmpCode(String(a.id), String(b.id)));
    const num = (id, label, v, min, max, hint) => `<label class="fl" for="${id}">${label}</label><input id="${id}" type="number" min="${min}" max="${max}" value="${esc(v)}" style="max-width:140px">${hint ? '<div class="ex">' + hint + '</div>' : ''}`;
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
        course_min_percent: +g('mc-cp'), notify_below: +g('mc-nb'), newbie_days: +g('mc-nd'), max_mentees: +g('mc-mx')
      };
      if (p.enabled && !p.course_module && !confirm('Курс по наставничеству не выбран: сотрудники не смогут подать заявку. Сохранить так?')) return;
      b.disabled = true; msg.textContent = 'Сохраняю…';
      const r = await sb.rpc('mentor_set_settings', { p });
      b.disabled = false;
      if (r.error) { msg.textContent = /check|violates|invalid/i.test(r.error.message || '') ? 'Проверьте значения: числа вне допустимых пределов.' : errText(r.error); return }
      msg.textContent = 'Сохранено.'; Object.assign(SET, p);
      await load(false); if (view === 'mnt') { renderTop() }
    };
  }

  function mview() {
    document.body.classList.remove('home');
    const tabs = [['apps', 'Заявки' + (MPEND ? ' (' + MPEND + ')' : '')], ['asg', 'Закрепление']];
    if (CAN_EDIT) tabs.push(['cfg', 'Настройки']);
    if (!tabs.some(t => t[0] === MTAB)) MTAB = 'apps';
    const body = MTAB === 'apps' ? appsHtml() : MTAB === 'asg' ? asgHtml() : cfgHtml();
    m.innerHTML = `<div class="pagehd"><img src="fox/look.webp" alt=""><h2>Наставничество</h2></div>
      <div class="tabs" role="tablist">${tabs.map(t => `<button type="button" role="tab" aria-selected="${MTAB === t[0]}" data-mt="${t[0]}">${t[1]}</button>`).join('')}</div>${body}`;
    m.querySelectorAll('[data-mt]').forEach(b => b.onclick = () => { MTAB = b.dataset.mt; mview(); loadTab() });
    if (MTAB === 'apps') wireApps(); else if (MTAB === 'asg') wireAsg(); else wireCfg();
  }

  /* ================= 3. ОТЧЁТ «ЭФФЕКТИВНОСТЬ НАСТАВНИКОВ» ================= */
  function repView() {
    document.body.classList.remove('home');
    const head = `<div class="pagehd"><img src="fox/info.webp" alt=""><h2>Отчёты по обучению</h2></div><div class="tabs" role="tablist">${repTabs()}</div>`;
    const wire = () => m.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { repMode = b.dataset.rm; draw() });
    if (RPT === null && !RPTERR) {
      m.innerHTML = head + '<div class="q">Загружаю…</div>'; wire();
      sb.rpc('mentor_report').then(r => { if (r.error) { RPTERR = true; RPT = {} } else RPT = r.data; if (view === 'rep' && repMode === 'mnt') repView() });
      return;
    }
    if (RPTERR) { m.innerHTML = head + '<div class="q">Не удалось загрузить отчёт. Проверьте, что в базе выполнена миграция 17.</div>'; wire(); return }
    const rows = RPT.mentors || [], mt = RPT.mentees || [], b = RPT.baseline || {};
    const medal = ['🥇', '🥈', '🥉'];
    const bar = v => `<span class="mn-bar"><i style="width:${Math.max(0, Math.min(100, +v || 0))}%"></i></span>${nz(v)}`;
    const base = b && b.n ? `<div class="q mn-base">Для сравнения: новички без наставника за последние ${RPT.newbie_days} дн. (${b.n} чел.): средний балл ${nz(b.avg)}, прогресс ${nz(b.progress)}.</div>` : '';
    let h = head;
    h += '<p class="ex" style="margin:0 0 8px">Чьи подопечные учатся лучше: места по среднему итоговому баллу подопечных. «С первой попытки» — доля модулей, где тест сдан сразу. «Сигналы» — сколько раз наставник получал уведомление о низком результате.</p>';
    if (!rows.length) return (m.innerHTML = h + '<div class="empty">Пока нет закреплённых подопечных. Отчёт появится, когда наставникам назначат новичков.</div>' + base, wire());
    h += `<div class="mn-scroll"><table class="mn-tbl"><thead><tr><th>#</th><th>Наставник</th><th>Подопечных</th><th>Средний балл</th><th>Прогресс</th><th>С первой попытки</th><th>Сигналы</th></tr></thead><tbody>`
      + rows.map((r, i) => `<tr><td>${medal[i] || i + 1}</td><td><b>${esc(r.mentor)}</b></td><td>${r.mentees}</td><td>${bar(r.avg)}</td><td>${bar(r.progress)}</td><td>${nz(r.first_try)}</td><td>${r.alerts || 0}</td></tr>`).join('')
      + '</tbody></table></div>' + base;
    h += '<h3 class="psec">Подопечные</h3><div class="mn-scroll"><table class="mn-tbl"><thead><tr><th>Подопечный</th><th>Наставник</th><th>Модулей</th><th>Средний балл</th><th>С первой попытки</th><th>Был(а) активен(а)</th></tr></thead><tbody>'
      + mt.slice().sort((a, b2) => String(a.mentor).localeCompare(String(b2.mentor)) || String(a.mentee).localeCompare(String(b2.mentee)))
        .map(x => `<tr><td><b>${esc(x.mentee)}</b><div class="ex">${esc(x.shop || '')}</div></td><td>${esc(x.mentor)}</td><td>${x.done} из ${x.total}</td><td>${nz(x.avg)}</td><td>${nz(x.first_try)}</td><td>${x.last_at ? fd(x.last_at) : '—'}</td></tr>`).join('')
      + '</tbody></table></div>';
    m.innerHTML = h; wire();
  }
  const resetReport = () => { RPT = null; RPTERR = false };

  window.MN = { load, onProf, afterTest, profBox, wireProf, homeAlert, wireHome, visible, pend, refreshPend, go, mview, repView, resetReport };
})();
