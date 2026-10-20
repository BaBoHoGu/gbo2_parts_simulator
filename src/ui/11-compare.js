  /* ui/11-compare.js — 구성 A/B 비교 · 기본 파츠 설정.
     tools/lib/uisrc.js 가 번호 순으로 이어 붙여 한 IIFE 로 감싼다(파일끼리 변수를 나눠 쓴다). */
  /* ---------- 빌드 A/B 비교 ---------- */
  // 저장한 구성(또는 현재 구성)의 스탯을 상태를 건드리지 않고 계산한다.
  function statsForBuild(bld) {
    if (!bld || !bld.ms) return null;
    const ms = msData.find(m => m.MS名 === bld.ms);
    if (!ms) return null;
    const stage = [0, 4, 6].includes(Number(bld.stage)) ? Number(bld.stage) : 6;
    const equipped = [];
    for (const n of (bld.parts || [])) {           // deserialize 와 같은 규칙으로 실제 장착분만
      const p = partByName.get(n);
      if (p && C.checkEquip(p, ms, equipped, C.calcSlots(ms, equipped, stage, fullst)).ok) equipped.push(p);
    }
    const expansion = C.EXPANSION_SKILLS.includes(bld.expansion) ? bld.expansion : C.EXPANSION_NONE;
    const expLevel = Number(bld.expLevel) || C.MAX_EXPANSION_LEVEL;
    const r = C.calcStats(ms, equipped, stage, expansion, partsByCat, fullst, expLevel, null, null);
    // wanted: 저장된 파츠 수. equipped 보다 많으면 슬롯 초과·규칙 위반으로 빠진 것이 있다는 뜻
    // (불러오기와 달리 비교는 조용히 빠지면 "저장이 반영 안 됐다"로 보이므로 헤더에 알린다)
    return { ms, equipped, stage, expansion, expLevel, r, wanted: (bld.parts || []).length };
  }

  /** 빌드의 무장별 1히트 위력(논차지·집속)·리로드. 파츠·사격/격투 보정·피해% 반영(자세·스킬 미반영). */
  function buildWeaponDamage(bs) {
    if (!bs) return [];
    const msLv = C.msLevel(bs.ms.MS名);
    const corr = { shooting: bs.r.total.shoot, melee: bs.r.total.meleeCorrection };
    const wm = D.weaponModsOf(C.partsAt(bs.equipped, state.lateMode), msLv, bs.ms.属性, bs.expansion);
    const out = [];
    for (const w of weaponsOfMs(bs.ms)) {
      if (w.type === 'shield') continue;
      const lvs = Object.keys(w.levels || {}).map(Number).sort((a, b) => a - b);
      const fit = lvs.filter(l => l <= msLv);
      const d = w.levels[String(fit.length ? fit[fit.length - 1] : (lvs[0] || ''))];
      if (!d) continue;
      const info = w.info || {};
      const kind = (w.attr === 'melee' || w.type === 'melee') ? 'melee' : 'shoot';
      // 무장 표·PNG 카드와 같은 함수를 쓴다. 자세·스킬은 '구성'이 아니라 그때의 화면 상태라
      // 여기선 넣지 않는다(그래서 pcts·etc 가 비어 있다) — 표 아래 라벨에 그렇게 밝힌다.
      const fin = base => weaponHitDamage(w, base, kind === 'melee' ? corr.melee : corr.shooting, wm, [], 0);
      const nc = fin(d.power);
      const ch = (d.powerCharged != null && d.powerCharged !== d.power) ? fin(d.powerCharged) : null;
      if (nc == null && ch == null) continue;
      // 조사·산탄·동시발사(연속 폭발 포함)는 1히트 값만으로는 세기를 못 잰다.
      // 무장 표와 같은 배수를 써서 '전탄' 값을 함께 낸다.
      const fm = fireMult(w);
      const nN = (fm.nc && fm.nc.n) || 1, nC = (fm.ch && fm.ch.n) || (fm.nc && fm.nc.n) || 1;
      const fxC = fixedDamageWithParts(w, bs.equipped);
      // 리로드 / OH복귀 — 파츠 단축 반영(초 단위)
      const secOf = (raw, key) => { const m = raw && String(raw).match(/([\d.]+)/); return m ? D.shortenTime(Number(m[1]), D.timeCutFor(wm, key, w)) : null; };
      const reloadRaw = wField(d, info, 'リロード時間'), ohRaw = wField(d, info, 'OH復帰時間', 'OH復帰速度');
      let reload = null, reloadKind = '';
      if (reloadRaw) { reload = secOf(reloadRaw, 'reloadTime'); reloadKind = '리로드'; }
      else if (ohRaw) { const ep = D.isEpackMag(w); reload = secOf(ohRaw, ep ? 'reloadTime' : 'weaponOH'); reloadKind = ep ? '리로드' : 'OH'; }
      out.push({ name: w.name, ko: T.weaponName(w.name), attr: weaponAttr(w), nc, ch, reload, reloadKind,
        ncAll: nc != null && nN > 1 ? nc * nN : null,        // 전탄
        chAll: ch != null && nC > 1 ? ch * nC : null,
        fx: fxC ? fxC.total : null });
    }
    return out;
  }

  let compareOpts = [];   // [{id, label, bld}]
  const compareOptions = () => {
    const opts = [];
    if (state.ms) opts.push({ id: '__current__', label: '● 현재 구성 — ' + T.msName(state.ms.MS名), bld: serialize() });
    for (const b of loadBuilds()) opts.push({ id: b.id, label: b.name + ' — ' + T.msName(b.ms), bld: b });
    return opts;
  };

  // 비교 칸에 올라간 구성 id 들. 2개가 기본, 4개까지 늘린다.
  // (파츠 한 장 차이를 두 개씩 짝지어 보는 것보다, 후보 3~4개를 한 화면에 놓는 편이 고르기 쉽다)
  let cmpIds = [];
  const CMP_MAX = 4;
  const CMP_TAG = ['A', 'B', 'C', 'D'];

  /** 구성 선택 줄 — 칸마다 select, 3번째부터는 빼기, 4칸 미만이면 더하기. */
  function renderComparePick() {
    const box = $('#comparePick'); if (!box) return;
    box.innerHTML = '';
    cmpIds.forEach((id, i) => {
      const lb = el('label', 'cmp-pick' + i);
      lb.append(el('span', 'cmp-tag t' + i, CMP_TAG[i]));
      const sel = el('select');
      for (const o of compareOpts) { const op = el('option', '', o.label); op.value = o.id; sel.append(op); }
      sel.value = id;
      sel.onchange = () => { cmpIds[i] = sel.value; renderCompare(); };
      lb.append(sel);
      if (i >= 2) {                       // A·B 는 항상 남긴다
        const x = el('button', 'cmp-drop', '×');
        x.title = '이 칸 빼기';
        x.onclick = () => { cmpIds.splice(i, 1); renderComparePick(); renderCompare(); };
        lb.append(x);
      }
      box.append(lb);
    });
    if (cmpIds.length < CMP_MAX && compareOpts.length) {
      const add = el('button', 'btn-ghost small cmp-add', '＋ 구성 추가');
      add.onclick = () => {
        const used = new Set(cmpIds);
        const next = compareOpts.find(o => !used.has(o.id)) || compareOpts[0];
        cmpIds.push(next.id); renderComparePick(); renderCompare();
      };
      box.append(add);
    }
  }

  function renderCompare() {
    const box = $('#compareBody'); if (!box) return;
    box.innerHTML = '';
    const bldOf = id => (compareOpts.find(o => o.id === id) || {}).bld;
    const cols = cmpIds.map(id => statsForBuild(bldOf(id))).filter(Boolean);
    if (cols.length < 2) {
      // 4칸까지 폈다가 구성이 사라진 경우 — 넓힘·Δ 없음 표시를 되돌리지 않으면 그대로 남는다
      box.classList.remove('no-delta');
      const m0 = $('#compareModal'); if (m0) m0.classList.remove('wide');
      box.append(el('div', 'cmp-empty', '비교할 두 구성을 선택하세요.'));
      return;
    }

    // 칸이 3개 이상이면 Δ 열은 뜻이 흐려진다(무엇에서 뺀 값인지가 모호). 대신 행마다 최고값을 표시한다.
    const n = cols.length, showDelta = n === 2;
    box.classList.toggle('no-delta', !showDelta);
    box.style.setProperty('--cmp-n', n);
    // 2칸은 예전처럼 폭에 맞춰 줄어든다. 3칸부터만 최소 너비를 걸어 표 안에서 가로로 스크롤시킨다
    // (2칸에도 최소 너비를 걸면 폰에서 멀쩡하던 화면이 공연히 옆으로 밀린다)
    box.style.setProperty('--cmp-min', showDelta ? '0px' : (130 + n * 96) + 'px');
    const modal = $('#compareModal');
    if (modal) modal.classList.toggle('wide', n > 2);

    // 헤더 — 각 빌드의 기체·코스트·강화·확장
    const idcell = (s, cls) => {
      const c = el('div', 'cmp-id ' + cls);
      c.append(el('b', '', T.msName(s.ms.MS名)));
      const dropped = s.wanted - s.equipped.length;
      const sub = el('span', 'cmp-sub', `${T.attrName(s.ms.属性)} · 코스트 ${s.ms.コスト} · ${STAGE_LABEL[s.stage]}`
        + (s.expansion !== C.EXPANSION_NONE ? ' · ' + expShort(s.expansion) + ' LV' + s.expLevel : '')
        + ` · 파츠 ${s.equipped.length}` + (dropped > 0 ? `/${s.wanted}` : ''));
      c.append(sub);
      if (dropped > 0) {
        const w = el('span', 'cmp-warn', `⚠ ${dropped}개 제외됨 (슬롯 초과·중복 등)`);
        w.title = '저장된 파츠 중 이 기체·강화 단계에서 장착 규칙을 통과하지 못한 파츠가 있습니다.';
        c.append(w);
      }
      return c;
    };
    const head = el('div', 'cmp-head');
    head.append(el('span', 'cmp-lb', ''));
    cols.forEach((s, i) => head.append(idcell(s, 'c' + i)));
    if (showDelta) head.append(el('span', 'cmp-d', 'Δ(B−A)'));
    box.append(head);

    const table = el('div', 'cmp-table');
    // vals: 칸 수만큼의 값 배열. opt.fmt: 값 포맷, opt.lowerBetter: 낮을수록 개선(리로드 등)
    const mkRow = (label, vals, opt = {}) => {
      const fmt = opt.fmt || (v => v.toLocaleString());
      const row = el('div', 'cmp-row' + (opt.cls ? ' ' + opt.cls : ''));
      row.append(el('span', 'cmp-lb', label));
      // 최고값 표시 — Δ 열이 없는 3~4칸에서 어느 구성이 앞서는지 눈으로 잡아 준다
      const nums = vals.filter(v => v != null);
      const best = !showDelta && nums.length > 1
        ? (opt.lowerBetter ? Math.min(...nums) : Math.max(...nums)) : null;
      const tie = best != null && nums.every(v => v === best);
      vals.forEach(v => row.append(el('span',
        'cmp-v' + (!tie && best != null && v === best ? ' best' : ''),
        v == null ? '—' : fmt(v))));
      if (showDelta) {
        const [av, bv] = vals;
        const d = (av != null && bv != null) ? Math.round((bv - av) * 100) / 100 : null;
        const good = d == null ? 0 : (opt.lowerBetter ? -d : d);
        row.append(el('span', 'cmp-d' + (good > 0 ? ' up' : good < 0 ? ' down' : ''),
          d == null ? '' : d === 0 ? '·' : (d > 0 ? '+' : '') + fmt(d)));
      }
      table.append(row);
    };
    const each = fn => cols.map(fn);
    for (const k of C.STAT_KEYS) mkRow(C.STAT_LABEL[k], each(s => s.r.total[k]));

    // 공격 지표 (실효 보정 = 보정에 피해% 접음)
    table.append(el('div', 'cmp-sec', '공격 지표 (실효 보정)'));
    const effCorr = (s, key) => {
      const corr = key === 'shoot' ? s.r.total.shoot : s.r.total.meleeCorrection;
      const pct = partAttackBonus(s.equipped, C.msLevel(s.ms.MS名))[key];   // 빌드엔 스킬 없음 → 파츠만
      return Math.round(((1 + corr / 100) * (1 + pct / 100) - 1) * 100);
    };
    mkRow('사격', each(s => effCorr(s, 'shoot')));
    mkRow('격투', each(s => effCorr(s, 'melee')));

    // 내구 지표 — 성능표와 같은 계산: 실효 HP 에 파츠 피해경감(신형완충재·오버튠 등)까지 접는다.
    // (이걸 빼면 피해경감 파츠를 넣은 구성이 안 넣은 구성과 같은 값으로 나온다)
    // 저장 구성엔 방어 스킬 체크 UI 가 없다 → 파츠 경감만 센다(skillMs 를 안 넘긴다)
    const cutsOf = s => damageCutsOf(s.equipped, { lv: C.msLevel(s.ms.MS名) });
    table.append(el('div', 'cmp-sec', '내구 지표 (실효 HP · 파츠 피해경감 반영)'));
    for (const [dattr, lb] of DURA_ATTRS) {
      const pcts = each(s => cutPctOf(cutsOf(s), dattr));
      const tag = pcts.some(c => c) ? ` (피해 ${pcts.map(c => '-' + c + '%').join(' / ')})` : '';
      mkRow(lb + tag, each(s => enduranceOf(s.r.total, dattr, cutsOf(s))));
    }

    // 무장 (파츠·보정 반영). 이름으로 맞춰 논차지·집속·리로드/OH 비교(다른 기체면 대부분 —).
    const wl = cols.map(buildWeaponDamage);
    if (wl.some(x => x.length)) {
      // 자세·스킬은 '구성'이 아니라 화면 상태라 비교에서는 빼고 잰다 — 무장 표와 값이 달라지므로 밝힌다
      table.append(el('div', 'cmp-sec', '무장 위력 (파츠 반영 · 자세·스킬 제외 · 전탄·고정 피해 포함)'));
      const maps = wl.map(x => new Map(x.map(y => [y.name, y])));
      const names = [];
      for (const list of wl) for (const x of list) if (!names.includes(x.name)) names.push(x.name);
      const sec = v => v == null ? '—' : v + '초';
      const pick = (nm, f) => maps.map(m => { const x = m.get(nm); return x ? f(x) : null; });
      const any = vals => vals.some(v => v != null);
      for (const nm of names) {
        const w = maps.map(m => m.get(nm)).find(Boolean);
        mkRow(w.ko, pick(nm, x => x.nc), { cls: 'cmp-wstart' });        // 논차지 (무장 시작)
        for (const [lb, f] of [['└ 전탄', x => x.ncAll], ['└ 집속', x => x.ch],
          ['└ 집속 전탄', x => x.chAll], ['└ 고정 피해', x => x.fx]]) {
          const vals = pick(nm, f);
          if (any(vals)) mkRow(lb, vals, { cls: 'cmp-wsub' });
        }
        const rl = pick(nm, x => x.reload);
        if (any(rl)) {
          const kind = maps.map(m => m.get(nm)).find(x => x && x.reloadKind);
          mkRow('└ ' + ((kind && kind.reloadKind) || '리로드'), rl,
            { fmt: sec, lowerBetter: true, cls: 'cmp-wsub' });
        }
      }
    }
    box.append(table);
  }

  function openCompareModal(open) {
    const m = $('#compareModal'), b = $('#compareModalBack');
    setModal(m, b, open);
    if (!open) return;
    compareOpts = compareOptions();
    const ids = new Set(compareOpts.map(o => o.id));
    cmpIds = cmpIds.filter(id => ids.has(id));          // 지워진 구성이 남아 있지 않도록
    while (cmpIds.length < 2 && compareOpts.length) {
      const used = new Set(cmpIds);
      const next = compareOpts.find(o => !used.has(o.id)) || compareOpts[0];
      cmpIds.push(next.id);
    }
    renderComparePick();
    renderCompare();
  }

  /* ---------- 기본 파츠 설정 (기본 제외 파츠 관리) ---------- */
  const PART_CAT_KO = { '防御': '방어', '攻撃': '공격', '移動': '이동', '補助': '보조', '特殊': '특수' };

  function updateOwnedUi() {
    const n = state.banned.size;
    const note = $('#ownedNote');
    if (note) note.textContent = n ? `기본 제외 ${n}개` : '제외한 파츠 없음';
    const btn = $('#ownedBtn');
    if (btn) btn.textContent = '기본 파츠 설정' + (n ? ` (${n})` : '');
  }

  /** 기본 제외 체크 토글 — 제외로 바꾸면 장착·잠금에서도 즉시 뺀다. */
  function toggleExcluded(name, on) {
    if (on) {
      state.banned.add(name);
      state.equipped = state.equipped.filter(e => e.name !== name);
      state.locked.delete(name);
    } else {
      state.banned.delete(name);
    }
    saveBanned();
    updateOwnedUi();
  }

  function renderOwnedList() {
    const box = $('#ownedList');
    if (!box) return;
    const q = ($('#ownedQuery').value || '').trim().toLowerCase();
    box.innerHTML = '';
    for (const cat of C.CATEGORIES) {
      let list = partsByCat[cat] || [];
      if (q) list = list.filter(p => matches(partSearchText.get(p), q));
      if (!list.length) continue;
      box.append(el('div', 'owned-cat', PART_CAT_KO[cat] || cat));
      const grid = el('div', 'owned-tiles');
      for (const p of list) grid.append(ownedTile(p));
      box.append(grid);
    }
    if (!box.children.length) box.append(el('div', 'empty-state', '검색 결과가 없습니다.'));
  }

  /** 기본 파츠 설정용 파츠 타일 — 파츠 적용 화면과 같은 모양. 클릭으로 제외 토글. */
  function ownedTile(p) {
    const v = partView(p);
    const off = state.banned.has(p.name);
    const tile = el('div', 'part-tile owned-tile' + (off ? ' banned' : ''));
    tile.title = `${v.fullNm}\n${v.cat} · ${v.slotTxt}\n\n${v.desc}`;
    const thumb = el('div', 'pt-thumb');
    thumb.append(img(partImg(p.name), 'parts', p.name));
    if (v.lv) thumb.append(el('span', 'pt-lv', 'LV' + v.lv));
    tile.append(thumb);
    tile.append(el('div', 'pt-nm', v.shortNm));
    const mark = el('div', 'owned-mark', off ? '제외됨' : '');
    tile.append(mark);
    tile.onclick = () => {
      const now = !state.banned.has(p.name);
      toggleExcluded(p.name, now);            // 세트 갱신·장착해제·저장·배지
      tile.classList.toggle('banned', now);
      mark.textContent = now ? '제외됨' : '';
    };
    return tile;
  }

  function openOwnedModal(open) {
    const m = $('#ownedModal'), b = $('#ownedModalBack');
    setModal(m, b, open);
    if (open) { $('#ownedQuery').value = ''; renderOwnedList(); updateOwnedUi(); }
    else renderAll();   // 닫을 때 빌드 화면(회색·자동구성 후보)에 반영
  }

