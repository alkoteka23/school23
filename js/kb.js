/* =====================================================================
   УМНЫЙ ПОИСК И БАЗА ЗНАНИЙ — интерфейс
   Подключается из index.html. Опирается на js/search-engine.js и на то, что уже загружено
   на странице (модули, темы, файлы, тесты). Своё хранилище — таблицы из supabase_migration_14.sql.

   Что внутри:
   1. Сбор документов для поиска (что видит человек — то и ищется)
   2. Извлечение текста из PDF / Word / Excel / PowerPoint / txt (в браузере, при загрузке файла)
   3. Быстрый поиск (Ctrl+K или «/»), страница результатов
   4. База знаний: статьи, темы модулей, файлы; редактор статей
   ===================================================================== */
(function () {
  'use strict';

  const TL = { module: 'Модуль', topic: 'Тема', article: 'Статья', file: 'Файл', test: 'Тест', case: 'Кейс' };
  const PL = { module: 'Модули', topic: 'Темы', article: 'Статьи', file: 'Файлы', test: 'Тесты', case: 'Кейсы' };
  const TORDER = ['article', 'topic', 'module', 'file', 'test', 'case'];
  const ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';

  let KB = [], KBERR = '', FT = new Map(), FTLOADED = false, FTERR = false, KBA = new Map();
  let ENG = null, SIG = '', SIGT = 0, DOCS = [];
  let SQ = '', KBT = 'art', KBC = '', TF = 'all', AID = null, CURR = [];
  const LOGGED = new Set();
  let PAL = null, warming = null, qTimer = 0, logTimer = 0;

  const $ = (s, r) => (r || document).querySelector(s);
  const plain = t => String(t || '').replace(/\[img:[\w-]+\]/g, ' ').replace(/\*\*|__/g, '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ');
  const dfmt = d => { const x = new Date(d); return isNaN(x) ? '' : x.toLocaleDateString('ru-RU') };
  const canEd = () => !!(PIN && CFG_URL);
  const secName = id => (ROLES.find(r => r.id == id) || {}).t || '';

  /* ================= 1. ДАННЫЕ ================= */
  async function loadKb() {
    if (!sb) return;
    try {
      const r = await sb.from('kb_articles').select('*').order('pinned', { ascending: false }).order('updated_at', { ascending: false });
      if (r.error) { KB = []; KBERR = (r.error.code === '42P01' || /kb_articles/.test(r.error.message || '')) ? 'table' : 'fail' }
      else { KB = r.data || []; KBERR = '' }
    } catch (e) { KB = []; KBERR = 'fail' }
  }
  async function loadFt() {
    if (!sb) return;
    const map = new Map();
    try {
      for (let from = 0; ; from += 200) {
        const r = await sb.from('file_texts').select('file_id,module_id,content,status').range(from, from + 199);
        if (r.error) { FTERR = true; break }
        (r.data || []).forEach(x => map.set(String(x.file_id), x));
        if ((r.data || []).length < 200) break;
      }
      FT = map; FTLOADED = true;
    } catch (e) { FTERR = true }
  }
  function warm(force) {
    if (!U || !sb) return Promise.resolve();
    if (warming && !force) return warming;
    warming = Promise.all([loadKb(), loadFt()]).then(() => { SIGT = 0; if (view == 'kb' || view == 'kba') draw() });
    return warming;
  }

  /* что можно искать этому человеку: только то, что он и так видит на портале */
  function buildDocs() {
    const out = [], editor = CAN_EDIT;
    D.forEach(d => {
      const c = code(d), lk = PIN ? [] : lockedBy(d), title = d.page ? d.ttl : d.n.slice(c.length).trim();
      const where = 'Модуль ' + c + ' · ' + title;
      out.push({ id: 'm:' + c, type: 'module', title: 'Модуль ' + c + '. ' + title, text: '', crumb: secName(roleOf(d)) + (d.hid ? ' · черновик' : ''), open: { k: 'module', code: c }, locked: lk.length > 0, boost: 1.1 });
      if (lk.length) return; /* содержимое закрытого модуля не раскрываем */
      topicItems(d).filter(it => PIN || !it.hidden).forEach(it => out.push({
        id: 'p:' + c + ':' + (it.key || it.oid), type: 'topic', title: it.rawTitle, text: plain(it.rawText), crumb: where,
        open: { k: 'topic', code: c, title: it.rawTitle }
      }));
      if (editor) { /* тесты и кейсы — только редакторам, чтобы сотрудники не искали ответы */
        TESTS.filter(t => String(t.module) == c).forEach(t => out.push({
          id: 't:' + t.id, type: 'test', title: 'Тест: ' + (t.title || title),
          text: t.q.map(q => q[0] + ' ' + (q[1] || []).join(' ')).join(' '), crumb: where, open: { k: 'module', code: c, tab: 't' }
        }));
        (d.k || []).forEach((k, i) => out.push({
          id: 'k:' + c + ':' + i, type: 'case', title: 'Кейс ' + (i + 1) + ' · модуль ' + c, text: plain(k.situation), crumb: where, open: { k: 'module', code: c, tab: 'k' }
        }));
      }
    });
    FILES.filter(f => !isImg(f) && fok(f)).forEach(f => {
      let crumb = 'Общие материалы';
      if (f.module) {
        const d = D.find(x => code(x) == String(f.module));
        if (!d) return;                                  /* модуль скрыт или удалён */
        if (!PIN && lockedBy(d).length) return;
        crumb = 'Модуль ' + code(d) + ' · ' + (d.page ? d.ttl : d.n.slice(code(d).length).trim());
      }
      const t = FT.get(String(f.id));
      out.push({ id: 'f:' + f.id, type: 'file', title: f.title || f.name, text: t ? t.content : '', tags: [f.name], crumb, open: { k: 'file', id: f.id }, ext: fext(f.name), boost: 0.95 });
    });
    KB.forEach(a => out.push({
      id: 'a:' + a.id, type: 'article', title: a.title, text: plain(a.body), tags: (a.tags || []).concat(a.category), crumb: 'База знаний · ' + a.category,
      open: { k: 'article', id: a.id }, draft: a.status !== 'published', boost: a.pinned ? 1.3 : 1.15
    }));
    return out;
  }
  const sigOf = () => [D.length, TOPICS.length, TOPICS.map(t => t.id + (t.date || '') + (t.del ? 1 : 0) + t.title.length + t.text.length).join(), FILES.length,
    FILES.map(f => f.id + f.title).join(), KB.map(a => a.id + a.updated_at).join(), FT.size, TESTS.map(t => t.id + t.q.length).join(),
    PIN ? 1 : 0, CAN_EDIT ? 1 : 0, D.map(d => lockedBy(d).length).join('')].join('|');
  function ensure() {
    const now = Date.now();
    if (ENG && now - SIGT < 1200) return ENG;
    SIGT = now;
    const sg = sigOf();
    if (ENG && sg === SIG) return ENG;
    SIG = sg;
    ENG = ENG || SearchEngine.create({ synonyms: window.PORTAL_SYNONYMS || [] });
    DOCS = buildDocs(); ENG.build(DOCS);
    return ENG;
  }

  /* ================= 2. ТЕКСТ ИЗ ФАЙЛОВ ================= */
  const JSZIP = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
  const CAP = 300000;
  const xmlText = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  async function extract(blob, ext) {
    ext = String(ext || '').toLowerCase();
    if (/^(txt|md|csv)$/.test(ext)) return blob.text();
    if (ext === 'pdf') {
      await needPdf();
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise, parts = [];
      for (let i = 1; i <= Math.min(pdf.numPages, 300); i++) { const pg = await pdf.getPage(i), tc = await pg.getTextContent(); parts.push(tc.items.map(x => x.str).join(' ')) }
      return parts.join('\n');
    }
    if (ext === 'docx') { await needMammoth(); return (await mammoth.extractRawText({ arrayBuffer: await blob.arrayBuffer() })).value }
    if (/^xlsx?$/.test(ext)) {
      await needXlsx();
      const wb = XLSX.read(await blob.arrayBuffer(), { type: 'array' });
      return wb.SheetNames.map(n => n + '. ' + XLSX.utils.sheet_to_csv(wb.Sheets[n]).replace(/[,;]+/g, ' ')).join('\n');
    }
    if (ext === 'pptx') {
      await needLib(JSZIP, () => window.JSZip);
      const z = await JSZip.loadAsync(await blob.arrayBuffer()), num = n => +(n.match(/(\d+)\.xml$/) || [0, 0])[1];
      const names = Object.keys(z.files).filter(n => /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/.test(n)).sort((a, b) => num(a) - num(b));
      const parts = [];
      for (const n of names) { const xml = await z.file(n).async('string'); parts.push([...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(x => xmlText(x[1])).join(' ')) }
      return parts.join('\n');
    }
    return null; /* doc, ppt, картинки, видео, аудио: текста нет */
  }
  async function indexFile(f, blob) {
    if (!sb || !f) return false;
    let text = null;
    try { text = await extract(blob, fext(f.name)) } catch (e) { console.warn('Текст файла не извлечён', f.name, e); return false }
    text = text == null ? null : String(text).replace(/\s+/g, ' ').trim().slice(0, CAP);
    const st = text == null ? 'unsupported' : (text.length < 20 ? 'empty' : 'ok');
    const row = { file_id: f.id, module_id: f.module || null, content: st === 'ok' ? text : '', status: st, chars: text ? text.length : 0 };
    const r = await sb.from('file_texts').upsert(row);
    if (r.error) { console.warn(r.error); return false }
    FT.set(String(f.id), row); SIGT = 0;
    return true;
  }
  async function reindex(all, onProgress) {
    const list = FILES.filter(f => !isImg(f) && fok(f) && (all || !FT.has(String(f.id))));
    let done = 0, fail = 0;
    for (const f of list) {
      try {
        const r = await fetch(furl.emb(f));
        if (!r.ok) throw new Error('http ' + r.status);
        if (!(await indexFile(f, await r.blob()))) fail++;
      } catch (e) { fail++ }
      done++; if (onProgress) onProgress(done, list.length, fail);
    }
    return { done, fail, total: list.length };
  }

  /* ================= 3. ОТКРЫТИЕ НАЙДЕННОГО ================= */
  function flash(el) { el.classList.remove('sx-flash'); void el.offsetWidth; el.classList.add('sx-flash'); el.scrollIntoView({ behavior: 'smooth', block: 'center' }) }
  function focusTopic(title) {
    const dt = [...document.querySelectorAll('#v details')].find(x => { const s = x.querySelector('summary'); return s && s.textContent.trim().indexOf(String(title).trim()) === 0 });
    if (dt) { dt.open = true; flash(dt) }
  }
  function openFile(id) {
    const f = FILES.find(x => String(x.id) == String(id)); if (!f) return;
    const k = vKind(fext(f.name));
    dlg(f.title || f.name,
      '<div class="fv" data-fid="' + esc(f.id) + '" data-k="' + k + '"><div class="ex">Загружаю…</div></div>' +
      '<div class="dact" style="margin-top:12px"><a class="fbtn alt" target="_blank" rel="noopener" href="' + furl.view(f) + '">Открыть в новой вкладке</a> <a class="fbtn alt" href="' + furl.dl(f) + '">Скачать ↓</a>' +
      (f.module ? ' <button type="button" class="fbtn alt" data-gm="' + esc(f.module) + '">К модулю ' + esc(f.module) + '</button>' : '') + '</div>',
      d => { loadViewer(d.querySelector('.fv')); const g = d.querySelector('[data-gm]'); if (g) g.onclick = () => { d.close(); goCode(g.dataset.gm) } });
  }
  function openDoc(doc) {
    const o = doc.open || {}; closePalette();
    if (o.k === 'article') return goArticle(o.id);
    if (o.k === 'file') return openFile(o.id);
    goCode(o.code);
    if (o.tab) { tab = o.tab; draw() }
    if (o.k === 'topic') focusTopic(o.title);
  }
  const typeBadge = d => '<span class="sx-t t-' + d.type + '">' + TL[d.type] + (d.type === 'file' && d.ext ? ' · ' + esc(d.ext.toUpperCase()) : '') + '</span>' + (d.draft ? ' <span class="kb-draft">черновик</span>' : '') + (d.locked ? ' <span class="sx-lock">🔒 откроется после зачёта предыдущих модулей</span>' : '');
  const remember = q => { q = q.trim(); if (q.length < 2) return; const h = ls.g('sx_h', []).filter(x => x !== q); h.unshift(q); ls.s('sx_h', h.slice(0, 6)) };
  function logGap(q) {
    q = q.trim().toLowerCase(); if (!sb || q.length < 3 || LOGGED.has(q)) return; LOGGED.add(q);
    sb.from('search_log').insert({ query: q.slice(0, 200), results: 0 }).then(() => {}, () => {});
  }

  /* ================= 4. БЫСТРЫЙ ПОИСК (палитра) ================= */
  function openPalette(q0) {
    if (!U || !window.SearchEngine) return;
    if (PAL) { PAL.input.focus(); return }
    closeDlg();
    const ov = document.createElement('div'); ov.className = 'sx-ov';
    ov.innerHTML = '<div class="sx-pal" role="dialog" aria-modal="true" aria-label="Поиск"><div class="sx-in">' + ICON +
      '<input type="text" placeholder="Найти в модулях, статьях и файлах…" autocomplete="off" spellcheck="false" aria-label="Поиск"><button type="button" aria-label="Закрыть">Esc</button></div>' +
      '<div class="sx-list" role="listbox"></div><div class="sx-ft"><span>↑ ↓ — выбрать, Enter — открыть</span><a data-all role="button" tabindex="0">Все результаты и база знаний →</a></div></div>';
    document.body.appendChild(ov);
    const input = $('input', ov), list = $('.sx-list', ov);
    PAL = { ov, input, items: [], sel: 0 };
    const paint = () => {
      const q = input.value.trim(); let h = '';
      PAL.items = [];
      if (!q) {
        const hist = ls.g('sx_h', []);
        h = hist.length ? '<div class="sx-lab">Недавние запросы</div>' + hist.map((x, i) => '<button type="button" class="sx-i" data-h="' + i + '"><b>' + esc(x) + '</b></button>').join('') : '<div class="sx-none">Начните вводить слово — например, «отпуск» или «инвентаризация».<br>Опечатки и формы слов не страшны.</div>';
        list.innerHTML = h; list.querySelectorAll('[data-h]').forEach(b => b.onclick = () => { input.value = hist[+b.dataset.h]; paint(); input.focus() }); return;
      }
      const r = ensure().search(q, { limit: 8, snip: 120 });
      PAL.items = r.results;
      if (PAL.sel >= PAL.items.length) PAL.sel = 0;
      if (!r.results.length) {
        h = '<div class="sx-none">Ничего не нашлось по запросу «' + esc(q) + '».' + (r.fixed ? '' : '<br>Попробуйте одно ключевое слово.') + '</div>';
        if (r.fixed) h += '<div class="sx-fix">Возможно, вы искали: <a data-fix="' + esc(r.fixed) + '">' + esc(r.fixed) + '</a></div>';
        clearTimeout(logTimer); logTimer = setTimeout(() => { if (PAL && input.value.trim() === q && !PAL.items.length) logGap(q) }, 1500);
      } else {
        h = r.results.map((x, i) => '<button type="button" class="sx-i' + (i === PAL.sel ? ' on' : '') + '" role="option" data-i="' + i + '"><div class="sx-top">' + typeBadge(x.doc) + '<span class="sx-c">' + esc(x.doc.crumb) + '</span></div><b>' + x.titleHtml + '</b>' + (x.snippet ? '<span class="sx-s">' + x.snippet + '</span>' : '') + '</button>').join('');
        if (r.fixed) h = '<div class="sx-fix">Возможно, вы искали: <a data-fix="' + esc(r.fixed) + '">' + esc(r.fixed) + '</a></div>' + h;
      }
      list.innerHTML = h;
      list.querySelectorAll('[data-i]').forEach(b => { b.onclick = () => { remember(input.value); openDoc(PAL.items[+b.dataset.i].doc) }; b.onmousemove = () => { if (PAL.sel !== +b.dataset.i) { PAL.sel = +b.dataset.i; list.querySelectorAll('.sx-i').forEach((n, k) => n.classList.toggle('on', k === PAL.sel)) } } });
      list.querySelectorAll('[data-fix]').forEach(a => a.onclick = () => { input.value = a.dataset.fix; PAL.sel = 0; paint(); input.focus() });
    };
    const all = () => { const q = input.value.trim(); remember(q); closePalette(); goKb(q) };
    input.addEventListener('input', () => { PAL.sel = 0; clearTimeout(qTimer); qTimer = setTimeout(paint, 60) });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); if (!PAL.items.length) return;
        PAL.sel = (PAL.sel + (e.key === 'ArrowDown' ? 1 : -1) + PAL.items.length) % PAL.items.length;
        list.querySelectorAll('.sx-i').forEach((n, k) => { n.classList.toggle('on', k === PAL.sel); if (k === PAL.sel) n.scrollIntoView({ block: 'nearest' }) });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey || !PAL.items.length) { if (input.value.trim()) all(); return }
        remember(input.value); openDoc(PAL.items[PAL.sel].doc);
      }
    });
    ov.addEventListener('mousedown', e => { if (e.target === ov) closePalette() });
    $('.sx-in button', ov).onclick = closePalette;
    $('[data-all]', ov).onclick = () => { if (input.value.trim()) all(); else { closePalette(); goKb('') } };
    ov.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closePalette() } });
    input.value = q0 || ''; paint(); input.focus();
    warm(); /* на случай, если данные ещё не подгрузились */
  }
  function closePalette() { if (!PAL) return; clearTimeout(qTimer); PAL.ov.remove(); PAL = null }

  function mountButton() {
    const ti = $('.top-inner'); if (!ti || !U) return;
    let b = document.getElementById('sxbtn');
    if (!b) { b = document.createElement('button'); b.id = 'sxbtn'; b.type = 'button'; b.className = 'sxbtn'; b.title = 'Поиск (Ctrl+K)'; b.setAttribute('aria-label', 'Поиск по порталу'); b.innerHTML = ICON; b.onclick = () => openPalette(); ti.insertBefore(b, document.getElementById('user')) }
    b.hidden = false;
  }
  function homeBox(anchor) {
    if (!anchor || document.getElementById('sxh')) return;
    anchor.insertAdjacentHTML('beforebegin', '<button type="button" class="sx-home" id="sxh">' + ICON + '<span>Найти в модулях, статьях и файлах…</span><span class="k">Ctrl K</span></button>');
    document.getElementById('sxh').onclick = () => openPalette();
    if(!CAN_EDIT){anchor.insertAdjacentHTML('beforeend','<button type="button" class="hcard hcard-quick" id="kb-home-course"><div class="hcard-icon">⚡</div><div class="hcard-content"><b>Быстрые курсы</b><span>Короткие видео и карточки для обучения</span></div><i id="kb-home-new" hidden>НОВОЕ</i></button>');const qb=$('#kb-home-course');if(qb)qb.onclick=()=>{KBSECTION='courses';goKb('')};warm().then(()=>{const fresh=KB.some(a=>a.category==='Быстрые курсы'&&a.status==='published'&&Date.now()-new Date(a.created_at||a.updated_at).getTime()<14*86400000);const badge=$('#kb-home-new');if(badge)badge.hidden=!fresh;});}
  }
  document.addEventListener('keydown', e => {
    if (!U) return;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK') { e.preventDefault(); PAL ? closePalette() : openPalette(); return }
    const t = e.target, typing = t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
    if (e.key === '/' && !typing && !PAL && !document.querySelector('dialog[open]')) { e.preventDefault(); openPalette() }
  });

  /* ================= 5. БАЗА ЗНАНИЙ: страница ================= */
  function goKb(q) {
    closePalette(); view = 'kb'; if (q != null) { SQ = q; TF = 'all' }
    renderTop(); nav(); draw(); window.scrollTo({ top: 0 });
    warm();
  }
  function goArticle(id) { closePalette(); AID = String(id); view = 'kba'; renderTop(); nav(); draw(); window.scrollTo({ top: 0 }) }
  const wireCrumb = () => m.querySelectorAll('[data-cr]').forEach(a => a.onclick = ev => { ev.preventDefault(); a.dataset.cr === 'h' ? goHome() : goKb('') });

  const KB_SECTIONS = [
    {id:'courses',title:'Быстрые курсы',desc:'Короткие видео, тексты и карточки',icon:'⚡',cat:'Быстрые курсы'},
    {id:'articles',title:'Статьи и лайфхаки',desc:'Опыт коллег и инструкции редактора',icon:'💡'},
    {id:'library',title:'Электронная библиотека',desc:'PDF-книги, документы и полезные файлы',icon:'📚',cat:'Электронная библиотека'},
    {id:'modules',title:'Материалы из модулей',desc:'Все материалы учебных модулей',icon:'📁'}
  ];
  let KBSECTION = 'all';
  function sectionCount(id) {
    if(id==='courses') return KB.filter(a=>a.category==='Быстрые курсы' && (a.status==='published'||CAN_EDIT||(ME&&String(a.author_id)===String(ME.id)))).length;
    if(id==='articles') return KB.filter(a=>a.category!=='Быстрые курсы'&&a.category!=='Электронная библиотека'&&(a.status==='published'||CAN_EDIT||(ME&&String(a.author_id)===String(ME.id)))).length;
    if(id==='library') return KB.filter(a=>a.category==='Электронная библиотека'&&(a.status==='published'||CAN_EDIT||(ME&&String(a.author_id)===String(ME.id)))).length + FILES.filter(f=>!f.module&&!isImg(f)&&fok(f)).length;
    if(id==='modules') return FILES.filter(f=>!!f.module&&!isImg(f)&&fok(f)).length + DOCS.filter(d=>d.type==='topic').length;
    return KB.filter(a=>a.status==='published'||CAN_EDIT||(ME&&String(a.author_id)===String(ME.id))).length + FILES.filter(f=>!isImg(f)&&fok(f)).length;
  }
  function viewKb() {
    document.body.classList.remove('home');
    const ed = canEd(), pending = KB.filter(a => a.status === 'pending' || a.status === 'revision').length;
    m.innerHTML = '<div class="crumb"><a href="#" data-cr="h">Главная</a> › База знаний</div><h2>База знаний</h2>' +
      '<div class="kb-bar"><label class="kb-q">' + ICON + '<input type="search" id="kbq" placeholder="Что вы ищете? Например: отпуск, касса…" autocomplete="off" spellcheck="false" aria-label="Поиск по базе знаний"><button type="button" id="kbx" aria-label="Очистить" hidden>×</button></label>' +
      '<button type="button" class="btn" id="kb-suggest">+ Предложить статью</button>' +
      (CAN_EDIT ? '<button type="button" class="fbtn alt" id="kb-review">На проверке (' + pending + ')</button>' : '') +
      (ed ? '<button type="button" class="fbtn alt" id="kbnew">+ Статья редактора</button>' : '') + edBtn() + '</div>' +
      '<div class="kb-folders">' + KB_SECTIONS.map(x=>'<button type="button" class="kb-folder" data-section="'+x.id+'"><span class="kb-folder-icon">'+x.icon+'</span><span><b>'+x.title+'</b><small>'+x.desc+'</small></span><em>'+sectionCount(x.id)+'</em></button>').join('') + '</div>' +
      (KBERR === 'table' && CAN_EDIT ? '<div class="kb-warn">Раздел статей ещё не подключён: выполните миграцию базы знаний в Supabase.</div>' : '') +
      '<div id="kb-review-list" hidden></div><div id="kbbody"></div>' + (ed ? edPanel() : '');
    wireCrumb(); wireAuth();
    const inp = $('#kbq'), x = $('#kbx'); inp.value = SQ; x.hidden = !SQ;
    inp.addEventListener('input', () => { SQ = inp.value; x.hidden = !SQ; clearTimeout(qTimer); qTimer = setTimeout(paintKb, 120) });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') remember(inp.value) });
    x.onclick = () => { SQ = ''; inp.value = ''; x.hidden = true; paintKb(); inp.focus() };
    const nb = $('#kbnew'); if (nb) nb.onclick = () => articleDlg(null);
    $('#kb-suggest').onclick = () => suggestDlg();
    const rv = $('#kb-review'); if (rv) rv.onclick = () => paintReviewQueue();
    m.querySelectorAll('[data-section]').forEach(b=>b.onclick=()=>{KBSECTION=b.dataset.section;SQ='';inp.value='';x.hidden=true;const q=$('#kb-review-list');if(q)q.hidden=true;$('#kbbody').hidden=false;paintKb()});
    paintKb(); wireEdPanel();
    if (SQ && !FTLOADED) warm();
  }

  function statusLabel(a) {
    return ({draft:'Черновик',pending:'На проверке',revision:'Нужны исправления',published:'Опубликовано',rejected:'Отклонено'})[a.status || (a.hidden ? 'draft' : 'published')] || 'Статья';
  }
  async function paintReviewQueue() {
    const box = $('#kb-review-list'); if (!box) return;
    box.hidden = false; $('#kbbody').hidden = true;
    const rows = KB.filter(a => a.status === 'pending' || a.status === 'revision').sort((a,b)=>new Date(a.submitted_at||a.updated_at)-new Date(b.submitted_at||b.updated_at));
    box.innerHTML = '<div class="kb-sec">Статьи на проверке</div>' + (rows.length ? '<div class="kb-grid">' + rows.map(a => '<button class="kb-card" data-art="'+a.id+'"><div class="kb-meta"><span class="kb-draft">'+statusLabel(a)+'</span></div><h3>'+esc(a.title)+'</h3><p>'+esc(plain(a.body).slice(0,140))+'</p></button>').join('') + '</div>' : '<div class="empty">Очередь проверки пуста.</div>') + '<button type="button" class="fbtn alt" id="kb-back">← Вернуться в базу знаний</button>';
    box.querySelectorAll('[data-art]').forEach(b => b.onclick = () => goArticle(b.dataset.art));
    $('#kb-back').onclick = () => { box.hidden = true; $('#kbbody').hidden = false };
  }

  function suggestDlg() {
    dlg('Поделиться опытом с коллегами', '<p class="ex">Опишите рабочий приём, который помогает вам в ежедневной работе. После отправки статья попадёт редактору на проверку.</p>' +
      '<label class="fl">Заголовок<input id="ks-title" maxlength="200" placeholder="Например: Как быстрее подготовить смену"></label>' +
      '<label class="fl">Раздел<select id="ks-cat"><option>Лайфхаки от коллег</option><option>Статьи редактора</option><option>Инструкции и процессы</option><option>Полезные советы</option></select></label>' +
      '<label class="fl">Теги через запятую<input id="ks-tags" maxlength="200" placeholder="касса, смена, сервис"></label>' +
      '<label class="fl">Ваша статья<textarea id="ks-body" rows="10" maxlength="60000" placeholder="Поделитесь своим опытом: опишите ситуацию, ваш способ решения и полезный результат…"></textarea></label>' +
      '<label class="fl">Прикрепить PDF или видео (до 50 МБ каждый)<input id="ks-files" type="file" accept="application/pdf,video/mp4,video/webm,.pdf,.mp4,.webm" multiple></label>' +
      '<div class="fmsg" id="ks-msg" role="status"></div><div class="dact"><button type="button" class="btn" id="ks-send">Отправить редактору</button><button type="button" class="fbtn alt" id="ks-cancel">Отмена</button></div>', dd => {
      const say = t => $('#ks-msg',dd).textContent = t, send = $('#ks-send',dd);
      $('#ks-cancel',dd).onclick = () => dd.close();
      send.onclick = async () => {
        const title=$('#ks-title',dd).value.trim(), body=$('#ks-body',dd).value.trim(), files=[...($('#ks-files',dd).files||[])];
        if(!title || body.length<30){say('Добавьте заголовок и текст статьи (не менее 30 символов).');return}
        if(files.some(f=>f.size>50*1048576)){say('Каждый файл должен быть не больше 50 МБ.');return}
        if(files.some(f=>!(/\.pdf$/i.test(f.name)||/^video\/(mp4|webm)$/.test(f.type)))){say('Поддерживаются только PDF, MP4 и WebM.');return}
        send.disabled=true; say('Сохраняю статью и загружаю вложения…');
        const cat=$('#ks-cat',dd).value, tags=$('#ks-tags',dd).value.split(',').map(x=>x.trim()).filter(Boolean).slice(0,12);
        const ins=await sb.from('kb_articles').insert({title,body,category:cat,tags,status:'draft',hidden:true,author_id:ME.id,author_name:ME.full_name||U.name,created_by:ME.id}).select().single();
        if(ins.error){send.disabled=false;say('Не удалось создать статью: '+(ins.error.message||'ошибка'));return}
        try {
          for(const f of files){
            const ext=f.name.split('.').pop().toLowerCase(), path='kb/'+ME.id+'/'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8)+'.'+ext;
            const up=await sb.storage.from('materials').upload(path,f,{contentType:f.type||'application/octet-stream'}); if(up.error)throw up.error;
            const ar=await sb.from('kb_attachments').insert({article_id:ins.data.id,name:f.name,storage_path:path,mime:f.type||'application/octet-stream',size_bytes:f.size,kind:ext==='pdf'?'pdf':(/^video\//.test(f.type)?'video':'document'),created_by:ME.id});
            if(ar.error){await sb.storage.from('materials').remove([path]);throw ar.error}
          }
          const upd=await sb.from('kb_articles').update({status:'pending',submitted_at:new Date().toISOString()}).eq('id',ins.data.id);
          if(upd.error)throw upd.error;
        } catch(e){send.disabled=false;say('Статья сохранена как черновик, но отправить её не удалось: '+(e.message||'ошибка'));return}
        dd.close(); alert('Статья отправлена редактору на проверку. Статус можно посмотреть в базе знаний.'); await loadKb(); SIGT=0; goKb('');
      };
    });
  }

  async function articleAttachments(id) {
    const r=await sb.from('kb_attachments').select('*').eq('article_id',id).order('created_at');
    if(r.error)return [];
    const list=r.data||[]; if(!list.length)return [];
    const signed=await sb.storage.from('materials').createSignedUrls(list.map(x=>x.storage_path),21600);
    const urls={};(signed.data||[]).forEach(x=>urls[x.path]=x.signedUrl);
    return list.map(x=>({...x,url:urls[x.storage_path]||''}));
  }

  async function reviewArticle(a, action) {
    let comment='';
    if(action!=='publish'){comment=prompt(action==='revision'?'Что нужно исправить?':'Укажите причину отказа:','');if(comment===null)return;if(!comment.trim()){alert('Добавьте комментарий для сотрудника.');return}}
    const patch={status:action,hidden:action!=='publish',reviewer_id:ME.id,review_comment:comment,reviewed_at:new Date().toISOString()};
    const r=await sb.from('kb_articles').update(patch).eq('id',a.id);
    if(r.error){alert('Не удалось сохранить решение редактора: '+r.error.message);return}
    await loadKb();SIGT=0;draw();
  }


  function paintKb() {
    const b = document.getElementById('kbbody'); if (!b) return;
    const q = SQ.trim();
    if (q) { b.innerHTML = resultsHtml(q); wireResults(b, q); return }
    ensure();
    const arts = DOCS.filter(d => d.type === 'article'), topics = DOCS.filter(d => d.type === 'topic'), files = DOCS.filter(d => d.type === 'file');
    if(KBSECTION==='courses'){
      const list=KB.filter(a=>a.category==='Быстрые курсы'&&(a.status==='published'||CAN_EDIT||(ME&&String(a.author_id)===String(ME.id))));
      b.innerHTML='<div class="kb-section-head"><h3>Быстрые курсы</h3>'+(canEd()?'<button type="button" class="btn" id="kb-upload-course">+ Загрузить курс</button>':'')+'</div>'+articleCards(list,'Курсов пока нет. Здесь появятся короткие видео, тексты и карточки.');
    } else if(KBSECTION==='articles'){
      const list=KB.filter(a=>a.category!=='Быстрые курсы'&&a.category!=='Электронная библиотека'&&(a.status==='published'||CAN_EDIT||(ME&&String(a.author_id)===String(ME.id))));
      b.innerHTML='<div class="kb-section-head"><h3>Статьи и лайфхаки</h3>'+(canEd()?'<button type="button" class="btn" id="kb-new-article">+ Добавить статью</button>':'')+'</div>'+articleCards(list,'Пока нет опубликованных статей. Вы можете предложить свою.');
    } else if(KBSECTION==='library'){
      const list=KB.filter(a=>a.category==='Электронная библиотека'&&(a.status==='published'||CAN_EDIT||(ME&&String(a.author_id)===String(ME.id))));
      b.innerHTML='<div class="kb-section-head"><h3>Электронная библиотека</h3>'+(canEd()?'<button type="button" class="btn" id="kb-upload-book">+ Загрузить материал</button>':'')+'</div>'+articleCards(list,'Библиотека пока пуста. Редактор может загрузить PDF-книги и материалы прямо сюда.');
    } else if(KBSECTION==='modules'){
      b.innerHTML='<div class="kb-section-head"><h3>Материалы из модулей</h3></div>'+filesHtml(files.filter(f=>f.crumb&&f.crumb.startsWith('Модуль ')))+modsHtml();
    } else {
      b.innerHTML='<div class="kb-section-head"><h3>Все материалы</h3></div>'+articleCards(KB.filter(a=>a.status==='published'||CAN_EDIT||(ME&&String(a.author_id)===String(ME.id))),'В базе знаний пока нет материалов.');
    }
    b.querySelectorAll('[data-art]').forEach(x=>x.onclick=()=>goArticle(x.dataset.art));
    const uc=$('#kb-upload-course');if(uc)uc.onclick=()=>uploadSectionDlg('Быстрые курсы','video');
    const ub=$('#kb-upload-book');if(ub)ub.onclick=()=>uploadSectionDlg('Электронная библиотека','pdf');
    const na=$('#kb-new-article');if(na)na.onclick=()=>{ls.s('sx_cat','Статьи редактора');articleDlg(null)};
    b.querySelectorAll('[data-mod]').forEach(x=>x.onclick=()=>{goCode(x.dataset.mod);if(x.dataset.topic)focusTopic(x.dataset.topic)});
    b.querySelectorAll('[data-file]').forEach(x=>x.onclick=()=>openFile(x.dataset.file));
  }
  function articleCards(list, empty) {
    if(!list.length)return '<div class="empty">'+empty+'</div>';
    return '<div class="kb-grid">'+list.map(a=>'<button type="button" class="kb-card" data-art="'+a.id+'"><div class="kb-meta"><span class="sx-t t-article">'+esc(a.category)+'</span>'+(a.status&&a.status!=='published'?'<span class="kb-draft">'+statusLabel(a)+'</span>':'')+'</div><h3>'+esc(a.title)+'</h3><p>'+esc(plain(a.body).replace(/\s+/g,' ').slice(0,155))+'</p><div class="kb-card-foot"><span>'+(a.author_name?esc(a.author_name):'База знаний')+'</span><span>'+dfmt(a.updated_at)+'</span></div></button>').join('')+'</div>';
  }
  function uploadSectionDlg(category, kind) {
    if(!canEd())return;
    const isVideo=kind==='video';
    dlg(isVideo?'Новый быстрый курс':'Новый материал библиотеки','<p class="ex">'+(isVideo?'Добавьте короткое видео, текст или карточку курса.':'Загрузите PDF-книги, EPUB, документы Office или текстовые файлы.')+'</p><label class="fl">Название<input id="ku-title" maxlength="200" placeholder="Название материала"></label><label class="fl">Описание / текст<textarea id="ku-body" rows="7" maxlength="60000" placeholder="Краткое содержание, инструкция или карточки…"></textarea></label><label class="fl">'+(isVideo?'Видео или PDF (до 50 МБ каждый)':'PDF, EPUB, Word, Excel, PowerPoint и TXT (до 50 МБ каждый)')+'<input id="ku-files" type="file" multiple accept="'+(isVideo?'application/pdf,video/mp4,video/webm,.pdf,.mp4,.webm':'application/pdf,.pdf,.epub,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt')+'"></label><div class="fmsg" id="ku-msg" role="status"></div><div class="dact"><button type="button" class="btn" id="ku-save">Опубликовать</button><button type="button" class="fbtn alt" id="ku-cancel">Отмена</button></div>',dd=>{
      const say=t=>$('#ku-msg',dd).textContent=t;$('#ku-cancel',dd).onclick=()=>dd.close();
      $('#ku-save',dd).onclick=async()=>{
        const title=$('#ku-title',dd).value.trim(),body=$('#ku-body',dd).value.trim(),files=[...$('#ku-files',dd).files];
        if(!title){say('Укажите название материала.');return}if(!body&&!files.length){say('Добавьте текст или хотя бы один файл.');return}
        if(files.some(f=>f.size>50*1048576)){say('Каждый файл должен быть не больше 50 МБ.');return}
        if(files.some(f=>!(/\.(pdf|epub|doc|docx|xls|xlsx|ppt|pptx|txt)$/i.test(f.name)||(isVideo&&/^video\/(mp4|webm)$/.test(f.type))))){say(isVideo?'Поддерживаются PDF, MP4 и WebM.':'Поддерживаются PDF, EPUB, Word, Excel, PowerPoint и TXT.');return}
        const btn=$('#ku-save',dd);btn.disabled=true;say('Сохраняю материал…');
        const ins=await sb.from('kb_articles').insert({title,body,category,tags:[],status:'published',hidden:false,author_id:ME.id,author_name:ME.full_name||U.name,created_by:ME.id}).select().single();
        if(ins.error){btn.disabled=false;say('Не удалось сохранить: '+ins.error.message);return}
        try{for(const f of files){const ext=f.name.split('.').pop().toLowerCase(),path='kb/'+ME.id+'/'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8)+'.'+ext;const up=await sb.storage.from('materials').upload(path,f,{contentType:f.type||'application/octet-stream'});if(up.error)throw up.error;const ar=await sb.from('kb_attachments').insert({article_id:ins.data.id,name:f.name,storage_path:path,mime:f.type||'application/octet-stream',size_bytes:f.size,kind:ext==='pdf'?'pdf':(/^video\//.test(f.type)?'video':'document'),created_by:ME.id});if(ar.error){await sb.storage.from('materials').remove([path]);throw ar.error}}}
        catch(e){btn.disabled=false;say('Материал создан, но файл не загрузился: '+(e.message||'ошибка'));return}
        dd.close();await loadKb();SIGT=0;KBSECTION=isVideo?'courses':'library';draw();
      };
    });
  }

  function artsHtml() {
    if (!KB.length) return '<div class="empty">' + (KBERR === 'table' ? 'Раздел статей готовится.' : canEd() ? 'Статей пока нет. Нажмите «+ Статья», чтобы написать первую: регламент, инструкцию или ответ на частый вопрос.' : 'Пока нет опубликованных статей. Нажмите «+ Предложить статью», чтобы поделиться своим опытом.') + '</div>';
    const visible = KB.filter(a => a.status === 'published' || CAN_EDIT || (ME && String(a.author_id)===String(ME.id)));
    const cats = {}; visible.forEach(a => cats[a.category] = (cats[a.category] || 0) + 1);
    const names = [...new Set(['Лайфхаки от коллег','Электронная библиотека',...Object.keys(cats)])].sort((a, b) => a.localeCompare(b, 'ru'));
    if (KBC && !cats[KBC]) KBC = '';
    const list = visible.filter(a => !KBC || a.category === KBC);
    return (names.length > 1 ? '<div class="kb-chips"><button data-kc="" aria-pressed="' + !KBC + '">Все<small>' + KB.length + '</small></button>' + names.map(n => '<button data-kc="' + esc(n) + '" aria-pressed="' + (KBC === n) + '">' + esc(n) + '<small>' + (cats[n]||0) + '</small></button>').join('') + '</div>' : '') +
      '<div class="kb-grid">' + list.map(a => {
        const ex = plain(a.body).replace(/\s+/g, ' ').trim();
        return '<button type="button" class="kb-card" data-art="' + a.id + '"><div class="kb-meta">' + (a.pinned ? '<span title="Закреплено">★</span>' : '') + '<span class="sx-t t-article">' + esc(a.category) + '</span>' + (a.status && a.status!=='published' ? '<span class="kb-draft">'+statusLabel(a)+'</span>' : '') + '</div><h3>' + esc(a.title) + '</h3>' +
          (ex ? '<p>' + esc(ex.slice(0, 150)) + (ex.length > 150 ? '…' : '') + '</p>' : '') + '<div class="kb-meta">' + (a.tags || []).slice(0, 4).map(t => '<span class="kb-tag">' + esc(t) + '</span>').join('') + '<span>' + dfmt(a.updated_at) + '</span></div></button>';
      }).join('') + '</div>';
  }
  function modsHtml() {
    let h = '';
    ROLES.forEach(r => {
      const mods = inRole(r.id).map(i => D[i]).filter(Boolean);
      if (!mods.length) return;
      h += '<div class="kb-sec">' + esc(r.t) + '</div>';
      mods.forEach(d => {
        const c = code(d), tp = DOCS.filter(x => x.type === 'topic' && x.open.code === c), lk = DOCS.find(x => x.id === 'm:' + c && x.locked);
        h += '<details class="kb-grp"><summary>Модуль ' + esc(c) + '. ' + esc(d.page ? d.ttl : d.n.slice(c.length).trim()) + (d.hid ? ' <small>черновик</small>' : '') + '<small>' + (lk ? '🔒 откроется после зачёта' : tp.length + ' ' + (tp.length % 10 === 1 && tp.length % 100 !== 11 ? 'тема' : (tp.length % 10 >= 2 && tp.length % 10 <= 4 && (tp.length % 100 < 12 || tp.length % 100 > 14) ? 'темы' : 'тем'))) + '</small></summary><ul>' +
          tp.map(t => '<li><button type="button" data-mod="' + esc(c) + '" data-topic="' + esc(t.open.title) + '">' + esc(t.title) + '</button></li>').join('') +
          '<li><button type="button" data-mod="' + esc(c) + '"><b>Открыть модуль →</b></button></li></ul></details>';
      });
    });
    return h || '<div class="empty">Материалы готовятся.</div>';
  }
  function filesHtml(files) {
    if (!files.length) return '<div class="empty">Файлов пока нет.</div>';
    const g = {}; files.forEach(f => (g[f.crumb] = g[f.crumb] || []).push(f));
    return Object.keys(g).sort((a, b) => a.localeCompare(b, 'ru', { numeric: true })).map(k => '<details class="kb-grp" open><summary>' + esc(k) + '<small>' + g[k].length + '</small></summary><ul>' + g[k].map(f => {
      const t = FT.get(String(f.open.id));
      return '<li><button type="button" data-file="' + f.open.id + '"><span class="fi t-' + fkind(f.ext) + '" aria-hidden="true">' + esc(f.ext.toUpperCase().slice(0, 4)) + '</span><span>' + esc(f.title) + '</span>' + (canEd() ? '<small class="ex" title="Есть ли текст для поиска внутри файла">' + (t && t.status === 'ok' ? '✓ текст в поиске' : t ? '— без текста' : '· не проиндексирован') + '</small>' : '') + '</button></li>';
    }).join('') + '</ul></details>').join('');
  }

  function resultsHtml(q) {
    const eng = ensure(), r = eng.search(q, { types: TF === 'all' ? null : [TF], limit: 50 });
    CURR = r.results;
    const types = TORDER.filter(t => r.counts[t]);
    let h = '';
    if (types.length > 1 || TF !== 'all') h += '<div class="kb-chips"><button data-tf="all" aria-pressed="' + (TF === 'all') + '">Всё<small>' + r.total + '</small></button>' + types.map(t => '<button data-tf="' + t + '" aria-pressed="' + (TF === t) + '">' + PL[t] + '<small>' + r.counts[t] + '</small></button>').join('') + '</div>';
    if (r.fixed) h += '<div class="sx-fix" style="padding-left:0">' + (r.total ? 'Показано по запросу как написано. ' : '') + 'Возможно, вы искали: <a data-fix="' + esc(r.fixed) + '">' + esc(r.fixed) + '</a></div>';
    if (!r.results.length) {
      clearTimeout(logTimer); logTimer = setTimeout(() => { if (view === 'kb' && SQ.trim() === q && !CURR.length) logGap(q) }, 1500);
      return h + '<div class="empty">Ничего не нашлось по запросу «' + esc(q) + '».<br><span class="ex">Попробуйте одно ключевое слово или другое название. Если материала нет, напишите нам через «Оставить отзыв» внизу страницы: мы дополним базу знаний.</span></div>';
    }
    if (!FTLOADED && !FTERR) h += '<div class="ex" style="margin:0 0 8px">Загружаю тексты файлов для поиска…</div>';
    return h + '<div class="kb-res">' + r.results.map((x, i) => '<button type="button" class="kb-r" data-r="' + i + '"><div class="sx-top">' + typeBadge(x.doc) + '<span class="sx-c">' + esc(x.doc.crumb) + '</span></div><h3>' + x.titleHtml + '</h3>' + (x.snippet ? '<div class="sx-s">' + x.snippet + '</div>' : '') + '</button>').join('') + '</div>';
  }
  function wireResults(b, q) {
    b.querySelectorAll('[data-tf]').forEach(x => x.onclick = () => { TF = x.dataset.tf; paintKb() });
    b.querySelectorAll('[data-r]').forEach(x => x.onclick = () => { remember(q); openDoc(CURR[+x.dataset.r].doc) });
    b.querySelectorAll('[data-fix]').forEach(a => a.onclick = () => { SQ = a.dataset.fix; const i = $('#kbq'); if (i) i.value = SQ; TF = 'all'; paintKb() });
  }

  /* ----- панель редактора: индексация файлов и пропущенные запросы ----- */
  function edPanel() {
    return '<details class="kb-ed" id="kbed"><summary>Для редактора: поиск внутри файлов и что не нашли сотрудники</summary><div id="kbedb"><div class="ex">Загружаю…</div></div></details>';
  }
  function wireEdPanel() {
    const dt = $('#kbed'); if (!dt) return;
    const paint = gaps => {
      const files = FILES.filter(f => !isImg(f) && fok(f)), have = files.filter(f => FT.has(String(f.id))), withText = files.filter(f => (FT.get(String(f.id)) || {}).status === 'ok');
      const body = $('#kbedb'); if (!body) return;
      body.innerHTML = '<div class="row"><span>Файлов: <b>' + files.length + '</b>. Обработано: <b>' + have.length + '</b>, из них с текстом для поиска: <b>' + withText.length + '</b>.</span></div>' +
        '<div class="row"><button type="button" class="btn" id="kbri">Проиндексировать новые файлы</button><button type="button" class="fbtn alt" id="kbra">Заново все</button><progress id="kbrp" max="1" value="0" hidden></progress><span class="ex" id="kbrm"></span></div>' +
        '<div class="ex" style="margin:0 0 10px">Новые файлы индексируются сами при загрузке. Текст берётся из PDF, Word (.docx), Excel, PowerPoint (.pptx) и текстовых файлов; старые .doc/.ppt и сканы без текста ищутся только по названию.</div>' +
        '<b>Что искали и не нашли (за 60 дней)</b>' + (gaps == null ? '<div class="ex">Загружаю…</div>' : gaps === false ? '<div class="ex">Журнал недоступен: проверьте, что выполнена миграция 14.</div>' : !gaps.length ? '<div class="ex">Пока всё находилось.</div>' : '<div style="margin-top:6px">' + gaps.map(g => '<div class="kb-gap"><span>' + esc(g.q) + '</span><span class="ex">' + '× ' + g.n + '</span></div>').join('') + '</div>');
      const run = all => async () => {
        const bi = $('#kbri'), ba = $('#kbra'), pr = $('#kbrp'), ms = $('#kbrm'); bi.disabled = ba.disabled = true; pr.hidden = false;
        const res = await reindex(all, (d, t, f) => { pr.max = t; pr.value = d; ms.textContent = d + ' из ' + t + (f ? ' · ошибок: ' + f : '') });
        ms.textContent = res.total ? 'Готово: ' + (res.done - res.fail) + ' из ' + res.total + (res.fail ? ', не удалось: ' + res.fail : '') : 'Новых файлов нет.'; SIGT = 0; paint(gaps);
        const m2 = $('#kbrm'); if (m2) m2.textContent = ms.textContent;
      };
      $('#kbri').onclick = run(false); $('#kbra').onclick = run(true);
    };
    let loaded = false;
    dt.addEventListener('toggle', async () => {
      if (!dt.open || loaded) return; loaded = true; paint(null);
      if (!FTLOADED) await loadFt();
      let g = false;
      try { const r = await sb.rpc('search_gaps', { p_days: 60 }); g = r.error ? false : (r.data || []) } catch (e) { g = false }
      paint(g);
    });
  }

  /* ================= 6. СТАТЬЯ ================= */
  async function viewArticle() {
    document.body.classList.remove('home');
    const a = KB.find(x => String(x.id) === AID);
    if (!a) { view = 'kb'; return viewKb() }
    const ed = canEd(), rel = (ensure(), ENG.related('a:' + a.id, 4));
    const own = !!(ME && a.author_id && String(a.author_id)===String(ME.id));
    const attachments = await articleAttachments(a.id);
    if(view!=='kba'||String(AID)!==String(a.id))return;
    m.innerHTML = '<div class="crumb"><a href="#" data-cr="h">Главная</a> › <a href="#" data-cr="k">База знаний</a></div><h2>' + esc(a.title) + '</h2>' +
      '<div class="kb-meta"><span class="sx-t t-article">' + esc(a.category) + '</span><span class="kb-draft">'+esc(statusLabel(a))+'</span>' + (a.author_name ? '<span>Автор: '+esc(a.author_name)+'</span>' : '') + (a.tags || []).map(t => '<span class="kb-tag">' + esc(t) + '</span>').join('') + '<span>Обновлено ' + dfmt(a.updated_at) + '</span></div>' +
      (a.review_comment ? '<div class="kb-review-note"><b>Комментарий редактора:</b> '+esc(a.review_comment)+'</div>' : '') +
      ((CAN_EDIT || (own && ['draft','revision'].includes(a.status))) ? '<div class="dact" style="margin:12px 0 0">' + (ed ? edBtn() : '') + (CAN_EDIT ? '<button type="button" class="btn" id="kae">Исправить статью</button>' : '<button type="button" class="btn" id="ka-own-edit">Исправить и отправить</button>') + (CAN_EDIT && a.status!=='published' ? '<button type="button" class="btn" id="ka-publish">Опубликовать</button><button type="button" class="fbtn alt" id="ka-revision">Вернуть на доработку</button><button type="button" class="fbtn del" id="ka-reject">Отказать</button>' : '') + (CAN_EDIT ? '<button type="button" class="fbtn del" id="kad">Удалить</button>' : '') + '</div>' : '') +
      '<article class="kb-art">' + (a.body.trim() ? m2h(a.body) : '<span class="ex">Текст ещё не добавлен.</span>') + '</article>' +
      (attachments.length ? '<div class="kb-attachments"><div class="kb-sec">Материалы к статье</div>' + attachments.map(f=>f.kind==='video' ? '<div class="kb-attachment"><b>Видео: '+esc(f.name)+'</b><video controls preload="metadata" playsinline src="'+esc(f.url)+'"></video><a href="'+esc(f.url)+'" target="_blank" rel="noopener">Открыть видео отдельно</a></div>' : f.kind==='pdf' ? '<div class="kb-attachment"><b>PDF: '+esc(f.name)+'</b><a href="'+esc(f.url)+'" target="_blank" rel="noopener">Открыть PDF ↗</a></div>' : '<div class="kb-attachment"><b>Файл: '+esc(f.name)+'</b><a href="'+esc(f.url)+'" target="_blank" rel="noopener" download>Скачать файл ↓</a></div>').join('') + '</div>' : '') +
      (rel.length ? '<div class="kb-rel"><div class="kb-sec">Похожие материалы</div><div class="kb-res">' + rel.map((x, i) => '<button type="button" class="kb-r" data-r="' + i + '"><div class="sx-top">' + typeBadge(x.doc) + '<span class="sx-c">' + esc(x.doc.crumb) + '</span></div><h3>' + esc(x.doc.title) + '</h3></button>').join('') + '</div></div>' : '') +
      '<div class="dact" style="margin-top:18px"><button type="button" class="fbtn alt" id="kab">← Ко всем статьям</button></div>';
    wireCrumb(); wireAuth();
    $('#kab').onclick = () => goKb('');
    m.querySelectorAll('[data-r]').forEach(x => x.onclick = () => openDoc(rel[+x.dataset.r].doc));
    const edit=$('#kae'); if(edit)edit.onclick=()=>articleDlg(a); const ownEdit=$('#ka-own-edit'); if(ownEdit)ownEdit.onclick=()=>suggestEditDlg(a);
    if(CAN_EDIT){
      const pub=$('#ka-publish'), rev=$('#ka-revision'), rej=$('#ka-reject');
      if(pub)pub.onclick=()=>reviewArticle(a,'published'); if(rev)rev.onclick=()=>reviewArticle(a,'revision'); if(rej)rej.onclick=()=>reviewArticle(a,'rejected');
      $('#kad').onclick=async()=>{if(!confirm('Удалить статью «'+a.title+'» навсегда?'))return;const at=await sb.from('kb_attachments').select('storage_path').eq('article_id',a.id);if(!at.error&&at.data.length)await sb.storage.from('materials').remove(at.data.map(x=>x.storage_path));const r=await sb.from('kb_articles').delete().eq('id',a.id);if(r.error){alert('Не удалось удалить.');return}await loadKb();SIGT=0;goKb('')};
    }
  }

  function suggestEditDlg(a) {
    dlg('Доработать статью', '<label class="fl">Заголовок<input id="kr-title" maxlength="200"></label><label class="fl">Текст<textarea id="kr-body" rows="12" maxlength="60000"></textarea></label><div class="fmsg" id="kr-msg" role="status"></div><div class="dact"><button type="button" class="btn" id="kr-send">Сохранить и отправить повторно</button><button type="button" class="fbtn alt" id="kr-cancel">Отмена</button></div>', dd=>{
      $('#kr-title',dd).value=a.title;$('#kr-body',dd).value=a.body;$('#kr-cancel',dd).onclick=()=>dd.close();
      $('#kr-send',dd).onclick=async()=>{const title=$('#kr-title',dd).value.trim(),body=$('#kr-body',dd).value.trim(),msg=$('#kr-msg',dd);if(!title||body.length<30){msg.textContent='Добавьте заголовок и текст не менее 30 символов.';return}const r=await sb.from('kb_articles').update({title,body,status:'pending',hidden:true,review_comment:'',submitted_at:new Date().toISOString()}).eq('id',a.id);if(r.error){msg.textContent='Не удалось отправить: '+r.error.message;return}dd.close();await loadKb();SIGT=0;goKb('')};
    });
  }

  function articleDlg(a) {
    const cats = [...new Set(KB.map(x => x.category))].sort((x, y) => x.localeCompare(y, 'ru'));
    dlg(a ? 'Изменить статью' : 'Новая статья',
      '<label class="fl">Название<input id="ka-t" maxlength="200" autofocus></label>' +
      '<label class="fl">Раздел (категория)<input id="ka-c" maxlength="80" list="ka-cl" placeholder="Например: Кадры, Касса, Выкладка"><datalist id="ka-cl">' + cats.map(c => '<option value="' + esc(c) + '">').join('') + '</datalist></label>' +
      '<label class="fl">Теги через запятую (по ним тоже ищут)<input id="ka-g" maxlength="200" placeholder="отпуск, заявление, график"></label>' +
      '<label class="fl">Текст<textarea id="ka-x" rows="12"></textarea></label>' +
      '<div class="fl">Картинки<div class="ithumbs" id="ka-i"></div><div class="dact" style="margin:0"><button type="button" class="fbtn alt" id="ka-p">+ Добавить картинку</button></div><input type="file" id="ka-f" accept="image/*" style="display:none"></div>' +
      '<label class="fl">PDF и видео (до 50 МБ каждый)<input type="file" id="ka-attach" accept="application/pdf,video/mp4,video/webm,.pdf,.mp4,.webm" multiple></label>' +
      '<div class="ex" style="margin:0 0 8px">Новая строка — Enter. Выделение: **жирный**, __курсив__. Картинка встаёт туда, где стоял курсор.</div>' +
      '<label style="display:flex;gap:8px;align-items:center;margin:6px 0"><input type="checkbox" id="ka-pin"> Закрепить вверху списка</label>' +
      '<label style="display:flex;gap:8px;align-items:center;margin:6px 0"><input type="checkbox" id="ka-d"> Черновик (сотрудники не видят)</label>' +
      '<div class="fmsg" id="ka-m" role="status"></div><div class="dact"><button type="button" class="btn" id="ka-s">Сохранить</button><button type="button" class="fbtn alt" id="ka-c2">Отмена</button></div>',
      dd => {
        const t = $('#ka-t', dd), c = $('#ka-c', dd), g = $('#ka-g', dd), x = $('#ka-x', dd), pin = $('#ka-pin', dd), dr = $('#ka-d', dd), say = z => $('#ka-m', dd).textContent = z, s = $('#ka-s', dd);
        t.value = a ? a.title : ''; c.value = a ? a.category : (KBC || ls.g('sx_cat', '') || ''); g.value = a ? (a.tags || []).join(', ') : ''; x.value = a ? a.body : ''; pin.checked = !!(a && a.pinned); dr.checked = a ? !!a.hidden : false;
        $('#ka-c2', dd).onclick = () => dd.close();
        const di = $('#ka-i', dd), dp = $('#ka-p', dd), df = $('#ka-f', dd);
        const refresh = () => { const ids = [...new Set((x.value.match(/\[img:[\w-]+\]/g) || []).map(z => z.slice(5, -1)))]; di.innerHTML = ids.map(id => '<div class="ith"><img src="' + thumb(id, 240) + '" alt=""><button type="button" data-rm="' + id + '" aria-label="Убрать картинку из текста">×</button></div>').join('') || '<div class="ex" style="margin:0">Картинок пока нет.</div>'; di.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { x.value = x.value.split('[img:' + b.dataset.rm + ']').join(''); refresh() }) };
        x.addEventListener('input', refresh); refresh();
        dp.onclick = () => df.click();
        df.onchange = () => {
          const f = df.files[0]; df.value = ''; if (!f) return;
          if (f.size > 25 * 1048576) { say('Картинка больше 25 МБ — выберите поменьше.'); return }
          dp.disabled = s.disabled = true; say('Загружаю картинку…');
          uploadImage(f, '').then(id => { const p = x.selectionStart == null ? x.value.length : x.selectionStart, bf = x.value.slice(0, p); x.value = bf + (bf && !bf.endsWith('\n') ? '\n' : '') + '[img:' + id + ']\n' + x.value.slice(p); refresh(); say('Картинка добавлена. Не забудьте нажать «Сохранить».') })
            .catch(() => say('Не удалось загрузить картинку. Подойдут JPG, PNG, GIF, WebP.')).then(() => { dp.disabled = s.disabled = false });
        };
        s.onclick = async () => {
          const title = t.value.trim(), cat = c.value.trim() || 'Общее';
          if (!title) { say('Введите название статьи.'); return }
          const files=[...($('#ka-attach',dd).files||[])];
          if(files.some(f=>f.size>50*1048576)){say('Каждый PDF или видеофайл должен быть не больше 50 МБ.');return}
          if(files.some(f=>!(/\.pdf$/i.test(f.name)||/^video\/(mp4|webm)$/.test(f.type)))){say('Поддерживаются только PDF, MP4 и WebM.');return}
          const row = { title, category: cat, body: x.value, tags: [...new Set(g.value.split(',').map(z => z.trim()).filter(Boolean))].slice(0, 12), pinned: pin.checked, hidden: dr.checked, status: a ? (a.status === 'pending' ? 'pending' : (dr.checked ? 'draft' : 'published')) : (dr.checked ? 'draft' : 'published') };
          s.disabled = true; say('Сохраняю…');
          const r = a ? await sb.from('kb_articles').update(row).eq('id', a.id).select().single() : await sb.from('kb_articles').insert(row).select().single();
          if (r.error) { s.disabled = false; say(r.error.code === '42P01' ? 'Таблица статей не создана: выполните миграцию 14.' : 'Не удалось сохранить: ' + (r.error.message || 'ошибка')); return }
          try { for(const f of files){const ext=f.name.split('.').pop().toLowerCase(),path='kb/'+ME.id+'/'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8)+'.'+ext;const up=await sb.storage.from('materials').upload(path,f,{contentType:f.type||'application/octet-stream'});if(up.error)throw up.error;const ar=await sb.from('kb_attachments').insert({article_id:r.data.id,name:f.name,storage_path:path,mime:f.type||'application/octet-stream',size_bytes:f.size,kind:ext==='pdf'?'pdf':(/^video\//.test(f.type)?'video':'document'),created_by:ME.id});if(ar.error){await sb.storage.from('materials').remove([path]);throw ar.error}} }
          catch(e){s.disabled=false;say('Статья сохранена, но вложение не загрузилось: '+(e.message||'ошибка'));return}
          ls.s('sx_cat', cat); dd.close(); await loadKb(); SIGT = 0;
          a ? draw() : goArticle(r.data.id);
        };
      });
  }

  window.SX = { warm, openPalette, closePalette, goKb, goArticle, viewKb, viewArticle, mountButton, homeBox, indexFile, reindex, search: (q, o) => ensure().search(q, o) };
})();
