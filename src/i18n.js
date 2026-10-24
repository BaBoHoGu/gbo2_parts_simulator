/* ------------------------------------------------------------------
 * 일본어 → 한국어 표시 변환
 * 사전(GBO2_I18N)은 빌드 시 인라인된다. 계산은 항상 원본 일본어 키로
 * 이루어지고, 여기서는 화면에 보이는 문자열만 바꾼다.
 * ------------------------------------------------------------------ */
(function () {
  'use strict';

  const raw = window.GBO2_I18N || { ms: {}, parts: {}, kind: {}, attr: {}, weapons: {} };

  /* ── 화면 언어 (2026-10-23) ──────────────────────────────────────────────
     기본은 한국어다(기본 주소는 한국 사용자만 쓴다 — 브라우저 언어로 바꾸지 않는다).
     일본어는 ① 주소의 ?lang=ja ② 「⋯ → 언어」 에서 고른 것. ①로 들어오면 그 선택을 기억한다 —
     일본 커뮤니티 링크로 처음 온 사람이 다음에 기본 주소로 와도 일본어로 보게. */
  const LANG_KEY = 'gbo2.lang';
  const LANG = (() => {
    let q = null;
    try { q = new URLSearchParams(location.search).get('lang'); } catch (e) { /* file:// 등 */ }
    if (q === 'ja') { try { localStorage.setItem(LANG_KEY, 'ja'); } catch (e) {} return 'ja'; }
    let s = null;
    try { s = localStorage.getItem(LANG_KEY); } catch (e) {}
    return s === 'ja' ? 'ja' : 'ko';
  })();
  const JA = LANG === 'ja';
  /** 언어를 바꾸고 새로 연다. 주소의 ?lang= 은 뗀다 — 남기면 고른 것을 그 주소가 다시 덮는다. */
  function setLang(l) {
    try { localStorage.setItem(LANG_KEY, l === 'ja' ? 'ja' : 'ko'); } catch (e) {}
    try {
      const u = new URL(location.href);
      u.searchParams.delete('lang');
      location.replace(u.toString());
    } catch (e) { location.reload(); }
  }
  /* 일본어 모드 — 데이터는 원래 일본어다. 한국어 사전을 **비우면** 화면 코드의 「사전[원문] || 원문」 이
     저절로 원문을 쓴다(자리마다 고치지 않는다). 버프 스킬의 한국어 이름(nameKo)은 데이터에 박혀 있어 원문으로 덮는다.
     화면 문구(한국어로 적힌 단추·안내)는 아래 jaUi 가 문구 표(uiJa)로 바꾼다.
     weaponNote 는 비우지 않는다 — 무장 태그(강경직·다운)는 한글 備考 를 읽어 판정하므로, 비우면 판정이 달라진다.
     보이는 備考 는 화면 쪽(ui/03-weapons.js 의 JA)이 원문으로 바꿔 끼운다. */
  const UI_JA = raw.uiJa || {};
  if (JA) {
    /* 한국어 기체 사전은 따로 남긴다 — 토큰 계산기가 「이 픽업이 기체인가」 를 한국어 이름으로 판정하고(벗어난 기체·
       미래시 강조), 한국 Steam 공지의 기체 이름을 원문으로 되돌리는 데도 쓴다. 비우기만 하면 둘 다 조용히 죽었다(2026-10-24). */
    raw.msKo = raw.ms;
    for (const k of ['ms', 'parts', 'weapons', 'skillText', 'attr', 'kind', 'fullst', 'fullstEffect', 'terms']) raw[k] = {};
    const S = window.GBO2_SKILLS;
    if (S) for (const list of Object.values(S)) for (const s of (Array.isArray(list) ? list : [])) if (s && s.name) s.nameKo = s.name;
    try { document.documentElement.lang = 'ja'; } catch (e) {}
  }

  // 원본 데이터에 결합문자(バ = ハ+゛) 형태가 섞여 있어 NFC로 맞춰 조회한다.
  const norm = s => (typeof s === 'string' ? s.normalize('NFC') : s);
  const table = obj => {
    const m = new Map();
    for (const [k, v] of Object.entries(obj)) m.set(norm(k), v);
    return m;
  };

  const MS = table(raw.ms);
  const PARTS = table(raw.parts);
  const KIND = table(raw.kind);
  const ATTR = table(raw.attr);
  const WEAPONS = table(raw.weapons || {});
  const FULLST = table(raw.fullst || {});             // 강화리스트 항목 이름
  const FULLST_EFF = table(raw.fullstEffect || {});   // 강화리스트 효과 키
  // 설명문에 섞인 고유명사(ビーム・ライフル 등)를 옮긴다. 긴 표기부터 치환해야
  // 짧은 항목이 긴 이름을 잘라먹지 않는다.
  const TERMS = Object.entries(raw.terms || {})
    .filter(([k]) => !k.startsWith('_'))
    .map(([k, v]) => [norm(k), v])
    .sort((a, b) => b[0].length - a[0].length);

  /** 기체명. `_LV3` 접미사는 사전에 없으므로 떼었다가 다시 붙인다. */
  function msName(name) {
    if (!name) return '';
    const m = norm(name).match(/^(.*?)(_LV\d+)?$/);
    const ko = MS.get(m[1]);
    // 사전에 없으면(일본어 모드 포함) 원문 이름에 「_LV3」 대신 「 LV3」 을 붙인다
    return (ko || m[1]) + (m[2] ? ' ' + m[2].slice(1) : '');
  }

  const partEntry = name => PARTS.get(norm(name));
  // 사전에 없으면 원문에서 「_LV1」 을 뗀다 — LV 는 타일이 따로 배지로 단다(한국어 이름도 LV 없이 적혀 있다)
  const partName = name => (partEntry(name) || {}).n || String(name || '').replace(/_LV\d+$/i, '');
  const partDesc = (name, fallback) => (partEntry(name) || {}).d || fallback || '';
  const kindName = k => (k ? KIND.get(norm(k)) || k : k);
  const attrName = a => (a ? ATTR.get(norm(a)) || a : a);
  const fullstName = n => (n ? FULLST.get(norm(n)) || n : n);
  /** 강화 효과 키. 스탯 키는 core 의 STAT_LABEL 이 이미 갖고 있어 그쪽을 먼저 본다. */
  const fullstEffect = k => {
    if (!k) return '';
    const C = window.GBO2Core;
    return (C && C.STAT_LABEL[k]) || FULLST_EFF.get(norm(k)) || k;
  };
  const weaponName = n => (n ? WEAPONS.get(norm(n)) || n : n);
  const weaponTerms = s => TERMS.reduce((t, [ja, ko]) => t.split(ja).join(ko), norm(String(s)));

  /* ── 일본어 화면 문구 층 ────────────────────────────────────────────────
     화면 코드 1,900여 줄의 한국어 문구를 자리마다 고치지 않고, **그려진 글자**를 문구 표(uiJa)로 바꾼다.
       phrases  : 한국어 문구 → 일본어. 통째로 맞으면 그대로, 아니면 긴 것부터 글자 안에서 찾아 바꾼다.
       patterns : 숫자가 섞인 꼴 — [정규식, 바꿀 글] (예: 「코스트 650」).
     글자 노드 · 툴팁(title) · 입력 안내(placeholder) · aria-label · 알림창 · 이미지 카드(캔버스) 를 덮는다.
     한글이 없는 글자는 건드리지 않는다(바꾼 결과엔 한글이 없어 다시 돌지 않는다). */
  const HANGUL = /[가-힣ㄱ-ㆎ]/;
  const PH = UI_JA.phrases || {};
  // 한 글자 조각(조사 · 「강」 같은 꼬리표)은 글자 안에서 찾으면 낱말을 쪼갠다 — 앞뒤가 한글이 아닐 때만 바꾼다
  // 한글로 시작하는 키를 먼저 바꾸고, 기호로 시작하는 키(「· 파츠」 · 「→ 버림」)는 그다음 — 정규식은 가장 앞자리에서
  // 맞는 것을 고르므로, 한 판에 섞으면 「풀강 · 파츠확장[장갑]」 의 「· 파츠」 가 뒤의 긴 키보다 먼저 맞아 버린다.
  const byLen = (a, b) => b.length - a.length;
  const PH_KEYS = Object.keys(PH).filter(k => k.length > 1 && PH[k]);
  const PH1_KEYS = Object.keys(PH).filter(k => k.length === 1 && PH[k]);
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const alt = ks => ks.length ? new RegExp(ks.sort(byLen).map(esc).join('|'), 'g') : null;
  const WORDY = /^[가-힣A-Za-z0-9]/;      // 낱말로 시작하는 키(「MS전 복합확장」 · 「2단 집속」 도)
  const PH_RES = [alt(PH_KEYS.filter(k => WORDY.test(k))), alt(PH_KEYS.filter(k => !WORDY.test(k)))].filter(Boolean);
  // 뒷보기((?<!…)) 대신 앞 글자를 잡아 되돌려 붙인다 — iOS 16.4 미만 Safari 는 뒷보기를 몰라 정규식을 만드는
  // 순간 이 파일이 죽는다(한국어 모드에서도 만든다). 앞 글자는 소비해도 한글이 아니므로 다음 맞춤을 막지 않는다.
  const PH1_RE = PH1_KEYS.length ? new RegExp('(^|[^가-힣])(' + PH1_KEYS.map(esc).join('|') + ')(?![가-힣])', 'g') : null;
  const PATS = (UI_JA.patterns || []).map(([re, to]) => { try { return [new RegExp(re), to]; } catch (e) { return null; } }).filter(Boolean);
  const jaCache = new Map();
  /* 옮기지 말 것 표시(U+2063, 보이지 않는 글자) — 캔버스처럼 lang="ko" 를 달 수 없는 자리에서 한국어 원문을
     그대로 그리게 한다(토큰 계산기 이미지의 한국 Steam 픽업 이름). 표시는 떼고 돌려준다. */
  const KEEP_MARK = '⁣';
  function jaText(s) {
    if (JA && typeof s === 'string' && s.charCodeAt(0) === 0x2063) return s.slice(1);
    if (!JA || typeof s !== 'string' || !HANGUL.test(s)) return s;
    const hit = jaCache.get(s);
    if (hit !== undefined) return hit;
    const lead = s.match(/^\s*/)[0], tail = s.match(/\s*$/)[0], core = s.trim().replace(/\s+/g, ' ');
    let out = PH[core] || undefined;
    if (out === undefined) {
      out = core;
      for (const [re, to] of PATS) if (re.test(out)) { out = out.replace(re, to); break; }
      for (const re of PH_RES) if (HANGUL.test(out)) out = out.replace(re, m => PH[m]);
      if (HANGUL.test(out) && PH1_RE) out = out.replace(PH1_RE, (m, pre, k) => pre + PH[k]);
    }
    out = lead + out + tail;
    if (jaCache.size > 20000) jaCache.clear();
    jaCache.set(s, out);
    return out;
  }
  const ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];
  // lang="ko" 로 표시한 곳은 한국어 원문이라 옮기지 않는다 — 반만 옮기면 「캐논 ガンダム」 처럼 섞인다
  const keepKo = e => !!(e && e.closest && e.closest('[lang="ko"]'));
  function jaNode(n) {
    if (n.nodeType === 3) {
      if (keepKo(n.parentElement)) return;
      const v = n.nodeValue;
      if (v && HANGUL.test(v)) { const t = jaText(v); if (t !== v) n.nodeValue = t; }
      return;
    }
    if (n.nodeType !== 1) return;
    const tag = n.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE') return;
    if (n.getAttribute('lang') === 'ko') return;
    for (const a of ATTRS) jaAttr(n, a);
    if (tag === 'INPUT' && (n.type === 'button' || n.type === 'submit') && HANGUL.test(n.value)) n.value = jaText(n.value);
    if (tag === 'TEXTAREA') return;      // 안의 글은 사용자가 쓴 것 — 안내(placeholder)만 옮긴다
    for (let c = n.firstChild; c; c = c.nextSibling) jaNode(c);
  }
  function jaAttr(n, a) {
    if (keepKo(n)) return;
    const v = n.getAttribute && n.getAttribute(a);
    if (v && HANGUL.test(v)) { const t = jaText(v); if (t !== v) n.setAttribute(a, t); }
  }
  function startJaUi() {
    if (!JA) return;
    const root = document.documentElement;
    jaNode(root);
    if (document.title && HANGUL.test(document.title)) document.title = jaText(document.title);
    new MutationObserver(list => {
      for (const m of list) {
        if (m.type === 'characterData') jaNode(m.target);
        else if (m.type === 'attributes') jaAttr(m.target, m.attributeName);
        else for (const n of m.addedNodes) jaNode(n);
      }
    }).observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    // 알림창 · 이미지 카드(캔버스 글자)는 DOM 이 아니라 따로 덮는다
    for (const f of ['alert', 'confirm', 'prompt']) {
      const o = window[f];
      if (typeof o === 'function') window[f] = function (msg, ...rest) { return o.call(window, jaText(String(msg == null ? '' : msg)), ...rest); };
    }
    const P = window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype;
    if (P) {
      const ft = P.fillText, mt = P.measureText;
      P.fillText = function (t, ...rest) { return ft.call(this, jaText(String(t)), ...rest); };
      P.measureText = function (t) { return mt.call(this, jaText(String(t))); };
    }
  }
  if (JA) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startJaUi);
    else startJaUi();
  }

  window.GBO2i18n = { msName, partName, partDesc, kindName, attrName, weaponName, weaponTerms,
    fullstName, fullstEffect, norm, lang: LANG, setLang, jaText, KEEP_MARK };
})();
