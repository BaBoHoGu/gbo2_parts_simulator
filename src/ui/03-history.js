  /* ui/03-history.js — 파츠 화면 「업데이트 이력」 칸(무장 칸 아래 · 2026-11-16).
     tools/lib/uisrc.js 가 번호 순으로 이어 붙여 한 IIFE 로 감싼다(파일끼리 변수를 나눠 쓴다).

     자료는 위키 기체 페이지의 「アップデート履歴」 전체(tools/extract_ms_history.js → data/ms_history.json).
     줄마다 원문과 한국어를 함께 갖고 있어 일본어 모드는 원문을 그대로 보인다. 못 옮긴 줄은 원문으로 보인다.
     첫 화면에는 안 쓰므로 **펼칠 때 읽는다** — 오프라인판은 실어 둔 글자를 그때 해석하고,
     사이트판은 따로 둔 history.<지문>.json 을 그때 받는다(build.js). */

  const HIST_FOLD_KEY = 'gbo2.histFold';
  const HIST_FILTER_KEY = 'gbo2.histFilter';
  let histFolded = true;           // 처음엔 접혀 있다 — 펼치기 전에는 자료를 읽지 않는다
  let histFilter = 'all';          // 'all' | 'adj'
  try {
    const f = localStorage.getItem(HIST_FOLD_KEY);
    if (f != null) histFolded = f === '1';
    if (localStorage.getItem(HIST_FILTER_KEY) === 'adj') histFilter = 'adj';
  } catch (e) { /* 저장소가 막혀도 기본값으로 돈다 */ }

  let histData = null;             // { pageId: [항목…] } — 읽고 나면 채워진다
  let histLoading = null;          // 읽는 중인 Promise
  let histFailed = false;
  let histDrawn = '';              // 마지막으로 그린 (페이지 · 거르기 · 언어) — 같으면 다시 안 그린다(renderAll 은 파츠마다 불린다)

  /** 자료를 읽는다(한 번만). 실패하면 null. */
  function loadHistory() {
    if (histData) return Promise.resolve(histData);
    if (histLoading) return histLoading;
    histLoading = (async () => {
      try {
        if (typeof window.GBO2_HISTORY_RAW === 'string') histData = JSON.parse(window.GBO2_HISTORY_RAW);
        else if (window.GBO2_HISTORY_URL) {
          const r = await fetch(window.GBO2_HISTORY_URL);
          if (!r.ok) throw new Error('HTTP ' + r.status);
          histData = await r.json();
        }
      } catch (e) { histData = null; }
      histFailed = !histData;
      return histData;
    })().then(d => { histLoading = null; return d; });
    /* 「읽는 중」 은 약속이 **끝난 뒤** 푼다. 몸통 안에서 풀면, 기다릴 것이 없는 오프라인판(글자를 바로 해석)은 몸통이
       그 자리에서 끝나 null 을 먼저 쓰고 → 바깥의 `histLoading = 약속` 이 덮어써 영영 「읽는 중」 으로 남았다.
       그래서 한 번 실패하면 다시 펼쳐도 다시 안 받았다(2026-11-16 history_check 가 잡음). */
    return histLoading;
  }

  const histPageOf = ms => (String((ms && ms.wiki_url) || '').match(/pages\/(\d+)\.html/) || [])[1] || null;

  function applyHistFold() {
    const p = $('#histPanel'), b = $('#histFold');
    if (p) p.classList.toggle('folded', histFolded);
    if (b) {
      b.classList.toggle('on', histFolded);
      b.title = histFolded ? '업데이트 이력을 펼칩니다' : '업데이트 이력을 접습니다';
    }
  }
  function toggleHistFold() {
    histFolded = !histFolded;
    if (!histFolded && histFailed) { histFailed = false; histDrawn = ''; }   // 다시 펼치면 다시 받아 본다
    try { localStorage.setItem(HIST_FOLD_KEY, histFolded ? '1' : '0'); } catch (e) {}
    applyHistFold();
    renderHistory();
  }

  function renderHistFilter() {
    const seg = $('#histFilter');
    if (!seg || seg.childElementCount) return;
    for (const [v, label] of [['all', '전체'], ['adj', '성능 조정만']]) {
      const b = el('button', 'seg-btn' + (histFilter === v ? ' on' : ''), label);
      b.type = 'button';
      b.dataset.v = v;
      b.onclick = () => {
        histFilter = v;
        try { localStorage.setItem(HIST_FILTER_KEY, v); } catch (e) {}
        [...seg.children].forEach(c => c.classList.toggle('on', c.dataset.v === v));
        renderHistory();
      };
      seg.append(b);
    }
  }

  /* 공식 참조 데이터 — 「유닛 관련 조정」 공지가 기체마다 붙이는 전적 표(extract_patchnotes → ms_refs.json, 빌드가 붙인다).
     「조정 후」 줄과 판정은 다음 밸런스 패치 때 공식이 덧붙인다 — 없으면 지어내지 않고 그렇다고 적는다.
     모양은 패치노트 화면의 표(.pn-ref · .pn-rt)와 같다. 일본어 모드는 일본어판 표(있을 때). */
  const HIST_AFTER = /조정\s*후|調整後/;
  function histRefBlock(rec, many) {
    /* 한국어판에 없는 공지(2025-11-20 · jpOnly)는 일본어판 표뿐이다 — 번역하지 않고 그대로 보이며 그렇다고 밝힌다 */
    const ref = (JA || !rec.ref) ? (rec.refJa || rec.ref) : rec.ref;
    if (!ref || !(ref.rows || []).length) return null;
    const d = el('details', 'pn-ref hist-ref');
    d.open = true;
    d.append(el('summary', '', '참조 데이터 (공식)' + (many && rec.ko ? ' · ' + rec.ko : '') + (ref.cost ? ' — COST ' + ref.cost : '')
      + (!JA && rec.jpOnly ? ' · 일본어판 공지(한국어판 없음)' : '')));
    const t = el('table', 'pn-rt');
    const hr = el('tr');
    hr.append(el('th', '', ''));
    for (const c of ref.cols || []) hr.append(el('th', '', c));
    t.append(hr);
    for (const r of ref.rows) {
      const tr = el('tr');
      if (HIST_AFTER.test(r.label)) tr.classList.add('after');
      tr.append(el('th', '', r.label + (r.cost ? ' (COST ' + r.cost + ')' : '')));   // LV 마다 다른 COST
      for (const v of r.values) tr.append(el('td', '', v));
      t.append(tr);
    }
    d.append(t);
    /* 「■조정 결과에 대한 부연 설명」 — 표 끝에 공식이 붙인 설명(2023~ 옛 공지). 공식 문구 그대로 */
    if (ref.note) d.append(el('div', 'pn-note hist-ref-note', ref.note));
    if (!ref.rows.some(r => HIST_AFTER.test(r.label)))
      d.append(el('div', 'pn-note', '※ 「조정 후」 전적은 다음 밸런스 패치 때 공식이 덧붙입니다.'));
    return d;
  }

  /** 한 날짜 항목. 줄은 [깊이, 원문, 한국어|null, 오름 1 · 내림 -1 · 0]. */
  function histEntry(e) {
    const box = el('div', 'hist-ent' + (e.k === 'adj' ? ' adj' : ''));
    const hd = el('div', 'hist-hd');
    hd.append(el('span', 'hist-date', e.d));
    const head = JA ? e.h : (e.hk || e.h);
    if (head) {
      const t = el('span', 'hist-what', head);
      /* 원문을 숨기지 않는다 — 옮긴 말이 미덥지 않을 때 확인할 길이 있어야 한다(패치노트 화면과 같다) */
      if (!JA && e.hk && e.hk !== e.h) t.title = e.h;
      hd.append(t);
    }
    box.append(hd);
    for (const [depth, ja, ko, b] of e.l || []) {
      /* 위키는 「機体HP上昇」 과 그 값 「Lv1：23500 → 28000」 을 **같은 깊이**로 적는 일이 많다 —
         그대로 그리면 값 줄도 굵은 항목 줄처럼 보인다. 맨 윗깊이에서 「→」 가 든 줄은 값으로 보고 한 칸 들인다. */
      const d = depth === 0 && /→/.test(ja) ? 1 : depth;
      const ln = el('div', 'pn-wl d' + Math.min(3, d), JA ? ja : (ko || ja));
      if (!JA && ko && ko !== ja) ln.title = ja;
      if (b === 1) ln.classList.add('up');
      if (b === -1) ln.classList.add('down');
      box.append(ln);
    }
    for (const rec of e.r || []) { const blk = histRefBlock(rec, (e.r || []).length > 1); if (blk) box.append(blk); }
    return box;
  }

  /** 칸을 그린다. 접혀 있으면 자료를 읽지 않는다. */
  function renderHistory() {
    renderHistFilter();
    applyHistFold();
    const body = $('#histBody'), cnt = $('#histCount'), wiki = $('#histWiki');
    if (!body) return;
    const ms = state.ms, id = histPageOf(ms);
    if (wiki) {
      wiki.hidden = !(ms && ms.wiki_url);
      if (ms && ms.wiki_url) wiki.href = ms.wiki_url;
    }
    if (histFolded) { if (cnt) cnt.textContent = ''; return; }
    if (!histData) {
      /* 실패는 **칸을 다시 펼칠 때만** 다시 시도한다(toggleHistFold 가 푼다). renderAll 은 파츠를 낄 때마다 불려서,
         여기서 풀면 인터넷이 끊긴 동안 「불러오는 중」 과 실패 안내가 번갈아 깜빡였다(2026-11-16 코드 리뷰). */
      if (histFailed) {
        if (histDrawn !== 'failed') {
          body.innerHTML = '';
          body.append(el('div', 'empty-state', '업데이트 이력을 불러오지 못했습니다 — 인터넷 연결을 확인한 뒤 다시 펼쳐 주세요.'));
          histDrawn = 'failed';
        }
        return;
      }
      if (!histLoading) {
        body.innerHTML = '';
        body.append(el('div', 'empty-state', '불러오는 중…'));
        loadHistory().then(() => { histDrawn = ''; renderHistory(); });
      }
      return;
    }
    const key = (id || '-') + '|' + histFilter + '|' + (JA ? 'ja' : 'ko');
    if (key === histDrawn) return;
    histDrawn = key;
    body.innerHTML = '';
    const all = (id && histData[id]) || [];
    const list = histFilter === 'adj' ? all.filter(e => e.k === 'adj') : all;
    if (cnt) cnt.textContent = all.length ? (list.length === all.length ? `${all.length}건` : `${list.length} / ${all.length}건`) : '';
    if (!ms) { body.append(el('div', 'empty-state', '먼저 기체를 선택하세요.')); return; }
    if (!all.length) { body.append(el('div', 'empty-state', '위키에 이 기체의 업데이트 이력이 없습니다.')); return; }
    if (!list.length) { body.append(el('div', 'empty-state', '성능 조정 이력이 없습니다.')); return; }
    const frag = document.createDocumentFragment();
    for (const e of list) frag.append(histEntry(e));
    body.append(frag);
    body.append(el('div', 'hist-src', JA ? '出典: wiki「アップデート履歴」'
      : '출처: 위키 「アップデート履歴」 · 한국어는 자동 번역이 섞여 있습니다(PC 에서는 줄에 마우스를 올리면 원문이 보입니다).'));
  }
