/* =====================================================================
   КУРСЫ (ПРОГРАММЫ ОБУЧЕНИЯ)
   Подключается из index.html. Данные и правила: supabase_migration_25.sql.

   Что внутри:
   1. «Мои курсы» для сотрудника: продолжить, срочный срок, список курсов
      (В работе / Завершённые / Доступные), страница курса со списком модулей.
   2. «Управление курсами» для редактора: Конструктор программ,
      Назначения (разово, группой, правилом), Аналитика.
   Если миграция 25 не выполнена, CRS.on() == false и портал работает по-старому.
   ===================================================================== */
(function () {
  'use strict';

  const S = {
    ok: null, load: null, P: [], PM: [], PA: [], RU: [],
    EM: null, RM: null, mdata: null,
    ctx: null, sel: null, tab: 'work', mt: 'build',
    draft: null, dirty: false, lib: '', q: '', pick: new Set()
  };

  const $ = (s, r) => (r || document).querySelector(s);
  const pl = (n, a, b, c) => { const k = Math.abs(n) % 100, j = k % 10; return k > 10 && k < 20 ? c : j === 1 ? a : j > 1 && j < 5 ? b : c };
  const isMissing = e => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|schema cache|Could not find the table/i.test(e.message || ''));
  const on = () => S.ok === true;
  const dayDiff = d => Math.round((new Date(d + 'T12:00:00') - new Date(TODAY() + 'T12:00:00')) / 864e5);
  const fd = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : '';
  const fds = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('ru-RU') : '';
  const modOf = id => D.find(d => code(d) === String(id));
  const mTitle = d => d.n.split(' ').slice(1).join(' ') || d.n;
  const progMods = pid => S.PM.filter(x => x.program_id == pid).sort((a, b) => a.position - b.position).map(x => String(x.module_id));
  const progOf = id => S.P.find(p => p.id == id);
  const isEmp = e => e.active && (e.role === 'employee' || e.role === 'manager');
  const modsWord = n => n + ' ' + pl(n, 'модуль', 'модуля', 'модулей');
  const weeksWord = n => n + ' ' + pl(n, 'неделя', 'недели', 'недель');
  const ofMods = n => 'из ' + n + ' ' + (n % 10 === 1 && n % 100 !== 11 ? 'модуля' : 'модулей');
  const daysLeft = n => n + ' ' + pl(n, 'день', 'дня', 'дней');

  /* ---------- загрузка ---------- */
  function load(force) {
    if (S.load && !force) return S.load;
    S.load = (async () => {
      try {
        const q = [sb.from('programs').select('*').order('sort'), sb.from('program_modules').select('*'), sb.from('program_assignments').select('*')];
        if (CAN_EDIT) q.push(sb.from('program_rules').select('*'));
        const r = await Promise.all(q);
        const bad = r.find(x => x.error);
        if (bad) { if (isMissing(bad.error)) S.ok = false; else S.load = null; return }
        S.P = r[0].data || []; S.PM = r[1].data || []; S.PA = r[2].data || []; S.RU = CAN_EDIT ? (r[3].data || []) : [];
        S.ok = true;
      } catch (e) { S.load = null }
    })();
    return S.load;
  }

  /* ---------- доступ к модулям (подключается в moduleForEmployee) ---------- */
  const has = d => {
    const c = code(d);
    return MINE.some(a => String(a.module_id) === c) || !!(window.MENT && MENT.course_module && String(MENT.course_module) === c);
  };

  /* ---------- сведения о курсе для сотрудника ---------- */
  function info(p) {
    const mm = {}; MINE.forEach(a => { mm[String(a.module_id)] = a.due_date || '' });
    const mods = progMods(p.id).map(modOf).filter(d => d && moduleForEmployee(d) && !d.hid);
    const left = mods.filter(d => !passed(d));
    const pa = S.PA.find(x => x.program_id == p.id && x.email === ME.email);
    const dues = left.map(d => mm[code(d)]).filter(Boolean).sort();
    const due = left.length ? (dues[0] || (pa && pa.due_date) || '') : '';
    const next = left.find(d => PIN || !lockedBy(d).length) || left[0] || null;
    return { p, assigned: !!pa, mods, total: mods.length, done: mods.length - left.length, all: mods.length > 0 && !left.length, due, next };
  }
  const mine = () => S.P.filter(p => S.PA.some(x => x.program_id == p.id && x.email === ME.email)).map(info).filter(c => c.total > 0);
  const avail = () => S.P.filter(p => p.published && p.self_enroll && !S.PA.some(x => x.program_id == p.id && x.email === ME.email))
    .map(p => ({ p, assigned: false, total: progMods(p.id).length, done: 0, all: false, due: '', next: null }));

  function urgent(list) {
    let best = null;
    list.forEach(c => c.mods.forEach(d => {
      if (passed(d)) return;
      const a = MINE.find(x => String(x.module_id) === code(d));
      if (a && a.due_date && (!best || a.due_date < best.due)) best = { d, due: a.due_date };
    }));
    if (!best) return '';
    const n = dayDiff(best.due);
    if (n > 3) return '';
    const od = n < 0;
    const head = od ? 'Просрочено: срок был ' + fd(best.due) : n === 0 ? 'Срочно: сегодня последний день!' : 'Срочно: осталось ' + daysLeft(n) + '!';
    return `<div class="crs-alert"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      <div><b>${esc(head)}</b><span>Модуль «${esc(mTitle(best.d))}» нужно сдать до ${esc(fd(best.due))}.</span></div></div>`;
  }

  function banner(list) {
    if (!list.length) return '';
    const last = ls.g('shk_last', '');
    let c = list.find(x => x.next && x.next.n === last) || list.slice().sort((a, b) => (a.due || '9').localeCompare(b.due || '9'))[0];
    if (!c || !c.next) return '';
    const d = c.next;
    const t = c.done > 0 ? 'Вы остановились на модуле ' + code(d) + ': «' + mTitle(d) + '»' : 'Начните с модуля ' + code(d) + ': «' + mTitle(d) + '»';
    return `<div class="crs-hero"><div><h3>${esc(c.p.title)}</h3><p>${esc(t)}</p></div><button type="button" class="btn" data-cc="${c.p.id}">Продолжить →</button></div>`;
  }

  /* ---------- карточка курса ---------- */
  function card(c) {
    const p = c.p;
    let chip = '';
    if (!c.assigned) chip = '<span class="cchip green">Доступно сейчас</span>';
    else if (c.all) chip = '<span class="cchip ok">Завершено</span>';
    else if (c.due) { const n = dayDiff(c.due); chip = `<span class="cchip ${n <= 7 ? 'red' : 'amber'}">${n < 0 ? 'Просрочено' : 'Срок'}: до ${esc(fd(c.due))}</span>` }
    else chip = '<span class="cchip gray">В процессе</span>';
    const meta = `<span>📚 ${modsWord(c.total)}</span>` + (p.duration_weeks ? `<span>⏱ ${weeksWord(p.duration_weeks)}</span>` : '');
    const prog = c.assigned ? `<div class="cbar"><i style="width:${c.total ? Math.round(c.done / c.total * 100) : 0}%"></i></div><div class="cprog">${c.done} ${ofMods(c.total)}</div>` : '';
    const label = !c.assigned ? 'Начать' : c.all ? 'Открыть' : c.done > 0 ? 'Продолжить' : 'Начать';
    const act = !c.assigned ? `data-ce="${p.id}"` : c.all ? `data-cp="${p.id}"` : `data-cc="${p.id}"`;
    return `<article class="ccard" data-cp="${p.id}">${chip}<h4>${esc(p.title)}</h4><div class="cmeta">${meta}</div>
      <p>${esc(p.description || '')}</p>${prog}<button type="button" class="btn" ${act}>${label}</button></article>`;
  }

  function wireCards(root) {
    root.querySelectorAll('[data-cc]').forEach(b => b.onclick = ev => { ev.stopPropagation(); continueCourse(+b.dataset.cc) });
    root.querySelectorAll('[data-ce]').forEach(b => b.onclick = ev => { ev.stopPropagation(); enroll(+b.dataset.ce) });
    root.querySelectorAll('[data-cp]').forEach(b => { if (b.tagName === 'ARTICLE') b.onclick = () => openProgram(+b.dataset.cp); else b.onclick = ev => { ev.stopPropagation(); openProgram(+b.dataset.cp) } });
  }

  /* ---------- экран «Мои курсы» ---------- */
  function viewMy() {
    document.body.classList.remove('home');
    const all = mine(), work = all.filter(c => !c.all), done = all.filter(c => c.all), av = avail();
    if (!['work', 'done', 'avail'].includes(S.tab)) S.tab = 'work';
    const list = S.tab === 'work' ? work : S.tab === 'done' ? done : av;
    const tabs = [['work', 'В работе', work.length], ['done', 'Завершённые', done.length], ['avail', 'Доступные', av.length]];
    const empty = S.tab === 'work' ? (all.length || av.length ? 'Сейчас нет курсов в работе.' : 'Вам пока не назначены курсы. Обратитесь к руководителю или в обучающий отдел.')
      : S.tab === 'done' ? 'Завершённых курсов пока нет.' : 'Сейчас нет курсов, на которые можно записаться.';
    m.innerHTML = `<div class="crs"><h2 class="crs-title">Мои курсы</h2>${banner(work)}${urgent(all)}
      <h3 class="crs-sub">Все курсы</h3>
      <div class="tabs crs-tabs" role="tablist">${tabs.map(t => `<button type="button" role="tab" aria-selected="${S.tab === t[0]}" data-ct="${t[0]}">${t[1]} (${t[2]})</button>`).join('')}</div>
      ${list.length ? `<div class="crs-grid">${list.map(card).join('')}</div>` : `<div class="empty">${empty}</div>`}</div>`;
    m.querySelectorAll('[data-ct]').forEach(b => b.onclick = () => { S.tab = b.dataset.ct; viewMy() });
    wireCards(m);
  }

  /* ---------- страница курса ---------- */
  function viewProgram() {
    document.body.classList.remove('home');
    const p = progOf(S.sel);
    if (!p) { goMy(); return }
    const c = info(p);
    const mm = {}; MINE.forEach(a => { mm[String(a.module_id)] = a.due_date || '' });
    const rows = c.mods.map(d => {
      const ok = passed(d), lk = !PIN && lockedBy(d).length, due = mm[code(d)];
      const od = !ok && due && dayDiff(due) < 0;
      const st = ok ? 'Пройден ✓' : lk ? '🔒 Откроется после модуля ' + lockedBy(d).map(x => code(x)).join(', ') : od ? 'Просрочено, срок был ' + fd(due) : due ? 'Срок: до ' + fd(due) : 'Без срока';
      const isNext = c.next === d;
      return `<div class="crs-mod ${ok ? 'done' : lk ? 'lock' : isNext ? 'now' : ''}"><span class="crs-n">${ok ? '✓' : lk ? '🔒' : esc(code(d))}</span>
        <div class="crs-mt"><b>${esc(mTitle(d))}</b><span class="ex">${esc(st)}</span></div>
        <button type="button" class="${isNext ? 'btn' : 'fbtn alt'}" data-mo="${esc(code(d))}"${lk ? ' disabled' : ''}>${ok ? 'Открыть' : isNext && c.done > 0 ? 'Продолжить' : 'Открыть'}</button></div>`;
    }).join('');
    m.innerHTML = `<div class="crs"><div class="crumb"><a href="#" data-cr="crs">Мои курсы</a></div><h2 class="crs-title">${esc(p.title)}</h2>
      ${p.description ? `<p class="crs-desc">${esc(p.description)}</p>` : ''}
      <div class="crs-meta"><span>📚 ${modsWord(c.total)}</span>${p.duration_weeks ? `<span>⏱ ${weeksWord(p.duration_weeks)}</span>` : ''}${c.due && !c.all ? `<span>📅 до ${esc(fd(c.due))}</span>` : ''}<span>Пройдено ${c.done} из ${c.total}</span></div>
      <div class="cbar big"><i style="width:${c.total ? Math.round(c.done / c.total * 100) : 0}%"></i></div>
      <div class="crs-mods">${rows || '<div class="empty">Материалы курса загружаются или пока не опубликованы.</div>'}</div></div>`;
    m.querySelectorAll('[data-mo]').forEach(b => b.onclick = () => openModule(p.id, b.dataset.mo));
  }

  /* ---------- переходы ---------- */
  function goMy() { S.ctx = null; view = 'crs'; renderTop(); nav(); draw(); window.scrollTo({ top: 0 }) }
  function openProgram(id) { S.sel = id; view = 'crsp'; renderTop(); nav(); draw(); window.scrollTo({ top: 0 }) }
  function openModule(pid, id) { const d = modOf(id); if (!d) return; S.ctx = pid; goModule(d.n) }
  function continueCourse(pid) {
    const p = progOf(pid); if (!p) return;
    const c = info(p);
    if (c.next) openModule(pid, code(c.next)); else openProgram(pid);
  }
  async function enroll(pid) {
    const r = await sb.rpc('program_enroll', { p_program: pid });
    if (r.error) { alert('Не удалось записаться на курс. Попробуйте позже.'); return }
    try {
      await loadMine(); await load(true);
      const j = await fetchContent(); MODS = j.modules; TOPICS = j.topics; ls.s('sb_m', MODS); ls.s('sb_tp', TOPICS); setD();
    } catch (e) { /* контент подтянется при следующем обновлении */ }
    renderTop(); openProgram(pid);
  }
  /* путь навигации внутри модуля: список модулей текущего курса */
  function ctxIdx() {
    if (!S.ctx || view !== 'mod') return null;
    const l = progMods(S.ctx).map(id => D.findIndex(d => code(d) === String(id))).filter(i => i >= 0 && moduleForEmployee(D[i]));
    return l.includes(cur) ? l : null;
  }
  function crumb(d) {
    if (CAN_EDIT) return '<div class="crumb"><a href="#" data-cr="cm">Управление курсами</a></div>';
    const p = ctxIdx() && progOf(S.ctx);
    return '<div class="crumb"><a href="#" data-cr="crs">Мои курсы</a>' + (p ? ' › <a href="#" data-cr="crsp">' + esc(p.title) + '</a>' : '') + '</div>';
  }
  function crumbClick(k) {
    if (k === 'crs') { goMy(); return true }
    if (k === 'crsp' && S.ctx) { openProgram(S.ctx); return true }
    if (k === 'cm') { goManage(); return true }
    return false;
  }

  /* ---------- меню и главная ---------- */
  function menu() {
    if (CAN_EDIT && !S.PA.some(x => x.email === ME.email)) return [];
    return [{ t: 'Мои курсы', on: goMy, cur: view === 'crs' || view === 'crsp' || (view === 'mod' && !CAN_EDIT) }];
  }
  const mgItem = () => ({ t: 'Управление курсами', on: goManage, cur: view === 'cm' || (view === 'mod' && CAN_EDIT) });

  function homeCards() {
    if (CAN_EDIT) {
      return `<button type="button" class="hcard" data-cgo="cm"><div class="hcard-icon">📚</div><div class="hcard-content"><b>Управление курсами</b><span>Программ: ${S.P.length} · модулей: ${D.filter(d => d.page).length}</span></div></button>`;
    }
    const all = mine(), work = all.filter(c => !c.all).slice(0, 4);
    const items = work.map(c => `<button type="button" class="hcard" data-cp="${c.p.id}"><div class="hcard-icon">📚</div><div class="hcard-content"><b>${esc(c.p.title)}</b><span>Пройдено ${c.done} из ${c.total}${c.due ? ' · до ' + esc(fd(c.due)) : ''}</span></div>
      <div class="hcard-progress"><div class="hbar" aria-hidden="true"><i style="width:${Math.round(c.done / c.total * 100)}%"></i></div></div></button>`);
    const av = avail().length;
    if (!items.length) items.push(`<button type="button" class="hcard" data-cgo="my"><div class="hcard-icon">📚</div><div class="hcard-content"><b>Мои курсы</b><span>${all.length ? 'Все курсы пройдены' : av ? 'Доступно курсов: ' + av : 'Курсы пока не назначены'}</span></div></button>`);
    else items.push(`<button type="button" class="hcard" data-cgo="my"><div class="hcard-icon">🗂</div><div class="hcard-content"><b>Все мои курсы</b><span>Завершённых: ${all.filter(c => c.all).length}${av ? ' · доступно: ' + av : ''}</span></div></button>`);
    return items.join('');
  }
  function wireHome(root) {
    root.querySelectorAll('.hcards-wrap [data-cp]').forEach(b => b.onclick = () => openProgram(+b.dataset.cp));
    root.querySelectorAll('.hcards-wrap [data-cgo]').forEach(b => b.onclick = () => b.dataset.cgo === 'cm' ? goManage() : goMy());
  }

  /* =====================================================================
     УПРАВЛЕНИЕ КУРСАМИ (редактор)
     ===================================================================== */
  const errText = m => /unknown_job_title/.test(m) ? 'Такой должности нет в справочнике.' : /bad_title/.test(m) ? 'Название: от 2 до 120 символов.'
    : /bad_module/.test(m) ? 'Один из модулей не найден. Обновите страницу.' : /program_not_found/.test(m) ? 'Курс не найден. Обновите страницу.'
    : /forbidden/.test(m) ? 'Недостаточно прав.' : /too_many/.test(m) ? 'Слишком много сотрудников или модулей за один раз.'
    : 'Не удалось выполнить. Проверьте связь и что выполнена миграция 25.';

  function goManage() {
    view = 'cm'; S.ctx = null; renderTop(); nav(); draw(); window.scrollTo({ top: 0 });
    load(true).then(() => { if (view === 'cm') draw() });
    S.mdata = null;
    Promise.all([sb.rpc('list_employees'), sb.rpc('report_matrix')]).then(r => {
      S.EM = r[0].error ? [] : (r[0].data || []); S.RM = r[1].error ? [] : (r[1].data || []);
      S.mdata = true; if (view === 'cm' && S.mt !== 'build') draw();
    });
  }

  function viewManage() {
    document.body.classList.remove('home');
    const tabs = [['build', 'Конструктор программ'], ['assign', 'Назначения'], ['stats', 'Аналитика']];
    m.innerHTML = `<div class="crs cm"><h2 class="crs-title">Управление курсами</h2>
      <div class="tabs crs-tabs cm-tabs" role="tablist">${tabs.map(t => `<button type="button" role="tab" aria-selected="${S.mt === t[0]}" data-mt="${t[0]}">${t[1]}</button>`).join('')}</div>
      <div id="cm-body"></div></div>`;
    m.querySelectorAll('[data-mt]').forEach(b => b.onclick = () => {
      if (S.mt === 'build' && S.dirty && !confirm('В программе есть несохранённые изменения. Перейти без сохранения?')) return;
      S.mt = b.dataset.mt; S.dirty = false; draw();
    });
    const body = $('#cm-body');
    if (!on()) { body.innerHTML = '<div class="empty">Курсы не подключены. Выполните в Supabase файл supabase_migration_25.sql.</div>'; return }
    if (S.mt === 'build') buildTab(body);
    else if (!S.mdata) body.innerHTML = '<div class="q">Загружаю…</div>';
    else if (S.mt === 'assign') assignTab(body);
    else statsTab(body);
  }

  /* ---------- вкладка «Конструктор программ» ---------- */
  const newDraft = () => ({ id: null, title: '', description: '', weeks: '', self: false, published: false, mods: [] });
  const draftFrom = p => ({ id: p.id, title: p.title, description: p.description || '', weeks: p.duration_weeks || '', self: !!p.self_enroll, published: !!p.published, mods: progMods(p.id) });

  function buildTab(body) {
    if (!S.draft || (S.draft.id && !progOf(S.draft.id))) S.draft = S.P.length ? draftFrom(S.P[0]) : newDraft();
    const dr = S.draft;
    const lib = D.filter(d => d.page).slice().sort((a, b) => cmpCode(code(a), code(b))).filter(d => !S.lib || d.n.toLowerCase().includes(S.lib.toLowerCase()));
    const libHtml = lib.map(d => {
      const inD = dr.mods.includes(code(d));
      return `<div class="lib-i${inD ? ' used' : ''}" draggable="${inD ? 'false' : 'true'}" data-lm="${esc(code(d))}"><span class="lib-t">Модуль ${esc(code(d))}: ${esc(mTitle(d))}${d.hid ? ' <em>черновик</em>' : ''}</span>
        <span class="lib-a"><button type="button" class="ic" data-open="${esc(code(d))}" title="Открыть модуль для редактирования" aria-label="Открыть модуль ${esc(code(d))}">✎</button><button type="button" class="ic" data-add="${esc(code(d))}" title="Добавить в программу"${inD ? ' disabled' : ''} aria-label="Добавить модуль ${esc(code(d))} в программу">＋</button></span></div>`;
    }).join('') || '<div class="ex">Модулей не найдено.</div>';
    const rows = dr.mods.map((id, i) => {
      const d = modOf(id);
      return `<div class="pb-row" draggable="true" data-pm="${esc(id)}"><span class="pb-h" aria-hidden="true">≡</span>
        <span class="pb-t">${d ? 'Модуль ' + esc(code(d)) + ': ' + esc(mTitle(d)) : 'Модуль ' + esc(id) + ' (не найден)'}${d && d.hid ? ' <em>черновик</em>' : ''}</span>
        <span class="pb-act"><button type="button" class="ic" data-up="${i}" aria-label="Выше"${i === 0 ? ' disabled' : ''}>↑</button><button type="button" class="ic" data-dn="${i}" aria-label="Ниже"${i === dr.mods.length - 1 ? ' disabled' : ''}>↓</button><button type="button" class="ic" data-rm="${i}" aria-label="Убрать из программы">×</button></span></div>`;
    }).join('');
    const sel = `<select id="pb-sel" aria-label="Программа">${S.P.map(p => `<option value="${p.id}"${dr.id == p.id ? ' selected' : ''}>${esc(p.title)}${p.published ? '' : ' (черновик)'}</option>`).join('')}<option value="new"${dr.id ? '' : ' selected'}>＋ Новая программа</option></select>`;
    const assigned = dr.id ? S.PA.filter(x => x.program_id == dr.id).length : 0;
    body.innerHTML = `<div class="bld">
      <aside class="pb-lib q fm"><h3>Библиотека модулей</h3><input id="pb-ls" type="search" placeholder="Поиск модуля" value="${esc(S.lib)}" autocomplete="off">
        <div class="lib-list">${libHtml}</div><button type="button" class="fbtn alt" id="pb-new">＋ Новый модуль</button></aside>
      <section class="pb-ed q fm"><div class="pb-top">${sel}</div>
        <h3 class="pb-h3">${dr.id ? 'Программа обучения' : 'Новая программа обучения'}${dr.id ? ` <span class="ex">${dr.published ? 'опубликована' : 'черновик'}${assigned ? ' · назначена: ' + assigned : ''}</span>` : ''}</h3>
        <label class="fl">Название<input id="pb-t" maxlength="120" value="${esc(dr.title)}" placeholder="например, Адаптация продавца"></label>
        <label class="fl">Описание<textarea id="pb-d" maxlength="600" rows="2" placeholder="Коротко: для кого и чему учит">${esc(dr.description)}</textarea></label>
        <div class="pb-two"><label class="fl">Срок, недель<input id="pb-w" type="number" min="1" max="52" value="${esc(dr.weeks)}" placeholder="не указан"></label>
        <label class="pb-chk"><input type="checkbox" id="pb-s"${dr.self ? ' checked' : ''}> Можно записаться самому (вкладка «Доступные» у сотрудников)</label></div>
        <div class="pb-zone" id="pb-zone">${rows || '<div class="ex pb-empty">Перетащите модули сюда или нажмите «＋» в библиотеке.</div>'}</div>
        <div class="fmsg" id="pb-m" role="status"></div>
        <div class="pb-btns">${dr.id ? '<button type="button" class="fbtn alt del" id="pb-del">Удалить</button>' : ''}<button type="button" class="fbtn alt" id="pb-sd">Сохранить черновик</button><button type="button" class="btn" id="pb-sp">Сохранить и опубликовать</button></div></section></div>`;
    wireBuild(body);
  }

  function wireBuild(body) {
    const dr = S.draft, say = z => { $('#pb-m').textContent = z }, redraw = () => { const y = window.scrollY; buildTab(body); window.scrollTo({ top: y }) };
    const touch = () => { S.dirty = true };
    $('#pb-sel').onchange = e => {
      if (S.dirty && !confirm('В программе есть несохранённые изменения. Переключиться без сохранения?')) { e.target.value = dr.id || 'new'; return }
      const v = e.target.value; S.draft = v === 'new' ? newDraft() : draftFrom(progOf(+v)); S.dirty = false; redraw();
    };
    $('#pb-t').oninput = e => { dr.title = e.target.value; touch() };
    $('#pb-d').oninput = e => { dr.description = e.target.value; touch() };
    $('#pb-w').oninput = e => { dr.weeks = e.target.value; touch() };
    $('#pb-s').onchange = e => { dr.self = e.target.checked; touch() };
    $('#pb-ls').oninput = e => { S.lib = e.target.value; const pos = e.target.selectionStart; redraw(); const n = $('#pb-ls'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos) } catch (x) { } } };
    $('#pb-new').onclick = () => moduleDlg(null);
    body.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { const d = modOf(b.dataset.open); if (d) { setPin('editor'); S.ctx = null; goModule(d.n) } });
    body.querySelectorAll('[data-add]').forEach(b => b.onclick = () => { if (!dr.mods.includes(b.dataset.add)) { dr.mods.push(b.dataset.add); touch(); redraw() } });
    body.querySelectorAll('[data-up]').forEach(b => b.onclick = () => { const i = +b.dataset.up; [dr.mods[i - 1], dr.mods[i]] = [dr.mods[i], dr.mods[i - 1]]; touch(); redraw() });
    body.querySelectorAll('[data-dn]').forEach(b => b.onclick = () => { const i = +b.dataset.dn; [dr.mods[i + 1], dr.mods[i]] = [dr.mods[i], dr.mods[i + 1]]; touch(); redraw() });
    body.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { dr.mods.splice(+b.dataset.rm, 1); touch(); redraw() });
    /* перетаскивание: из библиотеки в программу и внутри программы */
    body.querySelectorAll('[data-lm]').forEach(el => el.ondragstart = ev => { if (el.classList.contains('used')) { ev.preventDefault(); return } ev.dataTransfer.setData('text/plain', 'add:' + el.dataset.lm); ev.dataTransfer.effectAllowed = 'copy' });
    body.querySelectorAll('[data-pm]').forEach(el => el.ondragstart = ev => { ev.dataTransfer.setData('text/plain', 'mv:' + el.dataset.pm); ev.dataTransfer.effectAllowed = 'move' });
    const zone = $('#pb-zone');
    zone.ondragover = ev => { ev.preventDefault(); zone.classList.add('over') };
    zone.ondragleave = () => zone.classList.remove('over');
    zone.ondrop = ev => {
      ev.preventDefault(); zone.classList.remove('over');
      const t = (ev.dataTransfer.getData('text/plain') || '').split(':'), kind = t[0], id = t.slice(1).join(':');
      if (!id || (kind !== 'add' && kind !== 'mv')) return;
      const row = ev.target.closest && ev.target.closest('[data-pm]');
      let at = dr.mods.length;
      if (row) { const r = row.getBoundingClientRect(); at = dr.mods.indexOf(row.dataset.pm) + (ev.clientY > r.top + r.height / 2 ? 1 : 0) }
      if (kind === 'mv') { const from = dr.mods.indexOf(id); if (from < 0) return; dr.mods.splice(from, 1); if (from < at) at--; dr.mods.splice(at, 0, id) }
      else { if (dr.mods.includes(id)) return; dr.mods.splice(at, 0, id) }
      touch(); redraw();
    };
    const save = pub => {
      const t = dr.title.trim();
      if (t.length < 2) { say('Введите название программы.'); return }
      if (pub && !dr.mods.length) { say('Добавьте в программу хотя бы один модуль.'); return }
      const dd = dr.mods.map(modOf).filter(x => x && x.hid);
      if (pub && dd.length && !confirm('В программе есть модули-черновики (' + dd.map(x => code(x)).join(', ') + '): сотрудники их не увидят, пока модуль не опубликован. Продолжить?')) return;
      const w = dr.weeks === '' ? null : parseInt(dr.weeks, 10);
      if (w !== null && !(w >= 1 && w <= 52)) { say('Срок: от 1 до 52 недель.'); return }
      say('Сохраняю…'); $('#pb-sd').disabled = $('#pb-sp').disabled = true;
      sb.rpc('program_save', { p_id: dr.id, p_title: t, p_description: dr.description.trim(), p_weeks: w, p_self_enroll: dr.self, p_published: pub, p_modules: dr.mods }).then(async r => {
        if (r.error) { say(errText(r.error.message || '')); $('#pb-sd').disabled = $('#pb-sp').disabled = false; return }
        await load(true); const p = progOf(r.data); S.draft = p ? draftFrom(p) : newDraft(); S.dirty = false;
        draw(); const n = $('#pb-m'); if (n) n.textContent = pub ? 'Программа опубликована.' : 'Черновик сохранён.';
      });
    };
    $('#pb-sd').onclick = () => save(false);
    $('#pb-sp').onclick = () => save(true);
    const del = $('#pb-del');
    if (del) del.onclick = () => {
      const n = S.PA.filter(x => x.program_id == dr.id).length;
      if (!confirm('Удалить программу «' + dr.title + '»?' + (n ? '\nОна назначена сотрудникам: ' + n + '. Уже выданные модули и результаты останутся.' : ''))) return;
      sb.rpc('program_delete', { p_id: dr.id }).then(async r => {
        if (r.error) { say(errText(r.error.message || '')); return }
        await load(true); S.draft = null; S.dirty = false; draw();
      });
    };
  }

  /* ---------- статус сотрудника по программе ---------- */
  function statusOf(pa) {
    const ids = progMods(pa.program_id), rows = (S.RM || []).filter(r => r.email === pa.email && ids.includes(String(r.module_id)));
    const total = rows.length, done = rows.filter(r => r.passed).length;
    const started = rows.some(r => r.passed || r.attempts > 0 || r.case_total && (r.case_passed || r.case_pending || r.case_failed));
    const pct = total ? Math.round(done / total * 100) : 0;
    const overdue = !!pa.due_date && dayDiff(pa.due_date) < 0 && !(total && done === total);
    let k = total && done === total ? 'done' : overdue ? 'od' : started ? 'prog' : 'new';
    return { k, pct, total, done, overdue };
  }
  const ST = { done: ['Завершено', 'st-ok'], od: ['Просрочено', 'st-od'], prog: ['В процессе', 'st-pr'], new: ['Ждёт старта', 'st-nw'] };
  const stLabel = s => ST[s.k][0] + (s.k === 'prog' ? ' (' + s.pct + '%)' : '');

  /* ---------- вкладка «Назначения» ---------- */
  function assignRows() {
    const em = {}; (S.EM || []).forEach(e => { em[e.email] = e });
    const q = S.q.trim().toLowerCase();
    return S.PA.map(pa => ({ pa, e: em[pa.email], p: progOf(pa.program_id), s: statusOf(pa) })).filter(r => r.e && r.p)
      .filter(r => !q || (r.e.full_name + ' ' + r.e.email + ' ' + (r.e.shop || '') + ' ' + r.p.title).toLowerCase().includes(q))
      .sort((a, b) => a.e.full_name.localeCompare(b.e.full_name, 'ru') || a.p.title.localeCompare(b.p.title, 'ru'));
  }
  function assignTab(body) {
    const rows = assignRows();
    const rules = S.RU.map(r => { const p = progOf(r.program_id); return p ? { r, p } : null }).filter(Boolean);
    body.innerHTML = `<div class="as-bar"><button type="button" class="btn" id="as-new">+ Назначить курс</button><button type="button" class="fbtn alt" id="as-x">Экспорт в Excel</button>
      <input id="as-q" type="search" placeholder="Поиск сотрудника…" value="${esc(S.q)}" autocomplete="off" aria-label="Поиск сотрудника"></div>
      ${rows.length ? `<div class="rwrap"><table class="rt as-t"><thead><tr><th><input type="checkbox" id="as-all" aria-label="Выбрать все"></th><th class="l">Сотрудник</th><th class="l">Магазин</th><th class="l">Программа</th><th>Статус</th><th>Дедлайн</th><th>Действия</th></tr></thead><tbody>
      ${rows.map(x => { const k = x.pa.id; return `<tr><td><input type="checkbox" data-pk="${k}" aria-label="Выбрать"${S.pick.has(k) ? ' checked' : ''}></td><td class="l"><b>${esc(x.e.full_name)}</b></td><td class="l">${esc(x.e.shop || '—')}</td><td class="l">${esc(x.p.title)}</td>
        <td><span class="cst ${ST[x.s.k][1]}">${esc(stLabel(x.s))}</span></td><td>${x.pa.due_date ? esc(fds(x.pa.due_date)) : '—'}</td><td><button type="button" class="clnk" data-pe="${k}">Изменить</button></td></tr>` }).join('')}</tbody></table></div>
      <div class="as-sel" id="as-sel" style="display:${S.pick.size ? '' : 'none'}"><span>Выбрано: <b>${S.pick.size}</b></span><button type="button" class="fbtn alt del" id="as-un">Снять назначение у выбранных</button></div>`
        : '<div class="empty">Назначений пока нет. Нажмите «Назначить курс».</div>'}
      <h3 class="crs-sub">Правила автоназначения</h3>
      ${rules.length ? `<div class="as-rules">${rules.map(x => `<div class="as-rule"><div><b>${esc(x.p.title)}</b><span class="ex">${x.r.job_title ? 'Должность: ' + esc(x.r.job_title) : 'Любая должность'} · ${x.r.shop ? 'Магазин: ' + esc(x.r.shop) : 'Любой магазин'}${x.r.due_days ? ' · срок ' + daysLeft(x.r.due_days) : ''}</span></div><button type="button" class="fbtn alt del" data-rd="${x.r.id}">Удалить правило</button></div>`).join('')}</div>`
        : '<p class="ex">Правил нет. Правило автоматически назначает курс всем новым сотрудникам выбранной должности или магазина.</p>'}`;
    $('#as-new').onclick = () => assignDlg();
    $('#as-x').onclick = () => exportCsv(rows);
    const q = $('#as-q'); q.oninput = () => { S.q = q.value; const pos = q.selectionStart; draw(); const n = $('#as-q'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos) } catch (x) { } } };
    body.querySelectorAll('[data-pe]').forEach(b => b.onclick = () => editDlg(+b.dataset.pe));
    body.querySelectorAll('[data-pk]').forEach(c => c.onchange = () => { const k = +c.dataset.pk; c.checked ? S.pick.add(k) : S.pick.delete(k); const s = $('#as-sel'); s.style.display = S.pick.size ? '' : 'none'; s.querySelector('b').textContent = S.pick.size });
    const all = $('#as-all'); if (all) all.onchange = () => { rows.forEach(x => all.checked ? S.pick.add(x.pa.id) : S.pick.delete(x.pa.id)); draw() };
    const un = $('#as-un'); if (un) un.onclick = () => {
      const sel = S.PA.filter(x => S.pick.has(x.id)); if (!sel.length) return;
      if (!confirm('Снять назначение у выбранных (' + sel.length + ')? Результаты прохождения сохранятся.')) return;
      const by = new Map(); sel.forEach(x => { if (!by.has(x.program_id)) by.set(x.program_id, []); by.get(x.program_id).push(x.email) });
      Promise.all([...by].map(([pid, em]) => sb.rpc('program_unassign', { p_program: pid, p_emails: em }))).then(async r => {
        const er = r.find(x => x.error); if (er) { alert(errText(er.error.message || '')); return }
        S.pick.clear(); await refreshAll(); draw();
      });
    };
    body.querySelectorAll('[data-rd]').forEach(b => b.onclick = () => {
      if (!confirm('Удалить правило? Уже назначенные курсы останутся.')) return;
      sb.rpc('program_rule_delete', { p_rule: +b.dataset.rd }).then(async r => { if (r.error) { alert(errText(r.error.message || '')); return } await load(true); draw() });
    });
  }
  async function refreshAll() {
    await load(true);
    const r = await Promise.all([sb.rpc('list_employees'), sb.rpc('report_matrix')]);
    S.EM = r[0].error ? S.EM : (r[0].data || []); S.RM = r[1].error ? S.RM : (r[1].data || []);
  }

  function editDlg(paId) {
    const pa = S.PA.find(x => x.id === paId); if (!pa) return;
    const e = (S.EM || []).find(x => x.email === pa.email) || { full_name: pa.email }, p = progOf(pa.program_id);
    dlg('Назначение', `<div class="q fm"><p style="margin:0 0 8px"><b>${esc(e.full_name)}</b><br><span class="ex">${esc(p ? p.title : '')}</span></p>
      <label class="fl">Срок выполнения<input type="date" id="ed-d" value="${esc(pa.due_date || '')}"></label><div class="fmsg" id="ed-m" role="status"></div></div>
      <div class="dact">${dbtn('ed-u', 'Снять курс', 'fbtn alt del')}${dbtn('ed-s', 'Сохранить срок', 'btn')}</div>`, d => {
      const say = z => { $('#ed-m', d).textContent = z };
      $('#ed-s', d).onclick = () => { say('Сохраняю…'); sb.rpc('program_set_due', { p_program: pa.program_id, p_emails: [pa.email], p_due: $('#ed-d', d).value || null }).then(async r => { if (r.error) { say(errText(r.error.message || '')); return } await refreshAll(); d.close(); draw() }) };
      $('#ed-u', d).onclick = () => { if (!confirm('Снять курс у сотрудника? Результаты сохранятся.')) return; sb.rpc('program_unassign', { p_program: pa.program_id, p_emails: [pa.email] }).then(async r => { if (r.error) { say(errText(r.error.message || '')); return } await refreshAll(); d.close(); draw() }) };
    });
  }

  /* ---------- окно «Назначить курс»: сотрудникам, группе разово или правилом ---------- */
  function assignDlg() {
    const progs = S.P.filter(p => p.published);
    if (!progs.length) { alert('Сначала создайте и опубликуйте программу во вкладке «Конструктор программ».'); return }
    const emps = (S.EM || []).filter(isEmp).sort((a, b) => a.full_name.localeCompare(b.full_name, 'ru'));
    const jobs = [...new Set(((typeof JT !== 'undefined' && JT) ? JT.map(x => x.name) : emps.map(e => e.job_title)).map(x => String(x || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
    const shops = [...new Set(emps.map(e => e.shop).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
    dlg('Назначить курс', `<div class="q fm">
      <label class="fl">Курс<select id="as-p">${progs.map(p => `<option value="${p.id}">${esc(p.title)}</option>`).join('')}</select></label>
      <div class="fl"><b>Кому назначить</b><label class="rd"><input type="radio" name="as-m" value="sel" checked> Выбранным сотрудникам</label><label class="rd"><input type="radio" name="as-m" value="grp"> Группе: по должности и магазину</label></div>
      <div id="as-bsel"><input id="as-sq" type="search" placeholder="Найти сотрудника" autocomplete="off"><div class="as-list" id="as-list"></div><div class="ex" id="as-c1"></div></div>
      <div id="as-bgrp" style="display:none"><div class="fl"><b>Должности</b><div class="as-list" id="as-jobs">${jobs.map(j => `<label class="rd"><input type="checkbox" class="as-j" value="${esc(j)}"> ${esc(j)}</label>`).join('') || '<span class="ex">Справочник должностей пуст.</span>'}</div></div>
        <label class="fl">Магазин<select id="as-shop"><option value="">Все магазины</option>${shops.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select></label>
        <div class="ex" id="as-c2"></div>
        <div class="fl"><b>Как назначить</b><label class="rd"><input type="radio" name="as-h" value="once" checked> Разово: только тем, кто есть сейчас</label><label class="rd"><input type="radio" name="as-h" value="rule"> Правилом: ещё и всем новым сотрудникам этой группы автоматически</label></div></div>
      <label class="fl" id="as-dl">Срок выполнения (необязательно)<input type="date" id="as-d"></label>
      <label class="fl" id="as-nl" style="display:none">Срок для каждого сотрудника, дней с момента назначения<input type="number" id="as-n" min="1" max="365" placeholder="например, 14"></label>
      <div class="fmsg" id="as-msg" role="status"></div></div>
      <div class="dact">${dbtn('as-go', 'Назначить', 'btn')}${dbtn('as-cancel', 'Отмена')}</div>`, d => {
      const say = z => { $('#as-msg', d).textContent = z };
      const mode = () => d.querySelector('input[name=as-m]:checked').value, how = () => d.querySelector('input[name=as-h]:checked').value;
      const chosen = new Set();
      const drawList = () => {
        const q = $('#as-sq', d).value.trim().toLowerCase();
        $('#as-list', d).innerHTML = emps.filter(e => !q || (e.full_name + ' ' + (e.shop || '') + ' ' + (e.job_title || '')).toLowerCase().includes(q))
          .map(e => `<label class="rd"><input type="checkbox" class="as-e" value="${esc(e.email)}"${chosen.has(e.email) ? ' checked' : ''}> ${esc(e.full_name)} <span class="ex">${esc([e.shop, e.job_title].filter(Boolean).join(' · '))}</span></label>`).join('') || '<span class="ex">Никого не найдено.</span>';
        d.querySelectorAll('.as-e').forEach(c => c.onchange = () => { c.checked ? chosen.add(c.value) : chosen.delete(c.value); cnt() });
      };
      const groupEmails = () => {
        const js = [...d.querySelectorAll('.as-j:checked')].map(x => x.value), sh = $('#as-shop', d).value;
        return emps.filter(e => (!js.length || js.some(j => normJob(j) === normJob(e.job_title))) && (!sh || normJob(e.shop) === normJob(sh))).map(e => e.email);
      };
      const cnt = () => {
        $('#as-c1', d).textContent = 'Выбрано: ' + chosen.size;
        const g = mode() === 'grp', rule = g && how() === 'rule';
        $('#as-c2', d).textContent = 'Подходит сейчас сотрудников: ' + groupEmails().length;
        $('#as-bsel', d).style.display = g ? 'none' : ''; $('#as-bgrp', d).style.display = g ? '' : 'none';
        $('#as-dl', d).style.display = rule ? 'none' : ''; $('#as-nl', d).style.display = rule ? '' : 'none';
      };
      drawList(); cnt();
      d.querySelectorAll('input[name=as-m],input[name=as-h],.as-j').forEach(x => x.onchange = cnt); $('#as-shop', d).onchange = cnt;
      $('#as-sq', d).oninput = drawList; $('#as-cancel', d).onclick = () => d.close();
      $('#as-go', d).onclick = async () => {
        const pid = +$('#as-p', d).value, g = mode() === 'grp', rule = g && how() === 'rule', due = $('#as-d', d).value || null;
        const nd = $('#as-n', d).value === '' ? null : parseInt($('#as-n', d).value, 10);
        if (rule && nd !== null && !(nd >= 1 && nd <= 365)) { say('Срок: от 1 до 365 дней.'); return }
        const js = [...d.querySelectorAll('.as-j:checked')].map(x => x.value), sh = $('#as-shop', d).value;
        let emails = g ? groupEmails() : [...chosen];
        if (!rule && !emails.length) { say(g ? 'Нет подходящих сотрудников.' : 'Выберите хотя бы одного сотрудника.'); return }
        if (g && !js.length && !sh && !confirm('Вы не выбрали ни должность, ни магазин: курс получат ВСЕ сотрудники' + (rule ? ' (сейчас и в будущем)' : '') + '. Продолжить?')) return;
        $('#as-go', d).disabled = true; say('Назначаю…');
        try {
          let n = 0;
          if (rule) {
            for (const j of (js.length ? js : [null])) {
              const r = await sb.rpc('program_rule_save', { p_program: pid, p_job: j, p_shop: sh || null, p_due_days: nd });
              if (r.error) throw r.error; n += r.data || 0;
            }
          } else {
            const r = await sb.rpc('program_assign', { p_program: pid, p_emails: emails, p_due: due });
            if (r.error) throw r.error; n = r.data || 0;
          }
          await refreshAll(); d.close(); draw();
          alert(rule ? 'Правило сохранено. Назначено сейчас: ' + n + '. Новые сотрудники этой группы получат курс автоматически.' : 'Курс назначен сотрудникам: ' + n + '.');
        } catch (e) { $('#as-go', d).disabled = false; say(errText((e && e.message) || '')) }
      };
    });
  }

  function exportCsv(rows) {
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const L = [['Сотрудник', 'Почта', 'Магазин', 'Должность', 'Программа', 'Статус', 'Выполнено, %', 'Дедлайн'].map(q).join(';')];
    rows.forEach(x => L.push([x.e.full_name, x.e.email, x.e.shop || '', x.e.job_title || '', x.p.title, ST[x.s.k][0], x.s.pct, x.pa.due_date ? fds(x.pa.due_date) : ''].map(q).join(';')));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + L.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = 'naznacheniya_' + TODAY() + '.csv'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /* ---------- вкладка «Аналитика» ---------- */
  function statsTab(body) {
    if (!S.P.length) { body.innerHTML = '<div class="empty">Программ пока нет.</div>'; return }
    body.innerHTML = '<div class="st-grid">' + S.P.map(p => {
      const pa = S.PA.filter(x => x.program_id == p.id), ss = pa.map(statusOf);
      const done = ss.filter(s => s.k === 'done').length, prog = ss.filter(s => s.k === 'prog').length, od = ss.filter(s => s.k === 'od').length, nw = ss.filter(s => s.k === 'new').length;
      const pct = pa.length ? Math.round(done / pa.length * 100) : 0;
      return `<article class="st-card"><h4>${esc(p.title)}${p.published ? '' : ' <span class="ex">(черновик)</span>'}</h4><p class="ex">${esc(p.description || modsWord(progMods(p.id).length))}</p>
        <div class="st-r"><span>Назначено:</span><b>${pa.length} чел.</b></div><div class="st-r"><span>Завершено:</span><b>${done} чел.</b></div>
        <div class="st-r"><span>В процессе:</span><b>${prog} чел.</b></div><div class="st-r"><span>Ждут старта:</span><b>${nw} чел.</b></div>
        <div class="st-r od"><span>Просрочено:</span><b>${od} чел.</b></div><div class="cbar${od ? ' warn' : ''}"><i style="width:${pct}%"></i></div></article>`;
    }).join('') + '</div>';
  }

  window.CRS = { on, load, has, ctxIdx, menu, mgItem, homeCards, wireHome, crumb, crumbClick, viewMy, viewProgram, viewManage, goMy, goManage, openProgram };
})();
