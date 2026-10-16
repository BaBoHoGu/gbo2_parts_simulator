  /* ui/06-auto.js — 자동 구성.
     tools/lib/uisrc.js 가 번호 순으로 이어 붙여 한 IIFE 로 감싼다(파일끼리 변수를 나눠 쓴다). */
  /* ---------- 자동 구성 ---------- */

  // 파생 지표 목표 — 공격=실효 보정, 내구=실효 내성(armor 단위). % 파츠를 반영한 "체감 스탯"을 원시 스탯과 같은 단위로 목표 지정.
  const DERIVED_KEYS = ['effShoot', 'effMelee', 'durSolid', 'durBeam', 'durMelee',
    'ehpSolid', 'ehpBeam', 'ehpMelee'];
  const DERIVED_LABEL = { effShoot: '공격 사격', effMelee: '공격 격투',
    durSolid: '내구 실탄', durBeam: '내구 빔', durMelee: '내구 격투',
    ehpSolid: '실효 HP 실탄', ehpBeam: '실효 HP 빔', ehpMelee: '실효 HP 격투' };

  /** 파츠 집합의 파생 지표(공격 지표·내구 지표) — 성능표와 동일 계산. */
  function derivedMetrics(equipped, total) {
    const lv = msLevel(state.ms);
    const atkB = partAttackBonus(equipped, lv);
    const eff = (corr, key) => {
      const mul = (1 + atkB[key] / 100) * skillDmgPctList(key).reduce((m, p) => m * (1 + p / 100), 1);
      return Math.round(((1 + corr / 100) * mul - 1) * 100);
    };
    const cuts = damageCutsOf(equipped, { lv, skillMs: state.ms });
    // 내구 지표 = 실효 내성(armor 단위). 내성값과 피해경감 %를 합쳐 "체감 내성"으로 환산한다.
    // 예: armor 40 + 피해경감 10% → 100×(1 − 0.6×0.9) = 46. 목표 '50'을 armor처럼 지정.
    const dur = (key, dattr) => {
      const a = Math.min(total[key] || 0, 99);
      return Math.round(100 * (1 - (1 - a / 100) * staggerDmgFactor(cuts, dattr)));
    };
    // 실효 HP — 피탄 시뮬이 재는 것과 같은 값. 「N발 버티기」 목표가 쓴다.
    // 내구 지표(dur*)는 '내성' 단위라 HP 와 따로 놀아, 발수 조건을 그대로 담지 못한다.
    //
    // 목표를 건 적 무장(goalWeapon)이 있으면 **그 무장에만 걸리는** 파츠 경감(관통·폭풍)까지
    // 함께 접는다. 피탄 시뮬은 「격파까지」를 낼 때 이미 그것을 넣고 있는데 여기서 빠져 있어,
    // 사용자가 본 숫자와 자동 구성이 재는 자가 서로 달랐다 — 관통 경감 장갑(−20%)·폭풍 경감
    // 장갑(−15%)이 목표 달성에 한 푼도 기여하지 않아, 정작 그 파츠를 뽑으라고 만든 기능이
    // 그 파츠를 뽑지 않았다.
    // dur* 는 무장을 특정하지 않는 지표라 그대로 둔다 — 조건부 경감은 ehp* 축에만 넣는다.
    const ehpCuts = goalWeapon ? [...cuts, ...conditionalPartCuts(equipped, goalWeapon)] : cuts;
    return {
      effShoot: eff(total.shoot, 'shoot'), effMelee: eff(total.meleeCorrection, 'melee'),
      durSolid: dur('armorRange', 'solid'), durBeam: dur('armorBeam', 'beam'), durMelee: dur('armorMelee', 'melee'),
      ehpSolid: enduranceOf(total, 'solid', ehpCuts), ehpBeam: enduranceOf(total, 'beam', ehpCuts),
      ehpMelee: enduranceOf(total, 'melee', ehpCuts)
    };
  }

  /** 지금 걸려 있는 목표 수를 알리고, 없으면 「목표 지우기」를 숨긴다. */
  function renderTargetBar() {
    const n = Object.keys(state.minimums).length + Object.keys(state.maximums).length;
    const note = $('#autoTargetNote'), btn = $('#clearTargets');
    // 실효 HP 목표는 '어느 무장 기준인가' 로 값이 달라진다(관통·폭풍 경감) — 그 무장을 밝힌다
    if (note) note.textContent = !n ? '걸어 둔 목표 없음'
      : `걸어 둔 목표 ${n}개` + (goalWeapon ? ` · 실효 HP 는 「${T.weaponName(goalWeapon.name)}」 기준` : '');
    if (btn) btn.hidden = !n;
  }

  function renderAutoGrid() {
    const box = $('#autoGrid');
    box.innerHTML = '';
    renderTargetBar();
    box.append(el('div', 'hd', '스탯'), el('div', 'hd', '가중치'), el('div', 'hd', '하한 목표'), el('div', 'hd', '상한 목표'));

    // 하한·상한 목표 입력 한 칸을 만든다 (store = state.minimums / state.maximums)
    const targetInput = (store, k) => {
      // 클래스로 표시해 둔다 — 가중치 칸과 생김새가 같아, 점검 도구가 자리로만 찾으면 섞인다
      const m = el('input', 'auto-tgt');
      m.type = 'number'; m.placeholder = '—';
      // 화면 읽기에 무슨 칸인지 — 칸 머리(하한/상한)와 줄 이름(스탯)이 떨어져 있어 이름이 따로 필요하다
      m.setAttribute('aria-label', (C.STAT_LABEL[k] || DERIVED_LABEL[k] || k) + (store === state.minimums ? ' 하한 목표' : ' 상한 목표'));
      m.value = store[k] ?? '';
      m.oninput = () => {
        const v = Number(m.value);
        if (m.value === '' || isNaN(v)) delete store[k];
        else store[k] = v;
        state.weightsTouched = true;
        renderTargetBar();
      };
      return m;
    };

    for (const k of C.STAT_KEYS) {
      box.append(el('div', 'lb', C.STAT_LABEL[k]));

      const w = el('input');
      w.type = 'number'; w.step = '0.5'; w.min = '0';
      w.setAttribute('aria-label', C.STAT_LABEL[k] + ' 가중치');
      w.value = state.weights[k] ?? 0;
      // 0 보다 큰 항목에 테두리 강조 — 어떤 스탯을 노리는지 한눈에 보이게
      const mark = () => w.classList.toggle('active', Number(w.value) > 0);
      mark();
      w.oninput = () => { state.weights[k] = Number(w.value) || 0; state.weightsTouched = true; mark(); };
      box.append(w);

      box.append(targetInput(state.minimums, k));
      box.append(targetInput(state.maximums, k));
    }

    // 파생 지표 목표 (가중치 없음, 하한/상한만) — 공격 지표(실효 보정)·내구 지표(실효 HP)
    box.append(el('div', 'auto-sep', '실효 지표 목표 — 공격=실효 보정 · 내구=실효 내성 · 실효 HP=버티는 총량 (% 파츠 반영)'));
    for (const k of DERIVED_KEYS) {
      box.append(el('div', 'lb', DERIVED_LABEL[k]));
      box.append(el('div', 'lb dim', '—'));               // 가중치 없음
      box.append(targetInput(state.minimums, k));
      box.append(targetInput(state.maximums, k));
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
      maximums: state.maximums,
      locked: [...state.locked],
      /* 파츠별 피해 % — 자동 구성 점수가 피해 % 파츠를 볼 수 있게 한다.
         **한 번만** 계산한다. 평가마다 파츠 설명을 훑으면 비싸진다.
         기여가 파츠별로 독립이라(weaponModsOf 가 파츠를 훑어 더한다) 미리 나눠 둘 수 있다. */
      partDmgPct: partDmgPctMap(),
      /* 파츠별 슬러스터 소비경감 — 자동 구성이 「연소효율 보조장치」처럼 스탯을 하나도
         안 올리면서 부스트를 늘려 주는 파츠를 볼 수 있게 한다. 위와 같은 이유로 한 번만. */
      partThrFx: partThrFxMap(),
      banned: [...state.banned],   // 기본 제외한 파츠는 자동 구성에서도 빠진다
      skill: skillStatBonus(),      // 스킬을 켠 상태면 그 보정까지 감안해 구성한다
      form: state.form,             // 변형 화면을 보고 있으면 변형 수치로 최적화한다
      weaponLv: wantWeaponLv(),     // 주무장 LV 도 화면과 같은 기준으로 (레벨링크 파츠 판정)
      restarts: 1,
      /* 화면이 켜 둔 쪽으로 고른다 — 안 넘기면 고른 근거와 보이는 수치가 어긋난다
         (주무장 LV·변형과 같은 이유다) */
      lateMode: state.lateMode
    };
    /* 파생 지표 목표가 하나라도 있을 때만 계산 훅을 넘긴다 (없으면 오버헤드 0).
       점수의 실효 HP 축은 이 훅을 쓰지 않는다 — core 의 durabilityOf 로 공짜로 구한다.
       한때 여기서 늘 넘기게 했더니 자동 구성이 6.9초 → 12.5초가 됐다. */
    if ([...Object.keys(state.minimums), ...Object.keys(state.maximums)].some(k => DERIVED_KEYS.includes(k)))
      opts.derived = (set, total) => derivedMetrics(set, total);

    // 후보를 "상충 축"으로 나눠 대표 빌드를 함께 낸다(공격형/내구형/균형).
    //  - 가중치를 안 만졌으면 프로필 3종(밸런스·공격·방어)을 그대로 목표로.
    //  - 만졌으면 내 가중치를 1순위 목표로 두되, 공격·방어 축 프로필을 곁들여 트레이드오프 선택지를 보장한다.
    const objectives = state.weightsTouched
      ? [{ name: '내 가중치', weights: state.weights }, ...autoProfiles(state.ms).filter(p => p.name !== '밸런스')]
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
    // 최대 10개까지 뽑으려면 후보 풀을 넉넉히 만든다.
    // 지정 목표: 그 가중치로 여러 번 재시작 / 임의 목표: 프로필당 상위 몇 개씩
    const optRounds = Math.max(3, Math.ceil(rounds / 3));
    const total = objectives.length * (1 + perExps.length + optRounds);
    let evals = 0, step = 0;
    const cands = [];
    const opt = (weights, exp, seed, iters) => {
      const r = O.optimize(state.ms, { ...opts, weights, expansion: exp, expLevel, seed, iters }, partsByCat, fullst);
      evals += r.evaluations || 0;
      // usedWeights: '왜 이 파츠?' 기여도 계산에 그 후보를 만든 가중치를 쓴다.
      // usedOpts: 기여도를 **점수와 똑같은 자**로 재려고 그 후보를 만든 설정을 그대로 들고 간다
      //           (가중치만 들고 가면 피해 % 표·목표·주무장 LV 가 빠져 자가 달라진다).
      if (r.parts.length || r.feasible) {
        r.expansion = exp; r.expLevel = expLevel; r.usedWeights = weights;
        r.usedOpts = { ...opts, weights, expansion: exp, expLevel };
        r.abs = absScore(r.stats.total, weights);
      }
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
          const st = C.calcStats(state.ms, base.parts, state.stage, e, partsByCat, fullst, expLevel, opts.form, opts.skill, opts.weaponLv, state.lateMode);
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
      // 각 목표(축)의 최고 후보에 라벨을 달아 대표 빌드로 보이게 하고, 변형 몇 개를 함께 담는다.
      const top = topCandidates(results, 4);
      top.forEach((c, idx) => { if (idx === 0 && obj.name) c.label = obj.name; });
      cands.push(...top);
    }

    // 같은 구성은 하나만. 프로필 대표(라벨)를 앞에, 그다음 변형. 최대 10개.
    const seen = new Set();
    const key = c => c.parts.map(p => p.name).slice().sort().join('|');
    const dedup = arr => arr.filter(c => { const s = key(c); if (seen.has(s)) return false; seen.add(s); return true; });
    const picks = dedup([...cands.filter(c => c.label), ...cands.filter(c => !c.label)]).slice(0, 10);

    state.autoCandidates = picks;
    state.autoShown = Math.min(3, picks.length);   // 처음엔 3개, 더보기로 최대 10개
    state.autoApplied = 0;
    const note = $('#autoNote');
    if (!picks.length) { note.className = 'note mt'; note.textContent = '구성을 찾지 못했습니다.'; return; }
    note.className = 'note mt';
    note.textContent = `후보 ${picks.length}개를 찾았습니다.`;
    $('#autoModalNote').textContent = `후보 ${picks.length}개 · 평가 ${evals.toLocaleString()}회 — 원하는 구성을 고르세요`;
    renderAutoDiag(picks);
    renderAutoResults(picks);
    applyCandidate(0);   // 가장 좋은 후보를 우선 적용해 두고, 다른 것도 고를 수 있게 한다
    openDrawer(false);   // 결과는 화면 중앙 모달로 보여 준다
    openResultModal(true);
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

  /** 후보의 목표 지표 값 — 원시 스탯은 total, 파생 지표는 derivedMetrics 로 (후보에 캐시). */
  // 파생값은 현재 상태(스킬·누적치)에 의존하므로 캐시하지 않고 그때그때 계산한다
  // (후보 수가 적어 비용이 무시할 만하고, 상태 변경 시 값이 낡지 않는다).
  function candValue(c, key) {
    if (DERIVED_KEYS.includes(key)) return derivedMetrics(c.parts, c.stats.total)[key];
    return c.stats.total[key] ?? 0;
  }

  /** 후보의 공격·내구 축 요약값 (트레이드오프를 카드에 보이기 위한 대표 수치). */
  function axisSummary(c) {
    const dv = derivedMetrics(c.parts, c.stats.total);
    return {
      atk: Math.max(dv.effShoot, dv.effMelee),
      def: Math.round((dv.durSolid + dv.durBeam + dv.durMelee) / 3)
    };
  }

  /** 목표 진단 — 어떤 후보로도 못 미치는 목표를 "달성 가능한 최댓값"과 함께 알려 준다. */
  function renderAutoDiag(picks) {
    const box = document.getElementById('autoDiag');
    if (!box) return;
    const label = k => DERIVED_KEYS.includes(k) ? DERIVED_LABEL[k] : C.STAT_LABEL[k];
    const targets = [
      ...Object.entries(state.minimums).filter(([, v]) => v).map(([k, v]) => ({ k, v, kind: 'min' })),
      ...Object.entries(state.maximums).filter(([, v]) => v != null && v !== '').map(([k, v]) => ({ k, v, kind: 'max' }))
    ];
    box.innerHTML = '';
    if (!targets.length || !picks.length) { box.hidden = true; return; }
    const rows = [];
    for (const t of targets) {
      const vals = picks.map(c => candValue(c, t.k));
      const ok = t.kind === 'min' ? vals.some(v => v >= t.v) : vals.some(v => v <= t.v);
      if (ok) continue;
      rows.push({ t, best: t.kind === 'min' ? Math.max(...vals) : Math.min(...vals) });
    }
    box.hidden = false;
    if (!rows.length) { box.append(el('div', 'diag-ok', '✓ 지정한 목표를 만족하는 후보를 찾았습니다.')); return; }
    /* **「어떤 구성으로도 불가능하다」고 말하지 않는다.**
       best 는 「이번에 찾은 후보 중 최고값」이지 상한이 아니다. 예전 문구는
       「도달 가능한 최댓값 … (가용 파츠·이 기체 상한 한계)」라고 단정했는데,
       실제로는 손으로 짜면 넘는 경우가 있었다(자쿠Ⅱ LV5 · 목표 HP 29,000 →
       화면은 28,750 이 한계라 했지만 29,550 이 되는 구성이 있었다. 탐색이 못 찾았을 뿐이다).
       모르는 것을 아는 것처럼 적으면 사용자가 **되는 일을 포기한다.** */
    box.append(el('div', 'diag-head', '⚠ 아래 목표를 만족하는 구성을 찾지 못했습니다 — 찾은 것 중 가장 가까운 값:'));
    for (const { t, best } of rows) {
      const row = el('div', 'diag-row');
      row.append(el('span', 'diag-k', label(t.k)));
      row.append(el('span', 'diag-msg', `목표 ${t.v} ${t.kind === 'min' ? '이상' : '이하'} → 찾은 최고 ${best.toLocaleString()}`));
      box.append(row);
    }
    box.append(el('div', 'diag-note',
      '※ 더 나은 구성이 있을 수도 있습니다 — 목표를 조금 낮추거나, 파츠를 잠그고 다시 돌려 보세요.'));
  }

  /** '왜 이 파츠?' — 각 파츠를 뺐을 때의 가중총점 하락(기여도)과 주요 상승 스탯. */
  // 스탯 → 역할군 (막대색·태그용)
  const CONTRIB_ROLE = {
    hp: 'def', armorRange: 'def', armorBeam: 'def', armorMelee: 'def',
    shoot: 'atk', meleeCorrection: 'atk',
    speed: 'mob', highSpeedMovement: 'mob', thruster: 'mob',
    turnPerformanceGround: 'mob', turnPerformanceSpace: 'mob'
  };
  const ROLE_LABEL = { def: '내구', atk: '공격', mob: '기동' };
  // 가중치를 하나도 안 준 구성의 기여도를 잴 때 쓰는 '전부 1' 가중치 (0 만 주면 점수가 0 이 된다)
  const EVEN_WEIGHTS = Object.fromEntries(C.STAT_KEYS.map(k => [k, 1]));

  function partContributions(c) {
    const w = c.usedWeights || state.weights;
    const exp = c.expansion || state.expansion;
    const expLv = c.expLevel || state.expLevel;
    const skill = skillStatBonus();
    const full = c.stats.total;
    const fullDv = derivedMetrics(c.parts, full);   // 전체 구성의 실효 지표 (한 번만)
    // 가중치를 하나도 안 준 경우엔 모든 스탯을 동일 가중(1)으로 본다.
    const anyW = C.STAT_KEYS.some(k => (w[k] || 0) > 0);

    /* 기여도는 **자동 구성이 고를 때 쓴 점수 그 자체**로 잰다 — 같은 makeScorer 를 불러 쓴다.
       예전엔 여기서 따로 셈을 했다: 원시 가중합 + 실효 지표를 전부 가중치 1 로 평평하게 더하기.
       그래서 「사격 5」만 준 구성에서도 기동·내구 실효가 같은 무게로 섞여, 점수가 고른 이유와
       패널이 적어 주는 이유가 어긋났다. 셈을 두 군데 두면 반드시 갈라진다 —
       피해경감 파츠가 그 증거였다. 패널은 기여도를 줬지만 점수는 그 축을 아예 안 봤다
       (실측: 표본 12기에서 자동 구성이 경감 파츠를 하나도 고르지 않았고, 그래도 1스왑 최적이었다).
       점수가 안 보는 것에 기여도를 주는 쪽이 틀린 것이다.
       값은 score() 가 돌려주는 것(value − penalty)을 그대로 쓴다 — 목표를 깨는 파츠는
       페널티 차이로 자연히 1순위가 되고, 그것이 '목표 필수' 정렬과도 맞는다. */
    const scorerOpts = c.usedOpts
      ? { ...c.usedOpts, weights: anyW ? w : EVEN_WEIGHTS }
      : {
        stage: state.stage, expansion: exp, expLevel: expLv,
        weights: anyW ? w : EVEN_WEIGHTS,
        minimums: state.minimums, maximums: state.maximums,
        skill, form: state.form, weaponLv: wantWeaponLv(),
        partDmgPct: partDmgPctMap(), partThrFx: partThrFxMap()
      };
    if ([...Object.keys(state.minimums), ...Object.keys(state.maximums)].some(k => DERIVED_KEYS.includes(k)))
      scorerOpts.derived = (set, total) => derivedMetrics(set, total);
    const scorer = O.makeScorer(state.ms, scorerOpts, partsByCat, fullst);
    const fullScore = scorer(c.parts).value;
    // 지정한 목표들 (파츠별 '목표 필수' 판정용)
    const targets = [
      ...Object.entries(state.minimums).filter(([, v]) => v).map(([k, v]) => ({ k, v: +v, kind: 'min' })),
      ...Object.entries(state.maximums).filter(([, v]) => v != null && v !== '').map(([k, v]) => ({ k, v: +v, kind: 'max' }))
    ];
    const tLabel = k => DERIVED_KEYS.includes(k) ? DERIVED_LABEL[k] : C.STAT_LABEL[k];
    // '내구 빔'→'빔', '실효 HP 빔'→'HP 빔' — 뒤에 '실효 ' 를 붙여 쓰므로 접두를 뗀다
    // ('실효 HP 빔' 을 그냥 두면 '실효 실효 HP 빔' 이 된다)
    const effShort = k => DERIVED_LABEL[k].replace(/^(공격|내구|실효)\s*/, '');

    const out = c.parts.map(p => {
      const without = c.parts.filter(q => q.name !== p.name);
      // 점수를 부르면 그 안에서 이미 calcStats 를 돌린다 — 수치를 따로 또 구하지 않고 받아 쓴다
      // (자동 구성과 같은 모드·주무장 LV 로 재진다. 예전엔 여기서 인자를 손으로 맞춰야 했다).
      const sc = scorer(without);
      const st = sc.stats.total;
      const woDv = derivedMetrics(without, st);
      // 원시 스탯 상승분
      const rawDiffs = C.STAT_KEYS.map(k => ({ k, d: (full[k] || 0) - (st[k] || 0) })).filter(x => x.d > 0).sort((a, b) => b.d - a.d);
      // 실효 지표 상승분 (피해경감·피해% 파츠는 원시 스탯이 안 올라도 여기서 드러난다)
      const effDiffs = DERIVED_KEYS.map(k => ({ k, d: fullDv[k] - woDv[k] })).filter(x => x.d >= 1).sort((a, b) => b.d - a.d);
      // 역할: 정규화 기여가 가장 큰 군 (원시 없으면 실효로 판정)
      const roleScore = {};
      for (const { k, d } of rawDiffs) { const r = CONTRIB_ROLE[k]; if (r) roleScore[r] = (roleScore[r] || 0) + d / (O.UNIT[k] || 1); }
      // 실효 지표의 역할군 — 공격(eff*)만 atk, 내구(dur*)와 실효 HP(ehp*)는 def.
      // 'dur' 로 시작하는지만 보던 때는 ehp* 가 공격으로 분류돼, 피해경감 전용 파츠에
      // '공격' 태그가 붙었다.
      if (!rawDiffs.length) for (const { k, d } of effDiffs) {
        const r = k.indexOf('eff') === 0 ? 'atk' : 'def';
        roleScore[r] = (roleScore[r] || 0) + d;
      }
      let roleCls = null, best = 0;
      for (const r in roleScore) if (roleScore[r] > best) { best = roleScore[r]; roleCls = r; }
      // 목표 필수: 이 파츠를 빼면 (전체는 만족하던) 목표가 미달로 뒤집히는가
      const criticalFor = [];
      for (const t of targets) {
        const vFull = DERIVED_KEYS.includes(t.k) ? fullDv[t.k] : (full[t.k] || 0);
        const vWo = DERIVED_KEYS.includes(t.k) ? woDv[t.k] : (st[t.k] || 0);
        const fullOk = t.kind === 'min' ? vFull >= t.v : vFull <= t.v;
        const woOk = t.kind === 'min' ? vWo >= t.v : vWo <= t.v;
        if (fullOk && !woOk) criticalFor.push(tLabel(t.k));
      }
      // 순위 점수 = 이 파츠를 뺐을 때 **자동 구성 점수**가 떨어지는 양
      const rank = fullScore - sc.value;
      const stats = rawDiffs.length
        ? rawDiffs.slice(0, 3).map(d => C.STAT_LABEL[d.k] + ' +' + Math.round(d.d))
        : effDiffs.slice(0, 2).map(d => '실효 ' + effShort(d.k) + ' +' + Math.round(d.d));
      return { part: p, rank, roleCls, roleLabel: ROLE_LABEL[roleCls] || null, criticalFor, stats };
    });
    const maxR = Math.max(1e-6, ...out.map(o => o.rank));
    out.forEach(o => o.share = Math.max(0, o.rank) / maxR);
    // 목표 필수 파츠를 먼저, 그다음 기여 큰 순 — "왜 약한 파츠가 있나?" 를 바로 답한다
    out.sort((a, b) => (b.criticalFor.length - a.criticalFor.length) || (b.rank - a.rank));
    return out;
  }

  /** 자동 구성 후보 카드를 그린다. 클릭하면 그 구성을 장착한다. (처음 autoShown 개만, 나머지는 더보기) */
  function renderAutoResults(cands) {
    const box = $('#autoResults');
    box.innerHTML = '';
    const keys = SUMMARY_STAT_KEYS;   // 저장 목록 요약과 같은 핵심 스탯

    const shown = Math.min(state.autoShown || 3, cands.length);
    cands.slice(0, shown).forEach((c, i) => {
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

      // 상충 축 요약 — 공격/내구를 나란히 보여 트레이드오프를 한눈에 (Pareto 선택 보조)
      const ax = axisSummary(c);
      const axis = el('div', 'ac-axis');
      axis.append(el('span', 'axb atk', `공격 ${ax.atk}`));
      axis.append(el('span', 'axb def', `내구 ${ax.def}`));
      card.append(axis);

      // 자동으로 고른 확장 스킬 (사용자가 지정했으면 표시 안 함)
      if (state.autoExpansion && c.expansion && c.expansion !== C.EXPANSION_NONE) {
        const expName = (C.EXPANSION_LABEL[c.expansion] || c.expansion).replace(/\s*\(.*\)$/, '');
        card.append(el('div', 'ac-exp', '확장: ' + expName));
      }

      // 하한 미달 · 상한 초과 표시 (원시 스탯·파생 지표 공통)
      const tLabel = k => DERIVED_KEYS.includes(k) ? DERIVED_LABEL[k] : C.STAT_LABEL[k];
      const unmet = Object.entries(state.minimums)
        .filter(([k, v]) => v && candValue(c, k) < v)
        .map(([k, v]) => `${tLabel(k)} ${candValue(c, k).toLocaleString()}/${v}`);
      if (unmet.length) card.append(el('div', 'ac-warn', '하한 미달: ' + unmet.join(', ')));
      const over = Object.entries(state.maximums)
        .filter(([k, v]) => v != null && v !== '' && candValue(c, k) > v)
        .map(([k, v]) => `${tLabel(k)} ${candValue(c, k).toLocaleString()}/${v}`);
      if (over.length) card.append(el('div', 'ac-warn', '상한 초과: ' + over.join(', ')));

      // '왜 이 파츠?' — 파츠별 기여도(가중 점수 하락)와 주요 상승 스탯을 펼쳐 본다
      const why = el('button', 'ac-why', '왜 이 파츠?');
      const whyBody = el('div', 'ac-why-body'); whyBody.hidden = true;
      why.onclick = ev => {
        ev.stopPropagation();
        if (whyBody.dataset.built !== '1') {
          whyBody.append(el('div', 'why-cap', '막대=기여도 · 태그=역할 · 🎯=목표 필수 · 실효=피해경감/피해% 반영'));
          for (const o of partContributions(c)) {
            const row = el('div', 'why-row');
            const barWrap = el('div', 'why-bar');
            const bar = el('div', 'why-bar-fill' + (o.roleCls ? ' rb-' + o.roleCls : ''));
            bar.style.width = Math.round(o.share * 100) + '%';
            barWrap.append(bar);
            const main = el('div', 'why-main');
            main.append(el('span', 'why-ptn', T.partName(o.part.name)));
            if (o.roleLabel) main.append(el('span', 'why-role r-' + o.roleCls, o.roleLabel));
            if (o.criticalFor.length) main.append(el('span', 'why-crit', '🎯 ' + o.criticalFor.join('·') + ' 필수'));
            row.append(barWrap, main, el('div', 'why-stats', o.stats.join(' · ') || '—'));
            whyBody.append(row);
          }
          whyBody.dataset.built = '1';
        }
        whyBody.hidden = !whyBody.hidden;
        why.classList.toggle('on', !whyBody.hidden);
      };
      card.append(why, whyBody);

      card.title = c.parts.map(p => T.partName(p.name)).join(', ');
      card.onclick = () => applyCandidate(i);
      box.append(card);
    });

    // 지금 적용된 후보 강조 유지 (더보기로 다시 그려도)
    [...box.children].forEach(el => el.classList.toggle('on', Number(el.dataset.i) === state.autoApplied));

    // 더보기 — 아직 안 보여준 후보가 있으면 노출
    const moreWrap = document.getElementById('autoMoreWrap');
    if (moreWrap) {
      const remaining = cands.length - shown;
      moreWrap.hidden = remaining <= 0;
      const btn = document.getElementById('autoMore');
      if (btn) btn.textContent = `더보기 (${remaining}개 더)`;
    }
  }

  function applyCandidate(i) {
    const cands = state.autoCandidates || [];
    const c = cands[i];
    if (!c) return;
    state.autoApplied = i;
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

  /* 기체 변경 서랍 — 파츠 화면에서 목록을 열어 곧바로 바꾼다.
     목록은 등록해 두고 그린다. 닫을 때 등록을 빼는 이유: 안 빼면 서랍이 닫힌 뒤에도
     renderMsList() 가 숨은 칸을 계속 그린다(기체 1,709 개짜리 목록이라 공짜가 아니다). */
  let msDrawerView = null;
  /* onPick 을 넘기면 **고른 뒤 할 일만** 갈아친다 (강화 플랜이 기체를 고를 때 쓴다).
     목록·필터·검색은 그대로 빌려 쓴다 — 같은 목록을 또 만들면 필터가 둘로 갈라진다. */
  function openMsDrawer(open, onPick) {
    const dr = $('#msDrawer');
    if (!dr) return;
    if (open && !msDrawerView) {
      msDrawerView = addMsListView({
        box: '#msDrawerList', count: '#msDrawerCount', showInfo: false,
        // 서랍에서는 지금 쓰고 있는 기체에 테두리를 준다 (기체 선택 화면은 정보 칸 기준이다)
        isSel: m => !!(state.ms && state.ms.MS名 === m.MS名),
        pick: onPick,
        // 누르면 곧바로 바꾼다. selectMs 가 하는 일을 그대로 쓴다 — 목록에서 고르는 것과
        // 결과가 달라지면 「어느 쪽으로 골랐는지」에 따라 구성이 남거나 사라진다.
        onPick: m => {
          if (msDrawerView && msDrawerView.pick) { msDrawerView.pick(m); return; }
          const same = state.ms && state.ms.MS名 === m.MS名;
          openMsDrawer(false);
          if (same) return;
          const had = state.equipped.length;
          selectMs(m);
          if (had) toast(T.msName(m.MS名) + ' 로 바꿨습니다 — 장착 파츠 ' + had + '개는 초기화됩니다');
        }
      });
    } else if (!open && msDrawerView) {
      dropMsListView(msDrawerView);
      msDrawerView = null;
    }
    dr.classList.toggle('open', open);
    $('#msDrawerBack').classList.toggle('open', open);
    /* 모달 위에서 열리면 z-index 를 올린다 — 안 올리면 모달 뒤로 들어가 못 누른다.
       열 때만 켜고 닫을 때 끈다(남겨 두면 다음에 파츠 화면에서 열 때도 떠 있게 된다). */
    const overModal = open && !!onPick;
    const wasOver = dr.classList.contains('over-modal');
    const host = document.querySelector('dialog.auto-modal[open]');
    if (overModal) modalYield(host, true);          // 모달을 잠시 비모달로 — 서랍이 눌리게
    else if (wasOver) modalYield(host, false);      // 서랍을 닫으면 다시 모달로
    dr.classList.toggle('over-modal', overModal);
    $('#msDrawerBack').classList.toggle('over-modal', overModal);
    document.body.classList.toggle('drawer-open', open);
    if (open) {
      renderMsList();
      // 필터 상태가 저쪽에서 바뀌었을 수 있다 — 칸을 맞춰 연다.
      const q = $('#msDrawerQuery'), src = $('#msQuery');
      if (q && src) q.value = src.value;
      paintMsChips();
      setTimeout(() => { if (q) q.focus(); }, 60);
    }
  }

  // 칩을 다시 칠하는 일은 초기화 블록 안에 있다. 서랍이 열릴 때도 불러야 해서 밖으로 뺀다.
  let paintMsChips = () => {};

  function openDrawer(open) {
    $('#autoDrawer').classList.toggle('open', open);
    $('#drawerBack').classList.toggle('open', open);
    // 폰 하단 액션바(z-index 47)가 드로어(41) 위라 「실행」 버튼을 가렸다 — 열려 있는 동안 감춘다.
    document.body.classList.toggle('drawer-open', open);
  }

