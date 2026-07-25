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
  const D = window.GBO2Damage;
  const weaponData = window.GBO2_WEAPONS || {};
  const skillData = window.GBO2_SKILLS || {};
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

  // 코스트 필터: 전체 · 750~300(정확히 일치) · ~250(이하) — 높은 코스트부터
  const COST_CHIPS = [
    { label: '전체', v: 'all' },
    ...[750, 700, 650, 600, 550, 500, 450, 400, 350, 300].map(c => ({ label: String(c), v: c })),
    { label: '~250', v: 'low' }
  ];
  // 레벨 필터
  const LEVEL_CHIPS = [
    { label: '전체', v: 'all' },
    { label: 'LV1', v: 1 }, { label: 'LV2', v: 2 }, { label: 'LV3', v: 3 }, { label: 'LV4+', v: '4+' }
  ];
  // 등급 필터(레어리티 = 별 개수, 표시는 'N성') — 높은 등급부터
  const RARITY_CHIPS = [
    { label: '전체', v: 'all' },
    ...[5, 4, 3, 2, 1].map(n => ({ label: n + '성', v: n }))
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
    form: 'normal',        // 'normal' | 'transform' — 성능표를 어느 형태로 볼지
    detailPart: null,      // 상세 미리보기에 고정된 파츠
    openWeapon: null,      // 펼쳐 둔 무장 이름 — 파츠를 갈아 끼워도 닫히지 않게 유지한다
    skillPicks: new Set(), // 발동시킨 기체 스킬의 인덱스 (여러 개를 겹칠 수 있다)
    posture: 'stand',      // 사격 자세 'stand'|'crouch'|'prone' — 무장 피해에 자세 보정을 얹는다
    scope: false,          // 스코프 조준 (자세와 별개로 얹힌다)
    partTab: C.CATEGORY_ALL,
    partQuery: '',
    weights: { ...O.PRESETS['밸런스'] },
    minimums: {},
    weightsTouched: false,  // 사용자가 가중치·하한·프리셋을 직접 만졌는가
    running: false,
    autoCandidates: null,  // 자동 구성 후보 3개 (사용자가 고른다)
    autoExpansion: false   // 자동 구성이 확장 스킬까지 골랐는가
  };

  /** 기체가 바뀌면 이전 자동 구성 후보는 무효라 지운다. */
  function clearAutoResults() {
    state.autoCandidates = null;
    state.autoExpansion = false;
    const box = document.getElementById('autoResults');
    if (box) box.innerHTML = '';
    const note = document.getElementById('autoNote');
    if (note) note.textContent = '';
  }

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
    banned: () => '제외한 파츠',
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

  /* ---------- 기체 스킬 ---------- */

  /** 현재 기체가 가진 버프 스킬 목록. */
  const msSkills = () => (state.ms && skillData[baseName(state.ms.MS名)]) || [];

  /** 지금 발동시킨 스킬들. */
  function activeSkills() {
    const list = msSkills();
    return [...state.skillPicks].sort((a, b) => a - b).map(i => list[i]).filter(Boolean);
  }

  /**
   * 스킬 수치는 기체 LV 구간마다 다르다 (「LV1～」「LV4～」).
   * 지금 기체 LV 이 들어가는 구간 중 가장 높은 것을 쓴다.
   */
  function skillLevel(sk) {
    if (!sk || !sk.levels.length) return null;
    const lv = state.ms ? msLevel(state.ms) : 1;
    const fit = sk.levels.filter(l => lv >= l.from && (l.to == null || lv <= l.to));
    // 기체 LV 이 스킬 요구 LV 에 못 미치면 그 스킬은 아직 못 쓴다 (예: 백식 LV1 의 LV4 스킬)
    return fit.length ? fit[fit.length - 1] : null;
  }

  /** 지금 기체 LV 에서 실제로 쓸 수 있는 스킬만 (인덱스와 함께). */
  const availableSkills = () =>
    msSkills().map((sk, i) => ({ sk, i })).filter(x => skillLevel(x.sk) != null);

  /**
   * 발동시킨 스킬들의 효과 합계. 아무것도 안 골랐으면 null.
   * 피해 % 는 걸리는 대상이 갈린다 — `any` 는 사격·격투 모두에 얹는다.
   */
  function skillEffect() {
    const list = activeSkills();
    if (!list.length) return null;
    const sum = { shoot: 0, melee: 0, shootPct: 0, meleePct: 0, crouchPct: 0, limitUp: 0,
      dmgAny: 0, dmgShoot: 0, dmgMelee: 0, count: list.length };
    for (const sk of list) {
      const e = skillLevel(sk);
      if (!e) continue;
      sum.shoot += e.shoot;
      sum.melee += e.melee;
      sum.shootPct += e.shootPct;
      sum.meleePct += e.meleePct;
      sum.crouchPct += e.crouchPct || 0;
      sum.limitUp += e.limitUp || 0;
      sum.dmgAny += e.dmgAny;
      sum.dmgShoot += e.dmgShoot;
      sum.dmgMelee += e.dmgMelee;
    }
    return sum;
  }

  /** 이 무장에 걸리는 스킬 피해 %. */
  const skillDmgPct = (e, kind) =>
    (e ? e.dmgAny + (kind === 'melee' ? e.dmgMelee : e.dmgShoot) : 0);

  /**
   * calcStats 에 넘길 스탯 가산분. 피해 % 는 스탯이 아니라 무장 쪽에서 쓴다.
   * 사격/격투 보정 % (ZERO 시스템)는 스킬을 뺀 총보정에 곱해 정수로 더한다.
   * (ZERO 는 상한도 올리지만 그 폭이 위키에 없어, 여기서는 통상 상한을 그대로 둔다)
   */
  function skillStatBonus() {
    const e = skillEffect();
    if (!e) return null;
    let shoot = e.shoot, melee = e.melee;
    if (e.shootPct || e.meleePct) {
      const bare = stats(null).total;
      shoot += Math.round(bare.shoot * e.shootPct / 100);
      melee += Math.round(bare.meleeCorrection * e.meleePct / 100);
    }
    if (!shoot && !melee) return null;
    const out = { shoot, meleeCorrection: melee };
    // ZERO 시스템은 발동 중 사격·격투 상한도 올린다 (파츠로 상한 근처까지 올린 구성에서 차이가 난다)
    if (e.limitUp) out.limit = { shoot: e.limitUp, meleeCorrection: e.limitUp };
    return out;
  }

  /** 스킬 몫을 칠할 클래스 — 하나면 보라, 겹쳐 발동하면 청록. */
  const skillCls = () => (state.skillPicks.size > 1 ? ' multi' : '');

  const stats = (skill = skillStatBonus()) =>
    C.calcStats(state.ms, state.equipped, state.stage, state.expansion, partsByCat, fullst,
      state.expLevel, state.form, skill);

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
    // 숨겨진 동안에는 크기를 잴 수 없으므로, 보이게 된 뒤 줄 맞춤을 다시 한다
    if (view === 'build') fitWholeRows($('#partList'));
  }

  function selectMs(m) {
    state.ms = m;
    state.equipped = [];
    state.locked.clear();
    state.detailPart = null;
    state.skillPicks.clear();
    clearAutoResults();
    resetEnhance();             // 다른 기체를 고르면 확장·강화 설정을 초기값으로 되돌린다
    renderAll();
    setView('build');           // 기체를 고르면 곧바로 파츠 적용 단계로
  }

  /** 확장 스킬·강화 단계를 초기 상태로 되돌리고 컨트롤도 맞춘다. (기체를 새로 고를 때) */
  function resetEnhance() {
    state.expansion = C.EXPANSION_NONE;
    state.expLevel = C.MAX_EXPANSION_LEVEL;
    const exp = $('#expansion');
    if (exp) exp.value = C.EXPANSION_NONE;
    const expLv = $('#expLevel');
    if (expLv) { expLv.value = String(state.expLevel); expLv.disabled = true; }
  }

  /* ---------- 장착 ---------- */

  function equip(part) {
    // 우클릭으로 제외한 파츠는 자동 구성뿐 아니라 직접 장착도 막는다
    if (state.banned.has(part.name)) {
      toast('제외한 파츠입니다 — 우클릭으로 해제하세요');
      return;
    }
    const chk = C.checkEquip(part, state.ms, state.equipped, slots());
    if (!chk.ok) { toast(reasonText(chk) + ' — 장착할 수 없습니다'); return; }
    state.equipped.push(part);
    renderAll();
  }

  /** 제외 토글. 이미 장착 중인 파츠를 제외하면 함께 해제해 상태를 어긋나지 않게 한다. */
  function toggleBan(part) {
    if (state.banned.has(part.name)) {
      state.banned.delete(part.name);
    } else {
      state.banned.add(part.name);
      if (state.equipped.some(e => e.name === part.name)) {
        state.equipped = state.equipped.filter(e => e.name !== part.name);
        state.locked.delete(part.name);
        toast(T.partName(part.name) + ' — 제외하면서 장착도 해제했습니다');
      }
    }
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
      // 장착된 파츠도 목록 타일과 똑같이 상세 패널에 띄운다
      tile.onmouseenter = () => { state.detailPart = p; renderDetail(p); };

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
    const chk = state.banned.has(part.name) ? { ok: false, code: 'banned', param: null }
      : state.ms ? C.checkEquip(part, state.ms, state.equipped, slots()) : { ok: false, code: null };

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

  /* ---------- 무장 ---------- */

  /** 표에서 그대로 가져온 표기를 한글로 바꾼다. (「即2発 フル1+即1」 같은 값까지) */
  const JA_UNIT = [
    ['発/分', '발/분'], ['フル', '풀'], ['ノン', '논'], ['即', '즉'],
    ['連続', '연속'], ['連', '연'], ['消費', '소비'], ['単発', '단발'],
    ['秒', '초'], ['発', '발'], ['射', '발'], ['分', '분'], ['時', '시'], ['回', '회']
  ];
  // 전각 괄호·중점은 그대로 두면 표에서 일본어처럼 보여 반각으로 맞춘다.
  const jaUnits = s => JA_UNIT.reduce((t, [ja, ko]) => t.split(ja).join(ko), String(s))
    .replace(/（/g, '(').replace(/）/g, ')').replace(/・/g, '·').replace(/：/g, ':')
    .replace(/＋/g, '+').replace(/－/g, '-').replace(/％/g, '%').replace(/×/g, 'x');

  /** 표 열 이름에 공백 표기가 섞여 있어(OH復帰時間 / OH復帰 時間) 공백을 무시하고 찾는다. */
  function infoOf(info, ...names) {
    const flat = s => s.replace(/\s+/g, '');
    for (const n of names) {
      const key = Object.keys(info || {}).find(k => flat(k) === flat(n));
      const v = key && info[key];
      if (v && v !== '-') return v;
    }
    return null;
  }

  /**
   * 무장 항목 조회.
   * 추출 단계에서 레벨마다 값이 같으면 info(무장 공통), 다르면 levels[N].raw 로 나뉜다.
   * (예: 사거리가 레벨마다 늘어나는 무장은 raw 에 있다)
   * 어느 쪽에 있는지는 무장마다 다르므로 레벨값을 먼저 보고 없으면 공통값을 본다.
   */
  const wField = (lvl, info, ...names) =>
    infoOf(lvl && lvl.raw, ...names) || infoOf(info, ...names);

  /** 현재 기체의 무장 목록 (위키 페이지 ID 로 찾는다). */
  function msWeapons() {
    if (!state.ms) return [];
    const id = (String(state.ms.wiki_url || '').match(/pages\/(\d+)\.html/) || [])[1];
    const page = id && weaponData[id];
    return page ? page.weapons : [];
  }

  /**
   * 무장 레벨은 기체 레벨을 따라간다.
   * 기체 LV 보다 높은 무장 LV 는 쓰지 않고, 그보다 낮으면 가진 것 중 가장 높은 레벨을 쓴다.
   * (무장이 기체보다 적은 레벨만 가진 경우가 있다)
   */
  function weaponLevel(w) {
    const lvs = Object.keys(w.levels).map(Number).sort((a, b) => a - b);
    if (!lvs.length) return null;
    const want = state.ms ? msLevel(state.ms) : lvs[0];
    const fit = lvs.filter(l => l <= want);
    return String(fit.length ? fit[fit.length - 1] : lvs[0]);
  }

  function renderWeapons() {
    const box = $('#weaponList');
    box.innerHTML = '';
    const list = msWeapons();
    $('#weaponCount').textContent = list.length ? `${list.length}종` : '';

    if (!list.length) {
      box.append(el('div', 'empty-state', '이 기체의 무장 정보가 없습니다.'));
      return;
    }

    const r = stats();
    // 사격 무기는 사격 보정, 격투 무기는 격투 보정을 쓴다.
    const corr = { shooting: r.total.shoot, melee: r.total.meleeCorrection };
    // 스킬을 뺀 값도 함께 구해, 스킬로 늘어난 위력만 따로 보여 준다
    const sk = skillEffect();
    const bare = sk ? stats(null) : null;
    const corrBare = bare ? { shooting: bare.total.shoot, melee: bare.total.meleeCorrection } : corr;
    const sCls = skillCls();
    // 무장에 붙는 파츠 보정 (집속·리로드·OH·피해 %·실드 HP).
    // 효과마다 걸리는 무장 범위가 달라 무장별로 다시 뽑아 쓴다.
    const wm = D.weaponModsOf(state.equipped, state.ms ? msLevel(state.ms) : 1,
      state.ms && state.ms.属性);

    // 자세·스코프 보정 — 사격 무장에만, (1+etcA) 로 공격 배율에 곱해진다
    const postureEtcA = w => {
      if (w.type === 'melee') return 0;
      let e = 0;
      if (state.posture === 'crouch') e += D.ETC_ATTACK.crouch;
      else if (state.posture === 'prone') e += D.ETC_ATTACK.prone;
      if (state.scope) e += D.ETC_ATTACK.scope;
      return e;
    };
    // 고정밀 포격 스킬 — 앉기·정지에서만 사격 피해 +N% (스킬 몫이라 보라로 나온다)
    const skEtcOf = w => (w.type !== 'melee' && sk && sk.crouchPct && state.posture === 'crouch')
      ? sk.crouchPct / 100 : 0;

    for (const w of list) {
      const lv = weaponLevel(w);
      const d = lv ? w.levels[lv] : null;
      if (!d) continue;

      const info = w.info || {};
      const mods = w.mods || {};
      const note = info['備考'] || '';
      const f = (...names) => wField(d, info, ...names);
      const a = corr[w.type] || 0;
      const aBare = corrBare[w.type] || 0;

      // 집속 링·화기 관제는 「ビーム射撃兵装」만 줄여 준다 — 격투 무장의 집속은 절댓값이다
      const chargeCut = mods.chargeTime && w.type === 'shooting' ? D.timeCutFor(wm, 'chargeTime', w) : 0;
      const chargeSec = mods.chargeTime ? D.shortenTime(mods.chargeTime, chargeCut) + '초' : '';
      const mustCharge = /集束必須/.test(note);

      const row = el('div', 'weapon');
      row.dataset.name = w.name;

      // ① 구분
      row.append(el('span', 'w-sec' + (w.section === '主兵装' ? ' main' : ''),
        w.type === 'shield' ? '실드'
          : w.section === '主兵装' ? '주무장' : w.section === '副兵装' ? '부무장' : '기타'));

      // ② 이름 (격투/사격 점으로 구분)
      const nm = el('span', 'w-nm');
      nm.append(el('i', 'w-dot ' + w.type));
      nm.append(document.createTextNode(T.weaponName(w.name)));
      nm.title = w.name;
      row.append(nm);

      /** 위력 한 칸 — 기본값 · 파츠 보정분(초록) · 스킬 발동분(보라) */
      const dmgCell = (base) => {
        const cell = el('span', 'w-dmg');
        if (base == null) { cell.textContent = '—'; cell.classList.add('w-none'); return cell; }
        const kind = w.type === 'melee' ? 'melee' : 'shoot';
        const pct = D.damagePctFor(wm, w, kind);
        const baseEtc = postureEtcA(w);         // 자세·스코프 (스킬과 무관, 초록에 포함)
        const skEtc = skEtcOf(w);               // 고정밀 포격 (스킬 몫)
        const dmg = (corrOf, extraPct, etc) => D.applyDamagePct(
          w.type === 'melee' ? D.meleeDamage(base, corrOf, { etcA: etc })
            : D.shootingDamage(base, corrOf, { etcA: etc }), pct + extraPct);
        const withoutSkill = dmg(aBare, 0, baseEtc);
        const withSkill = dmg(a, skillDmgPct(sk, kind), baseEtc + skEtc);
        const gain = withoutSkill - base;
        const skillGain = withSkill - withoutSkill;

        cell.append(document.createTextNode(base.toLocaleString()));
        // 특화 프로그램은 반대쪽 무장을 깎으므로 감소분도 보여 준다
        if (gain) cell.append(el('span', gain > 0 ? 'w-gain' : 'w-loss',
          ' (' + (gain > 0 ? '+' : '') + gain.toLocaleString() + ')'));
        if (skillGain) cell.append(el('span', 's-gain' + sCls,
          ' (' + (skillGain > 0 ? '+' : '') + skillGain.toLocaleString() + ')'));
        return cell;
      };

      // ③ 논차지 · ④ 풀차지 (집속이 없으면 논차지 칸만 채운다)
      row.append(dmgCell(d.power));
      const full = dmgCell(d.powerCharged);
      if (d.powerCharged != null && chargeSec) {
        full.append(el('span', 'w-sub', (mustCharge ? '필수 ' : '') + chargeSec
          + (chargeCut ? ' (-' + chargeCut + '%)' : '')));
      }
      row.append(full);

      // ⑤ 쿨타임 — 격투는 クールタイム, 사격은 같은 자리에 발사 간격을 보여 준다
      //    (위키가 「発射 間隔」처럼 공백을 넣기도 해 표기 변형을 모두 받는다)
      //    조사(照射) 무장은 두 항목이 다 없어 조사 시간으로 대신한다
      row.append(el('span', 'w-col',
        jaUnits(f('クールタイム') || f('発射間隔', '発射速度', '発射間', '照射時間') || '—')));

      // ⑥ 탄 / 히트율 — 실탄은 탄수, 열무기는 히트율, 실드는 HP·크기
      const ammo = f('弾数');
      const heat = f('ヒート率', 'ヒート率/フル', 'ヒート率/ノン');
      const ohShots = f('OHまでの弾数');
      const shieldHp = f('シールドHP', 'HP'), shieldSize = f('サイズ');
      const ammoCell = el('span', 'w-col');
      if (shieldHp || shieldSize) {                       // 실드는 HP·크기가 핵심이다
        // 실드 보강재·커넥팅[범용Ⅱ형]은 실드 HP 를 올려 준다
        const base = Number(shieldHp) || 0;
        const bonus = shieldHp ? (wm.shieldHp || 0) : 0;
        ammoCell.append(document.createTextNode(shieldHp ? 'HP ' + (base + bonus).toLocaleString() : '—'));
        if (bonus) ammoCell.append(el('span', 'w-gain', ' (+' + bonus.toLocaleString() + ')'));
        if (shieldSize) ammoCell.append(el('span', 'w-sub', '크기 ' + shieldSize));
      } else if (ammo) ammoCell.append(document.createTextNode(jaUnits(ammo)));
      else if (heat) {
        ammoCell.append(document.createTextNode(heat));
        if (ohShots) ammoCell.append(el('span', 'w-sub', jaUnits(ohShots)));
      } else ammoCell.textContent = '—';
      row.append(ammoCell);

      // ⑥ 누적치 (よろけ値)
      row.append(el('span', 'w-col', mods.stagger ? jaUnits(mods.stagger) : '—'));

      // ⑦ 사거리
      row.append(el('span', 'w-col', f('射程') || '—'));

      // ⑧ 리로드 / OH복귀 — 파츠로 줄어드는 만큼을 함께 보여 준다
      const reload = f('リロード時間');
      const ohBack = f('OH復帰時間', 'OH復帰速度');
      const last = el('span', 'w-col');
      if (reload) {
        // 퀵 로더·대용량 보급 팩은 무장 종류를 가리지 않는다
        const cut = D.timeCutFor(wm, 'reloadTime', w);
        last.append(document.createTextNode(jaUnits(D.shortenTimeText(reload, cut))));
        if (cut) last.append(el('span', 'w-gain', ' (-' + cut + '%)'));
      } else if (ohBack) {
        // 보조 제네레이터는 빔 무장만, 대용량 보급 팩은 전 무장의 OH 복귀를 줄인다
        // (스러스터 OH 와는 별개)
        const cut = D.timeCutFor(wm, 'weaponOH', w);
        last.append(document.createTextNode(jaUnits(D.shortenTimeText(ohBack, cut))));
        if (cut) last.append(el('span', 'w-gain', ' (-' + cut + '%)'));
        last.append(el('span', 'w-sub', 'OH복귀'));
      } else last.textContent = '—';
      row.append(last);

      // 누르면 위키 설명 전체를 펼친다
      row.onclick = () => toggleWeaponDetail(row, w, d, lv);
      box.append(row);
      // 파츠를 갈아 끼우면 목록을 다시 그리므로, 펼쳐 둔 무장은 여기서 되살린다
      if (state.openWeapon === w.name) openWeaponDetail(row, w, d, lv);
    }
  }

  /** 무장 표의 열 이름을 한글로. 없는 이름은 원문을 그대로 쓴다. */
  const WCOL_LABEL = {
    '射程': '사거리', '弾数': '탄수', 'リロード時間': '리로드 시간', 'クールタイム': '쿨타임',
    'ヒート率': '히트율', 'ヒート率/ノン': '히트율(논차지)', 'ヒート率/フル': '히트율(풀차지)',
    'OHまでの弾数': 'OH까지 발수', 'OH復帰時間': 'OH 복귀 시간', 'OH復帰速度': 'OH 복귀 속도',
    '発射間隔': '발사 간격', '発射速度': '발사 속도', '切替時間': '전환 시간', '武装切替': '무장 전환',
    'DPS': 'DPS', 'HP': 'HP', 'シールドHP': '실드 HP', 'サイズ': '크기'
  };
  const wcol = k => WCOL_LABEL[String(k).replace(/\s+/g, '')] || k;

  /**
   * 위키 설명문에 자주 나오는 표현을 한글로 바꾼다.
   * 사전에 없는 표현은 원문 그대로 두어 정보가 사라지지 않게 한다.
   */
  const NOTE_TERM = [
    // 사격 조건
    ['ジャンプ射撃可', '점프사격 가능'], ['ブースト射撃可', '부스트사격 가능'],
    ['空中射撃可', '공중사격 가능'], ['伏せ射撃可', '엎드려사격 가능'],
    ['移動射撃可能', '이동사격 가능'], ['移動射撃可', '이동사격 가능'],
    ['射撃時静止', '사격 시 정지'], ['水中時使用不可', '수중에서 사용 불가'],
    ['空中格闘制御', '공중격투 제어'], ['連撃不可', '연격 불가'], ['射出可', '사출 가능'],
    ['使用可', '사용 가능'], ['使用不可', '사용 불가'],
    // 집속
    ['集束時よろけ有', '집속 시 비틀 있음'], ['集束時ユニット貫通効果付与', '집속 시 유닛관통 부여'],
    ['集束中移動可', '집속 중 이동 가능'], ['集束必須', '집속 필수'], ['集束可', '집속 가능'],
    ['非集束時', '비집속 시'], ['集束時間', '집속 시간'], ['集束時', '집속 시'],
    // 상태 이상·효과
    ['大よろけ有', '대비틀 있음'], ['よろけ有', '비틀 있음'], ['ひるみ有', '움찔 있음'],
    ['ユニット貫通効果有', '유닛관통 있음'], ['爆風範囲有', '폭풍범위 있음'],
    ['照射攻撃', '조사공격'], ['妨害効果付与', '방해효과 부여'], ['照準誘導効果有', '조준유도 있음'],
    ['よろけ値', '누적치'], ['非集束', '비집속'],
    // 발사 방식
    ['二発同時発射', '2발 동시발사'], ['発同時発射', '발 동시발사'],
    ['発連続発射', '발 연속발사'], ['左右交互発射', '좌우 교대발사'],
    ['即撃ち', '즉시발사'], ['秒間', '초간'], ['回攻撃', '회 공격'],
    ['パック式弾数所持', '팩식 탄수 보유'], ['秒長押しでロックオン', '초 길게 눌러 록온'],
    ['高速移動中にロックオン', '고속이동 중 록온'], ['命中後', '명중 후'],
    // 보정
    ['局部補正', '국부 보정'], ['シールド補正', '실드 보정'], ['拠点補正', '거점 보정'],
    ['頭部・背部補正', '두부·배부 보정'], ['脚部・背部補正', '각부·배부 보정'],
    ['頭部補正', '두부 보정'], ['脚部補正', '각부 보정'], ['背部補正', '배부 보정'],
    ['耐ビーム補正', '내빔 보정'], ['耐実弾補正', '내실탄 보정'], ['耐格闘補正', '내격투 보정'],
    ['自動照準補正', '자동조준보정'],

    // 위키 備考 상용구
    ['格闘方向に関わらず強制ダウン', '격투 방향에 관계없이 강제 다운'],
    ['格闘方向によらず強制ダウン', '격투 방향에 관계없이 강제 다운'],
    ['かつ小数点以下切り捨てで計算', '이며 소수점 이하 버림으로 계산'],
    ['小数点以下切り捨て', '소수점 이하 버림'], ['自身のみが視認', '자신만 시인'],
    ['命中対象に炎上デバフ', '명중 대상에 화상 디버프'], ['炎上デバフ', '화상 디버프'],
    ['吹き飛ばしダウン', '날려버림 다운'], ['強制ダウン', '강제 다운'],
    ['ボタン押下で', '버튼을 눌러'], ['ボタンで任意解除', '버튼으로 임의 해제'],
    ['任意解除', '임의 해제'], ['使用後', '사용 후'], ['無効化', '무효화'],
    ['特殊緩衝材', '특수완충재'], ['特殊偽装', '특수위장'], ['阿頼耶識', '아라야식'],
    ['高速移動', '고속이동'], ['ブースト移動', '부스트 이동'], ['連動射撃', '연동사격'],
    ['高速機動射撃', '고속기동사격'], ['格闘優先度', '격투 우선도'], ['連撃補正', '연격 보정'],
    ['防御力上昇', '방어력 상승'], ['スピード低下', '스피드 저하'],
    ['レーダー阻害', '레이더 저해'], ['レーダー障害', '레이더 장애'],
    ['ビーム属性', '빔 속성'], ['実弾属性', '실탄 속성'], ['射撃属性', '사격 속성'],
    ['伏せ撃ち', '엎드려 사격'], ['振り回し', '휘두르기'], ['機体後方', '기체 후방'],
    ['着弾点', '착탄점'], ['着弾', '착탄'], ['射出直後', '사출 직후'], ['射出', '사출'],
    ['与ダメージ', '주는 피해'], ['与ダメ', '주는 피해'], ['被ダメ', '받는 피해'],
    ['以上の場合', '이상인 경우'], ['場合', '경우'], ['以上', '이상'], ['以下', '이하'],
    // 외래어
    ['マシンガン', '머신건'], ['ライフル', '라이플'], ['バズーカ', '바주카'],
    ['レーダー', '레이더'], ['スコープ', '스코프'], ['ステルス', '스텔스'],
    ['スポット', '스팟'], ['バースト', '버스트'], ['リアクション', '리액션'],
    ['カウンター', '카운터'], ['バリア', '배리어'], ['デバフ', '디버프'],
    ['ボタン', '버튼'], ['ヘビー', '헤비'], ['ダウン', '다운'], ['リロード', '리로드'],
    // 일반어
    ['不可能', '불가능'], ['不可', '불가'], ['可能', '가능'],
    ['攻撃', '공격'], ['発生', '발생'], ['曲射', '곡사'], ['単発', '단발'],
    ['弾数', '탄수'], ['消費', '소비'], ['持続', '지속'], ['射程', '사거리'],
    ['低減', '저감'], ['出力', '출력'], ['能力', '능력'], ['段階', '단계'],
    ['下格', '하격'], ['横格', '횡격'], ['連続', '연속'], ['維持', '유지'],
    ['累計', '누계'], ['飛行', '비행'], ['味方', '아군'], ['展開', '전개'],
    ['散弾', '산탄'], ['無視', '무시'], ['固定', '고정'], ['共通', '공통'],
    ['時間', '시간'], ['上昇', '상승'], ['追加', '추가'], ['阻害', '저해'],
    ['障害', '장애'], ['押下', '누름'], ['最長', '최장'], ['約', '약'],
    ['直後', '직후'], ['命中', '명중'], ['対象', '대상'], ['計算', '계산'],
    ['自身', '자신'], ['視認', '시인'], ['解除', '해제'], ['使用', '사용'],
    ['移動', '이동'], ['防御', '방어'], ['属性', '속성'], ['優先', '우선'],
    ['補正', '보정'], ['方向', '방향'], ['機体', '기체'], ['後方', '후방'],
    ['無効', '무효'], ['偽装', '위장'], ['緩衝材', '완충재'],
    ['能', '능'], ['改', '카이'], ['強', '강'], ['単', '단'], ['回', '회'],
    ['中', '중'], ['後', '후'], ['前', '전'], ['時', '시'], ['内', '내'],
    ['等', '등'], ['用', '용'], ['非', '비'], ['分', '분'], ['減', '감'],
    ['爆', '폭'], ['腕', '팔'], ['格', '격'], ['射', '사'], ['動', '동'],
    ['生', '생'], ['与', '주는'], ['無', '없음'],
    // 조사 — 남겨 두면 문장이 일본어로 보인다
    ['からの', '으로부터'], ['まで', '까지'], ['から', '부터'], ['ごと', '마다'],
    ['かつ', '이며'], ['など', '등'], ['ため', '위해'],
    ['を', '을'], ['が', '이'], ['は', '는'], ['の', '의'], ['に', '에'],
    ['で', '로'], ['と', '와'], ['や', '나'], ['も', '도'], ['り', ''], ['な', ''],

    ['狙撃', '저격'], ['砲撃', '포격'], ['迎撃', '요격'], ['爆撃', '폭격'],
    ['集束', '집속'], ['ジャンプ', '점프'], ['リミッター', '리미터'],
    ['敵機', '적기'], ['受けた', '받은'], ['入った', '들어간'], ['ずつ', '씩'],
    ['撃', '격'], ['系', '계'], ['点', '점'], ['闘', '투'], ['風', '풍'],
    ['自', '자'], ['空', '공'], ['同', '동'], ['行', '행'],
    // 기타
    ['スキル発動中', '스킬 발동 중'], ['スキル', '스킬'], ['武装', '무장'],
    ['通常時', '통상 시'], ['変形時', '변형 시'], ['変身時', '변신 시'],
    ['は機体', '는 기체'], ['依存', '의존'], ['に付属', '에 부속'], ['対応', '대응'],
    ['ダメージ計算', '피해 계산'], ['対象の', '대상의'], ['付与', '부여'],
    ['装備中', '장비 중'], ['シールドへの被ダメージ', '실드에 받는 피해'],
    ['被ダメージ', '받는 피해'], ['シールド', '실드'], ['ダメージ', '피해'],
    ['ヒット', '히트'], ['アタック', '어택'], ['ロックオン', '록온'],
    ['頭部', '두부'], ['脚部', '각부'], ['背部', '배부'], ['腕部', '완부'],
    ['最大', '최대'], ['倍率', '배율'], ['連射', '연사'], ['貫通', '관통'],
    ['拡張', '확장'], ['短縮', '단축'], ['増加', '증가'], ['軽減', '경감'],
    ['効果', '효과'], ['範囲', '범위'], ['威力', '위력'], ['装備', '장비'],
    ['倍', '배'], ['発', '발'], ['秒', '초'], ['有', '있음'], ['可', '가능']
  ];
  // 짧은 항목이 긴 말을 잘라먹지 않도록 항상 긴 표기부터 치환한다 (「不可」가 「不가능」이 되던 문제)
  const NOTE_SORTED = NOTE_TERM.slice().sort((a, b) => b[0].length - a[0].length);
  /**
   * 위키 備考를 읽을 수 있는 한국어로 옮긴다.
   * ① 문장 사전을 먼저 돌리고 ② 남은 고유명사를 무장 용어 사전으로 마무리한다.
   *    (순서를 바꾸면 용어 사전이 문장을 잘게 쪼개 오히려 읽기 어려워진다)
   * 두 글자 이상 항목은 앞뒤에 공백을 넣어 어절이 붙지 않게 하고, 마지막에 정리한다.
   * 단위(秒·発)는 한 글자 항목이라 「2.5초」처럼 숫자에 붙은 채로 남는다.
   */
  const noteText = s => {
    let t = String(s).replace(/可能/g, '可');   // 「〜可」와 「〜可能」을 한 표기로 모은다
    for (const [ja, ko] of NOTE_SORTED) t = t.split(ja).join(ja.length > 1 ? ' ' + ko + ' ' : ko);
    return T.weaponTerms(t)
      .replace(/・/g, '·').replace(/：/g, ': ').replace(/、/g, ', ')
      .replace(/（/g, ' (').replace(/）/g, ') ')
      .replace(/［/g, ' [').replace(/］/g, '] ')
      .replace(/[「『]/g, ' “').replace(/[」』]/g, '” ')
      .replace(/＋/g, '+').replace(/－/g, '-').replace(/％/g, '%')
      .replace(/\s+/g, ' ')
      .replace(/\s+([),\]:;%·”])/g, '$1')
      .replace(/([(\[“])\s+/g, '$1')
      .replace(/\s*\/\s*/g, ' / ')
      .trim();
  };

  /** 누를 때마다 펼치거나 접는다. 열어 둔 무장은 state 에 남겨 다시 그려도 유지한다. */
  function toggleWeaponDetail(row, w, d, lv) {
    const open = row.nextElementSibling && row.nextElementSibling.classList.contains('weapon-detail');
    // 한 번에 하나만 열어 둔다
    for (const e of [...row.parentNode.querySelectorAll('.weapon-detail')]) e.remove();
    for (const e of [...row.parentNode.querySelectorAll('.weapon.open')]) e.classList.remove('open');
    state.openWeapon = open ? null : w.name;
    if (open) return;
    openWeaponDetail(row, w, d, lv);
  }

  /** 무장 행 아래에 위키의 설명과 표 값을 그대로 펼친다. */
  function openWeaponDetail(row, w, d, lv) {
    row.classList.add('open');
    const box = el('div', 'weapon-detail');

    const head = el('div', 'wd-head');
    head.append(el('b', '', T.weaponName(w.name)));
    head.append(el('span', 'wd-ja', w.name));
    head.append(el('span', 'wd-tag', 'LV' + lv + ' · '
      + (w.type === 'shield' ? '실드 · 방어'
        : (w.section === '主兵装' ? '주무장' : '부무장') + ' · ' + (w.type === 'melee' ? '격투' : '사격'))));
    box.append(head);

    // 성격별로 묶어 보여 준다 — 한 덩어리로 나열하면 읽기 어렵다
    const groups = [
      ['위력', ['논차지 위력', '풀차지 위력', '집속 시간', '집속 배율', '누적치']],
      ['운용', ['쿨타임', '무장 전환', '전환 시간', '발사 간격', '발사 속도', 'DPS']],
      ['탄약·열', ['탄수', '리로드 시간', '히트율', '히트율(논차지)', '히트율(풀차지)',
        'OH까지 발수', 'OH 복귀 시간', 'OH 복귀 속도']],
      ['방어·보정', ['실드 HP', 'HP', '크기', '사거리', '국부 보정', '실드 보정']]
    ];

    // 표시할 값을 한곳에 모은 뒤 그룹으로 나눈다
    const vals = new Map();
    const set = (k, v) => { if (v != null && v !== '' && v !== '-') vals.set(k, jaUnits(String(v))); };
    set('논차지 위력', d.power != null ? d.power.toLocaleString() : null);
    set('풀차지 위력', d.powerCharged != null ? d.powerCharged.toLocaleString() : null);
    for (const [k, v] of Object.entries(d.raw || {})) set(wcol(k), v);
    for (const [k, v] of Object.entries(w.info || {})) if (k !== '備考') set(wcol(k), v);
    const m = w.mods || {};
    set('집속 시간', m.chargeTime ? m.chargeTime + '초' : null);
    set('집속 배율', m.chargeRatio ? m.chargeRatio + '배' : null);
    set('누적치', m.stagger);
    set('국부 보정', m.partMod ? m.partMod + '배' : null);
    set('실드 보정', m.shieldMod ? m.shieldMod + '배' : null);

    for (const [title, keys] of groups) {
      const rows = keys.filter(k => vals.has(k));
      if (!rows.length) continue;
      const sec = el('div', 'wd-sec');
      sec.append(el('div', 'wd-sec-lb', title));
      const grid = el('div', 'wd-grid');
      for (const k of rows) {
        const line = el('div', 'wd-row');
        line.append(el('span', 'wd-k', k));
        line.append(el('span', 'wd-v', vals.get(k)));
        grid.append(line);
        vals.delete(k);
      }
      sec.append(grid);
      box.append(sec);
    }
    // 어느 묶음에도 안 들어간 값은 마지막에 모아 둔다
    if (vals.size) {
      const sec = el('div', 'wd-sec');
      sec.append(el('div', 'wd-sec-lb', '기타'));
      const grid = el('div', 'wd-grid');
      for (const [k, v] of vals) {
        const line = el('div', 'wd-row');
        line.append(el('span', 'wd-k', k));
        line.append(el('span', 'wd-v', v));
        grid.append(line);
      }
      sec.append(grid);
      box.append(sec);
    }

    // 격투 무장: 방향별 피해 + 연격 보정 (격투보정·파츠·스킬 반영)
    if (w.type === 'melee' && w.melee && d.power != null) box.append(meleeSection(w, d.power));

    // 위키 설명 원문 (계산에 안 들어가는 부가 효과까지 전부)
    if (w.info && w.info['備考']) {
      const note = el('div', 'wd-sec');
      note.append(el('div', 'wd-sec-lb', '위키 설명'));
      note.append(el('div', 'wd-note-tx', noteText(w.info['備考'])));
      box.append(note);
    }
    row.after(box);
  }

  const MELEE_LABEL = {
    'N格': 'N격', '横格': '횡격', '下格': '하격', '特殊格闘': '특수격투', 'BD格': 'BD격',
    '1撃目': '1격', '2撃目': '2격', '3撃目': '3격', '4撃目': '4격', '5撃目': '5격'
  };
  const mLabel = s => MELEE_LABEL[s] || s;

  /**
   * 격투 무장의 방향별 피해와 연격 보정을 보여 준다.
   * 방향 피해 = 격투 피해(격투보정·파츠·스킬 반영)에 방향 배율(연타는 히트별)을 곱한 합.
   * 상태(기본/헤비어택/최대출력 등)가 여러 개면 각각 소제목을 달아 나눠 보여 준다.
   */
  function meleeSection(w, power) {
    const r = stats();
    const corr = r.total.meleeCorrection;
    const sk = skillEffect();
    const corrBare = sk ? stats(null).total.meleeCorrection : corr;
    const pct = D.damagePctFor(wm0(), w, 'melee');   // 파츠 피해 % (특화 프로그램 등)
    const skPct = skillDmgPct(sk, 'melee');          // 스킬 피해 % (추격 등)

    const sec = el('div', 'wd-sec');
    sec.append(el('div', 'wd-sec-lb', '격투 방향별 피해'));

    const variants = w.melee.variants || [];
    const multi = variants.length > 1;
    for (const v of variants) {
      if (multi) sec.append(el('div', 'wd-var-lb', v.label));   // 상태 소제목
      const grid = el('div', 'wd-grid');
      for (const dir of v.direction) {
        const line = el('div', 'wd-row');
        line.append(el('span', 'wd-k', mLabel(dir.label) + '  ' + jaUnits(dir.raw)));
        // 히트별로 방향 배율을 적용해 합산 (하격 240%(120%x2) = 2히트)
        const withSkill = D.applyDamagePct(D.meleeDamage(power, corr, { ccd: dir.hits }), pct + skPct);
        const without = sk ? D.applyDamagePct(D.meleeDamage(power, corrBare, { ccd: dir.hits }), pct) : withSkill;
        const cell = el('span', 'wd-v');
        cell.append(document.createTextNode(without.toLocaleString()));
        if (withSkill !== without) cell.append(el('span', 's-gain' + skillCls(),
          ' (+' + (withSkill - without).toLocaleString() + ')'));
        line.append(cell);
        grid.append(line);
      }
      sec.append(grid);
    }

    if (w.melee.combo) {
      const cb = el('div', 'wd-combo');
      cb.append(el('span', 'wd-k', '연격 보정'));
      cb.append(el('span', '', w.melee.combo.map(c => mLabel(c.label) + ' ' + jaUnits(c.raw)).join(' · ')));
      sec.append(cb);
    }
    return sec;
  }

  /** 현재 장착 기준 파츠 무장 보정 (상세 패널에서도 쓴다). */
  const wm0 = () => D.weaponModsOf(state.equipped, state.ms ? msLevel(state.ms) : 1, state.ms && state.ms.属性);

  /* ---------- 스탯 ---------- */

  function renderStats() {
    const body = $('#statBody');
    body.innerHTML = '';
    if (!state.ms) return;

    const r = stats();
    // 스킬 몫은 상한에 걸려 잘릴 수 있으므로, 스킬을 뺀 결과와 비교해 실제로 늘어난 만큼만 센다
    const bare = skillStatBonus() ? stats(null) : null;

    for (const k of C.STAT_KEYS) {
      const limit = r.currentLimits[k];
      const raw = r.rawTotal[k], tot = r.total[k], soche = r.base[k];
      const skillGain = bare ? tot - bare.total[k] : 0;
      const over = limit !== Infinity && raw > limit ? raw - limit : 0;   // 상한 때문에 버려진 양
      const atCap = limit !== Infinity && tot >= limit;
      const gain = tot - soche;                                          // 강화+확장+파츠로 인한 증가분

      const row = el('div', 'stat-row' + (atCap ? ' capped' : '') + (over ? ' over' : ''));
      row.append(el('span', 'label', C.STAT_LABEL[k]));

      const totalCell = el('span', 'total');
      totalCell.append(document.createTextNode(tot.toLocaleString()));
      if (over) totalCell.append(el('span', 'over-warn', '+' + over));    // ⚠ 초과분
      row.append(totalCell);

      // 증가 폭: 강화·확장·파츠는 초록, 스킬 발동분은 보라로 나눠 보여 준다
      const base = gain - skillGain;
      const delta = el('span', 'delta' + (base > 0 ? ' up' : base < 0 ? ' down' : ''));
      delta.textContent = base === 0 && skillGain ? '' : (base === 0 ? '·' : (base > 0 ? '+' : '') + base.toLocaleString());
      if (skillGain) delta.append(el('span', 's-gain' + skillCls(), (base === 0 ? '' : ' ') + '+' + skillGain.toLocaleString()));
      row.append(delta);

      // 소체분(회색) 위에 증가분(초록)을 겹쳐 보이고, 상한 초과는 OVER 로 표시
      const meter = el('div', 'meter');
      const scale = limit === Infinity ? Math.max(tot, soche, 1) * 1.15 : limit;
      const baseW = Math.min(100, (Math.min(soche, tot) / scale) * 100);
      const gainW = Math.min(100 - baseW, (Math.max(base, 0) / scale) * 100);
      const skillW = Math.min(100 - baseW - gainW, (Math.max(skillGain, 0) / scale) * 100);
      const basePart = el('i', 'base');
      basePart.style.width = baseW + '%';
      const gainPart = el('i', 'gain' + (atCap ? ' capped' : '') + (over ? ' over' : ''));
      gainPart.style.width = gainW + '%';
      meter.append(basePart, gainPart);
      if (skillW > 0) {                       // 스킬 몫은 게이지에서도 색으로 구분한다
        const skillPart = el('i', 'skill' + skillCls());
        skillPart.style.width = skillW + '%';
        meter.append(skillPart);
      }

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
      const banned = state.banned.has(p.name);
      // 제외한 파츠는 장착 불가로 취급한다 (사유도 그렇게 보여 준다)
      const chk = banned ? { ok: false, code: 'banned', param: null }
        : state.ms ? C.checkEquip(p, state.ms, state.equipped, s) : { ok: false, code: null };
      return { p, isEquipped, chk, banned, blocked: !isEquipped && !chk.ok };
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
      state.detailPart = p;
      toggleBan(p);
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
    for (const { p, isEquipped, chk, blocked, banned } of rows) {
      const t = tileCache.get(p) || createTile(p);
      t.tile.className = 'part-tile'
        + (isEquipped ? ' on' : '')
        + (blocked ? ' blocked' : '')
        + (banned ? ' banned' : '');
      // 호버 힌트: 장착 가능/해제일 때만 (불가면 비워 둔다)
      t.hint.className = 'pt-hint' + (isEquipped ? ' rm' : '') + (blocked ? ' off' : '');
      t.hint.textContent = blocked ? '' : (isEquipped ? '해제' : '장비 가능');
      t.why.textContent = blocked && chk.code ? reasonText(chk) : '';
      frag.append(t.tile);              // 기존 노드를 옮길 뿐, 새로 만들지 않는다
    }
    box.replaceChildren(frag);
    fitWholeRows(box);
    box.scrollTop = keepScroll;
  }

  /**
   * 목록 높이를 줄 경계에 맞춘다 — 마지막 줄이 반쯤 잘려 보이지 않게.
   * 타일 높이가 제각각(장착 불가 사유가 붙으면 더 커진다)이라 고정 계산이 아니라
   * 실제 배치된 위치를 읽어 "예산(max-height) 안에 온전히 들어가는 마지막 줄"을 찾는다.
   */
  function fitWholeRows(box) {
    box.style.height = '';                       // 예산을 다시 재려면 먼저 비운다
    // 화면이 숨겨져 있으면 좌표가 전부 0이라 계산할 수 없다 (보이게 된 뒤 다시 부른다)
    if (!box.offsetParent) return;
    const cs = getComputedStyle(box);
    const budget = parseFloat(cs.maxHeight);
    if (!isFinite(budget)) return;
    const padBottom = parseFloat(cs.paddingBottom) || 0;

    // 같은 줄에 놓인 타일끼리 묶어 줄마다 가장 아래 지점을 구한다
    const rowBottom = new Map();
    for (const t of box.children) {
      const top = t.offsetTop;
      rowBottom.set(top, Math.max(rowBottom.get(top) || 0, top + t.offsetHeight));
    }

    let fit = 0, nextTop = null;
    for (const [top, bottom] of [...rowBottom].sort((a, b) => a[0] - b[0])) {
      if (bottom + padBottom > budget) { nextTop = top; break; }   // 이 줄부터는 잘린다
      fit = bottom;
    }
    if (!fit) return;
    // 아래 여백이 줄 간격보다 넓으면 다음 줄 윗머리가 비어져 나오므로 그 앞에서 끊는다
    const h = nextTop == null ? fit + padBottom : Math.min(fit + padBottom, nextTop);
    box.style.height = h + 'px';
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
    btn.onclick = () => { state.banned.clear(); renderAll(); };
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
      w.oninput = () => { state.weights[k] = Number(w.value) || 0; state.weightsTouched = true; mark(); };
      box.append(w);

      const m = el('input');
      m.type = 'number'; m.placeholder = '—';
      m.value = state.minimums[k] ?? '';
      m.oninput = () => {
        const v = Number(m.value);
        if (m.value === '' || isNaN(v)) delete state.minimums[k];
        else state.minimums[k] = v;
        state.weightsTouched = true;
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

    try {
    const opts = {
      stage: state.stage,
      expansion: state.expansion,
      expLevel: state.expLevel,
      weights: state.weights,
      minimums: state.minimums,
      locked: [...state.locked],
      banned: [...state.banned],
      skill: skillStatBonus(),      // 스킬을 켠 상태면 그 보정까지 감안해 구성한다
      restarts: 1
    };

    // 사용자가 가중치를 안 만졌으면 목표를 임의로 정해 서로 다른 방향의 후보 3개를 낸다.
    // 만졌으면 그 가중치로 서로 다른 상위 3개를 뽑는다.
    const objectives = state.weightsTouched
      ? [{ name: null, weights: state.weights }]
      : autoProfiles(state.ms);
    // 확장 스킬을 사용자가 안 정했으면(확장 없음) 확장별로 실제 구성을 만들어 비교해 고른다.
    // (최적화 점수는 "파츠 증가분"만 재서 확장의 고정 보너스를 못 보므로, 절대 가중총점으로 비교한다)
    const autoExp = state.expansion === C.EXPANSION_NONE;
    state.autoExpansion = autoExp;
    const expList = autoExp
      ? Object.keys(C.EXPANSION_LEVELS).concat([C.EXPANSION_NONE])
      : [state.expansion];
    const expLevel = autoExp ? C.MAX_EXPANSION_LEVEL : state.expLevel;

    // 절대 가중총점 — 확장의 고정 보너스까지 반영된다
    const absScore = (tot, w) => C.STAT_KEYS.reduce((s, k) => s + (w[k] || 0) * (tot[k] || 0) / (O.UNIT[k] || 1), 0);

    // 확장을 고르는 방식:
    //   고정형(사격보정 확장 등)은 파츠 선택을 바꾸지 않으므로 기준 셋에 얹어(calcStats) 싸게 평가.
    //   파츠당(per: 파츠확장[HP]·[장갑] 등)은 그 확장에 맞는 파츠(특히 보조)를 끌어와야 이득이 나므로
    //   따로 재최적화해서 공정하게 비교한다. 안 그러면 보조 계열 확장이 늘 과소평가된다.
    const isPer = e => C.EXPANSION_LEVELS[e] && C.EXPANSION_LEVELS[e][C.EXPANSION_LEVELS[e].length - 1].per;
    const perExps = autoExp ? expList.filter(isPer) : [];
    // 지정 시엔 상위 3개를 뽑아야 하니 넉넉히, 임의 목표는 목표당 후보 1개라 몇 번만 돌린다
    const optRounds = state.weightsTouched ? rounds : Math.max(2, Math.ceil(rounds / 10));
    const total = objectives.length * (1 + perExps.length + optRounds);
    let evals = 0, step = 0;
    const cands = [];
    const opt = (weights, exp, seed, iters) => {
      const r = O.optimize(state.ms, { ...opts, weights, expansion: exp, expLevel, seed, iters }, partsByCat, fullst);
      evals += r.evaluations || 0;
      if (r.parts.length || r.feasible) { r.expansion = exp; r.expLevel = expLevel; r.abs = absScore(r.stats.total, weights); }
      return r;
    };
    const yieldMaybe = async () => { bar.style.width = (++step / total * 100) + '%'; if (step % 3 === 0) await nextFrame(); };

    for (const obj of objectives) {
      // 1) 기준 셋 (확장 없이) — 고정형 확장 평가의 바탕. 스캔이라 반복을 줄여 빠르게.
      const base = opt(obj.weights, C.EXPANSION_NONE, 7919, 25);
      await yieldMaybe();

      let exp = state.expansion;
      if (autoExp && base.parts.length) {
        // 고정형: 기준 셋에 얹어 절대총점 비교 (파츠 선택을 안 바꾸므로 재최적화 불필요)
        let bestAbs = -1e9;
        for (const e of expList) {
          if (isPer(e)) continue;
          const st = C.calcStats(state.ms, base.parts, state.stage, e, partsByCat, fullst, expLevel, null, opts.skill);
          const a = absScore(st.total, obj.weights);
          if (a > bestAbs) { bestAbs = a; exp = e; }
        }
        // 파츠당: 각각 재최적화(빠른 스캔)해서 비교 — 보조 계열 파츠를 끌어와야 이득이 난다
        for (const e of perExps) {
          const r = opt(obj.weights, e, 7919 * 2, 25);
          await yieldMaybe();
          if ((r.parts.length || r.feasible) && r.abs > bestAbs) { bestAbs = r.abs; exp = e; }
        }
      }

      // 2) 고른 확장으로 제대로 다시 최적화 (풀 반복)
      const results = [];
      for (let i = 0; i < optRounds; i++) {
        const r = opt(obj.weights, exp, (i + 3) * 7919);
        if (r.parts.length || r.feasible) results.push(r);
        await yieldMaybe();
      }
      if (state.weightsTouched) {
        for (const c of topCandidates(results, 3)) cands.push(c);
      } else {
        const best = results.slice().sort((a, b) => b.abs - a.abs)[0];
        if (best) { best.label = obj.name; cands.push(best); }
      }
    }

    // 프로필이 겹쳐 같은 구성이 나오면 하나만 남기고, 최대 3개
    const seen = new Set();
    const picks = cands.filter(c => {
      const s = c.parts.map(p => p.name).slice().sort().join('|');
      if (seen.has(s)) return false; seen.add(s); return true;
    }).slice(0, 3);

    state.autoCandidates = picks;
    const note = $('#autoNote');
    if (!picks.length) { note.className = 'note mt'; note.textContent = '구성을 찾지 못했습니다.'; return; }
    note.className = 'note mt';
    note.textContent = `후보 ${picks.length}개 · 평가 ${evals.toLocaleString()}회 — 원하는 구성을 고르세요`;
    renderAutoResults(picks);
    applyCandidate(0);   // 가장 좋은 후보를 우선 적용해 두고, 다른 것도 고를 수 있게 한다
    } finally {          // 예외가 나도 버튼이 영구 비활성으로 남지 않게 한다
      state.running = false;
      btn.disabled = false;
      bar.style.width = '0';
    }
  }

  /**
   * 가중치를 안 정했을 때 쓸 3가지 목표. 기체 성향(사격/격투)에 맞춰 공격 방향을 정한다.
   */
  function autoProfiles(ms) {
    const melee = Number(ms && ms.格闘補正 || 0) >= Number(ms && ms.射撃補正 || 0);
    // 공격 프로필은 HP 가중치를 빼야 공격 보정·확장이 뽑힌다 (HP 는 절대치가 커서 총점을 지배한다)
    return [
      { name: '밸런스', weights: O.PRESETS['밸런스'] },
      melee
        ? { name: '격투 중심', weights: { meleeCorrection: 4, speed: 1.5, thruster: 1.5, highSpeedMovement: 1 } }
        : { name: '사격 중심', weights: { shoot: 4, thruster: 1, armorBeam: 0.5, armorRange: 0.5 } },
      { name: '방어형', weights: { hp: 3, armorRange: 2, armorBeam: 2, armorMelee: 2, thruster: 0.5 } }
    ];
  }

  /** 결과에서 서로 겹치지 않는 상위 후보를 고른다 (파츠가 1개 이하만 다르면 같은 구성으로 본다). */
  function topCandidates(results, n) {
    const rank = r => (r.abs != null ? r.abs : r.score);   // 확장 비교엔 절대 총점, 없으면 점수
    const sig = r => r.parts.map(p => p.name).slice().sort().join('|');
    const seen = new Set();
    const uniq = results.slice().sort((a, b) => rank(b) - rank(a))
      .filter(r => { const s = sig(r); if (seen.has(s)) return false; seen.add(s); return true; });

    const picks = [];
    const differs = (a, b) => {
      const A = new Set(a.parts.map(p => p.name));
      let common = 0;
      for (const p of b.parts) if (A.has(p.name)) common++;
      return Math.max(a.parts.length, b.parts.length) - common >= 2;   // 2개 이상 달라야 다른 구성
    };
    for (const r of uniq) {
      if (picks.length >= n) break;
      if (picks.every(p => differs(p, r))) picks.push(r);
    }
    for (const r of uniq) { if (picks.length >= n) break; if (!picks.includes(r)) picks.push(r); }
    return picks;
  }

  /** 자동 구성 후보 카드를 그린다. 클릭하면 그 구성을 장착한다. */
  function renderAutoResults(cands) {
    const box = $('#autoResults');
    box.innerHTML = '';
    // 보여줄 스탯: 사용자가 가중치를 줬으면 그 항목, 아니면 대표 스탯
    let keys = state.weightsTouched ? C.STAT_KEYS.filter(k => (state.weights[k] || 0) > 0) : [];
    if (!keys.length) keys = ['hp', 'shoot', 'meleeCorrection', 'thruster'];
    keys = keys.slice(0, 4);

    cands.forEach((c, i) => {
      const card = el('div', 'auto-cand');
      card.dataset.i = String(i);
      const head = el('div', 'ac-head');
      head.append(el('span', 'ac-rank', c.label || '구성 ' + (i + 1)));
      head.append(el('span', 'ac-parts', `파츠 ${c.parts.length}개`));
      card.append(head);

      // 파츠를 아이콘으로 보여 준다 — 어떤 파츠가 들어갔는지 한눈에 비교
      const thumbs = el('div', 'ac-thumbs');
      for (const part of c.parts) {
        const th = el('div', 'ac-thumb');
        th.append(img(partImg(part.name), 'parts', part.name));
        const lv = lvOf(part.name);
        if (lv) th.append(el('span', 'ac-lv', lv));
        th.title = T.partName(part.name);
        thumbs.append(th);
      }
      card.append(thumbs);

      const stats = el('div', 'ac-stats');
      for (const k of keys) {
        const cell = el('span', 'ac-stat');
        cell.append(el('span', 'ac-k', C.STAT_LABEL[k]));
        cell.append(el('span', 'ac-v', (c.stats.total[k] ?? 0).toLocaleString()));
        stats.append(cell);
      }
      card.append(stats);

      // 자동으로 고른 확장 스킬 (사용자가 지정했으면 표시 안 함)
      if (state.autoExpansion && c.expansion && c.expansion !== C.EXPANSION_NONE) {
        const expName = (C.EXPANSION_LABEL[c.expansion] || c.expansion).replace(/\s*\(.*\)$/, '');
        card.append(el('div', 'ac-exp', '확장: ' + expName));
      }

      // 하한 미달 표시
      const unmet = Object.entries(state.minimums)
        .filter(([k, v]) => v && c.stats.total[k] < v)
        .map(([k, v]) => `${C.STAT_LABEL[k]} ${c.stats.total[k]}/${v}`);
      if (unmet.length) card.append(el('div', 'ac-warn', '하한 미달: ' + unmet.join(', ')));

      card.title = c.parts.map(p => T.partName(p.name)).join(', ');
      card.onclick = () => applyCandidate(i);
      box.append(card);
    });
  }

  function applyCandidate(i) {
    const cands = state.autoCandidates || [];
    const c = cands[i];
    if (!c) return;
    state.equipped = c.parts.slice();
    // 확장 스킬을 자동으로 골랐으면 그 값도 함께 적용한다 (후보를 갈아탈 때마다).
    // NONE 후보로 갈아탈 수도 있으므로 확장이 NONE 이어도 반드시 맞춘다.
    if (state.autoExpansion && c.expansion) {
      state.expansion = c.expansion;
      state.expLevel = c.expLevel || C.MAX_EXPANSION_LEVEL;
      $('#expansion').value = state.expansion;
      const expLv = $('#expLevel');
      expLv.value = String(state.expLevel);
      expLv.disabled = state.expansion === C.EXPANSION_NONE;
    }
    [...$('#autoResults').children].forEach(el => el.classList.toggle('on', Number(el.dataset.i) === i));
    renderAll();
    toast(`${c.label || '구성 ' + (i + 1)} 적용 — 파츠 ${c.parts.length}개`);
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
    // 손상된 저장본이 들어와도 계산이 어긋나지 않게 아는 값만 받는다
    state.stage = [0, 4, 6].includes(Number(obj.stage)) ? Number(obj.stage) : 6;
    state.expansion = C.EXPANSION_SKILLS.includes(obj.expansion) ? obj.expansion : C.EXPANSION_NONE;
    // 불러온 구성이 그대로 보이도록 제외·변형·스킬 표시는 초기 상태로 되돌린다.
    // (스킬 선택은 기체별 인덱스라 다른 기체를 불러오면 어긋난다)
    state.banned.clear();
    state.form = 'normal';
    state.openWeapon = null;
    state.skillPicks.clear();
    clearAutoResults();         // 이전 기체의 자동 구성 후보가 남아 잘못 적용되지 않게 지운다
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

  const STAGE_LABEL = { 0: '미강화', 4: '4단계', 6: '풀강' };

  /**
   * 강화 단계 변경.
   * 단계를 내리면 강화로 늘어난 슬롯이 줄어 기존 구성이 성립하지 않을 수 있으므로,
   * 확인을 받고 파츠를 초기화한다.
   * 6→4 도 예외가 아니다 — 슬롯 증가가 강화리스트 5·6번째 항목에 들어간 기체
   * (걈플란 TR-5 LV4, 바운드 독 LV2)는 6→4 에서도 슬롯이 줄어든다.
   * 레벨 전환과 규칙을 맞추기 위해 내리는 경우는 항상 초기화한다.
   */
  function setStage(v) {
    if (v === state.stage) return;
    const resets = v < state.stage && state.equipped.length > 0;
    if (resets && !confirm(
      `${STAGE_LABEL[v]}로 내리면 강화로 늘어난 슬롯이 줄어 지금 구성을 유지할 수 없습니다.\n\n`
      + `장착한 파츠 ${state.equipped.length}개를 모두 해제하고 진행할까요?`)) return;

    state.stage = v;
    if (resets) { state.equipped = []; state.locked.clear(); }
    syncStageSeg();
    renderAll();
    if (resets) toast(`${STAGE_LABEL[v]}로 변경해 장착 파츠를 초기화했습니다`);
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
   * 레벨이 바뀌면 슬롯 상한도 바뀌어 기존 구성이 성립하지 않으므로 파츠·확장을 초기화한다.
   */
  function switchLevel(m) {
    if (!m || m === state.ms) return;
    const had = state.equipped.length;
    state.ms = m;
    state.equipped = [];
    state.skillPicks.clear();
    state.locked.clear();
    clearAutoResults();
    resetEnhance();             // 레벨이 바뀌면 슬롯도 바뀌므로 확장 스킬도 초기화한다
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

  /** 변형 수치가 있는 기체에만 통상/변형 전환 버튼을 띄운다. */
  function renderFormSeg() {
    const seg = $('#formSeg');
    seg.innerHTML = '';
    if (!C.hasTransform(state.ms)) {
      seg.hidden = true;
      state.form = 'normal';        // 일반 기체로 옮겨가면 통상으로 되돌린다
      return;
    }
    seg.hidden = false;
    for (const [v, label] of [['normal', '통상'], ['transform', '변형']]) {
      const b = el('button', 'seg-btn' + (state.form === v ? ' on' : ''), label);
      b.onclick = () => {
        state.form = v;
        [...seg.children].forEach(c => c.classList.remove('on'));
        b.classList.add('on');
        renderStats();
        renderWeapons();            // 사격·격투 보정이 바뀌면 무장 위력도 달라진다
      };
      seg.append(b);
    }
  }

  const skillDur = s => (s.forever ? '무제한' : s.secs ? s.secs + '초' : '시간 제한');

  /** 스킬 한 줄에 붙일 요약 — 「사격 +10 · 격투 +35 · 무제한 · HP 50% 이하」 */
  function skillSummary(sk) {
    const e = skillLevel(sk) || {};
    const num = [];
    if (e.shoot) num.push('사격 +' + e.shoot);
    if (e.melee) num.push('격투 +' + e.melee);
    if (e.shootPct) num.push('사격 +' + e.shootPct + '%');
    if (e.meleePct) num.push('격투 +' + e.meleePct + '%');
    if (e.dmgAny) num.push('피해 +' + e.dmgAny + '%');
    if (e.dmgShoot) num.push('사격 피해 +' + e.dmgShoot + '%');
    if (e.dmgMelee) num.push('격투 피해 +' + e.dmgMelee + '%');
    if (e.crouchPct) num.push('앉기·정지 사격 +' + e.crouchPct + '%');
    const how = [skillDur(sk), sk.hp ? 'HP ' + sk.hp + '% 이하' : null, sk.manual ? '수동' : null]
      .filter(Boolean).join(' · ');
    return { num: num.join(' · ') || '—', how };
  }

  /** 버튼 라벨·색만 갱신한다 (메뉴는 다시 그리지 않아 체크 시 스크롤이 튀지 않는다). */
  function updateSkillButton() {
    const n = state.skillPicks.size;
    const box = $('#skillBox'), act = activeSkills();
    box.classList.toggle('on', n === 1);
    box.classList.toggle('multi', n > 1);
    $('#skillBtnText').textContent = n === 0 ? '스킬' : n === 1 ? act[0].nameKo : '스킬 ' + n + '개';
    $('#skillBtn').title = n
      ? act.map(s => s.nameKo + ' (' + skillDur(s) + ')').join('\n')
      : '발동할 기체 스킬 고르기';
  }

  /**
   * 기체 스킬 선택 드롭다운. 체크박스라 여러 개를 겹쳐 발동할 수 있다.
   * 스킬이 아예 없거나, 현재 기체 LV 에서 쓸 수 있는 스킬이 없으면 통째로 숨긴다.
   */
  function renderSkillControls() {
    const box = $('#skillBox'), menu = $('#skillMenu');
    const avail = availableSkills();       // 현재 LV 에서 쓸 수 있는 스킬만
    if (!avail.length) {
      box.hidden = true;
      menu.hidden = true;
      menu.innerHTML = '';               // 이전 기체의 항목·상태를 남기지 않는다
      state.skillPicks.clear();
      box.classList.remove('on', 'multi');
      $('#skillBtnText').textContent = '스킬';
      return;
    }
    box.hidden = false;
    // LV 이 바뀌어 못 쓰게 된 선택은 정리한다
    for (const i of [...state.skillPicks]) if (!avail.some(x => x.i === i)) state.skillPicks.delete(i);

    menu.innerHTML = '';
    for (const { sk, i } of avail) {
      const s = skillSummary(sk);
      const item = el('label', 'skill-item');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = state.skillPicks.has(i);
      cb.onchange = () => {
        cb.checked ? state.skillPicks.add(i) : state.skillPicks.delete(i);
        updateSkillButton();            // 메뉴는 그대로 두고 버튼·성능·무장만 갱신
        renderStats();
        renderWeapons();
      };
      item.append(cb);
      const tx = el('div');
      tx.append(el('span', 'k', sk.nameKo));
      const v = el('span', 'v');
      v.append(el('b', '', s.num));
      v.append(document.createTextNode('  ·  ' + s.how));
      tx.append(v);
      item.append(tx);
      menu.append(item);
    }
    updateSkillButton();
  }

  function renderAll() {
    renderHero();
    renderFormSeg();
    renderSkillControls();
    renderLevelSwitch();
    // 기체 목록은 ① 선택 화면에서만 갱신 (파츠 장착 때마다 1,671기를 재정렬·재생성하지 않도록)
    if (state.view !== 'build') renderMsList();
    renderSlots();
    renderEquipped();
    renderStats();
    renderPartList();
    renderBannedCount();
    renderDetail(state.detailPart);
    renderWeapons();
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
    exp.onchange = () => { state.expansion = exp.value; state.autoExpansion = false; syncExpLv(); renderAll(); };
    expLv.onchange = () => { state.expLevel = Number(expLv.value); renderAll(); };

    const preset = $('#preset');
    preset.append(new Option('— 프리셋 선택 —', ''));
    for (const name of Object.keys(O.PRESETS)) preset.append(new Option(name, name));
    preset.onchange = () => {
      if (!preset.value) return;
      state.weights = {};
      for (const k of C.STAT_KEYS) state.weights[k] = 0;
      Object.assign(state.weights, O.PRESETS[preset.value]);
      state.weightsTouched = true;
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


    // 기체 스킬 드롭다운 — 바깥을 누르면 닫는다
    $('#skillBtn').onclick = ev => {
      ev.stopPropagation();
      const menu = $('#skillMenu');
      menu.hidden = !menu.hidden;
    };
    $('#skillMenu').onclick = ev => ev.stopPropagation();
    document.addEventListener('click', () => { $('#skillMenu').hidden = true; });

    // 사격 자세 — 선 자세 / 앉기·정지 / 엎드리기 중 하나. 스코프는 자세와 별개 토글.
    const postureSeg = $('#postureSeg');
    for (const [v, label] of [['stand', '선 자세'], ['crouch', '앉기·정지'], ['prone', '엎드리기']]) {
      const b = el('button', 'seg-btn' + (state.posture === v ? ' on' : ''), label);
      b.onclick = () => {
        state.posture = v;
        [...postureSeg.children].forEach(c => c.classList.remove('on'));
        b.classList.add('on');
        renderWeapons();            // 자세 보정은 무장 피해에만 영향
      };
      postureSeg.append(b);
    }
    $('#scopeBtn').onclick = () => {
      state.scope = !state.scope;
      $('#scopeBtn').classList.toggle('on', state.scope);
      renderWeapons();
    };

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

    // 창 크기가 바뀌면 예산(vh)이 달라지므로 줄 맞춤을 다시 한다
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => fitWholeRows($('#partList')), 120);
    });

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
