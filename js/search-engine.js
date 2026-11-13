/* =====================================================================
   ПОИСКОВЫЙ ДВИЖОК «Школы руководителя»
   Работает в браузере, без сервера и платных сервисов. Не знает про интерфейс:
   получает список документов, отвечает списком найденного.

   Что умеет:
   • русская морфология: «увольнение» находит «уволить», «увольнении», «уволенный»;
   • опечатки: «отпсук», «инвентаризцаия» находят нужное;
   • поиск по началу слова, пока человек печатает («инвент…»);
   • синонимы из файла data/synonyms.js;
   • ранжирование: название важнее текста, совпадение всех слов важнее одного,
     точная фраза важнее россыпи слов;
   • фрагмент текста с подсветкой найденного;
   • «Возможно, вы искали…» при опечатке.

   Документ: { id, type, title, text, crumb, tags[], boost }
   ===================================================================== */
(function (g) {
  'use strict';

  const STOP = new Set(('и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по только ее мне ' +
    'было вот от меня еще нет о из ему когда даже ну ли если уже или ни быть был до вас там потом себя ничего ей может ' +
    'они тут где есть надо для мы тебя их чем была сам без будто чего раз тоже себе под будет кто этот того какой при об ' +
    'про это эта эти эту нужно можно такое такой какие какая каков').split(' '));

  const TOK = /\d+(?:\.\d+)+|[a-zа-я0-9]+/g;

  /* нормализация «символ в символ»: длина строки не меняется, поэтому позиции совпадают с исходным текстом */
  function norm(s) {
    s = String(s == null ? '' : s).toLowerCase();
    let o = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === 'ё') o += 'е';
      else if ((c >= 'a' && c <= 'z') || (c >= 'а' && c <= 'я') || (c >= '0' && c <= '9')) o += c;
      else if ((c === '.' || c === ',') && /\d/.test(s[i - 1] || '') && /\d/.test(s[i + 1] || '')) o += '.';
      else o += ' ';
    }
    return o;
  }
  const words = n => n.match(TOK) || [];

  /* ---------- стеммер русского языка (по мотивам Snowball/Porter), без lookbehind ---------- */
  const RVRE = /^(.*?[аеиоуыэюя])(.*)$/;
  const rep = (s, re1, re2) => { const r = s.replace(re1, ''); return r !== s ? r : s.replace(re2, '$1'); };
  const STEM_CACHE = new Map();
  function stem(w) {
    let c = STEM_CACHE.get(w);
    if (c !== undefined) return c;
    c = stem0(w);
    if (STEM_CACHE.size > 200000) STEM_CACHE.clear();
    STEM_CACHE.set(w, c);
    return c;
  }
  function stem0(w) {
    if (!/[а-я]/.test(w)) return /^[a-z]{4,}s$/.test(w) ? w.slice(0, -1) : w;
    if (/\d/.test(w) || w.length <= 2) return w;
    const m = w.match(RVRE);
    if (!m) return w;
    const pre = m[1];
    let rv = m[2], t;
    t = rep(rv, /(ив|ивши|ившись|ыв|ывши|ывшись)$/, /([ая])(в|вши|вшись)$/);
    if (t === rv) {
      rv = rv.replace(/с[яь]$/, '');
      t = rv.replace(/(ее|ие|ые|ое|ими|ыми|ей|ий|ый|ой|ем|им|ым|ом|его|ого|ему|ому|их|ых|ую|юю|ая|яя|ою|ею)$/, '');
      if (t !== rv) { rv = rep(t, /(ивш|ывш|ующ)$/, /([ая])(ем|нн|вш|ющ|щ)$/); }
      else {
        t = rep(rv, /(ила|ыла|ена|ейте|уйте|ите|или|ыли|ей|уй|ил|ыл|им|ым|ен|ило|ыло|ено|ят|ует|уют|ит|ыт|ены|ить|ыть|ишь|ую|ю)$/,
                    /([ая])(ла|на|ете|йте|ли|й|л|ем|н|ло|но|ет|ют|ны|ть|ешь|нно)$/);
        rv = t === rv ? rv.replace(/(а|ев|ов|ие|ье|е|иями|ями|ами|еи|ии|и|ией|ей|ой|ий|й|иям|ям|ием|ем|ам|ом|о|у|ах|иях|ях|ы|ь|ию|ью|ю|ия|ья|я)$/, '') : t;
      }
    } else rv = t;
    rv = rv.replace(/и$/, '');
    if (/ость?$/.test(rv)) rv = rv.replace(/ость?$/, '');
    t = rv.replace(/ь$/, '');
    if (t === rv) { rv = rv.replace(/ейше?/, '').replace(/нн$/, 'н'); } else rv = t;
    const r = pre + rv;
    return r.length < 2 ? w.slice(0, Math.min(3, w.length)) : r;
  }

  /* расстояние Дамерау — Левенштейна с отсечкой */
  function dist(a, b, max) {
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > max) return max + 1;
    let p2 = null, p1 = new Array(lb + 1), c = new Array(lb + 1);
    for (let j = 0; j <= lb; j++) p1[j] = j;
    for (let i = 1; i <= la; i++) {
      c[0] = i; let mn = i;
      for (let j = 1; j <= lb; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        let v = Math.min(p1[j] + 1, c[j - 1] + 1, p1[j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, p2[j - 2] + 1);
        c[j] = v; if (v < mn) mn = v;
      }
      if (mn > max) return max + 1;
      p2 = p1; p1 = c; c = new Array(lb + 1);
    }
    return p1[lb];
  }

  const cpl = (a, b) => { let i = 0; const n = Math.min(a.length, b.length); while (i < n && a[i] === b[i]) i++; return i };
  const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function create(opts) {
    opts = opts || {};
    const FW = { title: 5, crumb: 2, tags: 3, text: 1 }, K1 = 1.4, B = 0.55;
    let docs = [], post = new Map(), vocab = [], best = new Map(), avgdl = 1, fuzzyCache = new Map();

    /* синонимы: группы слов, каждое слово ведёт к остальным */
    const syn = new Map();
    (opts.synonyms || []).forEach(gr => {
      const sets = gr.map(ph => words(norm(ph)).map(stem)).filter(a => a.length);
      const all = [...new Set([].concat.apply([], sets))];
      all.forEach(s => { const cur = syn.get(s) || new Set(); all.forEach(o => { if (o !== s) cur.add(o) }); syn.set(s, cur) });
    });

    function build(list) {
      docs = list.map((d, i) => Object.assign({}, d, { i }));
      post = new Map(); fuzzyCache = new Map();
      const cnt = new Map(); let sumdl = 0;
      docs.forEach(d => {
        d._nt = norm(d.title); d._nx = norm(d.text || '');
        const fields = [['title', d._nt], ['crumb', norm(d.crumb || '')], ['tags', norm((d.tags || []).join(' '))], ['text', d._nx]];
        const wtf = new Map(); let dl = 0;
        fields.forEach(([f, n]) => {
          const ws = words(n);
          if (f === 'text' || f === 'title') dl += ws.length;
          ws.forEach(w => {
            const s = stem(w);
            wtf.set(s, (wtf.get(s) || 0) + FW[f]);
            cnt.set(w, (cnt.get(w) || 0) + 1);
            const b = best.get(s);
            if (!b || (cnt.get(w) > (cnt.get(b) || 0))) best.set(s, w);
          });
        });
        d.dl = Math.max(dl, 1); sumdl += d.dl;
        wtf.forEach((v, s) => { let p = post.get(s); if (!p) post.set(s, p = new Map()); p.set(d.i, v) });
      });
      avgdl = docs.length ? sumdl / docs.length : 1;
      vocab = [...post.keys()];
    }

    const idf = s => { const n = (post.get(s) || { size: 0 }).size; return Math.log(1 + (docs.length - n + 0.5) / (n + 0.5)) };

    /* варианты одного слова запроса: {стем → вес} */
    function expand(t, isLast) {
      const out = new Map(), s = stem(t);
      out.set(s, 1);
      (syn.get(s) || []).forEach(o => out.set(o, Math.max(out.get(o) || 0, 0.85)));
      const exact = (post.get(s) || { size: 0 }).size;
      if (isLast && t.length >= 2) {
        let n = 0;
        for (const v of vocab) { if (v !== s && (v.startsWith(t) || v.startsWith(s))) { out.set(v, Math.max(out.get(v) || 0, 0.65)); if (++n >= 40) break } }
      }
      if (t.length >= 4 && exact < 2) {
        const mx = s.length >= 8 ? 2 : 1;
        let fz = fuzzyCache.get(s);
        if (!fz) {
          fz = [];
          for (const v of vocab) {
            if (v === s) continue;
            /* опечатка (1–2 буквы) или родственное слово с общим началом: уволить ~ увольнение, оформляется ~ оформление */
            if ((Math.abs(v.length - s.length) <= mx && dist(s, v, mx) <= mx) ||
                (t.length >= 5 && cpl(s, v) >= Math.max(4, Math.min(s.length, v.length) - 2) && (Math.abs(v.length - s.length) <= 3 || (cpl(s, v) === Math.min(s.length, v.length) && Math.abs(v.length - s.length) <= 5)))) fz.push(v);
          }
          if (fuzzyCache.size > 500) fuzzyCache.clear();
          fuzzyCache.set(s, fz);
        }
        fz.forEach(v => { if (!out.has(v)) out.set(v, 0.5) });
      }
      return out;
    }

    function search(q, o) {
      o = o || {};
      const raw = words(norm(q));
      let toks = raw.filter(t => !STOP.has(t)); if (!toks.length) toks = raw;
      toks = [...new Set(toks)].slice(0, 8);
      const res = { results: [], counts: {}, total: 0, tokens: toks, fixed: null, stems: new Set() };
      if (!toks.length || !docs.length) return res;
      const n = toks.length, acc = new Map(), allStems = res.stems;
      toks.forEach((t, ti) => {
        const ex = expand(t, ti === toks.length - 1), local = new Map();
        ex.forEach((w, s) => {
          allStems.add(s);
          const p = post.get(s); if (!p) return;
          const id = idf(s);
          p.forEach((tf, di) => {
            const d = docs[di], v = w * id * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * d.dl / avgdl));
            if (v > (local.get(di) || 0)) local.set(di, v);
          });
        });
        local.forEach((v, di) => { const a = acc.get(di) || { s: 0, m: 0 }; a.s += v; a.m++; acc.set(di, a) });
      });
      const need = n <= 2 ? 1 : Math.ceil(n / 2);
      const phr = n >= 2 ? new RegExp(toks.map(reEsc).join('\\s+(?:[a-zа-я0-9]{1,3}\\s+)?')) : null;
      const found = [];
      acc.forEach((a, di) => {
        if (a.m < need) return;
        const d = docs[di], cov = a.m / n;
        let sc = a.s * (0.25 + 0.75 * cov * cov) * (d.boost || 1);
        if (phr) { if (phr.test(d._nt)) sc *= 1.8; else if (phr.test(d._nx)) sc *= 1.3 }
        else if (d._nt.trim() === toks[0]) sc *= 1.4;
        found.push({ doc: d, score: sc });
      });
      found.sort((a, b) => b.score - a.score);
      res.total = found.length;
      found.forEach(f => { res.counts[f.doc.type] = (res.counts[f.doc.type] || 0) + 1 });
      let list = o.types ? found.filter(f => o.types.indexOf(f.doc.type) >= 0) : found;
      if (o.exclude != null) list = list.filter(f => f.doc.id !== o.exclude);
      res.shown = list.length;
      res.results = list.slice(0, o.limit || 30).map(f => ({ doc: f.doc, score: f.score, snippet: snippet(f.doc, allStems, o.snip || 190), titleHtml: hl(f.doc.title, allStems) }));
      if (res.total < 3) res.fixed = didYouMean(toks);
      return res;
    }

    function didYouMean(toks) {
      let changed = false;
      const out = toks.map(t => {
        const s = stem(t), p = post.get(s);
        if (p && p.size) return t;
        if (t.length < 4) return t;
        const mx = s.length >= 8 ? 2 : 1;
        let bestV = null, bd = 9, bdf = -1;
        for (const v of vocab) {
          if (Math.abs(v.length - s.length) > mx) continue;
          const d = dist(s, v, mx); if (d > mx) continue;
          const df = post.get(v).size;
          if (d < bd || (d === bd && df > bdf)) { bestV = v; bd = d; bdf = df }
        }
        if (bestV) { changed = true; return best.get(bestV) || bestV }
        return t;
      });
      return changed ? out.join(' ') : null;
    }

    /* фрагмент вокруг найденных слов; совпавшие слова обёрнуты в <mark> */
    function hlRange(text, nx, stems, start, end, pos) {
      let out = '', cur = start;
      pos.forEach(([a, b]) => { if (a >= start && b <= end) { out += esc(text.slice(cur, a)) + '<mark>' + esc(text.slice(a, b)) + '</mark>'; cur = b } });
      return out + esc(text.slice(cur, end));
    }
    function positions(nx, stems) {
      const pos = []; TOK.lastIndex = 0; let m;
      while ((m = TOK.exec(nx))) { if (stems.has(stem(m[0]))) pos.push([m.index, m.index + m[0].length, stem(m[0])]) }
      TOK.lastIndex = 0;
      return pos;
    }
    function hl(text, stems) { const nx = norm(text); return hlRange(text, nx, stems, 0, text.length, positions(nx, stems)) }
    function snippet(d, stems, max) {
      const text = String(d.text || '').replace(/\s+/g, ' ').trim();
      if (!text) return '';
      const nx = norm(text), pos = positions(nx, stems);
      if (!pos.length) return esc(text.slice(0, max)) + (text.length > max ? '…' : '');
      let bi = 0, bs = -1, j = 0;
      for (let i = 0; i < pos.length; i++) {
        if (j < i) j = i;
        while (j + 1 < pos.length && pos[j + 1][1] - pos[i][0] <= max - 30) j++;
        const sc = new Set(pos.slice(i, j + 1).map(p => p[2])).size * 100 + (j - i + 1);
        if (sc > bs) { bs = sc; bi = i }
      }
      let a = Math.max(0, pos[bi][0] - 35);
      if (a > 0) { const sp = text.lastIndexOf(' ', a + 12); if (sp >= a - 20 && sp < pos[bi][0]) a = sp + 1 }
      let b = Math.min(text.length, a + max);
      if (b < text.length) { const sp = text.indexOf(' ', b - 8); if (sp > 0 && sp < b + 15) b = sp }
      return (a > 0 ? '…' : '') + hlRange(text, nx, stems, a, b, pos) + (b < text.length ? '…' : '');
    }

    /* похожие материалы: запрос из названия и тегов документа */
    function related(id, n) {
      const d = docs.find(x => x.id === id); if (!d) return [];
      return search(d.title + ' ' + (d.tags || []).join(' '), { exclude: id, limit: n || 4, snip: 120 }).results;
    }

    return { build, search, related, size: () => docs.length, stem, norm };
  }

  g.SearchEngine = { create, stem, norm, dist };
  if (typeof module !== 'undefined') module.exports = g.SearchEngine;
})(typeof window !== 'undefined' ? window : globalThis);
