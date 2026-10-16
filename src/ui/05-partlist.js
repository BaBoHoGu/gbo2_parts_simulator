  /* ui/05-partlist.js — 파츠 목록.
     tools/lib/uisrc.js 가 번호 순으로 이어 붙여 한 IIFE 로 감싼다(파일끼리 변수를 나눠 쓴다). */
  /* ---------- 파츠 목록 ---------- */

  /**
   * 화면에 뿌릴 파츠와 그 장착 판정을 함께 돌려준다.
   * 판정은 정렬과 렌더 양쪽에서 쓰이므로 여기서 한 번만 계산한다.
   */
  // 필터(탭·검색·기체)별로 순서를 '한 번만' 고정한다. 장착/해제해도 타일이 안 움직여야
  // 모바일에서 연속 탭 시 손가락 밑 타일이 바뀌어 엉뚱한 파츠가 장착되는 일이 없다.
  let partOrderKey = null, partOrder = [];
  function visibleParts() {
    const q = state.partQuery.trim().toLowerCase();
    let list = state.partTab === C.CATEGORY_ALL ? allParts : partsByCat[state.partTab];
    if (q) list = list.filter(p => matches(partSearchText.get(p), q));

    const s = slots();
    const rowOf = p => {
      const isEquipped = state.equipped.some(e => e.name === p.name);
      const banned = state.banned.has(p.name);
      // 기본 제외한 파츠는 장착 불가로 취급한다 (사유도 그렇게 보여 준다)
      const chk = banned ? { ok: false, code: 'banned', param: null }
        : state.ms ? C.checkEquip(p, state.ms, state.equipped, s) : { ok: false, code: null };
      return { p, isEquipped, chk, banned, blocked: !isEquipped && !chk.ok };
    };

    // 캐시 키의 구분자는 보통 문자로 둔다 — 예전엔 NUL(U+0000) 이 박혀 있어
    // ui.js 가 '바이너리' 로 취급돼 grep 이 이 파일을 줄 단위로 못 뒤졌다.
    const key = [state.partTab, q, state.ms ? state.ms.MS名 : '', state.stage].join('|');
    if (key !== partOrderKey) {
      partOrder = list.slice();          // 필터·기체·강화가 바뀌면 바탕 순서를 새로 잡는다
      partOrderKey = key;
    } else {
      // 같은 필터 안에서는 순서 유지(빠진 건 제거, 새로 든 건 뒤에).
      const set = new Set(list), have = new Set(partOrder);
      partOrder = partOrder.filter(p => set.has(p));
      for (const p of list) if (!have.has(p)) partOrder.push(p);
    }

    /* 묶음이 섞였을 때만 다시 정렬한다 — '장착 가능 → 장착 중 → 불가'.
     *
     * 예전에는 필터가 바뀔 때만 정렬하고 장착하는 동안에는 순서를 얼렸다. 손가락 밑에서
     * 타일이 움직이지 않게 하려던 것인데, 값을 재 보니 대가가 훨씬 컸다 —
     * 파츠 5개를 달면 아직 달 수 있는 것은 **1~3개**뿐인데 그것이 막힌 파츠 **66개**
     * 뒤에 흩어지고, 목록이 13~15 덩어리로 끊겼다. 쓰는 사람은 회색 타일 수십 개를
     * 지나며 아직 되는 것을 찾아야 했다(사용자 지적).
     *
     * 다시 정렬하되 두 가지를 지킨다:
     *   · **섞였을 때만** 한다. 그냥 다시 그리는 것만으로는 순서가 안 흔들린다.
     *   · **안정 정렬**이라 묶음 안의 순서는 그대로다 — 되는 것들끼리의 자리는 안 바뀐다. */
    const rows = partOrder.map(rowOf);
    const rank = r => (r.isEquipped ? 1 : r.chk.ok ? 0 : 2);
    const ranks = rows.map(rank);
    const mixed = ranks.some((v, i) => i > 0 && v < ranks[i - 1]);
    if (mixed) {
      rows.sort((a, b) => rank(a) - rank(b));   // Array.prototype.sort 는 안정적이다
      partOrder = rows.map(r => r.p);
    }
    return rows;
  }

  // 파츠 타일은 파츠 수만큼만 만들어 두고(현재 163개, 갱신 때마다 늘어난다) 상태만 갱신한다.
  // (매 장착마다 DOM·이미지를 새로 만들지 않아 깜빡임과 재로딩이 없다)
  const tileCache = new Map();

  function createTile(p) {
    const v = partView(p);
    const tile = el('div', 'part-tile');
    tile.title = `${v.fullNm}\n${v.cat} · ${v.slotTxt}\n\n${v.desc}`;
    kbdPressable(tile, v.fullNm);

    const thumb = el('div', 'pt-thumb');
    thumb.append(img(partImg(p.name), 'parts', p.name));
    if (v.lv) thumb.append(el('span', 'pt-lv', 'LV' + v.lv));
    const hint = el('span', 'pt-hint');
    thumb.append(hint);
    tile.append(thumb);
    tile.append(el('div', 'pt-nm', v.shortNm));
    // 칸 소모 — 폰 세로의 가로줄 타일, 태블릿의 큰 카드에서만 보인다(그 밖에서는 CSS 로 숨김).
    // 목록에서 '원거리 3칸 남았는데 뭘 넣지'를 파츠마다 눌러 보지 않고 훑을 수 있게.
    tile.append(el('div', 'pt-slot', v.slotTxt));
    // 분류(방어·공격…) — 태블릿 큰 카드의 왼쪽 위. 그 밖에서는 CSS 로 숨긴다.
    tile.append(el('div', 'pt-cat', v.cat));
    const why = el('div', 'pt-why');
    tile.append(why);

    // 핸들러는 만들 때 한 번만 붙이고, 판정은 그때그때 최신 상태에서 읽는다.
    tile.onmouseenter = () => { showDetail(p); };
    tile.onclick = ev => {
      const fired = entryLp.get(tile);
      if (fired && fired()) return;              // 길게 눌러 메뉴를 연 것 — 장착까지 하지 않는다
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
    // 폰엔 우클릭도 hover 도 없어 '기본 제외'와 '장착 없이 상세만 보기'에 닿을 길이 없었다.
    // 길게 누르기(0.5초, 손가락이 10px 넘게 움직이면 취소)로 같은 것을 연다.
    let lpTimer = null, lpFired = false, lpXY = null;
    const lpCancel = () => { clearTimeout(lpTimer); lpTimer = null; };
    tile.addEventListener('touchstart', ev => {
      const t = ev.touches[0]; lpXY = [t.clientX, t.clientY]; lpFired = false;
      lpTimer = setTimeout(() => {
        lpFired = true;
        if (navigator.vibrate) navigator.vibrate(12);
        openTileMenu(p, v, lpXY);
      }, 500);
    }, { passive: true });
    tile.addEventListener('touchmove', ev => {
      if (!lpTimer) return;
      const t = ev.touches[0];
      if (Math.abs(t.clientX - lpXY[0]) > 10 || Math.abs(t.clientY - lpXY[1]) > 10) lpCancel();
    }, { passive: true });
    tile.addEventListener('touchend', lpCancel, { passive: true });
    tile.addEventListener('touchcancel', lpCancel, { passive: true });
    tile.dataset.lp = '1';
    entryLp.set(tile, () => lpFired);

    const entry = { tile, hint, why };
    tileCache.set(p, entry);
    return entry;
  }

  const entryLp = new WeakMap();     // 타일 → '방금 길게 눌렀는가' 판정
  /** 파츠 타일 길게 누르기 메뉴 — 데스크톱 우클릭과 같은 것을 폰에서 연다. */
  function openTileMenu(p, v, xy) {
    document.querySelectorAll('.png-menu').forEach(m => m.remove());
    const menu = el('div', 'png-menu tile-menu');
    const mk = (t, sub, fn) => {
      const b = el('button', 'png-menu-item');
      b.append(el('span', 'pm-t', t));
      if (sub) b.append(el('span', 'pm-s', sub));
      b.onclick = () => { menu.remove(); fn(); };
      return b;
    };
    menu.append(el('div', 'tile-menu-hd', v.fullNm));
    menu.append(mk('상세 보기', v.cat + ' · ' + v.slotTxt, () => {
      showDetail(p);
      const d = $('#detailPanel'); if (d) d.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }));
    const banned = state.banned.has(p.name);
    menu.append(mk(banned ? '기본 제외 해제' : '기본 제외',
      banned ? '목록·자동 구성에 다시 넣는다' : '자동 구성·장착에서 빼 둔다', () => toggleBan(p)));
    document.body.append(menu);
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    menu.style.left = Math.max(6, Math.min(xy[0] - mw / 2, window.innerWidth - mw - 8)) + 'px';
    menu.style.top = Math.max(safeTop() + 6, Math.min(xy[1] + 10, window.innerHeight - mh - 8)) + 'px';
    setTimeout(() => document.addEventListener('click', function h(e) {
      if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', h); }
    }), 0);
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
    fitBuildBand();
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
    // 본뜻은 「최대 3행」이 아니라 「정사각 타일 3행만큼의 높이까지」다.
    // 행 수로 끊으면 폰 세로의 가로줄 타일(행 높이 절반)이 6개밖에 안 보인다.
    // 기본 264px = 정사각 타일(82px) 3행 + 줄 간격.
    // 타일 모양이 다르면 CSS 에서 --row-budget 로 바꾼다(큰 카드는 더 준다).
    const ROW_BUDGET = parseFloat(cs.getPropertyValue('--row-budget')) || 264;
    for (const [top, bottom] of [...rowBottom].sort((a, b) => a[0] - b[0])) {
      if (bottom > ROW_BUDGET || bottom + padBottom > budget) { nextTop = top; break; }
      fit = bottom;
    }
    if (!fit) return;
    // 아래 여백이 줄 간격보다 넓으면 다음 줄 윗머리가 비어져 나오므로 그 앞에서 끊는다
    const h = nextTop == null ? fit + padBottom : Math.min(fit + padBottom, nextTop);
    box.style.height = h + 'px';
  }

  /* 태블릿 2단 배치(720~1080px · 높이 820px 이상)에서 두 단의 높이를 정한다.
     기체 헤더는 기체 이름 줄바꿈·확장 스킬 유무로 높이가 달라져 CSS 만으로는
     남은 높이를 못 적는다. 헤더 아래부터 화면 끝까지를 재어 CSS 변수로 넘긴다.
     (무장은 이 띠 아래에 그대로 흘러 스크롤 한 번이면 닿는다) */
  const TABLET_2COL = '(min-width: 720px) and (max-width: 1080px) and (min-height: 1000px)';
  /* 파츠 상세에 떼어 줄 높이. 내용은 파츠에 따라 282~419px 이라 244px 고정으로는
     163개 전부가 스크롤을 요구했다. 남은 높이의 절반 남짓을 주되,
     너무 좁거나(스탯이 안 보임) 너무 넓지(목록이 사라짐) 않게 가둔다.
       DETAIL_MIN  머리줄+그림+칸 수치까지는 보이는 최소
       DETAIL_MAX  가장 긴 파츠(419px)와 머리줄이 들어가는 높이 */
  const DETAIL_MIN = 300, DETAIL_MAX = 470, DETAIL_SHARE = 0.55;
  const PARTS_MIN = 150;        // 목록이 최소 한 줄은 남게
  function fitBuildBand() {
    const sb = $('#screenBuild');
    if (!sb) return;
    // jsdom(smoke.js)에는 matchMedia 가 없다 — 없으면 2단 배치도 없다고 본다
    if (!window.matchMedia || !window.matchMedia(TABLET_2COL).matches) {
      sb.style.removeProperty('--band-parts');
      sb.style.removeProperty('--band-stats');
      sb.style.removeProperty('--band-detail');
      return;
    }
    const left = document.querySelector('.build-left');
    if (!left || !left.offsetParent) return;                 // 숨어 있으면 잴 수 없다
    // 화면 좌표(getBoundingClientRect)로 재면 스크롤한 만큼 띠가 넓어진다 —
    // 회전 후 돌아왔을 때 9px 씩 어긋났다. 스크롤과 무관한 배치 값으로 잰다.
    //   쓸 수 있는 높이 = 칸 안쪽 높이 − 위아래 여백(8+8) − 기체 헤더 − 칸 간격(8)
    const avail = Math.round(sb.clientHeight - 8 - 8 - left.offsetHeight - 8);
    if (avail < 160) {                                        // 헤더가 화면을 다 먹었다 — 손대지 않는다
      sb.style.removeProperty('--band-parts');
      sb.style.removeProperty('--band-stats');
      sb.style.removeProperty('--band-detail');
      return;
    }
    const detail = Math.min(DETAIL_MAX, Math.max(DETAIL_MIN,
      Math.min(Math.round(avail * DETAIL_SHARE), avail - PARTS_MIN - 8)));
    sb.style.setProperty('--band-stats', avail + 'px');
    sb.style.setProperty('--band-detail', detail + 'px');
    sb.style.setProperty('--band-parts', Math.max(PARTS_MIN, avail - detail - 8) + 'px');
  }

  function renderBannedCount() {
    const n = state.banned.size;
    updateOwnedUi();   // 우클릭·초기화 등 어떤 경로로 바뀌어도 버튼 배지를 맞춘다
    const box = $('#bannedCount');
    box.innerHTML = '';
    if (!n) return;
    box.append(el('span', 'note', `기본 제외 ${n}개`));
    const btn = el('button', 'btn-ghost', '초기화');
    btn.style.padding = '1px 7px';
    btn.style.fontSize = '11px';
    btn.onclick = () => { state.banned.clear(); saveBanned(); renderAll(); };
    box.append(btn);
  }

