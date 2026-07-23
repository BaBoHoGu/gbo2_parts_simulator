/* ------------------------------------------------------------------
 * 오프라인 UI
 * 데이터(GBO2_DATA)와 사전(GBO2_I18N)은 빌드 시 이 파일 앞에 인라인된다.
 * 이미지는 HTML 옆의 images/ 폴더를 상대 경로로 참조한다.
 * ------------------------------------------------------------------ */
(function () {
  'use strict';

  const C = window.GBO2Core;
  const O = window.GBO2Optimizer;
  const T = window.GBO2i18n;
  const { msData, parts: partsByCat, fullst } = window.GBO2_DATA;

  const allParts = [].concat(...C.CATEGORIES.map(c => partsByCat[c]));
  const partByName = new Map(allParts.map(p => [p.name, p]));

  /* ---------- 이미지 ---------- */

  const baseName = C.partBase;
  const msImg = name => `images/ms/${encodeURIComponent(baseName(name))}.webp`;
  const partImg = name => `images/parts/${encodeURIComponent(name)}.webp`;

  /** 이미지가 없으면 기본 이미지로 한 번만 대체한다. */
  function img(src, fallbackDir, alt) {
    const node = document.createElement('img');
    node.loading = 'lazy';
    node.alt = alt || '';
    node.src = src;
    node.onerror = () => {
      node.onerror = null;
      node.src = `images/${fallbackDir}/_default.webp`;
    };
    return node;
  }

  /* ---------- 상태 ---------- */

  // 코스트 필터: 전체 · ~250(이하) · 300~750(정확히 일치)
  const COST_CHIPS = [
    { label: '전체', v: 'all' },
    { label: '~250', v: 'low' },
    ...[300, 350, 400, 450, 500, 550, 600, 650, 700, 750].map(c => ({ label: String(c), v: c }))
  ];
  // 레벨 필터
  const LEVEL_CHIPS = [
    { label: '전체', v: 'all' },
    { label: 'LV1', v: 1 }, { label: 'LV2', v: 2 }, { label: 'LV3', v: 3 }, { label: 'LV4+', v: '4+' }
  ];
  // 등급 필터(레어리티 = 별 개수, 표시는 'N성')
  const RARITY_CHIPS = [
    { label: '전체', v: 'all' },
    ...[1, 2, 3, 4, 5].map(n => ({ label: n + '성', v: n }))
  ];
  // 속성 정렬 우선순위 — 강습 → 범용 → 지원
  const ATTR_ORDER = { '強襲': 0, '汎用': 1, '支援': 2 };

  const msLevel = m => C.msLevel(m.MS名);
  const msRarity = m => (m.レアリティ || '').length;   // ☆ 개수
  /** 표시용 LV 추출 — 접미사가 없는 파츠(이레귤러DBL 등)는 undefined. */
  const lvOf = name => (name.match(/_LV(\d+)/) || [])[1];

  // 같은 기체의 레벨 변형 묶음 (base 이름 → 레벨 오름차순 목록)
  const msByBase = new Map();
  for (const m of msData) {
    const b = baseName(m.MS名);
    if (!msByBase.has(b)) msByBase.set(b, []);
    msByBase.get(b).push(m);
  }
  for (const arr of msByBase.values()) arr.sort((a, b) => msLevel(a) - msLevel(b));

  const state = {
    view: 'select',        // 'select'(기체 선택) | 'build'(파츠 적용)
    ms: null,
    equipped: [],
    locked: new Set(),
    banned: new Set(),
    stage: 6,
    expansion: C.EXPANSION_NONE,
    expLevel: C.MAX_EXPANSION_LEVEL,   // 확장 스킬 레벨 (LV1~LV5)
    msQuery: '',
    msAttr: '',
    msCost: 'all',
    msLv: 'all',
    msRarity: 'all',
    msLimit: 80,
    detailPart: null,      // 상세 미리보기에 고정된 파츠
    partTab: C.CATEGORY_ALL,
    partQuery: '',
    weights: { ...O.PRESETS['밸런스'] },
    minimums: {},
    running: false
  };

  const SAVE_KEY = 'gbo2-offline-build';

  const $ = sel => document.querySelector(sel);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  /* ---------- 검색 색인 ---------- */

  const msSearchText = new Map(msData.map(m =>
    [m, T.norm(T.msName(m.MS名) + ' ' + m.MS名).toLowerCase()]));
  const partSearchText = new Map(allParts.map(p => [p,
    T.norm(T.partName(p.name) + ' ' + p.name + ' ' + T.partDesc(p.name, p.description)).toLowerCase()]));

  const EQUIP_REASON = {
    equipped: () => '이미 장착됨',
    full: () => '슬롯 8개 가득 참',
    category: attr => `${T.attrName(attr)} 전용`,
    kind: kind => `${T.kindName(kind)} 계열 중복`,
    effect: name => `${T.partName(name)} 효과 중복`,
    movement: () => '스피드/선회 중복',
    slotClose: () => '근접 슬롯 부족',
    slotMid: () => '중거리 슬롯 부족',
    slotLong: () => '원거리 슬롯 부족'
  };
  const reasonText = chk => (chk.code ? EQUIP_REASON[chk.code](chk.param) : '');

  /** 파츠 표시용 파생값 — 상세 패널과 목록 타일이 같은 규칙을 쓰도록 한곳에 둔다. */
  function partView(p) {
    const lv = lvOf(p.name);
    const fullNm = T.partName(p.name);
    return {
      lv,
      fullNm,
      shortNm: lv ? fullNm.replace(/\s*LV\d+\s*$/i, '') : fullNm,
      desc: T.partDesc(p.name, p.description),
      cat: C.CATEGORY_LABEL[p.category] || '',
      slotTxt: [['근', p.close], ['중', p.mid], ['원', p.long]]
        .filter(([, v]) => v).map(([l, v]) => l + v).join(' ') || '슬롯 0'
    };
  }

  /* ---------- 파생값 ---------- */

  const slots = () => C.calcSlots(state.ms, state.equipped, state.stage, fullst);
  const stats = () => C.calcStats(state.ms, state.equipped, state.stage, state.expansion, partsByCat, fullst, state.expLevel);

  /* ---------- 기체 목록 ---------- */

  function filteredMs() {
    const q = state.msQuery.trim().toLowerCase();
    let list = msData;

    if (state.msAttr) list = list.filter(m => m.属性 === state.msAttr);

    if (state.msCost === 'low') list = list.filter(m => m.コスト <= 250);
    else if (state.msCost !== 'all') list = list.filter(m => m.コスト === state.msCost);

    if (state.msLv === '4+') list = list.filter(m => msLevel(m) >= 4);
    else if (state.msLv !== 'all') list = list.filter(m => msLevel(m) === state.msLv);

    if (state.msRarity !== 'all') list = list.filter(m => msRarity(m) === state.msRarity);

    if (q) list = list.filter(m => msSearchText.get(m).includes(q));

    // 정렬: ① 코스트 높은 순(750→) → ② 속성(강습→범용→지원) → ③ 등급 높은 순
    //       → ④ 레벨 LV1부터 → ⑤ 이름 순
    return list.slice().sort((a, b) => {
      if (a.コスト !== b.コスト) return b.コスト - a.コスト;   // 750 → 100
      const oa = ATTR_ORDER[a.属性] ?? 9, ob = ATTR_ORDER[b.属性] ?? 9;
      if (oa !== ob) return oa - ob;                        // 강습 → 범용 → 지원
      const ra = msRarity(a), rb = msRarity(b);
      if (ra !== rb) return rb - ra;                        // 높은 등급 먼저
      const la = msLevel(a), lb = msLevel(b);
      if (la !== lb) return la - lb;                        // LV1부터
      return T.msName(a.MS名).localeCompare(T.msName(b.MS名), 'ko');
    });
  }

  function renderMsList() {
    const box = $('#msList');
    box.innerHTML = '';
    const list = filteredMs();

    if (!list.length) {
      box.append(el('div', 'empty-state', '조건에 맞는 기체가 없습니다.'));
      $('#msCount').textContent = '0기';
      return;
    }

    for (const m of list.slice(0, state.msLimit)) {
      const card = el('div', 'ms-card' + (state.ms === m ? ' sel' : ''));
      card.append(img(msImg(m.MS名), 'ms', m.MS名));

      const info = el('div', 'info');
      const nm = el('div', 'nm', T.msName(m.MS名));
      nm.title = m.MS名;
      info.append(nm);

      const meta = el('div', 'meta');
      meta.append(el('span', 'dot ' + (m.属性 || '')));
      meta.append(el('span', '', T.attrName(m.属性) || '-'));
      meta.append(el('span', 'cost-badge', m.コスト));
      const r = msRarity(m);
      if (r) meta.append(el('span', 'stars', '★'.repeat(r)));
      info.append(meta);

      card.append(info);
      card.onclick = () => selectMs(m);
      box.append(card);
    }

    if (list.length > state.msLimit) {
      const more = el('button', 'more', `더 보기 (${list.length - state.msLimit}기 남음)`);
      more.onclick = () => { state.msLimit += 120; renderMsList(); };
      box.append(more);
    }
    $('#msCount').textContent = `${list.length}기`;
  }

  /* ---------- 화면 전환 ---------- */

  function setView(view) {
    const changed = state.view !== view;
    state.view = view;
    // 선택 화면으로 "돌아올 때"만 목록을 갱신 (초기 렌더와 중복 실행하지 않는다)
    if (view === 'select' && changed) renderMsList();
    document.body.classList.toggle('view-select', view === 'select');
    document.body.classList.toggle('view-build', view === 'build');
    [...$('#stepper').querySelectorAll('li[data-step]')].forEach(li =>
      li.classList.toggle('on', li.dataset.step === view));
    // 화면 전환 시 스크롤을 위로 되돌린다
    const scr = view === 'build' ? $('#screenBuild') : $('#screenSelect');
    if (scr) scr.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  function selectMs(m) {
    state.ms = m;
    state.equipped = [];
    state.locked.clear();
    state.detailPart = null;
    renderAll();
    setView('build');           // 기체를 고르면 곧바로 파츠 적용 단계로
  }

  /* ---------- 장착 ---------- */

  function equip(part) {
    const chk = C.checkEquip(part, state.ms, state.equipped, slots());
    if (!chk.ok) { toast(reasonText(chk) + ' — 장착할 수 없습니다'); return; }
    state.equipped.push(part);
    renderAll();
  }

  function unequip(name) {
    state.equipped = state.equipped.filter(p => p.name !== name);
    state.locked.delete(name);
    renderAll();
  }

  function renderEquipped() {
    const box = $('#equipped');
    box.innerHTML = '';
    $('#equipCount').textContent = `${state.equipped.length} / ${C.MAX_PARTS}`;

    for (let i = 0; i < C.MAX_PARTS; i++) {
      const p = state.equipped[i];
      if (!p) {
        box.append(el('div', 'eq empty', '+'));
        continue;
      }

      const tile = el('div', 'eq' + (state.locked.has(p.name) ? ' locked' : ''));
      tile.title = p.name + '\n\n' + T.partDesc(p.name, p.description);

      const lock = el('span', 'lock' + (state.locked.has(p.name) ? ' on' : ''), '🔒');
      lock.title = '자동 구성 시 이 파츠 고정';
      lock.onclick = ev => {
        ev.stopPropagation();
        state.locked.has(p.name) ? state.locked.delete(p.name) : state.locked.add(p.name);
        renderEquipped();
      };
      tile.append(lock);
      tile.append(el('span', 'rm', '✕'));
      tile.append(img(partImg(p.name), 'parts', p.name));
      tile.append(el('div', 'nm', T.partName(p.name)));

      // 0 인 슬롯은 숨겨서 실제로 소비하는 슬롯만 눈에 들어오게 한다.
      const cost = el('div', 'cost');
      for (const [cls, label, v] of [['cost-c', '근', p.close], ['cost-m', '중', p.mid], ['cost-l', '원', p.long]]) {
        if (v) cost.append(el('span', cls, label + v));
      }
      if (!cost.children.length) cost.append(el('span', 'note', '슬롯 0'));
      tile.append(cost);

      tile.onclick = () => unequip(p.name);
      box.append(tile);
    }
  }

  function renderSlots() {
    const s = slots();
    const box = $('#slotBars');
    box.innerHTML = '';
    const defs = [
      ['close', '근접', s.close, s.maxClose],
      ['mid', '중거리', s.mid, s.maxMid],
      ['long', '원거리', s.long, s.maxLong]
    ];

    for (const [key, label, used, max] of defs) {
      const bar = el('div', 'slot-bar ' + key + (used >= max && max > 0 ? ' full' : ''));
      const top = el('div', 'top');
      top.append(el('span', 'k', label));
      top.append(el('span', 'v', `${used} / ${max}`));
      bar.append(top);

      // 칸 수가 많으면 눈에 안 들어오므로 최대 20칸으로 압축해 보여준다.
      const track = el('div', 'track');
      const cells = Math.min(Math.max(max, used, 1), 20);
      const scale = cells / Math.max(max, used, 1);
      const filled = Math.round(used * scale);
      for (let i = 0; i < cells; i++) {
        const cell = el('i');
        if (i < filled) cell.className = used > max ? 'over' : 'on';
        track.append(cell);
      }
      bar.append(track);
      box.append(bar);
    }
  }

  /* ---------- 파츠 상세 미리보기 ---------- */

  function renderDetail(part) {
    const box = $('#detailBody');
    box.innerHTML = '';
    if (!part) {
      const e = el('div', 'detail-empty');
      e.innerHTML = '파츠에 마우스를 올리거나 눌러<br>상세 정보를 확인하세요';
      box.append(e);
      return;
    }

    const { lv, fullNm, desc, cat } = partView(part);
    const isEquipped = state.equipped.some(e => e.name === part.name);
    const chk = state.ms ? C.checkEquip(part, state.ms, state.equipped, slots()) : { ok: false, code: null };

    const head = el('div', 'd-head');
    const thumb = el('div', 'd-thumb');
    thumb.append(img(partImg(part.name), 'parts', part.name));
    if (lv) thumb.append(el('span', 'pt-lv', 'LV' + lv));
    head.append(thumb);
    const htext = el('div', 'd-htext');
    htext.append(el('div', 'd-name', fullNm));
    htext.append(el('div', 'd-cat', cat));
    head.append(htext);
    box.append(head);

    let cls = 'ok', txt = '장비 가능 — 눌러서 장착';
    if (isEquipped) { cls = 'on'; txt = '장착됨 — 눌러서 해제'; }
    else if (!chk.ok) { cls = 'bad'; txt = (reasonText(chk) || '장착 불가') + ' — 장착 불가'; }
    const status = el('div', 'd-status ' + cls + (chk.ok || isEquipped ? ' clickable' : ''), txt);
    // 상세 카드에서 바로 장착/해제 (하단 목록 타일과 동일 동작)
    status.onclick = () => {
      state.detailPart = part;
      if (isEquipped) unequip(part.name);
      else if (chk.ok) equip(part);
      else toast(reasonText(chk) + ' — 장착할 수 없습니다');
    };
    box.append(status);

    const slotRow = el('div', 'd-slots');
    for (const [c, label, v] of [['cost-c', '가까운', part.close], ['cost-m', '중간', part.mid], ['cost-l', '원거리', part.long]]) {
      const cell = el('div', 'd-slot');
      cell.append(el('span', 'k', label));
      cell.append(el('span', 'v ' + c, String(v || 0)));
      slotRow.append(cell);
    }
    box.append(slotRow);

    if (desc) {
      const eff = el('div', 'd-eff');
      eff.append(el('div', 'd-eff-lb', '특성'));
      eff.append(el('div', 'd-eff-tx', desc));
      box.append(eff);
    }
  }

  /* ---------- 스탯 ---------- */

  function renderStats() {
    const body = $('#statBody');
    body.innerHTML = '';
    if (!state.ms) return;

    const r = stats();

    for (const k of C.STAT_KEYS) {
      const limit = r.currentLimits[k];
      const raw = r.rawTotal[k], tot = r.total[k], soche = r.base[k];
      const over = limit !== Infinity && raw > limit ? raw - limit : 0;   // 상한 때문에 버려진 양
      const atCap = limit !== Infinity && tot >= limit;
      const gain = tot - soche;                                          // 강화+확장+파츠로 인한 증가분

      const row = el('div', 'stat-row' + (atCap ? ' capped' : '') + (over ? ' over' : ''));
      row.append(el('span', 'label', C.STAT_LABEL[k]));

      const totalCell = el('span', 'total');
      totalCell.append(document.createTextNode(tot.toLocaleString()));
      if (over) totalCell.append(el('span', 'over-warn', '+' + over));    // ⚠ 초과분
      row.append(totalCell);

      // 증가 폭: 강화·확장·파츠로 늘어난 양을 초록(+)으로 표시
      row.append(el('span', 'delta' + (gain > 0 ? ' up' : gain < 0 ? ' down' : ''),
        gain === 0 ? '·' : (gain > 0 ? '+' : '') + gain.toLocaleString()));

      // 소체분(회색) 위에 증가분(초록)을 겹쳐 보이고, 상한 초과는 OVER 로 표시
      const meter = el('div', 'meter');
      const scale = limit === Infinity ? Math.max(tot, soche, 1) * 1.15 : limit;
      const baseW = Math.min(100, (Math.min(soche, tot) / scale) * 100);
      const gainW = Math.min(100 - baseW, (Math.max(gain, 0) / scale) * 100);
      const basePart = el('i', 'base');
      basePart.style.width = baseW + '%';
      const gainPart = el('i', 'gain' + (atCap ? ' capped' : '') + (over ? ' over' : ''));
      gainPart.style.width = gainW + '%';
      meter.append(basePart, gainPart);

      const graph = el('div', 'graph');
      graph.append(meter);
      if (over) graph.append(el('span', 'over-badge', 'OVER'));
      row.append(graph);

      row.append(el('span', 'cap', limit === Infinity ? '—' : limit.toLocaleString()));
      body.append(row);
    }
  }

  /* ---------- 파츠 목록 ---------- */

  /**
   * 화면에 뿌릴 파츠와 그 장착 판정을 함께 돌려준다.
   * 판정은 정렬과 렌더 양쪽에서 쓰이므로 여기서 한 번만 계산한다.
   */
  function visibleParts() {
    const q = state.partQuery.trim().toLowerCase();
    let list = state.partTab === C.CATEGORY_ALL ? allParts : partsByCat[state.partTab];
    if (q) list = list.filter(p => partSearchText.get(p).includes(q));

    const s = slots();
    const rows = list.map(p => {
      const isEquipped = state.equipped.some(e => e.name === p.name);
      const chk = state.ms ? C.checkEquip(p, state.ms, state.equipped, s) : { ok: false, code: null };
      return { p, isEquipped, chk, blocked: !isEquipped && !chk.ok };
    });

    // 장착 가능한 것을 위로, 그 다음 장착 중, 마지막이 불가.
    const rank = r => (r.isEquipped ? 1 : r.chk.ok ? 0 : 2);
    return rows.sort((a, b) => rank(a) - rank(b));
  }

  // 파츠 타일은 159개로 고정이라 한 번 만들어 두고 상태만 갱신한다.
  // (매 장착마다 DOM·이미지를 새로 만들지 않아 깜빡임과 재로딩이 없다)
  const tileCache = new Map();

  function createTile(p) {
    const v = partView(p);
    const tile = el('div', 'part-tile');
    tile.title = `${v.fullNm}\n${v.cat} · ${v.slotTxt}\n\n${v.desc}`;

    const thumb = el('div', 'pt-thumb');
    thumb.append(img(partImg(p.name), 'parts', p.name));
    if (v.lv) thumb.append(el('span', 'pt-lv', 'LV' + v.lv));
    const hint = el('span', 'pt-hint');
    thumb.append(hint);
    tile.append(thumb);
    tile.append(el('div', 'pt-nm', v.shortNm));
    const why = el('div', 'pt-why');
    tile.append(why);

    // 핸들러는 만들 때 한 번만 붙이고, 판정은 그때그때 최신 상태에서 읽는다.
    tile.onmouseenter = () => { state.detailPart = p; renderDetail(p); };
    tile.onclick = ev => {
      if (ev.shiftKey) { toast(v.fullNm + ' — ' + (v.desc || '설명 없음')); return; }
      state.detailPart = p;
      if (state.equipped.some(e => e.name === p.name)) unequip(p.name);
      else equip(p);
    };
    tile.oncontextmenu = ev => {
      ev.preventDefault();
      state.banned.has(p.name) ? state.banned.delete(p.name) : state.banned.add(p.name);
      renderPartList();
      renderBannedCount();
    };

    const entry = { tile, hint, why };
    tileCache.set(p, entry);
    return entry;
  }

  function renderPartList() {
    const box = $('#partList');
    const keepScroll = box.scrollTop;      // 장착/해제 후에도 보던 위치를 유지
    const rows = visibleParts();

    if (!rows.length) {
      box.replaceChildren(el('div', 'empty-state', '검색 결과가 없습니다.'));
      return;
    }

    const frag = document.createDocumentFragment();
    for (const { p, isEquipped, chk, blocked } of rows) {
      const t = tileCache.get(p) || createTile(p);
      t.tile.className = 'part-tile'
        + (isEquipped ? ' on' : '')
        + (blocked ? ' blocked' : '')
        + (state.banned.has(p.name) ? ' banned' : '');
      // 호버 힌트: 장착 가능/해제일 때만 (불가면 비워 둔다)
      t.hint.className = 'pt-hint' + (isEquipped ? ' rm' : '') + (blocked ? ' off' : '');
      t.hint.textContent = blocked ? '' : (isEquipped ? '해제' : '장비 가능');
      t.why.textContent = blocked && chk.code ? reasonText(chk) : '';
      frag.append(t.tile);              // 기존 노드를 옮길 뿐, 새로 만들지 않는다
    }
    box.replaceChildren(frag);
    box.scrollTop = keepScroll;
  }

  function renderBannedCount() {
    const n = state.banned.size;
    const box = $('#bannedCount');
    box.innerHTML = '';
    if (!n) return;
    box.append(el('span', 'note', `제외 ${n}개`));
    const btn = el('button', 'btn-ghost', '초기화');
    btn.style.padding = '1px 7px';
    btn.style.fontSize = '11px';
    btn.onclick = () => { state.banned.clear(); renderPartList(); renderBannedCount(); };
    box.append(btn);
  }

  /* ---------- 자동 구성 ---------- */

  function renderAutoGrid() {
    const box = $('#autoGrid');
    box.innerHTML = '';
    box.append(el('div', 'hd', '스탯'), el('div', 'hd', '가중치'), el('div', 'hd', '하한 목표'));

    for (const k of C.STAT_KEYS) {
      box.append(el('div', 'lb', C.STAT_LABEL[k]));

      const w = el('input');
      w.type = 'number'; w.step = '0.5'; w.min = '0';
      w.value = state.weights[k] ?? 0;
      // 0 보다 큰 항목에 테두리 강조 — 어떤 스탯을 노리는지 한눈에 보이게
      const mark = () => w.classList.toggle('active', Number(w.value) > 0);
      mark();
      w.oninput = () => { state.weights[k] = Number(w.value) || 0; mark(); };
      box.append(w);

      const m = el('input');
      m.type = 'number'; m.placeholder = '—';
      m.value = state.minimums[k] ?? '';
      m.oninput = () => {
        const v = Number(m.value);
        if (m.value === '' || isNaN(v)) delete state.minimums[k];
        else state.minimums[k] = v;
      };
      box.append(m);
    }
  }

  const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));

  async function runAuto() {
    if (!state.ms) { toast('먼저 기체를 선택하세요'); return; }
    if (state.running) return;

    state.running = true;
    const btn = $('#runAuto');
    btn.disabled = true;
    const rounds = Number($('#effort').value);
    const bar = $('#progressBar');
    $('#autoNote').textContent = '탐색 중…';

    const opts = {
      stage: state.stage,
      expansion: state.expansion,
      expLevel: state.expLevel,
      weights: state.weights,
      minimums: state.minimums,
      locked: [...state.locked],
      banned: [...state.banned],
      restarts: 1
    };

    let best = null;
    for (let i = 0; i < rounds; i++) {
      const r = O.optimize(state.ms, { ...opts, seed: (i + 1) * 7919 }, partsByCat, fullst);
      if (!best || r.score > best.score) best = r;
      bar.style.width = ((i + 1) / rounds * 100) + '%';
      await nextFrame();
    }

    state.equipped = best.parts.slice();
    state.running = false;
    btn.disabled = false;
    bar.style.width = '0';

    const unmet = Object.entries(state.minimums)
      .filter(([k, v]) => v && best.stats.total[k] < v)
      .map(([k, v]) => `${C.STAT_LABEL[k]} ${best.stats.total[k]}/${v}`);
    const note = $('#autoNote');
    note.className = 'note mt' + (unmet.length ? ' warn' : '');
    note.textContent = unmet.length
      ? `하한 미달: ${unmet.join(', ')} — 상한이나 슬롯 때문에 도달 불가일 수 있습니다.`
      : `완료 · 파츠 ${best.parts.length}개 · 평가 ${best.evaluations.toLocaleString()}회`;

    renderAll();
    if (!unmet.length) toast(`자동 구성 완료 — 파츠 ${best.parts.length}개 장착`);
  }

  function openDrawer(open) {
    $('#autoDrawer').classList.toggle('open', open);
    $('#drawerBack').classList.toggle('open', open);
  }

  /* ---------- 저장 / 불러오기 ---------- */

  const serialize = () => ({
    ms: state.ms ? state.ms.MS名 : null,
    parts: state.equipped.map(p => p.name),
    stage: state.stage,
    expansion: state.expansion,
    expLevel: state.expLevel
  });

  /** @returns {{ok: boolean, missing?: number}} missing = 사전에 없어 제외된 파츠 수 */
  function deserialize(obj) {
    if (!obj || !obj.ms) return { ok: false };
    const ms = msData.find(m => m.MS名 === obj.ms);
    if (!ms) return { ok: false };
    state.ms = ms;
    state.stage = obj.stage ?? 6;
    state.expansion = obj.expansion || C.EXPANSION_NONE;
    // expLevel 이 없던 시절의 저장본은 앱 기본값(최대 레벨)으로 맞춘다
    state.expLevel = Number(obj.expLevel) || C.MAX_EXPANSION_LEVEL;
    const wanted = obj.parts || [];
    state.equipped = wanted.map(n => partByName.get(n)).filter(Boolean);
    const missing = wanted.length - state.equipped.length;
    state.locked.clear();
    syncStageSeg();
    $('#expansion').value = state.expansion;
    const expLv = $('#expLevel');
    expLv.value = String(state.expLevel);
    expLv.disabled = state.expansion === C.EXPANSION_NONE;
    renderAll();
    setView('build');
    return { ok: true, missing };
  }

  function syncStageSeg() {
    const seg = $('#stageSeg');
    if (seg) [...seg.children].forEach(c => c.classList.toggle('on', Number(c.dataset.v) === state.stage));
  }

  /**
   * 강화 단계 변경.
   * 미강화로 내리면 강화로 늘어난 슬롯이 사라져 기존 구성이 성립하지 않으므로,
   * 확인을 받고 파츠를 초기화한다. (6↔4 는 슬롯이 줄지 않으므로 그대로 둔다)
   */
  function setStage(v) {
    if (v === state.stage) return;
    const resets = v === 0 && state.stage !== 0 && state.equipped.length > 0;
    if (resets && !confirm(
      '미강화로 내리면 강화로 늘어난 슬롯이 사라져 지금 구성을 유지할 수 없습니다.\n\n'
      + `장착한 파츠 ${state.equipped.length}개를 모두 해제하고 진행할까요?`)) return;

    state.stage = v;
    if (resets) { state.equipped = []; state.locked.clear(); }
    syncStageSeg();
    renderAll();
    if (resets) toast('미강화로 변경해 장착 파츠를 초기화했습니다');
  }

  /* ---------- 렌더 ---------- */

  function renderHero() {
    const m = state.ms;
    const hero = $('#heroImg');
    if (m) {
      hero.onerror = () => { hero.onerror = null; hero.src = 'images/ms/_default.webp'; };
      hero.src = msImg(m.MS名);
      hero.style.visibility = '';
    } else {
      hero.style.visibility = 'hidden';
    }

    $('#heroName').textContent = m ? T.msName(m.MS名) : '기체를 선택하세요';

    const sub = $('#heroSub');
    sub.innerHTML = '';
    if (!m) return;
    sub.append(el('span', 'dot ' + (m.属性 || '')));
    sub.append(el('span', '', T.attrName(m.属性)));
    sub.append(el('span', '', '·'));
    sub.append(el('span', 'cost-badge', '코스트 ' + m.コスト));
    const r = msRarity(m);
    if (r) {
      sub.append(el('span', '', '·'));
      sub.append(el('span', 'stars', '★'.repeat(r)));   // 기체 카드와 같은 표기
    }
  }

  /**
   * 같은 기체의 다른 레벨로 전환.
   * 레벨이 바뀌면 슬롯 상한도 바뀌어 기존 구성이 성립하지 않으므로 파츠는 항상 초기화한다.
   * (강화·확장 설정은 유지)
   */
  function switchLevel(m) {
    if (!m || m === state.ms) return;
    const had = state.equipped.length;
    state.ms = m;
    state.equipped = [];
    state.locked.clear();
    renderAll();
    if (had) toast('레벨을 변경해 장착 파츠를 초기화했습니다');
  }

  /** 현재 기체에 LV2 이상 변형이 있으면 이름 위에 레벨 전환 세그먼트를 그린다. */
  function renderLevelSwitch() {
    const seg = $('#levelSwitch');
    seg.innerHTML = '';
    const variants = (state.ms && msByBase.get(baseName(state.ms.MS名))) || [];
    if (variants.length < 2) { seg.hidden = true; return; }
    seg.hidden = false;
    for (const m of variants) {
      const lv = msLevel(m);
      const b = el('button', 'seg-btn' + (m === state.ms ? ' on' : ''), 'LV' + lv);
      b.title = T.msName(m.MS名) + ' · 코스트 ' + m.コスト;
      b.onclick = () => switchLevel(m);
      seg.append(b);
    }
  }

  function renderAll() {
    renderHero();
    renderLevelSwitch();
    // 기체 목록은 ① 선택 화면에서만 갱신 (파츠 장착 때마다 1,671기를 재정렬·재생성하지 않도록)
    if (state.view !== 'build') renderMsList();
    renderSlots();
    renderEquipped();
    renderStats();
    renderPartList();
    renderBannedCount();
    renderDetail(state.detailPart);
  }

  /* ---------- 초기화 ---------- */

  function buildControls() {
    $('#brandImg').src = 'images/ms/_default.webp';

    // 강화리스트 — 세그먼트 버튼 (미강화 / 4단계 / 풀강)
    const seg = $('#stageSeg');
    for (const [v, label] of [[0, '미강화'], [4, '4단계'], [6, '풀강']]) {
      const b = el('button', 'seg-btn' + (state.stage === v ? ' on' : ''), label);
      b.dataset.v = String(v);
      b.onclick = () => setStage(v);
      seg.append(b);
    }

    const exp = $('#expansion');
    for (const name of C.EXPANSION_SKILLS) exp.append(new Option(C.EXPANSION_LABEL[name] || name, name));

    // 확장 스킬 레벨 (LV1~LV5) — 스킬을 고르지 않았을 땐 비활성
    const expLv = $('#expLevel');
    for (let lv = 1; lv <= C.MAX_EXPANSION_LEVEL; lv++) expLv.append(new Option('LV' + lv, String(lv)));
    expLv.value = String(state.expLevel);
    const syncExpLv = () => { expLv.disabled = state.expansion === C.EXPANSION_NONE; };
    syncExpLv();
    exp.onchange = () => { state.expansion = exp.value; syncExpLv(); renderAll(); };
    expLv.onchange = () => { state.expLevel = Number(expLv.value); renderAll(); };

    const preset = $('#preset');
    preset.append(new Option('— 프리셋 선택 —', ''));
    for (const name of Object.keys(O.PRESETS)) preset.append(new Option(name, name));
    preset.onchange = () => {
      if (!preset.value) return;
      state.weights = {};
      for (const k of C.STAT_KEYS) state.weights[k] = 0;
      Object.assign(state.weights, O.PRESETS[preset.value]);
      renderAutoGrid();
    };

    // 필터 칩 공통 빌더 — 한 줄의 칩을 만들고 선택 상태를 state[key]에 반영한다
    function buildChips(boxSel, items, key, extraClass) {
      const box = $(boxSel);
      for (const it of items) {
        const cls = 'chip'
          + (extraClass ? ' ' + extraClass(it) : '')
          + (state[key] === it.v ? ' on' : '');
        const chip = el('button', cls, it.label);
        chip.onclick = () => {
          state[key] = it.v;
          state.msLimit = 80;
          [...box.children].forEach(c => c.classList.remove('on'));
          chip.classList.add('on');
          renderMsList();
        };
        box.append(chip);
      }
    }

    // 속성: 전체 · 강습 · 범용 · 지원
    buildChips('#attrChips',
      [{ label: '전체', v: '' }, { label: T.attrName('強襲'), v: '強襲' },
       { label: T.attrName('汎用'), v: '汎用' }, { label: T.attrName('支援'), v: '支援' }],
      'msAttr', it => 'attr-' + it.v);
    buildChips('#costChips', COST_CHIPS, 'msCost');
    buildChips('#levelChips', LEVEL_CHIPS, 'msLv');
    buildChips('#rarityChips', RARITY_CHIPS, 'msRarity');

    $('#msQuery').oninput = e => {
      state.msQuery = T.norm(e.target.value);
      state.msLimit = 80;
      renderMsList();
    };
    $('#partQuery').oninput = e => { state.partQuery = T.norm(e.target.value); renderPartList(); };

    const tabs = $('#tabs');
    for (const cat of [C.CATEGORY_ALL, ...C.CATEGORIES]) {
      const b = el('button', 'chip' + (state.partTab === cat ? ' on' : ''),
        cat === C.CATEGORY_ALL ? '전체' : C.CATEGORY_LABEL[cat]);
      b.onclick = () => {
        state.partTab = cat;
        [...tabs.children].forEach(c => c.classList.remove('on'));
        b.classList.add('on');
        renderPartList();
      };
      tabs.append(b);
    }

    $('#backToSelect').onclick = () => setView('select');

    // 스텝퍼: 1단계는 언제든 클릭해 기체 목록으로, 2단계는 기체가 있을 때만
    $('#stepper').querySelectorAll('li[data-step]').forEach(li => {
      li.onclick = () => {
        if (li.dataset.step === 'build' && !state.ms) { toast('먼저 기체를 선택하세요'); return; }
        setView(li.dataset.step);
      };
    });

    $('#openAuto').onclick = () => openDrawer(true);
    $('#closeAuto').onclick = () => openDrawer(false);
    $('#drawerBack').onclick = () => openDrawer(false);
    $('#runAuto').onclick = runAuto;
    $('#clearParts').onclick = () => {
      state.equipped = [];
      state.locked.clear();
      renderAll();
    };

    $('#save').onclick = () => {
      if (!state.ms) { toast('먼저 기체를 선택하세요'); return; }
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(serialize()));
        toast('구성을 저장했습니다');
      } catch { toast('저장에 실패했습니다 (브라우저 저장 공간 제한)'); }
    };
    // 불러오기 결과 안내 — 제외된 파츠가 있으면 조용히 넘기지 않는다
    const loadedMsg = (r, okText) => r.missing
      ? `${okText} — 알 수 없는 파츠 ${r.missing}개는 제외했습니다`
      : okText;

    $('#load').onclick = () => {
      let raw;
      try { raw = localStorage.getItem(SAVE_KEY); }
      catch { toast('브라우저 저장소를 읽을 수 없습니다'); return; }
      if (!raw) { toast('저장된 구성이 없습니다'); return; }

      let obj;
      try { obj = JSON.parse(raw); }
      catch { toast('저장된 구성이 손상되었습니다'); return; }

      const r = deserialize(obj);
      toast(r.ok ? loadedMsg(r, '저장한 구성을 불러왔습니다') : '저장된 구성의 기체를 찾을 수 없습니다');
    };
    $('#share').onclick = () => {
      if (!state.ms) { toast('먼저 기체를 선택하세요'); return; }
      const text = JSON.stringify(serialize(), null, 2);
      // 실패 시(파일 열람 등 비보안 컨텍스트) 직접 복사할 수 있도록 프롬프트로 대체
      const fallback = () => { toast('아래 내용을 복사하세요'); prompt('구성 JSON (Ctrl+C 로 복사)', text); };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(() => toast('구성 JSON을 복사했습니다'), fallback);
        } else fallback();
      } catch { fallback(); }
    };
    $('#importBtn').onclick = () => {
      const text = prompt('구성 JSON을 붙여넣으세요');
      if (!text) return;
      let obj;
      try { obj = JSON.parse(text); }
      catch { toast('JSON 형식이 올바르지 않습니다'); return; }
      const r = deserialize(obj);
      toast(r.ok ? loadedMsg(r, '구성을 불러왔습니다') : '알 수 없는 기체입니다');
    };

    document.addEventListener('keydown', ev => {
      if (ev.key !== 'Escape') return;
      if ($('#autoDrawer').classList.contains('open')) { openDrawer(false); return; }

      // 입력 중이면 화면을 벗어나지 않는다 — 내용이 있으면 비우고, 없으면 포커스만 해제
      const t = ev.target;
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) {
        if (t.value) { t.value = ''; t.dispatchEvent(new Event('input')); }
        else t.blur();
        return;
      }

      if (state.view === 'build') setView('select');
    });
  }

  buildControls();
  renderAutoGrid();
  // 빌드 화면이 곧바로 채워지도록 기본 기체를 잡아두되, 시작 화면은 ① 기체 선택.
  state.ms = msData.find(m => T.msName(m.MS名).startsWith('건담 ')) || msData[0];
  renderAll();
  setView('select');
})();
