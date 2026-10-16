  /* ui/09-plan.js — 강화 플랜.
     tools/lib/uisrc.js 가 번호 순으로 이어 붙여 한 IIFE 로 감싼다(파일끼리 변수를 나눠 쓴다). */
  /* ---------- 강화 플랜 ----------
     「어느 기체를 먼저 강화할지」를 1~3순위로 묶어 두는 화면.
     파츠 구성은 담지 않는다 — 그건 저장 목록이 한다. 여기 담는 것은 **목표**뿐이다:
     기체 · 어디까지 강화할지(미강화/4단계/풀강) · 어떤 확장 스킬을 올릴지.

     순위를 옮기는 길을 둘 둔다. 드래그는 손잡이(⠿)에서 포인터 이벤트로 직접 만든다 —
     HTML5 드래그는 **터치에서 아예 안 걸려서**, 폰에서 쓰는 이 앱에서는 쓸 수 없다.
     그래도 드래그가 어려운 자리(보조기기·좁은 화면)가 있으니 카드마다 1·2·3 단추도 둔다. */
  const PLAN_KEY = 'gbo2.plan';
  const PLAN_RANKS = [1, 2, 3];

  /* ── 강화 수치 ──────────────────────────────────────────────
     기체마다 다른 「개방 전 상한치」는 **이미 데이터에 있다** — ms.fullst 의 네 번째
     항목 points 다(강화리스트 화면이 'N pt' 로 보여 주는 그 값). 5·6단계 임계도
     다섯·여섯 번째에 있다. 1,655기 중 1,642기가 5단계 = 4단계×2, 1,646기가
     6단계 = ×3 이지만 **어긋나는 기체가 13기 있어** 배수로 짐작하지 않고 실제 값을 쓴다.
     네 번째 값이 비어 있는 기체가 50기 있다 — 그건 숫자를 지어내지 않고 그렇게 적는다.

     규칙(사용자 제공):
       ① 강화 1회 = 70시간, 100pt
       ② 티켓 1장 = 5시간 단축 (14장 = 70시간)
       ③ 티켓을 겹쳐 최대 10배 부스트 (140장 = 1000pt)
       ④ 성공 · 대성공(2배) · 초성공(3배)
       ⑤ 기체 중복 획득 시 **개방 전 상한치**의 등급별 %
       ⑥ 3배 이벤트면 중복 보상 ×3
       ⑦ 4→5, 5→6 개방은 두 번이고 비용은 등급별 개량 키트 + DP

     ①②③이 한 자로 맞아떨어진다: 14장 ↔ 70시간 ↔ 100pt. 그래서 B배 작업은
     70B 시간 또는 14B 장이고 100B pt 를 준다(상한 B=10). 이 해석을 화면에도 적어 둔다. */
  const PLAN_HOURS_PER_RUN = 70;      // 1배 작업에 드는 시간
  const PLAN_PT_PER_RUN = 100;        // 1배 작업이 주는 pt
  const PLAN_HOURS_PER_TICKET = 5;    // 티켓 1장이 대신하는 시간
  const PLAN_MAX_BOOST = 10;
  // 중복 획득 보상 — 개방 전 상한치에 대한 %
  const PLAN_DUP_PCT = { 1: 15, 2: 22.5, 3: 35, 4: 45, 5: 60 };
  /* 개방 비용 — 등급별, 1차(4→5) · 2차(5→6). 키트는 등급별로 종류가 다르다. */
  const PLAN_OPEN_COST = {
    1: [{ kit: 150, dp: 40000 }, { kit: 300, dp: 50000 }],
    2: [{ kit: 150, dp: 60000 }, { kit: 300, dp: 70000 }],
    3: [{ kit: 150, dp: 80000 }, { kit: 300, dp: 100000 }],
    4: [{ kit: 150, dp: 160000 }, { kit: 300, dp: 240000 }],
    5: [{ kit: 150, dp: 240000 }, { kit: 300, dp: 360000 }]
  };

  /** 이 기체의 강화 임계치 — { cap4, p5, p6 }. 자료에 없으면 그 자리가 null. */
  function planThresholds(ms) {
    const f = (ms && Array.isArray(ms.fullst)) ? ms.fullst : [];
    const pt = i => (f[i] && f[i].points != null) ? Number(f[i].points) : null;
    return { cap4: pt(3), p5: pt(4), p6: pt(5) };
  }

  /** 목표 단계에서 채워야 하는 pt. 미강화면 0, 자료가 없으면 null. */
  function planGoalPt(ms, stage) {
    const t = planThresholds(ms);
    if (stage === 0) return 0;
    if (stage === 4) return t.cap4;
    return t.p6;                      // 풀강
  }
  let planItems = [];              // { id, ms, stage, exp, expLevel, rank }
  let planEdit = null;             // 지금 모달에서 고치고 있는 항목 (새 항목이면 id 없음)
  let planFilter = { attr: '', cost: 'all', lv: 'all', rarity: 'all', rank: 'all' };
  let planSel = null;              // 우측 계산이 보고 있는 항목 id
  let planFocusKey = null;         // 다시 그린 뒤 돌려놓을 입력칸
  // 계산 가정 — 항목이 아니라 화면 전체에 걸린다 (이벤트·부스트는 그때그때 같은 조건이다)
  const PLAN_OPT_KEY = 'gbo2.planOpt';
  let planOpt = { boost: 1, succ: 1, x3: false };
  try {
    const o = JSON.parse(localStorage.getItem(PLAN_OPT_KEY) || '{}');
    if (o && typeof o === 'object') {
      planOpt.boost = Math.min(Math.max(Number(o.boost) || 1, 1), PLAN_MAX_BOOST);
      planOpt.succ = [1, 2, 3].includes(Number(o.succ)) ? Number(o.succ) : 1;
      planOpt.x3 = !!o.x3;
    }
  } catch { /* 무시 */ }
  const savePlanOpt = () => {
    try { localStorage.setItem(PLAN_OPT_KEY, JSON.stringify(planOpt)); } catch { /* 무시 */ }
  };

  const PLAN_EXP_SLOTS = 3;         // 확장 스킬 1~3순위
  const PLAN_MEMO_MAX = 10;         // 메모 글자 수 — 박스가 좁아 이보다 길면 읽을 수가 없다

  /* 플랜의 확장 스킬은 **늘 최대 레벨**이다 — 올릴 거면 끝까지 올리는 것이 전제라
     고를 것이 없다. 그래서 레벨 칸을 두지 않는다(요청). 저장할 때도 레벨은 안 남긴다.
     쓰는 쪽이 늘 이 값을 보도록 상수로 둔다. */
  const PLAN_EXP_LEVEL = C.MAX_EXPANSION_LEVEL;

  /** 저장된 항목에서 확장 스킬 목록을 꺼낸다. 길이는 늘 3이고 빈 칸은 '확장 없음'. */
  function planExpsOf(x) {
    const out = [];
    if (Array.isArray(x && x.exps)) {
      for (const e of x.exps.slice(0, PLAN_EXP_SLOTS))
        out.push({ name: typeof (e && e.name) === 'string' ? e.name : C.EXPANSION_NONE });
    } else if (x && typeof x.exp === 'string') {
      out.push({ name: x.exp });                              // 하나만 담던 옛 저장분
    }
    while (out.length < PLAN_EXP_SLOTS) out.push({ name: C.EXPANSION_NONE });
    return out;
  }
  /** 실제로 고른 확장만 (빈 칸 제외). */
  const planExpPicked = it => (it.exps || []).filter(e => e.name !== C.EXPANSION_NONE);

  function loadPlan() {
    try {
      const raw = JSON.parse(localStorage.getItem(PLAN_KEY) || '[]');
      planItems = (Array.isArray(raw) ? raw : []).filter(x => x && x.ms).map(x => ({
        id: String(x.id || (Date.now() + '-' + Math.random().toString(36).slice(2, 7))),
        ms: String(x.ms),
        stage: [0, 4, 6].includes(Number(x.stage)) ? Number(x.stage) : 6,
        /* 확장 스킬은 1~3순위로 **최대 셋**이다. 예전에 하나만 담던 저장분(exp/expLevel)도
           그대로 읽어 첫 칸에 넣는다 — 쓰던 플랜이 열었더니 비어 있으면 안 된다. */
        exps: planExpsOf(x),
        rank: PLAN_RANKS.includes(Number(x.rank)) ? Number(x.rank) : 1,
        now: Math.max(0, Number(x.now) || 0),     // 지금까지 쌓은 강화 pt
        dup: Math.max(0, Number(x.dup) || 0),     // 쓸 수 있는 중복 기체 수
        /* 메모 — 박스에 붙여 둘 한마디. 칸이 좁아 10글자까지다.
           저장된 것이 더 길면(손으로 고쳤거나 옛 저장분) 여기서 자른다 — 화면만 막으면 샌다. */
        memo: String(x.memo == null ? '' : x.memo).slice(0, PLAN_MEMO_MAX)
      }));
    } catch { planItems = []; }
  }
  function savePlan() {
    try { localStorage.setItem(PLAN_KEY, JSON.stringify(planItems)); } catch { /* 무시 */ }
  }

  /** 이 항목의 기체 데이터. 데이터가 갱신돼 이름이 사라졌으면 null — 카드가 그 사실을 적는다. */
  const planMsOf = it => msData.find(m => m.MS名 === it.ms) || null;

  function planPasses(it) {
    const f = planFilter;
    if (f.rank !== 'all' && it.rank !== f.rank) return false;
    const ms = planMsOf(it);
    // 기체를 못 찾으면 기체 기준 필터로는 거르지 않는다 — 조용히 사라지면 지울 수도 없다
    if (!ms) return f.attr === '' && f.cost === 'all' && f.lv === 'all' && f.rarity === 'all';
    if (f.attr && ms.属性 !== f.attr) return false;
    if (f.cost === 'low') { if (ms.コスト > 250) return false; }
    else if (f.cost !== 'all' && ms.コスト !== f.cost) return false;
    if (f.lv === '4+') { if (msLevel(ms) < 4) return false; }
    else if (f.lv !== 'all' && msLevel(ms) !== f.lv) return false;
    if (f.rarity !== 'all' && msRarity(ms) !== f.rarity) return false;
    return true;
  }

  /**
   * 한 항목의 강화 셈. 숫자를 못 구하면 그 자리를 null 로 두고 why 에 이유를 남긴다 —
   * 모르는 값을 0 으로 적으면 「다 됐다」로 읽힌다.
   */
  function planCalc(it) {
    const ms = planMsOf(it);
    if (!ms) return { why: '데이터에 없는 기체입니다 — 자료가 갱신되며 이름이 바뀌었을 수 있습니다.' };
    const rar = msRarity(ms);
    const th = planThresholds(ms);
    const goal = planGoalPt(ms, it.stage);
    if (goal == null) {
      return { why: '이 기체는 강화 pt 자료가 없습니다 (원본·위키 어디에도 없는 기체 50기 중 하나).',
        ms, rar, th };
    }
    const now = Math.min(it.now || 0, goal);
    const left = Math.max(0, goal - now);

    // ⑤⑥ 중복 보상 — 개방 전 상한치의 등급별 %, 3배 이벤트면 ×3
    const pct = PLAN_DUP_PCT[rar] || null;
    const dupOne = (pct != null && th.cap4 != null)
      ? Math.round(th.cap4 * pct / 100) * (planOpt.x3 ? 3 : 1) : null;
    const dupGot = dupOne != null ? Math.min(dupOne * (it.dup || 0), left) : 0;
    const afterDup = Math.max(0, left - dupGot);

    // ①②③④ 강화 작업
    const B = planOpt.boost, S = planOpt.succ;
    const perRun = PLAN_PT_PER_RUN * B * S;
    const runs = perRun > 0 ? Math.ceil(afterDup / perRun) : 0;
    const hours = runs * PLAN_HOURS_PER_RUN * B;
    const tickets = runs * (PLAN_HOURS_PER_RUN * B / PLAN_HOURS_PER_TICKET);

    // ⑦ 개방 — 풀강이 목표일 때만. 4→5, 5→6 두 번.
    const open = it.stage === 6 ? (PLAN_OPEN_COST[rar] || null) : null;
    const openSum = open
      ? { kit: open[0].kit + open[1].kit, dp: open[0].dp + open[1].dp } : null;

    return { ms, rar, th, goal, now, left, pct, dupOne, dupGot, afterDup,
      runs, hours, tickets, open, openSum };
  }

  const planHours = h => h >= 24
    ? Math.floor(h / 24) + '일 ' + (h % 24) + '시간'
    : h + '시간';

  function renderPlanCalc() {
    const box = $('#planCalc');
    if (!box) return;
    box.innerHTML = '';
    box.append(el('h3', '', '강화 수치'));

    const shown = planItems.filter(planPasses);
    // 어느 것을 볼지는 renderPlan 이 카드를 그리기 전에 정해 둔다 (테두리와 어긋나지 않게)
    const it = planItems.find(x => x.id === planSel) || null;
    if (!it) {
      box.append(el('div', 'pc-empty', '박스를 추가하고 누르면 여기에 강화 계산이 나옵니다.'));
      return;
    }

    const r = planCalc(it);
    box.append(el('div', 'pc-ms', r.ms ? T.msName(r.ms.MS名) : it.ms));
    box.append(el('div', 'pc-sub',
      (r.ms ? '★'.repeat(r.rar || 0) + ' · ' : '') + '목표 ' + (STAGE_LABEL[it.stage] || it.stage)));

    if (r.why) { box.append(el('div', 'pc-warn', r.why)); return; }

    const line = (label, value, cls) => {
      const d = el('div', 'pc-line');
      d.append(el('span', '', label));
      d.append(el('b', cls || '', value));
      box.append(d);
      return d;
    };
    /* 머리줄. help 를 주면 ? 를 달고, 누르면 그 아래에 설명을 펼친다.
       설명을 늘 펼쳐 두면 자리만 먹고(요청으로 지웠다), 툴팁은 폰에서 안 뜬다 —
       ? 는 둘 다 피한다. */
    const sec = (title, help) => {
      const d = el('div', 'pc-sec');
      d.append(el('b', '', title));
      box.append(d);
      if (help) {
        const q = el('button', 'pc-help', '?');
        q.type = 'button';
        q.title = '설명 보기';
        q.setAttribute('aria-label', title + ' 설명');
        d.querySelector('b').append(q);
        const note = el('div', 'pc-note');
        note.hidden = true;
        note.textContent = help;
        q.onclick = () => { note.hidden = !note.hidden; q.classList.toggle('on', !note.hidden); };
        box.append(note);
      }
      return d;
    };
    /* 값이 바뀌면 패널을 통째로 다시 그린다 — 그러면 **치던 칸의 포커스가 날아간다.**
       다시 그린 뒤 같은 칸으로 돌려놓는다(어느 칸이었는지는 key 로 기억한다). */
    const numInput = (key, val, onSet) => {
      const i = el('input');
      i.type = 'number'; i.min = '0'; i.value = String(val || 0);
      i.dataset.k = key;
      i.oninput = () => { planFocusKey = key; onSet(Math.max(0, Number(i.value) || 0)); };
      return i;
    };

    sec('목표');
    line('개방 전 상한치 (4단계)', r.th.cap4 == null ? '자료 없음' : r.th.cap4.toLocaleString() + ' pt');
    if (it.stage === 6) line('풀강 임계', r.th.p6 == null ? '자료 없음' : r.th.p6.toLocaleString() + ' pt');
    const nowRow = el('div', 'pc-line');
    nowRow.append(el('span', '', '지금까지 쌓은 pt'));
    nowRow.append(numInput('now', it.now, v => { it.now = v; savePlan(); renderPlanCalc(); }));
    box.append(nowRow);
    line('남은 pt', r.left.toLocaleString() + ' pt', 'pc-big');

    sec('기체 중복');
    // 3배 이벤트는 바로 아래 「등급 보상」을 바꾸는 스위치다 — 바꾸는 값 **위에** 둔다
    const x3 = el('label', 'pc-chk');
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = planOpt.x3;
    cb.onchange = () => { planOpt.x3 = cb.checked; savePlanOpt(); renderPlanCalc(); };
    x3.append(cb, el('span', '', '3배 이벤트 (중복 보상 ×3)'));
    box.append(x3);
    line('등급 보상 (상한치의 ' + (r.pct != null ? r.pct + '%' : '—') + ')',
      r.dupOne == null ? '자료 없음' : '+' + r.dupOne.toLocaleString() + ' pt');
    const dupRow = el('div', 'pc-line');
    dupRow.append(el('span', '', '쓸 중복 기체 수'));
    dupRow.append(numInput('dup', it.dup, v => { it.dup = v; savePlan(); renderPlanCalc(); }));
    box.append(dupRow);
    line('중복으로 채우는 pt', '−' + r.dupGot.toLocaleString() + ' pt');

    sec('강화 작업',
      '티켓 1장 = 5시간, 14장 = 70시간 = 100pt 로 봅니다. '
      + '×B 작업은 ' + PLAN_HOURS_PER_RUN + 'B 시간(또는 14B장)을 쓰고 ' + PLAN_PT_PER_RUN + 'B pt 를 줍니다.\n'
      + '「결과 가정」은 그 결과가 계속 나왔다고 쳤을 때입니다 — 기댓값이 아닙니다. '
      + '초성공 ×3 으로 보면 숫자가 3분의 1로 줄어듭니다.');
    const bRow = el('div', 'pc-line');
    bRow.append(el('span', '', '부스트'));
    const bSel = el('select');
    for (let b = 1; b <= PLAN_MAX_BOOST; b++) bSel.append(new Option('×' + b, String(b)));
    bSel.value = String(planOpt.boost);
    bSel.onchange = () => { planOpt.boost = Number(bSel.value); savePlanOpt(); renderPlanCalc(); };
    bRow.append(bSel);
    box.append(bRow);

    const sRow = el('div', 'pc-line');
    sRow.append(el('span', '', '결과 가정'));
    const sSel = el('select');
    // 주의는 「강화 작업」 머리의 ? 안에 있다 (툴팁은 폰에서 안 뜬다)
    [[1, '성공'], [2, '대성공 ×2'], [3, '초성공 ×3']].forEach(([v, t]) => sSel.append(new Option(t, String(v))));
    sSel.value = String(planOpt.succ);
    sSel.onchange = () => { planOpt.succ = Number(sSel.value); savePlanOpt(); renderPlanCalc(); };
    sRow.append(sSel);
    box.append(sRow);

    line('남은 작업', r.runs.toLocaleString() + '회 (1회 ' + (PLAN_PT_PER_RUN * planOpt.boost * planOpt.succ).toLocaleString() + ' pt)');
    line('기다리면', planHours(r.hours));
    line('티켓으로 다 건너뛰면', r.tickets.toLocaleString() + '장', 'pc-big');

    if (r.open) {
      sec('개방 (4→5, 5→6)');
      line('개량 키트[' + '★'.repeat(r.rar) + ']', r.openSum.kit.toLocaleString() + '개');
      line('DP', r.openSum.dp.toLocaleString() + ' DP');
    }

    /* 여기는 **고른 기체 하나**만 본다. 플랜 전체 합계는 순위마다 아래에 붙어 있다 —
       같은 숫자를 두 군데 적으면 어느 쪽을 보는지 헷갈린다. */

    // 치던 칸으로 돌려놓는다 (커서는 끝으로 — 숫자 칸이라 그 편이 이어 치기 좋다)
    if (planFocusKey) {
      const back = box.querySelector('input[data-k="' + planFocusKey + '"]');
      planFocusKey = null;
      if (back) {
        back.focus();
        try { back.setSelectionRange(back.value.length, back.value.length); } catch { /* number 칸은 막힐 수 있다 */ }
      }
    }
  }

  function openPlan(open) {
    if (!open) { setView(AUX_BACK); return; }
    setView('plan');
    renderPlan();
  }

  function renderPlan() {
    const body = $('#planBody');
    if (!body) return;
    body.innerHTML = '';
    const shown = planItems.filter(planPasses);
    /* 고른 것이 없거나 걸러져 사라졌으면 맨 앞을 고른다 — **카드를 그리기 전에** 정해야
       테두리가 같이 칠해진다. 예전엔 계산 패널에서 뒤늦게 정해서, 계산은 어떤 기체를
       보고 있는데 카드에는 아무 표시가 없었다. */
    if (!shown.some(x => x.id === planSel)) planSel = shown.length ? shown[0].id : null;
    const note = $('#planNote');
    if (note) note.textContent = planItems.length
      ? (shown.length === planItems.length ? planItems.length + '개' : shown.length + ' / ' + planItems.length + '개')
      : '';

    for (const rank of PLAN_RANKS) {
      const zone = el('div', 'plan-zone');
      const mine = shown.filter(it => it.rank === rank);
      const head = el('div', 'plan-zone-head');
      head.append(el('span', '', rank + '순위'));
      head.append(el('span', 'pz-count', mine.length + '개'));
      zone.append(head);

      const drop = el('div', 'plan-drop');
      drop.dataset.rank = String(rank);
      if (!mine.length) {
        drop.append(el('div', 'plan-empty',
          planItems.length ? '여기로 끌어다 놓거나, ＋로 추가하세요.' : '＋로 기체를 추가하세요.'));
      }
      for (const it of mine) drop.append(planCard(it));

      const add = el('button', 'plan-add', '＋ 기체 추가');
      add.onclick = () => openPlanEdit(null, rank);
      drop.append(add);
      zone.append(drop);

      /* 순위마다 도합 — 「이 순위를 끝내려면 무엇이 얼마나」. 우측 계산과 **같은 함수**를
         쓴다(planCalc). 여기서 따로 세면 둘이 갈라진다. 셀 수 없는 항목은 숨기지 않고
         몇 개인지 적는다 — 조용히 빠지면 합계가 작게 보인다. */
      const foot = el('div', 'plan-foot');
      /* 개량 키트는 **등급마다 다른 물건**이다(개량 키트[★] ≠ [★★★]). 한 숫자로 합치면
         가진 것과 맞춰 볼 수가 없다 — 등급별로 쪼갠다. DP 는 하나로 합쳐도 된다. */
      const kitBy = {};
      let dp = 0;
      const skipped = [];
      for (const x of mine) {
        const c = planCalc(x);
        if (c.why) { skipped.push({ ms: x.ms, why: c.why }); continue; }
        if (!c.openSum) continue;              // 풀강이 목표일 때만 개방 비용이 든다
        kitBy[c.rar] = (kitBy[c.rar] || 0) + c.openSum.kit;
        dp += c.openSum.dp;
      }
      if (mine.length) {
        foot.append(el('span', 'pf-lb', rank + '순위 도합'));
        const rars = Object.keys(kitBy).sort((a, b) => a - b);
        if (rars.length) {
          for (const r of rars)
            foot.append(el('span', 'pf-v', '개량 키트[' + '★'.repeat(Number(r)) + '] ' + kitBy[r].toLocaleString() + '개'));
          foot.append(el('span', 'pf-v', dp.toLocaleString() + ' DP'));
        } else {
          foot.append(el('span', 'pf-dim', '개방 비용 없음 (풀강 목표가 없습니다)'));
        }
        /* 뺀 것은 **무엇을 왜** 뺐는지 적는다. 개수만 적으면 합계가 왜 작은지 알 수 없고,
           조용히 빼면 다 됐다고 읽힌다. */
        if (skipped.length) {
          const names = skipped.map(s => {
            const m = msData.find(x => x.MS名 === s.ms);
            return m ? T.msName(m.MS名) : s.ms;
          });
          const why = skipped.every(s => /강화 pt 자료가 없습니다/.test(s.why))
            ? '강화 pt 가 원본·위키 어디에도 없어 셈할 수 없습니다'
            : '자료를 찾을 수 없어 셈할 수 없습니다';
          const d = el('span', 'pf-dim', '셈에서 뺌 — ' + names.join(', ') + ' : ' + why);
          d.title = skipped.map(s => s.ms + ' — ' + s.why).join('\n');
          foot.append(d);
        }
        zone.append(foot);
      }
      body.append(zone);
    }
    renderPlanCalc();
  }

  function planCard(it) {
    const ms = planMsOf(it);
    const card = el('div', 'plan-card');
    card.dataset.id = it.id;

    const grip = el('div', 'plan-grip', '⠿');
    grip.title = '끌어서 순위 옮기기';
    card.append(grip);
    planDragFrom(grip, card, it);

    if (ms) card.append(img(msImg(ms.MS名), 'ms', ms.MS名));

    const main = el('div', 'plan-main');
    main.append(el('div', 'plan-name', ms ? T.msName(ms.MS名) : it.ms));

    const tags = el('div', 'plan-tags');
    if (ms) {
      tags.append(el('span', '', T.attrName(ms.属性) || '-'));
      tags.append(el('span', '', '코스트 ' + ms.コスト));
      const r = msRarity(ms);
      if (r) tags.append(el('span', '', r + '성'));
    } else {
      // 데이터에서 사라진 기체 — 말없이 비우지 않고 그대로 적는다
      tags.append(el('span', '', '데이터에 없는 기체'));
    }
    tags.append(el('span', 'pt-goal', STAGE_LABEL[it.stage] || String(it.stage)));
    // 확장은 고른 순서가 곧 순위다 — ①②③ 로 적어 어느 것을 먼저 올릴지 보이게
    planExpPicked(it).forEach((e, i) => {
      // 레벨은 늘 최대라 칸에 적지 않는다 (적어 봐야 모두 같은 글자다) — 설명에만 남긴다
      const t = el('span', 'pt-goal', '①②③'[i] + ' ' + expShort(e.name));
      t.title = (i + 1) + '순위 확장 — ' + (C.EXPANSION_LABEL[e.name] || e.name) + ' LV' + PLAN_EXP_LEVEL;
      tags.append(t);
    });
    main.append(tags);

    /* 메모 — 사용자가 적어 둔 한마디. 속성·코스트 같은 자동 꼬리표와 섞이면 묻히므로
       줄을 따로 두고 색을 달리한다. 비어 있으면 줄 자체를 만들지 않는다(빈 자리를 안 먹게). */
    if (it.memo) {
      const m = el('div', 'plan-memo', it.memo);
      m.title = '메모 — ' + it.memo;
      main.append(m);
    }

    // 드래그를 못 쓰는 자리를 위한 두 번째 길
    const move = el('div', 'plan-move');
    for (const r of PLAN_RANKS) {
      const b = el('button', r === it.rank ? 'on' : '', String(r));
      b.title = r + '순위로 옮기기';
      b.onclick = ev => {
        ev.stopPropagation();
        if (r === it.rank) return;
        it.rank = r; savePlan(); renderPlan();
      };
      move.append(b);
    }
    main.append(move);
    card.append(main);

    /* 누르면 **우측 계산이 이 박스를 본다.** 고치기는 ✎ 로 따로 뺐다 —
       누를 때마다 설정 칸이 뜨면 계산을 볼 수가 없다. */
    card.classList.toggle('sel', planSel === it.id);
    card.title = (ms ? T.msName(ms.MS名) : it.ms) + ' — 눌러서 강화 계산 보기';
    card.onclick = () => { planSel = it.id; renderPlan(); };

    const edit = el('button', 'plan-edit-btn', '✎');
    edit.title = '고치기';
    edit.setAttribute('aria-label', '고치기');
    edit.onclick = ev => { ev.stopPropagation(); openPlanEdit(it, it.rank); };
    card.append(edit);
    return card;
  }

  /* 포인터로 끄는 드래그. 손잡이에서만 시작한다 — 카드 전체에 touch-action: none 을 걸면
     목록 스크롤이 죽는다. 임계값(6px)을 넘겨야 끌기로 보고, 그 전엔 그냥 눌린 것이다. */
  function planDragFrom(handle, card, it) {
    handle.addEventListener('pointerdown', down => {
      if (down.button != null && down.button > 0) return;
      down.preventDefault();
      const x0 = down.clientX, y0 = down.clientY;
      let ghost = null, overBox = null;
      const rect = card.getBoundingClientRect();
      const dx = x0 - rect.left, dy = y0 - rect.top;

      const start = () => {
        ghost = card.cloneNode(true);
        ghost.classList.add('ghost');
        ghost.style.width = rect.width + 'px';
        document.body.append(ghost);
        card.classList.add('dragging');
        document.body.classList.add('plan-dragging');
      };
      const paint = (ev) => {
        ghost.style.left = (ev.clientX - dx) + 'px';
        ghost.style.top = (ev.clientY - dy) + 'px';
        // 손가락 아래 있는 받는 자리 — 유령은 pointer-events: none 이라 가리지 않는다
        const under = document.elementFromPoint(ev.clientX, ev.clientY);
        const box = under && under.closest ? under.closest('.plan-drop') : null;
        if (box !== overBox) {
          if (overBox) overBox.classList.remove('over');
          overBox = box;
          if (overBox) overBox.classList.add('over');
        }
      };
      const move = ev => {
        if (!ghost && Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 6) return;
        if (!ghost) start();
        paint(ev);
      };
      const up = ev => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        if (!ghost) return;                       // 끌지 않았다 — 그냥 누른 것
        ghost.remove();
        card.classList.remove('dragging');
        document.body.classList.remove('plan-dragging');
        if (overBox) overBox.classList.remove('over');
        const rank = overBox ? Number(overBox.dataset.rank) : null;
        ev.stopPropagation();
        if (!rank || rank === it.rank) return;
        it.rank = rank; savePlan(); renderPlan();
      };
      // 손잡이가 포인터를 붙잡아 둔다 — 그래야 카드를 다시 그려도 끌기가 끊기지 않는다
      try { handle.setPointerCapture(down.pointerId); } catch { /* 무시 */ }
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  }

  function openPlanEdit(it, rank) {
    // exps 는 **얕은 복사로는 안 된다** — 취소해도 원본이 같이 바뀐다
    planEdit = it
      ? { ...it, exps: it.exps.map(e => ({ ...e })) }
      : { ms: '', stage: 6, exps: planExpsOf(null), rank: rank || 1, now: 0, dup: 0, memo: '' };
    $('#planEditTitle').textContent = it ? '강화 플랜 고치기' : '강화 플랜 추가';
    $('#planDelete').hidden = !it;
    syncPlanEdit();
    setModal($('#planEditModal'), $('#planEditBack'), true);
  }
  function closePlanEdit() {
    setModal($('#planEditModal'), $('#planEditBack'), false);
    planEdit = null;
  }

  /** 모달의 칸들을 planEdit 에서 다시 칠한다 (한 방향으로만 흐르게 — 손으로 토글하면 어긋난다). */
  function syncPlanEdit() {
    if (!planEdit) return;
    const ms = msData.find(m => m.MS名 === planEdit.ms) || null;
    // 칸이 좁아 이름이 잘릴 수 있다 — 전체 이름은 title 로 남긴다
    $('#planPickMs').textContent = ms ? T.msName(ms.MS名) : '+ 기체 선택';
    $('#planPickMs').title = ms ? T.msName(ms.MS名) : '기체를 고릅니다';
    for (const b of document.querySelectorAll('#planStageSeg .seg-btn'))
      b.classList.toggle('on', Number(b.dataset.v) === planEdit.stage);
    for (const b of document.querySelectorAll('#planRankSeg .seg-btn'))
      b.classList.toggle('on', Number(b.dataset.v) === planEdit.rank);
    for (let i = 0; i < PLAN_EXP_SLOTS; i++) {
      const e = planEdit.exps[i];
      const sel = $('#planExp' + i);
      if (!sel) continue;
      sel.value = e.name;
    }
    const memo = $('#planMemo');
    if (memo) {
      // 치는 중에 커서가 튀지 않게, 값이 실제로 다를 때만 넣는다
      if (memo.value !== (planEdit.memo || '')) memo.value = planEdit.memo || '';
      const cnt = $('#planMemoCount');
      if (cnt) cnt.textContent = (planEdit.memo || '').length + '/' + PLAN_MEMO_MAX;
    }

    /* 같은 기체를 플랜에 두 번 담지 않는다 — 두 줄이 서로 다른 목표를 말하면
       합계도 순위도 뜻을 잃는다. 고치는 중인 자기 자신은 빼고 본다. */
    const dup = planEdit.ms
      ? planItems.find(x => x.ms === planEdit.ms && x.id !== planEdit.id) : null;
    $('#planSave').disabled = !planEdit.ms || !!dup;
    $('#planEditNote').textContent = !planEdit.ms ? '기체를 먼저 고르세요.'
      : dup ? '이미 플랜에 있습니다 (' + dup.rank + '순위) — 그 박스를 고치세요.' : '';
  }

  function initPlan() {
    loadPlan();

    // 강화 단계 · 순위 — 칸을 코드에 박지 않고 목록에서 만든다
    const stageSeg = $('#planStageSeg');
    for (const v of [0, 4, 6]) {
      const b = el('button', 'seg-btn', STAGE_LABEL[v]);
      b.type = 'button'; b.dataset.v = String(v);
      b.onclick = () => { planEdit.stage = v; syncPlanEdit(); };
      stageSeg.append(b);
    }
    const rankSeg = $('#planRankSeg');
    for (const v of PLAN_RANKS) {
      const b = el('button', 'seg-btn', v + '순위');
      b.type = 'button'; b.dataset.v = String(v);
      b.onclick = () => { planEdit.rank = v; syncPlanEdit(); };
      rankSeg.append(b);
    }

    // 확장 스킬 1~3순위 — 목록은 파츠 화면과 **같은 것**을 쓴다
    const expBox = $('#planExpRows');
    for (let i = 0; i < PLAN_EXP_SLOTS; i++) {
      const row = el('div', 'pe-row');
      const lb = el('label', '', '확장 ' + (i + 1) + '순위');
      lb.htmlFor = 'planExp' + i;
      row.append(lb);

      // 레벨 칸은 두지 않는다 — 플랜의 확장은 늘 LV5 다(요청). 스킬만 고른다.
      const sel = el('select', 'pe-exp pe-exp-wide');
      sel.id = 'planExp' + i;
      sel.title = '확장 스킬 (LV' + PLAN_EXP_LEVEL + ' 기준)';
      for (const name of C.EXPANSION_SKILLS) sel.append(new Option(C.EXPANSION_LABEL[name] || name, name));
      sel.onchange = () => { planEdit.exps[i].name = sel.value; syncPlanEdit(); };

      row.append(sel);
      expBox.append(row);
    }

    // 기체 선택은 「기체 변경」 서랍을 그대로 빌린다 — 목록·필터·검색이 이미 한 벌 있다
    $('#planPickMs').onclick = () => openMsDrawer(true, m => {
      planEdit.ms = m.MS名;
      openMsDrawer(false);
      syncPlanEdit();
    });

    /* 메모 — maxlength 로 막히지만 **붙여넣기·IME 조합**은 넘어올 수 있어 여기서도 자른다.
       화면에서만 막으면 저장소에 긴 값이 들어가고, 그러면 박스가 터진다. */
    const memoInp = $('#planMemo');
    if (memoInp) memoInp.oninput = () => {
      const v = memoInp.value.slice(0, PLAN_MEMO_MAX);
      if (memoInp.value !== v) memoInp.value = v;
      if (planEdit) planEdit.memo = v;
      const cnt = $('#planMemoCount');
      if (cnt) cnt.textContent = v.length + '/' + PLAN_MEMO_MAX;
    };

    $('#planSave').onclick = () => {
      if (!planEdit || !planEdit.ms) return;
      // 단추를 막아 두지만 여기서도 본다 — 막는 곳이 화면뿐이면 언젠가 샌다
      if (planItems.some(x => x.ms === planEdit.ms && x.id !== planEdit.id)) { syncPlanEdit(); return; }
      if (planEdit.id) {
        const i = planItems.findIndex(x => x.id === planEdit.id);
        if (i >= 0) planItems[i] = { ...planEdit };
      } else {
        const id = Date.now() + '-' + Math.random().toString(36).slice(2, 7);
        planItems.push({ ...planEdit, id });
        planSel = id;        // 방금 만든 것을 우측 계산이 바로 보게 한다
      }
      savePlan();
      closePlanEdit();
      renderPlan();
    };
    $('#planDelete').onclick = () => {
      if (!planEdit || !planEdit.id) return;
      if (planSel === planEdit.id) planSel = null;
      planItems = planItems.filter(x => x.id !== planEdit.id);
      savePlan();
      closePlanEdit();
      renderPlan();
    };
    $('#planEditClose').onclick = closePlanEdit;
    $('#planEditBack').onclick = closePlanEdit;

    // 상단 필터 — 기체 선택 화면과 **같은 칩 목록**을 쓴다(따로 두면 어긋난다)
    const planChips = (boxSel, items, key) => {
      const box = $(boxSel);
      if (!box) return;
      for (const it of items) {
        const chip = el('button', 'chip' + (planFilter[key] === it.v ? ' on' : '') + (it.cls ? ' ' + it.cls : ''), it.label);
        chip.onclick = () => {
          planFilter[key] = it.v;
          [...box.children].forEach(c => c.classList.remove('on'));
          chip.classList.add('on');
          renderPlan();
        };
        box.append(chip);
      }
    };
    planChips('#planAttrChips',
      [{ label: '전체', v: '' },
       { label: T.attrName('強襲'), v: '強襲', cls: 'attr-強襲' },
       { label: T.attrName('汎用'), v: '汎用', cls: 'attr-汎用' },
       { label: T.attrName('支援'), v: '支援', cls: 'attr-支援' }], 'attr');
    planChips('#planCostChips', COST_CHIPS, 'cost');
    planChips('#planLvChips', LEVEL_CHIPS, 'lv');
    planChips('#planRarityChips', RARITY_CHIPS, 'rarity');
    planChips('#planRankChips',
      [{ label: '전체', v: 'all' }].concat(PLAN_RANKS.map(r => ({ label: r + '순위', v: r }))), 'rank');
  }

