  /* ui/01-select.js — 기체 선택 화면 — 기체 목록 · 화면 전환.
     tools/lib/uisrc.js 가 번호 순으로 이어 붙여 한 IIFE 로 감싼다(파일끼리 변수를 나눠 쓴다). */
  /* ---------- 기체 목록 ---------- */

  function filteredMs() {
    const q = state.msQuery.trim().toLowerCase();
    let list = msData;

    // 보기 모드: 즐겨찾기 / 최근 — 최근은 사용 순서를 그대로 유지하려고 먼저 처리한다.
    if (state.msView === 'fav') list = list.filter(m => state.favorites.has(m.MS名));
    else if (state.msView === 'recent') {
      const order = new Map(state.recent.map((n, i) => [n, i]));
      list = list.filter(m => order.has(m.MS名)).sort((a, b) => order.get(a.MS名) - order.get(b.MS名));
    }

    if (state.msAttr) list = list.filter(m => m.属性 === state.msAttr);

    if (state.msCost === 'low') list = list.filter(m => m.コスト <= 250);
    else if (state.msCost !== 'all') list = list.filter(m => m.コスト === state.msCost);

    if (state.msLv === '4+') list = list.filter(m => msLevel(m) >= 4);
    else if (state.msLv !== 'all') list = list.filter(m => msLevel(m) === state.msLv);

    if (state.msRarity !== 'all') list = list.filter(m => msRarity(m) === state.msRarity);

    if (q) list = list.filter(m => matches(msSearchText.get(m), q));

    // 최근 보기는 사용 순서를 유지한다 (아래 표준 정렬을 건너뛴다)
    if (state.msView === 'recent') return list;

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

  /** 보기 칩(전체 / 즐겨찾기 / 최근)을 개수 배지와 함께 그린다. */
  /** 보기 칩(전체 / 즐겨찾기 / 최근)을 개수 배지와 함께 그린다.
   *  개수가 바뀌면 글자 자체가 달라지므로 다시 칠하는 것으로는 안 되고 매번 새로 그린다 —
   *  기체 선택 화면과 「기체 변경」 서랍 두 곳을 같이 그린다. */
  function renderViewChips() {
    const items = [
      { v: 'all', label: '전체' },
      { v: 'fav', label: `★ 즐겨찾기${state.favorites.size ? ' ' + state.favorites.size : ''}` },
      { v: 'recent', label: `🕐 최근${state.recent.length ? ' ' + state.recent.length : ''}` }
    ];
    for (const id of ['viewChips', 'dViewChips']) {
      const box = document.getElementById(id);
      if (!box) continue;
      box.innerHTML = '';
      for (const it of items) {
        const chip = el('button', 'chip' + (state.msView === it.v ? ' on' : ''), it.label);
        chip.onclick = () => {
          state.msView = it.v;
          state.msLimit = 80;
          renderViewChips();
          renderMsList();
        };
        box.append(chip);
      }
    }
  }

  /** 번들 데이터 신선도 배지 — 빌드일과 총량. */
  function renderDataFresh() {
    const box = document.getElementById('dataFresh');
    const b = (typeof window !== 'undefined' && window.GBO2_BUILD) || null;
    if (!box || !b) return;
    // 날짜만 적으면 같은 날 두 번 빌드했을 때 어느 것이 도는지 구분이 안 된다.
    // 실기에서 "새 APK 를 깔았는데 옛 화면" 을 가릴 방법이 없어 분까지 적는다.
    let txt = `데이터 ${b.stamp || b.date} · 기체 ${b.ms.toLocaleString()} · 파츠 ${b.parts} · 무장 ${b.weapons.toLocaleString()}`;
    /* 여기 적힌 것은 **HTML 의 빌드 시각**이고, 그 HTML 은 OTA 로 갱신된다 —
       옛 APK 를 쓰고 있어도 최신으로 보인다. 그래서 「APK 를 다시 설치하세요」라고
       안내해도 했는지 확인할 길이 없었다(09-29·09-30).
       앱에서는 앱 자신의 버전을 함께 적는다. 브라우저에서는 창구가 없어 그대로다. */
    try {
      const av = window.AndroidBridge && typeof window.AndroidBridge.appVersion === 'function'
        ? String(window.AndroidBridge.appVersion() || '') : '';
      if (av) txt += ` · 앱 ${av}`;
    } catch (e) { /* 창구가 없거나 막히면 데이터만 적는다 */ }
    box.textContent = txt;
  }

  /* 기체 목록을 그리는 곳은 이제 둘이다 — 기체 선택 화면과, 파츠 화면의 「기체 변경」 서랍.
     목록을 한 벌 더 베껴 두면 반드시 어긋나므로(즐겨찾기 배지·더 보기·정렬) **그리는 함수는
     하나**로 두고 그릴 자리만 등록해 쓴다. renderMsList() 는 등록된 곳을 전부 다시 그린다 —
     기존 호출부(수십 곳)를 그대로 두려고 인자 없는 모양을 지켰다. */
  const msListViews = [];
  function addMsListView(v) { msListViews.push(v); return v; }
  function dropMsListView(v) {
    const i = msListViews.indexOf(v);
    if (i >= 0) msListViews.splice(i, 1);
  }

  function renderMsList() {
    // 기체 선택 화면이 티어 보기면 그쪽을 그린다 — 필터·검색이 이 함수를 부르기 때문이다.
    // 서랍(기체 변경)은 언제나 목록이므로 등록된 자리는 그대로 다 그린다.
    if (typeof msViewTab !== 'undefined' && msViewTab === 'tier') renderTier();
    for (const v of msListViews) drawMsList(v);
  }

  function drawMsList(view) {
    const box = $(view.box);
    if (!box) return;
    const countBox = view.count ? $(view.count) : null;
    // 고른 것으로 볼 기준과 눌렀을 때 할 일은 자리마다 다르다.
    const isSel = view.isSel || (m => !!(infoMs && infoMs.MS名 === m.MS名));
    const onPick = view.onPick || (m => { selectMs(m); });
    box.innerHTML = '';
    const list = filteredMs();

    if (!list.length) {
      const msg = state.msView === 'fav' ? '즐겨찾기한 기체가 없습니다. 카드의 ☆를 눌러 추가하세요.'
        : state.msView === 'recent' ? '최근 고른 기체가 없습니다.'
        : '조건에 맞는 기체가 없습니다.';
      box.append(el('div', 'empty-state', msg));
      if (countBox) countBox.textContent = '0기';
      return;
    }

    for (const m of list.slice(0, state.msLimit)) {
      const card = el('div', 'ms-card' + (state.ms === m ? ' sel' : ''));
      card.dataset.ms = m.MS名;          // 다시 그린 뒤 같은 카드를 다시 찾으려고
      kbdPressable(card, T.msName(m.MS名));
      card.append(img(msImg(m.MS名), 'ms', m.MS名));

      // 즐겨찾기 별 — 카드 선택과 별개로 토글한다
      const fav = state.favorites.has(m.MS名);
      const star = el('button', 'ms-fav' + (fav ? ' on' : ''), fav ? '★' : '☆');
      star.title = fav ? '즐겨찾기 해제' : '즐겨찾기 추가';
      star.onclick = ev => {
        ev.stopPropagation();
        toggleFavorite(m.MS名);
        renderMsList();
        renderViewChips();   // 개수 배지 갱신
      };
      card.append(star);

      const info = el('div', 'info');
      const nm = el('div', 'nm', T.msName(m.MS名));
      nm.title = m.MS名;
      info.append(nm);

      const meta = el('div', 'meta');
      meta.append(attrMark(m.属性));
      meta.append(el('span', '', T.attrName(m.属性) || '-'));
      meta.append(el('span', 'cost-badge', m.コスト));
      const r = msRarity(m);
      if (r) meta.append(rarityChip(r));
      if (wikiPending(m)) {
        const wp = el('span', 'wiki-pending', '위키 미수록');
        wp.title = WIKI_PENDING_TXT;
        meta.append(wp);
      }

      // ⓘ — 기체 정보를 본다. 카드 본체는 곧바로 파츠로 가므로, 훑어보고 싶을 때만 누른다.
      // (예전에는 카드를 누르면 늘 정보가 먼저 떠서, 아는 기체를 고를 때마다 한 번 더 눌러야 했다.)
      // **등급 줄 안에** 넣는다 — 절대 위치로 바닥에서 띄우면 카드 높이가 달라지는 화면에서
      // 줄과 어긋난다. 여기 두면 세로는 구조가 맞춰 주고, 가로만 ★ 에 맞추면 된다.
      //
      // 「기체 변경」 서랍에는 달지 않는다. 서랍은 파츠 화면 위에 열려서 기체 정보 칸이
      // 보일 자리가 없다 — 눌러도 아무 일이 안 일어나는 죽은 손잡이가 된다(실측 확인).
      if (view.showInfo !== false) {
        const ib = el('button', 'ms-info', 'ⓘ');
        ib.title = T.msName(m.MS名) + ' 정보 보기';
        ib.setAttribute('aria-label', '기체 정보');
        ib.onclick = ev => { ev.stopPropagation(); openInfo(m); };
        meta.append(ib);
      }

      info.append(meta);

      card.append(info);

      // 카드 본체를 누르면 **곧바로 파츠 적용**으로 간다. 정보는 ⓘ 로 따로 연다 —
      // 기체를 아는 사람이 대부분이라, 매번 정보를 거치게 하면 한 번씩 더 누르게 된다.
      // 서랍에서는 그 자리에서 기체를 바꾼다.
      card.classList.toggle('sel', isSel(m));
      card.onclick = () => onPick(m);
      box.append(card);
    }

    if (list.length > state.msLimit) {
      const more = el('button', 'more', `더 보기 (${list.length - state.msLimit}기 남음)`);
      more.onclick = () => { state.msLimit += 120; renderMsList(); };
      box.append(more);
    }
    if (countBox) countBox.textContent = `${list.length}기`;
  }

  /* ---------- 화면 전환 ---------- */

  // 화면은 셋이다 — 기체 선택 · 파츠 적용 · 공유 갤러리.
  // 갤러리는 단계(stepper)에 넣지 않는다. 흐름의 한 단계가 아니라 언제든 다녀오는 곳이라,
  // 들어오기 전 화면을 기억해 두고 「돌아가기」로 그리로 되돌린다.
/* 갤러리·스킬 도감·토큰·강화 플랜에서 뒤로가기는 **언제나 기체 선택**으로 간다.
   예전엔 '들어오기 전 화면'(viewBefore)으로 돌아갔는데, 그 넷이 서로를 기억해서
   강화 플랜 → 토큰 → 뒤로(강화 플랜) → 뒤로(토큰) 처럼 **고리에 갇혔다**.
   파츠 구성은 그대로 남아 있고 「2 파츠 적용」을 누르면 바로 돌아가므로,
   한 군데로 모으는 편이 예측 가능하고 갇히지 않는다. */
  const AUX_BACK = 'select';
  // 지금 보고 있는 구성이 갤러리에서 온 것인가. 「기체 변경」이 어디로 돌아갈지 정한다
  // — 갤러리에서 골라 들어왔는데 기체 선택 화면으로 튕기면 찾던 자리를 잃는다.
  let fromGallery = false;

  function setView(view) {
    const changed = state.view !== view;
    /* ■ 패치노트 화면을 **떠나면** 옮겨 둔 기체 정보 칸을 제자리로 되돌린다.
       그 칸(#selInfo)은 패치노트에서 열 때 #screenPatch 안으로 옮겨진다. 되돌리지 않고
       나가면 조상이 display:none 이라 **기체 선택 화면에서 정보 칸이 영영 안 열린다**
       (실측: 「‹ 돌아가기」 뒤 ⓘ 를 눌러도 폭 0). 출구는 돌아가기·뒤로가기·스테퍼로
       여럿이라 하나씩 적으면 또 빠뜨린다 — 모든 출구가 지나는 **여기 한 곳**에 둔다.
       패치노트에 머무는 동안(📰 를 다시 누르는 것 포함)에는 건드리지 않는다. */
    if (view !== 'patch' && pnInfoHome) closeInfo();
    state.view = view;
    // 선택 화면으로 "돌아올 때"만 목록을 갱신 (초기 렌더와 중복 실행하지 않는다)
    // 최근/즐겨찾기 칩의 개수 배지도 함께 갱신한다(방금 고른 기체가 최근에 반영되도록).
    if (view === 'select' && changed) { renderMsList(); renderViewChips(); }
    for (const v of ['select', 'build', 'gallery', 'codex', 'token', 'plan', 'patch'])
      document.body.classList.toggle('view-' + v, view === v);
    [...$('#stepper').querySelectorAll('li[data-step]')].forEach(li =>
      li.classList.toggle('on', li.dataset.step === view));
    fitTopbar();   // 화면마다 상단바 버튼이 다르다(빌드 화면에만 있는 것들)
    // 화면 전환 시 스크롤을 위로 되돌린다
    const scr = { build: $('#screenBuild'), gallery: $('#screenGallery'), codex: $('#screenCodex'),
      token: $('#screenToken'), plan: $('#screenPlan'), patch: $('#screenPatch') }[view] || $('#screenSelect');
    if (scr) scr.scrollTop = 0;
    window.scrollTo(0, 0);
    // 숨겨진 동안에는 크기를 잴 수 없으므로, 보이게 된 뒤 줄 맞춤을 다시 한다
    if (view === 'build') {
      fitBuildBand();
      fitWholeRows($('#partList'));
      // 어디로 돌아가는지 버튼에 그대로 적는다 — 문구와 동작이 다르면 안 누른다
      const back = $('#backToSelect');
      if (back) {
        back.textContent = fromGallery ? '‹ 갤러리로' : '‹ 기체 리스트로';
        back.title = fromGallery ? '공유 갤러리로 돌아가기 (검색·필터 유지)' : '기체 목록으로 돌아가기';
      }
    }
  }

  function selectMs(m) {
    state.ms = m;
    fromGallery = false;        // 기체 선택 화면에서 골랐으니 거기로 돌아간다
    pushRecent(m.MS名);         // 최근 사용 목록 갱신
    state.form = 'normal';      // 새 기체는 통상 모드부터
    state.equipped = [];
    state.locked.clear();
    state.detailPart = null;
    state.skillPicks.clear();
    // 방어 스킬 체크는 스킬 "이름"으로 저장돼 있어, 안 지우면 이름이 같은 스킬(데미지 컨트롤·
    // 마뉴버아머 등)이 다른 기체에서 저절로 켜진 채로 내구 지표·피탄 수치를 바꿔 버린다.
    state.staggerOn.clear();
    state.thrusterOn.clear();   // 스러스터 스킬 체크도 기체마다 다시 — 스킬 이름으로 저장된다
    state.weaponLv = null;      // 무장 LV 는 기체마다 다시 고른다(LV 상한이 기체마다 다르다)
    clearAutoResults();
    clearTargets();             // 목표는 그 기체의 절댓값이라 다른 기체로 가져가면 못 맞춘다
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

