  /* ui/02-equip.js — 파츠 장착 · 파츠 상세 미리보기.
     tools/lib/uisrc.js 가 번호 순으로 이어 붙여 한 IIFE 로 감싼다(파일끼리 변수를 나눠 쓴다). */
  /* ---------- 장착 ---------- */

  function equip(part) {
    // 기본 제외한 파츠는 자동 구성뿐 아니라 직접 장착도 막는다 (우클릭으로 해제)
    if (state.banned.has(part.name)) {
      toast('기본 제외한 파츠입니다 — 우클릭(폰은 길게 누르기)으로 해제하세요');
      return;
    }
    const chk = C.checkEquip(part, state.ms, state.equipped, slots());
    if (!chk.ok) { toast(reasonText(chk) + ' — 장착할 수 없습니다'); return; }
    const snap = snapshotEquip();
    state.equipped.push(part);
    renderAll();
    undoToast(T.partName(part.name) + ' 장착', snap);
  }

  /** 기본 제외 토글 (영구). 이미 장착 중인 파츠를 제외하면 함께 해제해 상태를 어긋나지 않게 한다. */
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
    saveBanned();
    renderAll();
  }

  function unequip(name) {
    const snap = snapshotEquip();
    state.equipped = state.equipped.filter(p => p.name !== name);
    state.locked.delete(name);
    renderAll();
    undoToast(T.partName(name) + ' 해제', snap);
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
      tile.onmouseenter = () => { showDetail(p); };

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

  /** 상세 패널에 파츠를 띄우고 슬롯 미리보기도 함께 갱신한다.
   *  (상세만 바꾸고 슬롯을 안 그리면 미리보기가 한 박자 늦는다) */
  function showDetail(p) { state.detailPart = p; renderDetail(p); renderSlots(); }

  function renderSlots() {
    const s = slots();
    // 지금 보고 있는 파츠를 끼우면 칸이 얼마나 차는지 미리 보여 준다.
    // 이미 장착한 파츠는 뺀다 — 끼울 것이 없으니 보여 줄 것도 없다.
    // 못 끼우는 파츠도 그대로 보여 준다: 몇 칸 모자라서 안 되는지가 그 자체로 답이다.
    const pv = state.detailPart && !state.equipped.some(e => e.name === state.detailPart.name)
      ? state.detailPart : null;
    const box = $('#slotBars');
    box.innerHTML = '';
    const defs = [
      ['close', '근접', s.close, s.maxClose],
      ['mid', '중거리', s.mid, s.maxMid],
      ['long', '원거리', s.long, s.maxLong]
    ];

    for (const [key, label, used, max] of defs) {
      const cost = pv ? Number(pv[key] || 0) : 0;
      const over = used + cost > max;
      const bar = el('div', 'slot-bar ' + key + (used >= max && max > 0 ? ' full' : ''));
      const top = el('div', 'top');
      top.append(el('span', 'k', label));
      const v = el('span', 'v', `${used} / ${max}`);
      if (cost > 0) v.append(el('span', 'add' + (over ? ' over' : ''), ' +' + cost));
      top.append(v);
      bar.append(top);

      // 칸 수가 많으면 눈에 안 들어오므로 최대 20칸으로 압축해 보여준다.
      const track = el('div', 'track');
      const cells = Math.min(Math.max(max, used, 1), 20);
      const scale = cells / Math.max(max, used, 1);
      const filled = Math.round(used * scale);
      // 미리보기는 채워진 칸 뒤에 이어 붙인다. 칸 수(scale)는 바꾸지 않는다 —
      // 마우스를 올릴 때마다 막대 눈금이 달라지면 오히려 읽기 어렵다.
      const preEnd = Math.min(cells, Math.round((used + cost) * scale));
      for (let i = 0; i < cells; i++) {
        const cell = el('i');
        if (i < filled) cell.className = used > max ? 'over' : 'on';
        else if (i < preEnd) cell.className = 'pre' + (over ? ' over' : '');
        track.append(cell);
      }
      bar.append(track);
      box.append(bar);
    }
  }

  /* ---------- 파츠 상세 미리보기 ---------- */

  function renderDetail(part) {
    const box = $('#detailBody');
    const panel = $('#detailPanel');
    box.innerHTML = '';
    // 비어 있는 동안은 폰에서 200px 넘는 빈 칸이라 파츠 목록을 그만큼 아래로 민다.
    if (panel) panel.classList.toggle('is-empty', !part);
    if (!part) {
      const e = el('div', 'detail-empty');
      e.innerHTML = '파츠를 길게 눌러(PC 는 마우스를 올려)<br>상세 정보를 볼 수 있습니다';
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

    /* 번역문 끝에 「※ 위키: …」 로 덧붙여 둔 메모가 16칸 있다. 게임 안 설명이 아니라
       **우리가 조사해 적어 둔 배경**이다(상한이 50→70 이 된다, 경감량은 위키에도 없다 …).
       한 덩어리로 보여 주면 게임이 그렇게 적어 둔 것처럼 읽힌다 — 갈라서 따로 적는다.
       검색·툴팁은 통짜 그대로 둔다(메모에 든 말로도 찾을 수 있어야 한다). */
    const wikiCut = desc.search(/※\s*위키/);
    const descMain = wikiCut < 0 ? desc : desc.slice(0, wikiCut).trim();
    const descNote = wikiCut < 0 ? '' : desc.slice(wikiCut).replace(/^※\s*위키\s*[—:：-]?\s*/, '').trim();

    /* 메모를 **상자 밖에 따로** 두면 안 된다. 특성 상자는 높이를 못 박아 두었는데
       (.d-eff-tx height:114px — 아래 CSS 주석 참고), 메모 상자는 16 파츠에만 생기므로
       상세 칸이 97px 씩 늘었다 줄었다 한다. 그러면 아래 파츠 목록이 그만큼 밀리고,
       밀린 목록 때문에 커서 밑의 파츠가 바뀌어 또 바뀐다 — 예전에 잡았던 떨림이
       그대로 되살아났다(사용자 지적, 실측 581 ↔ 484 · 목록 697 ↔ 600).
       그래서 **같은 상자 안**에 넣는다. 상자 수와 높이가 늘 같아 고리가 생기지 않고,
       길면 예전처럼 상자 안에서 굴러간다. */
    if (descMain) {
      const eff = el('div', 'd-eff');
      eff.append(el('div', 'd-eff-lb', '특성'));
      const tx = el('div', 'd-eff-tx');
      tx.append(withNumbers(descMain));
      if (descNote) {
        const note = el('div', 'd-wiki');
        note.append(el('div', 'd-wiki-lb', '위키 메모'));
        const nt = el('div', 'd-wiki-tx');
        nt.append(withNumbers(descNote));
        note.append(nt);
        tx.append(note);
      }
      eff.append(tx);
      box.append(eff);
    }

    // 계산에 안 들어가는 효과가 있으면 밝힌다. 설명만 보고 슬롯을 쓰는 일이 없게.
    const un = unmodelledOf(part);
    if (un.length) {
      const w = el('div', 'd-unmod');
      w.append(el('b', '', '계산에 반영되지 않는 효과'));
      for (const x of un) {
        const row = el('div', 'd-unmod-row');
        row.append(el('span', 'd-unmod-k', x.ko));
        row.append(el('span', 'd-unmod-why', x.why));
        w.append(row);
      }
      box.append(w);
    }
  }

