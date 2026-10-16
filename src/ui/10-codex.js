  /* ui/10-codex.js — 스킬 도감 · 「계산 안 함」 모아 보기 · 강화 리스트 · 확장 스킬 설명.
     tools/lib/uisrc.js 가 번호 순으로 이어 붙여 한 IIFE 로 감싼다(파일끼리 변수를 나눠 쓴다). */
  /* ---------- 스킬 도감 ---------- */
  // 기체와 상관없이 스킬을 위키 분류대로 모아 본다.
  // 데이터는 이미 앱에 있는 ms_skills 를 그대로 쓴다 — 용량이 늘지 않는다.
  // 좌: 스킬 목록 · 우: 고른 스킬의 LV 별 효과와 보유 기체.
  let codexIndex = null, codexCat = '전체', codexQ = '';
  let codexView = 'skill';        // 'skill' | 'unmod' — 스킬 목록인가 「계산 안 함」 모아 보기인가
  let codexSel = null;                                   // 고른 스킬 이름(원문)
  let codexMsQ = '', codexMsAttr = 'all', codexMsCost = 'all', codexMsLv = 'all', codexMsLimit = 60;

  // 기체 목록은 이미 만들어 둔 msByBase 를 쓴다(LV 오름차순 정렬돼 있다).
  // 코스트가 기체 LV 마다 다르다 — 592기 중 495기가 그렇다. 그래서 범위로 다룬다.

  function buildCodexIndex() {
    if (codexIndex) return codexIndex;
    const byName = new Map();
    for (const [msName, modes] of Object.entries(msSkillsData)) {
      for (const md of modes || []) for (const sk of md.skills || []) {
        if (!sk.name) continue;
        let e = byName.get(sk.name);
        if (!e) { e = { name: sk.name, cat: sk.cat || 'その他', lvs: new Map(), ms: new Map() }; byName.set(sk.name, e); }
        // 분류가 빈 항목이 섞여 있다 — 한 번이라도 분류가 있으면 그것을 쓴다
        if (sk.cat && (!e.cat || e.cat === 'その他')) e.cat = sk.cat;
        const lv = sk.lv || '';
        if (!e.lvs.has(lv)) e.lvs.set(lv, { lv, eff: sk.eff || '', desc: sk.desc || '' });
        // 기체별로 가진 스킬 LV 를 모은다 — 같은 기체가 기체 LV 에 따라 여러 단계를 갖는다
        if (!e.ms.has(msName)) e.ms.set(msName, new Set());
        if (lv) e.ms.get(msName).add(lv);
      }
    }
    const lvNum = v => { const m = /(\d+)/.exec(v); return m ? +m[1] : 0; };
    codexIndex = [...byName.values()].map(e => ({
      ...e,
      ko: skTr(e.name),
      lvList: [...e.lvs.values()].sort((x, y) => lvNum(x.lv) - lvNum(y.lv)),
      msCount: e.ms.size,
    })).sort((x, y) => y.msCount - x.msCount);
    return codexIndex;
  }

  /* ---------- 「계산 안 함」 모아 보기 ----------
   * 앱이 **알고는 있는데 숫자에 넣지 않은** 것들을 한곳에 모은다.
   * 여태 기체·파츠를 하나씩 열어야만 보여서, 무엇이 비어 있는지 전체를 볼 수 없었다.
   * 쓰는 사람에게는 「이 앱이 뭘 모르는지」가 한눈에 보이고,
   * 고치는 쪽에는 그대로 다음 할 일 목록이 된다. */
  const UNMOD_GROUP = [
    [/값이 없습니다|수치가 적혀 있지 않습니다/, '값이 원문에 없음'],
    [/한 번\*\*에 드는 몫|고속이동 지속에는 넣지 않습니다/, '다른 축의 값'],
    [/느려지는|늘어나는/, '방향이 반대'],
    [/어느 것인지 알 수 없습니다|값이 달라져/, '값이 여럿'],
    [/붙습니다|조건이 겹쳐|못 정해/, '조건을 못 가림'],
    [/부위|상태이상/, '안 만드는 영역']
  ];
  const unmodGroupOf = why => {
    for (const [re, g] of UNMOD_GROUP) if (re.test(why)) return g;
    return '그 밖';
  };

  /** 「왜 안 넣는가」와 별개로 **고칠 수 있는가**를 가른다.
   *  둘은 다른 축이다 — 「값이 원문에 없음」과 「방향이 반대」는 왜는 다르지만 둘 다 못 고치고,
   *  「조건을 못 가림」 안에서도 스러스터 쪽은 고칠 수 있고 무장 쪽은 자료가 있어야 한다.
   *  순서가 뜻을 가진다: 「소비가 늘어난다고만 적혀 있고 값이 없습니다」는 **값이 없어서**
   *  못 넣는 것이지 방향 때문이 아니므로, 값 없음을 먼저 본다. */
  const UNMOD_FIX = [
    // 값은 원문에 있다. 앱이 「그 스킬이 지금 켜져 있나」를 가릴 수 있게 되면 그대로 들어간다.
    [/발동 중에만 붙습니다|실드 매수에 따라/, '고칠 수 있음'],
    // 원문이 「줄어든다」고만 적고 수를 안 적었다 — 2차 자료가 나오기 전에는 지어낼 수 없다.
    [/값이 없습니다|수치가 적혀 있지 않습니다|어느 무장에 걸리는지/, '값이 나와야 함'],
    // 넣으면 오히려 실제와 어긋난다 — 다른 축의 값·벌점·이 앱이 안 만드는 영역.
    [/한 번에 드는 몫|고속이동 지속에는|벌점이라|늘어나는 값이라|부위|상태이상/, '일부러 안 넣음']
  ];
  /** 이유 글에는 **강조**가 박혀 있어 낱말이 끊긴다 — 「소비가 **늘어나는** 값이라」.
   *  강조를 떼고 맞춘다. 처음엔 안 떼서 세 종(인터럽트 가드·슬러스터 바인더·활성 퍼지)이
   *  말없이 「그 밖」으로 떨어졌고, 화면에는 갈래가 하나 더 붙어 보였다. */
  const unmodFixOf = why => {
    const t = String(why).replace(/\*\*/g, '');
    for (const [re, g] of UNMOD_FIX) if (re.test(t)) return g;
    return '그 밖';           // 새 문구가 들어오면 여기로 떨어져 눈에 띈다 (검사가 0을 지킨다)
  };
  const UNMOD_FIX_NOTE = {
    '고칠 수 있음': '값은 원문에 있습니다. 앱이 조건을 가릴 수 있게 되면 그대로 들어갑니다.',
    '값이 나와야 함': '원문이 「줄어든다」고만 적고 수치를 안 적었습니다. 지어내지 않습니다.',
    '일부러 안 넣음': '넣으면 오히려 실제와 어긋납니다 — 다른 축의 값·벌점·안 만드는 영역.',
    '그 밖': '아직 갈래를 못 정한 것입니다.'
  };
  const UNMOD_FIX_ORDER = ['고칠 수 있음', '값이 나와야 함', '일부러 안 넣음', '그 밖'];

  /** 원문을 한글로 — 사전은 문장 전체가 열쇠다. 못 찾으면 그 문장은 빼고 찾은 것만 보여 준다
   *  (일본어를 그대로 내보이느니 적게 보여 주는 쪽이 낫다). */
  const unmodSrcKo = src => {
    if (!src) return '';
    /* 사전을 직접 읽으면 안 된다 — skTr 을 거쳐야 문장부호가 반각으로 맞는다.
       직접 읽던 동안 이 칸만 「・고속 이동 ＋20」으로 나왔다(다른 칸은 「· 고속 이동 +20」).
       없는 문장은 빼고 찾은 것만 보여 준다 — 일본어를 그대로 내보이느니 적게 보여 주는 쪽이 낫다. */
    return [src.eff, src.desc].map(t => (t && skillText[t] ? skTr(t) : '')).filter(Boolean).join(' / ');
  };

  let unmodIndex = null;
  /** 전 기체·전 파츠를 한 번 훑어 모은다. 무거우니 한 번만 만들고 들고 있는다. */
  function buildUnmodIndex() {
    if (unmodIndex) return unmodIndex;
    const map = new Map();
    const add = (kind, ko, lv, why, owner, seg) => {
      const k = kind + '|' + ko + '|' + (lv || '') + '|' + why;
      if (!map.has(k)) map.set(k, { kind, ko, lv: lv || '', why, seg: seg || '', owners: new Set(),
        group: unmodGroupOf(why), fix: unmodFixOf(why) });
      if (owner) map.get(k).owners.add(owner);
    };
    for (const ms of msData) {
      const lv = msLevel(ms), nm = T.msName(baseName(ms.MS名));
      for (const form of ['normal', 'transform'])
        for (const u of thrusterUnmodelled(ms, lv, form))
          add('스러스터', u.ko, u.lv, u.why, nm, unmodSrcKo(u.src) || u.seg);
      // 적 내성을 깎는데 **어느 무장에 걸리는지** 못 정한 스킬도 같은 성격이다
      for (const sk of (skillData[baseName(ms.MS名)] || [])) {
        const f = foeArmorOf(sk.name, ms, 'normal');
        if (f && !f.scope) add('스킬', sk.nameKo || skTr(sk.name), '', f.txt.replace(/^적 [^—]*— /, ''), nm, f.txt);
      }
    }
    for (const p of allParts)
      for (const u of unmodelledOf(p)) add('파츠', u.ko, '', u.why, T.partName(p.name), '');
    unmodIndex = [...map.values()]
      .map(x => ({ ...x, owners: [...x.owners].sort(), n: x.owners.size }))
      .sort((a, b) => b.n - a.n);
    return unmodIndex;
  }

  function unmodFiltered() {
    const q = codexQ.trim().toLowerCase();
    return buildUnmodIndex().filter(e => {
      if (codexCat !== '전체' && e.fix !== codexCat) return false;
      if (!q) return true;
      return (e.ko + ' ' + e.why + ' ' + e.kind + ' ' + e.group + ' ' + e.owners.join(' ')).toLowerCase().includes(q);
    });
  }

  function codexFiltered() {
    const q = codexQ.trim().toLowerCase();
    return buildCodexIndex().filter(e => {
      if (codexCat !== '전체' && (SKILL_CAT_KO[e.cat] || '기타') !== codexCat) return false;
      if (!q) return true;
      if (e.ko.toLowerCase().includes(q) || e.name.toLowerCase().includes(q)) return true;
      return e.lvList.some(v => skTr(v.eff).toLowerCase().includes(q));
    });
  }

  function renderCodexList() {
    if (codexView === 'unmod') return renderUnmodList();
    const box = $('#codexList'); if (!box) return;
    const hit = codexFiltered();
    $('#codexNote').textContent = '스킬 ' + buildCodexIndex().length + '종 · 보이는 것 ' + hit.length;
    box.innerHTML = '';
    if (!hit.length) { box.append(el('div', 'codex-empty', '찾는 스킬이 없습니다.')); return; }
    const order = ['足回り', '攻撃', '防御', '移動', '格闘', '射撃', 'その他', ''];
    const groups = new Map();
    for (const e of hit) { const k = e.cat || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
    for (const k of [...groups.keys()].sort((x, y) => order.indexOf(x) - order.indexOf(y))) {
      if (codexCat === '전체') {
        const h = el('div', 'codex-cat', SKILL_CAT_KO[k] || '기타');
        h.append(el('span', '', groups.get(k).length + '종'));
        box.append(h);
      }
      for (const e of groups.get(k)) {
        const it = el('div', 'codex-item' + (codexSel === e.name ? ' on' : ''));
        it.append(el('div', 'codex-nm', e.ko));
        const lvs = el('div', 'codex-lvs');
        for (const v of e.lvList) if (v.lv) lvs.append(el('span', 'codex-lv', v.lv));
        it.append(lvs);
        it.append(el('div', 'codex-cnt', e.msCount + '기'));
        it.onclick = () => selectCodex(e.name);
        box.append(it);
      }
    }
  }

  function renderUnmodList() {
    const box = $('#codexList'); if (!box) return;
    const all = buildUnmodIndex(), hit = unmodFiltered();
    const mechs = new Set();
    for (const e of all) if (e.kind !== '파츠') for (const o of e.owners) mechs.add(o);
    // 갈래별 수는 바로 아래 칩이 보여 준다 — 여기에 겹쳐 적으면 폰에서 머리줄이 찌그러진다
    $('#codexNote').textContent = '계산에 안 넣는 효과 ' + all.length + '종 · 보이는 것 ' + hit.length
      + ' · 하나 이상 걸린 기체 ' + mechs.size + '기';
    box.innerHTML = '';
    if (!hit.length) { box.append(el('div', 'codex-empty', '찾는 것이 없습니다.')); return; }
    const groups = new Map();
    for (const e of hit) { if (!groups.has(e.fix)) groups.set(e.fix, []); groups.get(e.fix).push(e); }
    for (const g of [...groups.keys()].sort((x, y) => UNMOD_FIX_ORDER.indexOf(x) - UNMOD_FIX_ORDER.indexOf(y))) {
      if (codexCat === '전체') {
        const h = el('div', 'codex-cat', g);
        h.append(el('span', '', groups.get(g).length + '종'));
        box.append(h);
        box.append(el('div', 'unmod-fixnote', UNMOD_FIX_NOTE[g] || ''));
      }
      for (const e of groups.get(g)) {
        const key = e.kind + '|' + e.ko + '|' + e.lv + '|' + e.why;
        /* 스킬 목록과 달리 두 줄짜리다 — 이름만으로는 어느 줄이 어느 것인지 알 수 없어서다.
           이름은 말줄임으로 두고 꼬리표는 안 줄인다(줄면 무슨 갈래인지 못 읽는다). */
        const it = el('div', 'codex-item unmod-item' + (codexSel === key ? ' on' : ''));
        const nm = el('div', 'codex-nm unmod-nm');
        nm.append(el('span', 'unmod-name', e.ko));
        nm.append(el('span', 'unmod-kind', e.kind));
        nm.append(el('span', 'unmod-grp', e.group));   // 「왜」는 꼬리표로 — 가르는 축은 위로 올렸다
        it.append(nm);
        const lvs = el('div', 'codex-lvs');
        if (e.lv) lvs.append(el('span', 'codex-lv', e.lv));
        it.append(lvs);
        /* 같은 스킬이 조건만 달라 여러 줄로 나온다(플랩 부스터 LV1 이 열두 줄).
           이름만 적으면 전부 같은 줄로 보이므로, 가르는 대목을 한 줄 붙인다. */
        const short = e.why.replace(/\*\*/g, '').replace(/ — .*$/, '').replace(/합니다\.?$/, '');
        it.append(el('div', 'unmod-line', short));
        it.append(el('div', 'codex-cnt', e.n + (e.kind === '파츠' ? '종' : '기')));
        it.onclick = () => { codexSel = key; $('#codex2col').classList.add('sel'); renderCodexList(); renderCodexPane(); };
        box.append(it);
      }
    }
  }

  function renderUnmodPane() {
    const pane = $('#codexPane'); if (!pane) return;
    pane.innerHTML = '';
    const e = buildUnmodIndex().find(x => (x.kind + '|' + x.ko + '|' + x.lv + '|' + x.why) === codexSel);
    if (!e) { pane.append(el('div', 'codex-empty', '왼쪽에서 하나를 고르세요.')); return; }
    const back = el('button', 'btn-ghost small codex-paneback', '‹ 목록');
    back.onclick = () => { codexSel = null; $('#codex2col').classList.remove('sel'); renderCodexList(); renderCodexPane(); };
    pane.append(back);
    const ttl = el('div', 'codex-ttl');
    ttl.append(el('b', '', e.ko + (e.lv ? ' ' + e.lv : '')));
    ttl.append(el('span', 'unmod-kind', e.kind));
    ttl.append(el('span', 'unmod-grp', e.group));
    pane.append(ttl);
    // 고칠 수 있는가 — 먼저 알고 싶은 것이 이것이다
    const fix = el('div', 'unmod-fix f-' + UNMOD_FIX_ORDER.indexOf(e.fix));
    fix.append(el('b', '', e.fix));
    fix.append(el('div', '', UNMOD_FIX_NOTE[e.fix] || ''));
    pane.append(fix);
    // 왜 안 넣는지 — 이 줄이 이 화면의 본체다
    const why = el('div', 'unmod-why');
    why.append(el('b', '', '계산에 안 넣는 이유'));
    why.append(el('div', '', e.why.replace(/\*\*/g, '')));
    pane.append(why);
    if (e.seg) {
      const src = el('div', 'unmod-src');
      src.append(el('b', '', '원문'));
      src.append(el('div', '', e.seg.slice(0, 300)));
      pane.append(src);
    }
    const lb = el('div', 'codex-sub', (e.kind === '파츠' ? '해당 파츠 ' : '가진 기체 ') + e.n);
    pane.append(lb);
    const wrap = el('div', 'unmod-owners');
    for (const o of e.owners) wrap.append(el('span', 'unmod-owner', o));
    pane.append(wrap);
  }

  function selectCodex(name) {
    codexSel = name;
    codexMsQ = ''; codexMsAttr = 'all'; codexMsCost = 'all'; codexMsLv = 'all'; codexMsLimit = 60;
    $('#codex2col').classList.add('sel');
    renderCodexList();
    renderCodexPane();
    const p = $('#codexPane'); if (p) p.scrollTop = 0;
  }

  /** 보유 기체 한 줄에 필요한 것 — 이름·속성·코스트 범위·가진 스킬 LV. */
  function codexMsRows(e) {
    const byBase = msByBase;
    const lvNum = v => { const m = /(\d+)/.exec(v); return m ? +m[1] : 0; };
    const rows = [];
    for (const [base, lvSet] of e.ms) {
      const list = byBase.get(base);
      if (!list || !list.length) continue;
      const costs = list.map(m => m.コスト).filter(c => c != null);
      if (!costs.length) continue;
      rows.push({
        base,
        ko: T.msName(base),
        attr: list[0].属性 || '',
        attrKo: T.attrName(list[0].属性) || '-',
        costMin: Math.min.apply(null, costs), costMax: Math.max.apply(null, costs),
        lvs: [...lvSet].sort((x, y) => lvNum(x) - lvNum(y)),
        ms: list[0],
      });
    }
    return rows.sort((x, y) => (y.costMax - x.costMax) || x.ko.localeCompare(y.ko, 'ko'));
  }

  function renderCodexPane() {
    if (codexView === 'unmod') return renderUnmodPane();
    const pane = $('#codexPane'); if (!pane) return;
    pane.innerHTML = '';
    const e = buildCodexIndex().find(x => x.name === codexSel);
    if (!e) { pane.append(el('div', 'codex-ph', '왼쪽에서 스킬을 고르면 설명과 보유 기체가 나옵니다.')); return; }

    const back = el('button', 'btn-ghost small codex-paneback', '‹ 목록');
    back.onclick = () => { codexSel = null; $('#codex2col').classList.remove('sel'); renderCodexList(); renderCodexPane(); };
    pane.append(back);

    const ttl = el('div', 'codex-ttl');
    ttl.append(el('h2', '', e.ko));
    ttl.append(el('span', 'codex-tag', SKILL_CAT_KO[e.cat] || '기타'));
    ttl.append(el('span', 'codex-tag', e.msCount + '기 보유'));
    pane.append(ttl);
    if (e.ko !== e.name) pane.append(el('div', 'codex-jp', e.name));

    pane.append(el('div', 'codex-sub', 'LV 별 효과'));
    for (const v of e.lvList) {
      const row = el('div', 'codex-row');
      if (v.lv) row.append(el('b', '', v.lv));
      const eff = skTr(v.eff), desc = skTr(v.desc);
      if (eff) row.append(el('div', 'codex-eff', eff.split(' / ').join('\n')));
      if (desc && desc !== eff) row.append(el('div', 'codex-desc', desc.split(' / ').join('\n')));
      pane.append(row);
    }

    pane.append(el('div', 'codex-sub', '보유 기체'));
    const bar = el('div', 'codex-msbar');
    const inp = el('input', 'codex-mssearch');
    inp.type = 'search'; inp.placeholder = '기체 이름 검색'; inp.value = codexMsQ; inp.autocomplete = 'off';
    inp.oninput = ev => { codexMsQ = ev.target.value; codexMsLimit = 60; renderCodexMsList(e); };
    bar.append(inp);
    // 칩 묶음마다 라벨을 단다 — 셋이 붙어 있으면 어디까지가 코스트인지 안 보인다
    const mkChips = (lb, cur, list, set) => {
      const g = el('div', 'codex-chipgrp');
      g.append(el('span', 'filter-lb', lb));
      const w = el('div', 'chips');
      for (const c of list) {
        const b = el('button', 'chip' + (cur() === c.v ? ' on' : ''), c.label);
        b.onclick = () => { set(c.v); codexMsLimit = 60; renderCodexPane(); };
        w.append(b);
      }
      g.append(w);
      return g;
    };
    bar.append(mkChips('카테고리', () => codexMsAttr, [{ label: '전체', v: 'all' },
      { label: '강습', v: '強襲' }, { label: '범용', v: '汎用' }, { label: '지원', v: '支援' }],
      v => { codexMsAttr = v; }));
    bar.append(mkChips('코스트', () => codexMsCost, COST_CHIPS, v => { codexMsCost = v; }));
    if (e.lvList.filter(v => v.lv).length > 1) {
      bar.append(mkChips('스킬 LV', () => codexMsLv, [{ label: '전체', v: 'all' }].concat(
        e.lvList.filter(v => v.lv).map(v => ({ label: v.lv, v: v.lv }))), v => { codexMsLv = v; }));
    }
    pane.append(bar);
    const listBox = el('div', 'codex-mslist'); listBox.id = 'codexMsList';
    pane.append(listBox);
    renderCodexMsList(e);
  }

  function renderCodexMsList(e) {
    const box = $('#codexMsList'); if (!box) return;
    const q = codexMsQ.trim().toLowerCase();
    const rows = codexMsRows(e).filter(r => {
      if (codexMsAttr !== 'all' && r.attr !== codexMsAttr) return false;
      // 코스트는 기체 LV 마다 다르다 — 한 LV 라도 걸리면 통과시킨다
      if (codexMsCost === 'low') { if (r.costMin > 250) return false; }
      else if (codexMsCost !== 'all') { if (codexMsCost < r.costMin || codexMsCost > r.costMax) return false; }
      if (codexMsLv !== 'all' && r.lvs.indexOf(codexMsLv) < 0) return false;
      if (q && !r.ko.toLowerCase().includes(q) && !r.base.toLowerCase().includes(q)) return false;
      return true;
    });
    box.innerHTML = '';
    if (!rows.length) { box.append(el('div', 'codex-empty', '조건에 맞는 기체가 없습니다.')); return; }
    for (const r of rows.slice(0, codexMsLimit)) {
      const it = el('div', 'codex-ms');
      const nm = el('div', 'nm');
      nm.append(attrMark(r.attr));
      nm.append(el('span', '', r.ko));
      it.append(nm);
      it.append(el('div', 'at', r.attrKo));
      it.append(el('div', 'co', r.costMin === r.costMax ? String(r.costMin) : r.costMin + '~' + r.costMax));
      const lv = el('div', 'lv');
      for (const v of r.lvs) lv.append(el('span', 'codex-lv', v));
      it.append(lv);
      // 눌러서 바로 그 기체로 간다 — 도감에서 본 것을 그대로 짜 볼 수 있다
      it.title = '이 기체로 구성 짜기';
      it.onclick = () => { selectMs(r.ms); };
      box.append(it);
    }
    if (rows.length > codexMsLimit) {
      const more = el('div', 'codex-msmore', '더 보기 (' + (rows.length - codexMsLimit) + '기 남음)');
      more.onclick = () => { codexMsLimit += 60; renderCodexMsList(e); };
      box.append(more);
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     게임 패치노트 — **게임의** 밸런스 조정·추가 기체.
     (이 앱이 바뀐 내역이 아니다. 그쪽은 패치노트.md 다)

     자료는 data/patchnotes.json → GBO2_PATCHNOTES.
     공식 한국어 공지의 문구를 **그대로** 보여 준다 — 번역·요약·보충을 하지 않는다.
     공식이 수치를 생략한 항목(「비틀거림 축적치 상승」)은 생략된 채 보인다.
     ══════════════════════════════════════════════════════════════════ */
  const PN = (window.GBO2_PATCHNOTES && Array.isArray(window.GBO2_PATCHNOTES.patches))
    ? window.GBO2_PATCHNOTES.patches : [];
  let pnDate = null;        // 고른 패치 날짜
  let pnPick = null;        // 고른 조정 기체(ko 이름)
  let pnBalOnly = false;    // 밸런스 조정이 있는 날짜만 보기

  const pnFind = d => PN.find(p => p.date === d) || null;

  /* 기체 정보 칸을 **패치노트 화면 안에서** 띄운다(사용자 지시).

     그 칸(#selInfo)은 기체 선택 화면에 붙어 있고, 안 보는 화면은 display:none 이라
     그대로 두면 아무것도 안 보인다 — 조상이 none 이면 자식이 fixed 여도 안 그려진다.
     그래서 **요소를 옮긴다.** 닫거나 파츠로 넘어갈 때 제자리에 되돌린다 —
     안 되돌리면 기체 선택 화면의 정보 칸이 영영 사라진다. */
  let pnInfoHome = null;        // 원래 있던 자리(되돌릴 때 쓴다)

  function pnOpenInfo(m) {
    const panel = $('#selInfo'), screen = $('#screenPatch');
    if (!panel || !screen || !m) return;
    if (!pnInfoHome) pnInfoHome = { parent: panel.parentNode, next: panel.nextSibling };
    screen.appendChild(panel);
    document.body.classList.add('pn-info');
    openInfo(m);
  }

  /** 옮겨 둔 정보 칸을 제자리로. 옮긴 적이 없으면 아무 일도 안 한다. */
  function pnRestoreInfo() {
    if (!pnInfoHome) return;
    const panel = $('#selInfo');
    if (panel) pnInfoHome.parent.insertBefore(panel, pnInfoHome.next);
    pnInfoHome = null;
    document.body.classList.remove('pn-info');
  }

  /** 줄기 이름(ガブスレイ)으로 기체를 찾는다. **가장 낮은 LV** 을 고른다 —
      정보 칸은 LV 하나를 받고, 목록에서도 낮은 LV 이 대표로 나온다. */
  function pnFindMs(stem) {
    if (!stem) return null;
    const hit = msData.filter(m => String(m.MS名).replace(/_LV\d+$/, '') === stem);
    if (!hit.length) return null;
    return hit.sort((x, y) =>
      (Number((String(x.MS名).match(/_LV(\d+)$/) || [])[1] || 0))
      - (Number((String(y.MS名).match(/_LV(\d+)$/) || [])[1] || 0)))[0];
  }

  /** 지금 레일에 세울 날짜들 — 걸개가 켜져 있으면 조정이 있는 날만 */
  const pnList = () => pnBalOnly ? PN.filter(p => (p.adjusted || []).length) : PN;

  function openPatch(open) {
    if (!open) { setView(AUX_BACK); return; }
    if (!pnDate) { const L = pnList(); pnDate = L.length ? L[0].date : null; }   // 기본은 가장 최근
    setView('patch');
    renderPatch();
  }

  /** 걸개를 켜고 끈다. 지금 보던 날짜가 걸러지면 가장 가까운 날로 옮긴다 —
      안 옮기면 오른쪽이 빈 채로 남아 「망가졌다」로 보인다. */
  function pnSetBalOnly(on) {
    pnBalOnly = !!on;
    const b = $('#pnBalBtn');
    if (b) { b.classList.toggle('on', pnBalOnly); b.setAttribute('aria-pressed', String(pnBalOnly)); }
    const L = pnList();
    if (!L.some(p => p.date === pnDate)) {
      const near = L.slice().sort((x, y) =>
        Math.abs(Date.parse(x.date) - Date.parse(pnDate)) - Math.abs(Date.parse(y.date) - Date.parse(pnDate)))[0];
      pnDate = near ? near.date : (L[0] && L[0].date) || null;
      pnPick = null;
    }
    renderPatch();
  }

  function renderPatch() {
    const fresh = $('#patchFresh');
    if (fresh) {
      /* 어디서 온 자료인지 적는다. 비어 있을 때 「없다」와 「못 받았다」는 다른 말이다. */
      fresh.textContent = PN.length
        ? '공식 한국어 공지 기준 · 패치 ' + PN.length + '개'
        : '패치노트 자료가 아직 없습니다 (업데이트를 한 번 돌리면 들어옵니다)';
    }
    renderPnRail();
    renderPnBody();
  }

  /** 좌측 날짜 레일 — 고른 칸은 크게, 나머지는 작게. 레일이 미끄러져 고른 칸이 가운데로 온다. */
  function renderPnRail() {
    const rail = $('#pnRail'); if (!rail) return;
    rail.innerHTML = '';
    for (const p of pnList()) {
      const on = p.date === pnDate;
      const b = el('button', 'pn-date' + (on ? ' on' : ''));
      const ymd = String(p.date).split('-');
      b.append(el('span', 'pn-y', ymd[0]));
      b.append(el('span', 'pn-md', ymd[1] + '.' + ymd[2]));
      /* 작은 칸에도 규모를 적어 둔다 — 날짜만으론 어느 패치가 큰지 알 수 없다. */
      /* 조정이 없는 주(신규·LV 추가만 있는 주)도 칸이 생긴다 — 0 을 적으면 읽기 나쁘다. */
      const nAdj = (p.adjusted || []).length, nAdd = (p.added || []).length;
      b.append(el('span', 'pn-cnt', [nAdj ? '조정 ' + nAdj : '', nAdd ? '추가 ' + nAdd : '']
        .filter(Boolean).join(' · ') || '-'));
      if (nAdj) b.classList.add('bal');   // 밸런스 패치가 있는 주는 눈에 띄게
      b.title = p.date + (p.ver ? '  ver.' + p.ver : '');
      b.onclick = () => {
        /* 이미 고른 칸을 눌렀을 때도 **가운데로 되돌린다.** 휠로 훑다가 그 칸을 누르면
           아무 일도 안 일어나 「눌러도 안 되네」가 된다(재서 봤다 — 320px 어긋나 있었다).
           다시 그릴 일은 없으니 자리만 잡는다. */
        if (pnDate === p.date) { pnPlaceRail(); return; }
        pnDate = p.date;
        pnPick = null;                 // 패치를 바꾸면 펼쳐 둔 내역을 닫는다
        renderPatch();
      };
      rail.append(b);
    }
    pnPlaceRail();
  }

    /* 미끄러뜨리기 — 고른 칸을 레일 상자 가운데로 옮기되, **끝이 비지 않게 조른다.**
       숨어 있는 동안에는 크기를 못 재므로(0 이 나온다) 다음 프레임에 잰다.

       조르는 쪽을 골랐다. 조르지 않고 늘 가운데로 보냈더니 패치가 몇 개뿐일 때
       레일 위가 통째로 비어 화면이 한쪽으로 쏠렸다(찍어서 봤다). 다 들어가는 동안에는
       움직일 일이 없는 것이 맞고, 패치가 쌓여 넘치기 시작하면 그때부터 미끄러진다.
       — 그래서 자도 **넘치는 높이로 줄여 놓고** 미끄러지는지 잰다. */
  function pnPlaceRail() {
    const rail = $('#pnRail'); if (!rail) return;
    /* 고른 칸을 레일 상자 가운데로 가져온다.

       **transform 이 아니라 스크롤로** 옮긴다. transform 으로 밀 때는 화면이 제자리에
       박혀 있어, 아래쪽 패치를 보려면 날짜를 하나씩 눌러 가며 옮겨야 했다(사용자 지적).
       스크롤로 두면 휠·드래그·터치로 **마음대로 훑고**, 누르면 가운데로 와 준다.

       양 끝 여백은 그대로 둔다 — 첫 칸·끝 칸도 가운데에 설 수 있어야 한다.
       숨어 있는 동안에는 크기를 못 재므로(0 이 나온다) 다음 프레임에 잰다. */
    const place = (smooth) => {
      const box = rail.parentElement;
      const on = rail.querySelector('.pn-date.on');
      if (!box || !on) return;
      const wide = box.clientWidth > box.clientHeight;   // 좁은 화면에서는 가로 레일이다
      const boxLen = wide ? box.clientWidth : box.clientHeight;
      const onLen = wide ? on.offsetWidth : on.offsetHeight;
      /* 여백은 **끝쪽에만** 둔다. 양쪽에 두었더니 첫 칸(= 열자마자 고르는 최신 패치)이
         가운데로 내려가 레일 위가 통째로 비어 보였다(찍어서 봤다).
         끝쪽만 두면 첫 칸은 맨 위에 서고, 마지막 칸도 가운데까지 올라올 수 있다. */
      const pad = Math.max(0, Math.round((boxLen - onLen) / 2));
      if (wide) { rail.style.paddingRight = pad + 'px'; rail.style.paddingLeft = '';
        rail.style.paddingTop = ''; rail.style.paddingBottom = ''; }
      else { rail.style.paddingBottom = pad + 'px'; rail.style.paddingTop = '';
        rail.style.paddingLeft = ''; rail.style.paddingRight = ''; }
      const to = Math.round((wide ? on.offsetLeft + on.offsetWidth / 2 - box.clientWidth / 2
        : on.offsetTop + on.offsetHeight / 2 - box.clientHeight / 2));
      const key = wide ? 'left' : 'top';
      const opt = { behavior: smooth ? 'smooth' : 'auto' };
      opt[key] = Math.max(0, to);
      box.scrollTo(opt);
      const span = wide ? box.scrollWidth - box.clientWidth : box.scrollHeight - box.clientHeight;
      box.classList.toggle('over', span > 1);
    };
    requestAnimationFrame(() => { place(false); requestAnimationFrame(() => place(true)); });
  }

  function renderPnBody() {
    const p = pnFind(pnDate);
    const added = $('#pnAdded'), adj = $('#pnAdjusted');
    if (!added || !adj) return;
    added.innerHTML = ''; adj.innerHTML = '';
    const addN = $('#pnAddN'), adjN = $('#pnAdjN');

    const list = (p && p.added) || [];
    if (addN) addN.textContent = list.length ? list.length + '기' : '';
    if (!list.length) {
      /* 왜 비었는지 적는다 — 「없음」으로만 두면 자료가 빠진 것과 구분이 안 된다.
         추가 기체 기록은 우리가 미러를 대조해 쌓는 것이라, 쌓기 전 패치는 비어 있다. */
      added.append(el('div', 'pn-empty', p
        ? '이 패치 주기에 기록된 추가 기체가 없습니다 (기록을 쌓기 전 패치일 수 있습니다)'
        : '패치를 고르세요'));
    } else {
      for (const a of list) {
        const c = pnMsCard(a.ms, a.why === 'newLv' ? 'LV 추가' : '신규', a.at);
        /* 누르면 **기체 정보**를 띄운다(사용자 지시). 정보 칸은 기체 선택 화면에 붙어 있어서
           그 화면으로 옮긴 뒤 연다. 보던 패치 날짜는 그대로 남으므로, 「📰 패치노트」를
           다시 누르면 같은 자리로 돌아온다. */
        const m = pnFindMs(a.ms);
        if (m) {
          c.classList.add('pick');
          c.title = T.msName(m.MS名) + ' 정보 보기';
          c.onclick = () => pnOpenInfo(m);
        }
        added.append(c);
      }
    }

    const ads = (p && p.adjusted) || [];
    if (adjN) adjN.textContent = ads.length ? ads.length + '기' : '';
    if (!ads.length) adj.append(el('div', 'pn-empty', '조정된 기체가 없습니다'));
    for (const a of ads) {
      const c = pnMsCard(a.ms, '', '', a.ko);
      c.classList.add('pick');
      if (pnPick === a.ko) c.classList.add('on');
      c.onclick = () => { pnPick = (pnPick === a.ko ? null : a.ko); renderPnBody(); };
      adj.append(c);
    }
    renderPnDetail(p, ads);
  }

  /** 기체 카드 한 장. ms(일본어 줄기)가 없으면 공식 이름만 적는다. */
  function pnMsCard(ms, badge, at, koFallback) {
    const card = el('div', 'pn-card');
    if (ms) card.append(img(msImg(ms + '_LV1'), 'ms', ms));
    const info = el('div', 'pn-ci');
    info.append(el('div', 'pn-nm', ms ? T.msName(ms) : (koFallback || '?')));
    const meta = el('div', 'pn-meta');
    if (badge) meta.append(el('span', 'pn-badge', badge));
    if (at) meta.append(el('span', '', String(at).slice(5)));
    if (meta.childNodes.length) info.append(meta);
    card.append(info);
    card.title = ms || koFallback || '';
    return card;
  }

  /** 고른 기체의 변경 내역 — 공식 공지 원문 그대로 */
  function renderPnDetail(p, ads) {
    const box = $('#pnDetail'); if (!box) return;
    const a = pnPick ? ads.find(x => x.ko === pnPick) : null;
    if (!a) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = '';

    const head = el('div', 'pn-dhead');
    head.append(el('strong', '', a.ms ? T.msName(a.ms) : a.ko));
    head.append(el('span', 'pn-dsrc', p.date + (p.ver ? ' · ver.' + p.ver : '') + ' · 공식 공지 원문'));
    const close = el('button', 'pn-dclose', '✕');
    close.title = '닫기';
    close.onclick = () => { pnPick = null; renderPnBody(); };
    head.append(close);
    box.append(head);

    for (const s of a.sections || []) {
      /* 변형·변신 서브섹션은 같은 기체의 다른 모드다 — 제목을 그대로 보여 준다. */
      if (s.isSub) box.append(el('div', 'pn-sub', s.header));
      for (const r of s.rows || []) {
        const row = el('div', 'pn-row');
        const lb = el('div', 'pn-rl');
        lb.append(el('span', 'pn-cat', r.category || '-'));
        if (r.weapon) lb.append(el('span', 'pn-wp', r.weapon));
        row.append(lb);
        const ch = el('div', 'pn-rc');
        (r.changes || []).forEach((line, i) => {
          /* 【통상 사격】 같은 소제목은 글머리가 아니라 묶음 표시다 — 따로 보이게 한다. */
          const ln = el('div', /^[【[]/.test(line) ? 'pn-ln head' : 'pn-ln', line);
          /* 공식이 수치를 안 적은 줄에는 위키에서 찾은 값을 **따로 달아** 준다.
             공식 문구 안에 끼워 넣지 않는다 — 어디까지가 공식인지 알 수 있어야 한다. */
          const f = r.fill && r.fill[i];
          if (f && f.from) {
            const tag = el('span', 'pn-num');
            tag.append(el('span', 'pn-nv', f.from));
            tag.append(el('span', 'pn-na', '→'));
            tag.append(el('span', 'pn-nv', f.to));
            tag.title = '공식 공지에는 수치가 없어 위키 기록에서 가져왔습니다';
            ln.append(tag);
          }
          ch.append(ln);
          /* 「(더불어 상위 LV도 상승)」 — 공식은 대표 LV 하나만 적는다.
             위키가 적어 둔 **LV 별 수치**를 그 줄 바로 아래에 작게 붙인다(사용자 지시). */
          if (f && f.lv) {
            const box2 = el('div', 'pn-lv');
            for (const x of f.lv) {
              const e2 = el('span', 'pn-lvi');
              e2.append(el('span', 'pn-lvk', x.lv));
              e2.append(el('span', 'pn-lvv', x.from + ' → ' + x.to));
              box2.append(e2);
            }
            box2.title = '위키 기록의 LV 별 수치';
            ch.append(box2);
          }
        });
        row.append(ch);
        box.append(row);
      }
    }
    if ((a.intent || []).length) {
      const d = el('details', 'pn-intent');
      d.append(el('summary', '', '조정 의도 (공식)'));
      for (const line of a.intent) d.append(el('div', 'pn-ln', line));
      box.append(d);
    }


    /* 참조 데이터 — 공식이 「왜 바꿨나」의 근거로 붙이는 전적.
       「조정 후」 행과 판정은 **한 달 뒤**(다음 밸런스 패치 때) 공식이 덧붙인다.
       아직 안 붙은 패치는 그 행이 없다 — 없는 것을 지어내지 않고 그대로 비워 둔다. */
    if (a.ref && (a.ref.rows || []).length) {
      const d = el('details', 'pn-ref');
      d.append(el('summary', '', '참조 데이터 (공식)'
        + (a.ref.cost ? ' — COST ' + a.ref.cost : '')));
      const t = el('table', 'pn-rt');
      const hr = el('tr');
      hr.append(el('th', '', ''));
      for (const c of a.ref.cols || []) hr.append(el('th', '', c));
      t.append(hr);
      for (const r of a.ref.rows) {
        const tr = el('tr');
        if (/조정\s*후/.test(r.label)) tr.classList.add('after');
        tr.append(el('th', '', r.label));
        for (const v of r.values) tr.append(el('td', '', v));
        t.append(tr);
      }
      d.append(t);
      if (!a.ref.rows.some(r => /조정\s*후/.test(r.label)))
        d.append(el('div', 'pn-note', '※ 「조정 후」 전적은 다음 밸런스 패치 때 공식이 덧붙입니다.'));
      box.append(d);
    }
    /* 위키가 적어 둔 **LV 별 수치.** 공식은 「비틀거림 축적치 상승」처럼 얼마인지를
       생략하고, LV 도 대표값 하나만 적는다. 위키는 LV1~4 를 다 적는다.
       일본어 원문 그대로 둔다 — 번역해 옮기면 수치 옆 말이 어긋날 수 있고,
       정작 필요한 숫자는 번역이 필요 없다. ▲▼ 는 위키가 단 표식이다. */
    if ((a.wiki || []).length) {
      const d = el('details', 'pn-wiki');
      /* 한국어로 옮겨 적는다. 공식이 **안 적은 변화까지** 여기 들어 있다 —
         공식 389개, 위키 423개(2026-10-10 실측). 옮기기 전에는 일본어라 접어 둘 수밖에 없었다. */
      d.append(el('summary', '', '상세 수치 — 위키 기록'));
      for (const w of a.wiki) {
        const ln = el('div', 'pn-wl d' + Math.min(3, w.depth), w.ko || w.text);
        /* 원문을 숨기지 않는다 — 옮긴 말이 미덥지 않을 때 확인할 길이 있어야 한다. */
        if (w.ko && w.ko !== w.text) ln.title = w.text;
        if (w.buff === true) ln.classList.add('up');
        if (w.buff === false) ln.classList.add('down');
        d.append(ln);
      }
      box.append(d);
    }
  }

  function openCodex(open) {
    if (!open) { setView(AUX_BACK); return; }
    setView('codex');
    renderCodexChips();
    renderCodexList();
    renderCodexPane();
  }

  function renderCodexChips() {
    const wrap = $('#codexCatChips'); if (!wrap) return;
    wrap.innerHTML = '';
    if (codexView === 'unmod') {
      /* 「계산 안 함」 쪽은 위키 분류가 아니라 **고칠 수 있는가**로 가른다.
         왜 안 넣는지(값이 원문에 없음·방향이 반대…)는 항목마다 꼬리표로 단다 —
         「왜」로 가르면 일곱 갈래가 되는데, 정작 알고 싶은 것은 「이 중 뭐가 고쳐지나」다. */
      const all = buildUnmodIndex();
      const cnt = { 전체: all.length };
      for (const e of all) cnt[e.fix] = (cnt[e.fix] || 0) + 1;
      for (const nm of ['전체', ...UNMOD_FIX_ORDER]) {
        if (!cnt[nm]) continue;
        const b = el('button', 'chip' + (codexCat === nm ? ' on' : ''), nm + ' ' + cnt[nm]);
        b.onclick = () => { codexCat = nm; renderCodexChips(); renderCodexList(); };
        wrap.append(b);
      }
      return;
    }
    const all = buildCodexIndex();
    const cnt = { 전체: all.length };
    for (const e of all) { const k = SKILL_CAT_KO[e.cat] || '기타'; cnt[k] = (cnt[k] || 0) + 1; }
    for (const nm of ['전체', '기동', '공격', '방어', '기타']) {
      if (!cnt[nm]) continue;
      const b = el('button', 'chip' + (codexCat === nm ? ' on' : ''), nm + ' ' + cnt[nm]);
      b.onclick = () => { codexCat = nm; renderCodexChips(); renderCodexList(); };
      wrap.append(b);
    }
  }

  /* ---------- 강화리스트 설명 ---------- */
  // 확장 스킬 설명과 같은 방식 — 표를 손으로 적지 않고 데이터에서 만든다.
  // 요구치(points)·항목·레벨은 기체마다 다르므로 ms.fullst 에서, 효과는 fullst 정의에서 온다.

  /** 강화 효과 한 줄. 값이 숫자면 계산에 들어가고, "3%"·"1초" 같은 문자열은 안 들어간다. */
  function fullstEffText(effects) {
    const parts = [];
    for (const [k, raw] of Object.entries(effects || {})) {
      if (k === 'limitIncreases') continue;
      const label = T.fullstEffect(k);
      // 값의 모양이 셋이다: 숫자(계산에 들어감) · "3%"·"1초"(안 들어감) · true(있고 없고만 있는 것)
      const num = typeof raw === 'number';
      // 문자열 값에는 일본어 단위가 섞여 있다("1秒"). 무장 표에 쓰는 변환기를 그대로 쓴다.
      const txt = raw === true ? label
        : num ? label + ' +' + raw.toLocaleString()
        : label + ' ' + jaUnits(raw);
      parts.push({ txt, applied: num });
    }
    return parts;
  }

  function openStageHelp(open) {
    const m = $('#stageHelpModal'), b = $('#stageHelpBack');
    setModal(m, b, open);
    if (!open) return;

    const body = $('#stageHelpBody');
    body.innerHTML = '';
    const ms = state.ms;
    $('#stageHelpTitle').textContent = ms ? T.msName(ms.MS名) + ' — 강화리스트' : '강화리스트';
    if (!ms) { body.append(el('div', 'ac-warn', '먼저 기체를 고르세요.')); return; }
    const list = Array.isArray(ms.fullst) ? ms.fullst : [];
    if (!list.length) { body.append(el('div', 'ac-warn', '이 기체는 강화리스트 자료가 없습니다.')); return; }

    // 4단계는 앞 4개까지만 스탯에 반영된다. 파츠칸만은 단계와 무관하게 전부 더해진다
    // (원본이 그렇게 계산한다 — 5·6번째에 슬롯 강화가 든 기체가 실제로 있다).
    const tbl = el('div', 'exp-help-tbl');
    list.forEach((entry, i) => {
      const n = i + 1;
      const on = state.stage === 6 ? true : state.stage === 4 ? n <= 4 : false;
      const row = el('div', 'stage-help-row' + (on ? ' on' : ''));
      row.append(el('span', 'stage-help-no', String(n)));
      row.append(el('span', 'stage-help-pt',
        entry.points == null ? '— pt' : entry.points.toLocaleString() + ' pt'));

      const mid = el('span', 'stage-help-mid');
      mid.append(el('span', 'stage-help-nm', T.fullstName(entry.name) + ' LV' + entry.level));
      const def = fullst.find(d => d.name === entry.name);
      const lv = def && (def.levels || []).find(l => Number(l.level) === Number(entry.level));
      const effs = lv ? fullstEffText(lv.effects) : [];
      // 기체는 이 레벨을 쓰는데 어느 자료에도 값이 없는 경우가 있다(2종·8기).
      // '우리가 모른다' 가 아니라 '어디에도 없다' 라고 말해야 오해가 없다 —
      // 효과가 무엇인지는 알지만(윗 레벨에 있다) 그 레벨의 수치만 없는 것이다.
      if (!lv) {
        const known = def && (def.levels || [])[0];
        const what = known ? Object.keys(known.effects || {})
          .filter(k => k !== 'limitIncreases').map(k => T.fullstEffect(k)).join(' · ') : '';
        mid.append(el('span', 'stage-help-eff dim',
          (what ? what + ' — ' : '') + 'LV' + entry.level + ' 수치가 원본·위키 어디에도 없습니다'));
      }
      else if (!effs.length) mid.append(el('span', 'stage-help-eff dim', '(효과 없음)'));
      for (const e of effs) {
        const tag = el('span', 'stage-help-eff' + (e.applied ? '' : ' dim'), e.txt);
        if (!e.applied) tag.title = '이 효과는 계산에 반영되지 않습니다';
        mid.append(tag);
      }
      row.append(mid);
      tbl.append(row);
    });
    body.append(tbl);

    const lb = { 0: '미강화', 4: '4단계', 6: '풀강' }[state.stage] || '';
    const note = el('div', 'exp-help-note');
    note.append(document.createTextNode(
      '지금은 ' + lb + ' 입니다. 4단계는 앞 4개까지 스탯에 반영되고, 풀강은 전부 반영됩니다. '));
    note.append(el('b', '', '파츠칸만은 단계와 무관하게 전부 더해집니다'));
    note.append(document.createTextNode(
      ' — 원본이 그렇게 계산하며, 5·6번째에 파츠칸 강화가 든 기체가 실제로 있습니다. '
      + '흐린 글씨는 자료는 있으나 계산에 넣지 않는 효과입니다(초 단위 단축 등).'));
    body.append(note);
  }

  /* ---------- 확장 스킬 효과 설명 ---------- */
  // 표를 손으로 적지 않고 core.js 의 EXPANSION_LEVELS 에서 만든다.
  // 같은 값을 두 곳에 적어 두면 상수가 바뀔 때 화면만 옛 숫자를 말하게 된다.

  const EXP_CAT_KO = { '防御': '방어', '攻撃': '공격', '移動': '이동', '補助': '보조', '特殊': '특수' };
  /** 실드 HP 보너스 — 파츠(무장 규칙) + 확장 스킬(파츠확장[HP]).
   *  세 화면(무장 표·PNG·피탄)이 같은 값을 쓰도록 한 곳에 둔다. */
  const shieldHpBonus = (wm, equipped, expansion, expLevel) =>
    ((wm && wm.shieldHp) || 0) + C.expansionShieldHp(expansion, expLevel, equipped || []);

  /** {shoot: 4, ...} → '사격 +4' 목록 */
  const expStatText = obj => Object.entries(obj || {})
    .map(([k, v]) => (C.STAT_LABEL[k] || k) + ' +' + v.toLocaleString()).join(' · ');

  /** 스탯이 아닌 효과(실드 HP·리로드 단축·리페어 회복량)를 사람 말로.
   *  스탯 표(STAT_LABEL)에 없는 값이라 여기서 이름을 붙인다 —
   *  이게 없어서 위키에 적힌 「シールドHPが300増加」「リロード…1%短縮」 이 설명에서 통째로 빠졌다. */
  const EXP_EXTRA_TEXT = {
    shieldHp: v => '실드 HP +' + v.toLocaleString(),
    reloadOhPct: v => '무장 리로드·오버히트 −' + v + '%',
    repairPct: v => '리페어 회복량 +' + v + '%'
  };
  const expExtraText = obj => Object.entries(obj || {})
    .map(([k, v]) => (EXP_EXTRA_TEXT[k] ? EXP_EXTRA_TEXT[k](v) : k + ' +' + v)).join(' · ');

  /** 한 레벨의 효과를 사람이 읽는 문장으로. 모양이 셋뿐이라 그대로 나눈다. */
  function expEffectText(e) {
    if (!e) return '';
    if (e.per) {
      const cats = (e.per.cats || []).map(c => EXP_CAT_KO[c] || c).join('·');
      const per = [expStatText(e.per.add), expExtraText(e.perExtra)].filter(Boolean).join(' · ');
      return cats + ' 파츠 1개당  ' + per;
    }
    const parts = [];
    if (e.add) parts.push(expStatText(e.add));
    // 상한이 가산과 같으면 굳이 두 번 적지 않는다 (대부분 그렇다)
    const same = e.limit && e.add && JSON.stringify(e.limit) === JSON.stringify(e.add);
    if (e.limit && !same) parts.push('상한 ' + expStatText(e.limit));
    else if (same) parts[0] += '  (상한도 같이 오름)';
    if (e.extra) parts.push(expExtraText(e.extra));
    return parts.join('  /  ');
  }

  function openExpHelp(open) {
    const m = $('#expHelpModal'), b = $('#expHelpBack');
    setModal(m, b, open);
    if (!open) return;

    const name = state.expansion;
    const body = $('#expHelpBody');
    body.innerHTML = '';
    $('#expHelpTitle').textContent = C.EXPANSION_LABEL[name] || name;

    if (name === C.EXPANSION_NONE) {
      body.append(el('div', 'ac-warn', '확장 스킬을 고르면 레벨별 효과가 여기에 나옵니다.'));
      return;
    }
    const levels = C.EXPANSION_LEVELS[name];
    if (!levels) {
      body.append(el('div', 'ac-warn', '이 확장 스킬의 수치 자료가 없습니다 — 계산에도 반영되지 않습니다.'));
      return;
    }

    const tbl = el('div', 'exp-help-tbl');
    levels.forEach((e, i) => {
      const lv = i + 1;
      const row = el('div', 'exp-help-row' + (lv === state.expLevel ? ' on' : ''));
      row.append(el('span', 'exp-help-lv', 'LV' + lv));
      row.append(el('span', 'exp-help-eff', expEffectText(e)));
      tbl.append(row);
    });
    body.append(tbl);
    body.append(el('div', 'exp-help-note',
      '지금 고른 것은 LV' + state.expLevel + ' 입니다. 표의 값만 계산에 반영됩니다 — '
      + '원본에 있는 일부 효과(실드 HP·리로드 단축·리페어툴 회복량)는 자료가 없어 반영하지 않습니다.'));
  }

  /** 관리자 로그인 — 비밀번호는 앱에 없다. 관리자가 직접 입력하면 서버가 해시로 대조한다. */
  async function adminSignIn() {
    if (!S) return;
    if (S.isAdmin()) {
      if (!confirm('관리자에서 로그아웃할까요?')) return;
      S.adminLogout(); renderGallery(); updateAdminBtn(); toast('로그아웃했습니다');
      return;
    }
    openAdmin(true);
  }

  /** 관리자 로그인 팝업 여닫기. 닫을 때 입력을 지운다 — 비밀번호를 화면에 남기지 않는다. */
  function openAdmin(open) {
    const m = $('#adminModal'), b = $('#adminBack');
    setModal(m, b, open);
    $('#adminMsg').textContent = '';
    if (open) { $('#adminPw').value = ''; setTimeout(() => $('#adminPw').focus(), 30); }
    else { $('#adminPw').value = ''; }
  }

  async function adminSubmit() {
    if (!S) return;
    const pw = $('#adminPw').value || '';
    if (!pw) { toast('비밀번호를 입력하세요'); return; }
    const btn = $('#adminGo');
    btn.disabled = true; btn.textContent = '확인 중…';
    $('#adminMsg').textContent = '';
    const r = await S.adminLogin(pw);
    btn.disabled = false; btn.textContent = '로그인';
    $('#adminPw').value = '';                 // 비밀번호는 화면에 남기지 않는다
    if (r.ok) {
      openAdmin(false);
      toast(r.msg);
      renderGallery(); updateAdminBtn();
    } else {
      // 실패는 팝업 안에 남긴다 — 토스트는 팝업에 가려 잘 안 보인다
      $('#adminMsg').textContent = r.msg;
    }
  }

  function updateAdminBtn() {
    const b = $('#galleryAdmin');
    if (!b) return;
    const on = !!(S && S.isAdmin());
    b.textContent = on ? '관리자 ✓' : '관리자';
    b.classList.toggle('on', on);
  }

  /**
   * 수동 업데이트 확인.
   *   APK — 네이티브가 직접 받고 적용한다(자동 갱신이 실패했을 때의 손잡이).
   *   PC  — 배포 자산은 file:// 에서 CORS 로 막히므로 GitHub API 로 날짜만 보고 안내한다.
   *         PC 는 앱이 스스로 갱신할 수 없다 — 업데이트.bat / update.bat 이 한다.
   */
  async function checkUpdateNow() {
    const btn = $('#updateBtn');
    const done = () => { if (btn) { btn.disabled = false; btn.textContent = '🔄 업데이트 확인'; } };
    if (btn) { btn.disabled = true; btn.textContent = '확인 중…'; }
    if (window.AndroidBridge && typeof window.AndroidBridge.checkUpdate === 'function') {
      try { window.AndroidBridge.checkUpdate(); } catch (e) { toast('업데이트를 확인하지 못했습니다'); }
      done();
      return;
    }
    if (!S) { done(); return; }
    const r = await S.checkUpdate();
    done();
    if (!r.ok) { toast(r.msg); return; }
    if (!r.newer) { toast('최신입니다 (데이터 ' + r.mine + ')'); return; }
    alert('새 데이터가 있습니다.\n\n지금 쓰는 것: ' + r.mine + '\n최신: ' + r.latest
      + '\n\n앱 폴더의 「업데이트.bat」(완전판은 update.bat)을 실행하면 받아집니다.');
  }

  /** 올리기 팝업 — 갤러리 화면에는 파츠가 안 보이므로 무엇이 올라가는지 여기서 보여 준다. */
  /* ── 무과금 판정 ──────────────────────────────────────────
     위키 「カスタムパーツ」 표의 必要リサイクルチケット 칸을 그대로 쓴다.
       숫자 → 티켓으로 살 수 있다(무과금) · 0 → 기본 지급 · null/없음 → 티켓으로 못 산다(과금)
     데이터는 tools/build_parts_recycle.js 가 위키에서 뽑아 둔다. */
  const RECYCLE = (window.GBO2_DATA && window.GBO2_DATA.recycle) || {};
  const isFreePart = name => RECYCLE[name] != null;
  /** 이 구성에 든 과금 파츠 목록(한글명). 없으면 빈 배열 = 무과금 구성. */
  const paidPartsIn = equipped => equipped.filter(p => !isFreePart(p.name)).map(p => T.partName(p.name));

  function openUpload(open) {
    const m = $('#uploadModal'), b = $('#uploadBack');
    setModal(m, b, open);
    if (!open) return;
    $('#uploadMsg').textContent = '';
    const box = $('#uploadTarget');
    box.innerHTML = '';
    const parts = state.equipped.length;
    if (!state.ms) {
      box.append(el('div', 'ac-warn', '올릴 구성이 없습니다 — 먼저 기체를 고르고 파츠를 장착하세요.'));
    } else if (!parts) {
      box.append(el('div', 'ac-warn',
        T.msName(state.ms.MS名) + ' — 파츠가 없습니다. 파츠를 하나 이상 장착한 뒤 올려 주세요.'));
    } else {
      const line = el('div', 'sc-ms');
      line.append(img(msImg(state.ms.MS名), 'ms', state.ms.MS名));
      const meta = el('div', 'sc-meta');
      meta.append(el('span', 'sc-msname', T.msName(state.ms.MS名)));
      meta.append(el('span', 'sc-tags', [STAGE_LABEL[state.stage],
        state.expansion !== C.EXPANSION_NONE ? expShort(state.expansion) : null,
        '파츠 ' + parts + '개'].filter(Boolean).join(' · ')));
      line.append(meta);
      box.append(line);
      const th = el('div', 'ac-thumbs');
      for (const p of state.equipped) {
        const t = el('div', 'ac-thumb');
        t.append(img(partImg(p.name), 'parts', p.name));
        const lv = lvOf(p.name);
        if (lv) t.append(el('span', 'ac-lv', lv));
        t.title = T.partName(p.name);
        th.append(t);
      }
      box.append(th);
    }
    // 이름은 매번 다시 치는 게 번거로우므로 지난번 것을 채워 둔다
    try { $('#uploadAuthor').value = localStorage.getItem(AUTHOR_KEY) || ''; } catch { /* 무시 */ }
    $('#uploadAuthor').dispatchEvent(new Event('input'));

    // 무과금 여부는 장착 파츠에서 바로 읽는다 — 사용자가 고르지 않는다.
    // 결과만 보여 주지 않고 왜 그런지(어느 파츠 때문인지)까지 적는다.
    const paid = state.ms ? paidPartsIn(state.equipped) : [];
    const wrap = $('#uploadFreeWrap'), mark = $('#uploadFreeMark'), fnote = $('#uploadFreeNote');
    if (wrap && mark) {
      const free = parts > 0 && !paid.length;
      wrap.hidden = !parts;
      wrap.classList.toggle('off', !free);
      mark.textContent = free ? '무과금 구성' : '과금 파츠 포함';
      fnote.textContent = free
        ? '리사이클 티켓만으로 만들 수 있습니다 — 갤러리에 「무과금」으로 붙습니다'
        : (paid.length + '종: ' + paid.slice(0, 3).join(', ') + (paid.length > 3 ? ' 외 ' + (paid.length - 3) + '종' : ''));
      fnote.title = paid.length ? paid.join(', ') : '';
    }
    $('#uploadPw').value = '';
    $('#uploadGo').disabled = !(state.ms && parts);
    setTimeout(() => $('#uploadAuthor').focus(), 30);
  }

  function uploadCurrent() { if (S) openUpload(true); }

  async function uploadSubmit() {
    if (!S) return;
    const title = $('#uploadTitle').value || '';
    const desc = $('#uploadDesc').value || '';
    const author = $('#uploadAuthor').value || '';
    const pw = $('#uploadPw').value || '';
    // 작성자를 먼저 묻는 순서라 검사도 같은 순서로 — 위에서부터 채우게 된다
    if (!author.trim()) { $('#uploadMsg').textContent = '작성자를 입력하세요'; $('#uploadAuthor').focus(); return; }
    if (!title.trim()) { $('#uploadMsg').textContent = '제목을 입력하세요'; $('#uploadTitle').focus(); return; }
    if (!/^\S{4,20}$/.test(pw)) {
      $('#uploadMsg').textContent = '삭제용 비밀번호를 공백 없이 4~20자로 입력하세요';
      $('#uploadPw').focus(); return;
    }
    // 무과금 여부는 보내지 않는다 — 서버가 장착 파츠를 파츠 표와 대조해 직접 정한다.
    const btn = $('#uploadGo');
    btn.disabled = true; btn.textContent = '올리는 중…';
    $('#uploadMsg').textContent = '';
    const r = await S.upload(serialize(), title, desc, author, pw);
    btn.disabled = false; btn.textContent = '올리기';
    if (r.ok) {
      openUpload(false);
      // 이름만 남긴다 — 제목·설명은 구성마다 다르지만 이름은 늘 같다
      try { localStorage.setItem(AUTHOR_KEY, author.trim()); } catch { /* 무시 */ }
      $('#uploadTitle').value = ''; $('#uploadDesc').value = '';
      $('#uploadPw').value = '';       // 비밀번호는 절대 남기지 않는다(이름과 달리 기억해 두지도 않는다)
      toast(r.msg);
      galleryList = [];
      if (state.view === 'gallery') loadGallery();   // 안 보이는 목록을 그릴 이유가 없다
    } else {
      $('#uploadMsg').textContent = r.msg;   // 팝업 안에 남긴다(토스트는 가려진다)
    }
  }

  function openSavedModal(open) {
    const m = document.getElementById('savedModal'), b = document.getElementById('savedModalBack');
    setModal(m, b, open);
    if (open) renderSavedBuilds();
  }

