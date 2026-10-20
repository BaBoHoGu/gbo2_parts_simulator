  /* ui/04-stats.js — 성능 표 · PNG 카드 · 이미지 미리보기.
     tools/lib/uisrc.js 가 번호 순으로 이어 붙여 한 IIFE 로 감싼다(파일끼리 변수를 나눠 쓴다). */
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
      const lb = el('span', 'label', C.STAT_LABEL[k]);
      ICON.prepend(lb, STAT_IC[k]);
      row.append(lb);

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

    const lv = msLevel(state.ms);

    // 공격 지표 — 내구가 HP에 내성을 접듯, 피해%(파츠·발동 스킬)를 보정에 접은 '실효 보정'.
    //   피해 = 무장위력 × (1+보정/100) × (1+피해%)  →  실효보정 = ((1+보정/100)(1+피해%/100) − 1)×100
    // 보정 상한(100)을 넘는 피해% 파츠의 실제 가치까지 드러난다.
    const atkBonus = partAttackBonus(state.equipped, lv);
    const totalDmgPct = (partPct, kind) => {   // 파츠(합산) × 스킬(곱연산) 최종 피해 증가율
      const skills = skillDmgPctList(kind);
      const mult = (1 + partPct / 100) * skills.reduce((m, p) => m * (1 + p / 100), 1);
      return Math.round((mult - 1) * 100);
    };
    const atk = el('div', 'dura-row');
    atk.append(el('span', 'dura-lb', '공격 지표'));
    for (const [key, label, corr] of [['shoot', '사격', r.total.shoot], ['melee', '격투', r.total.meleeCorrection]]) {
      const pct = totalDmgPct(atkBonus[key], key);
      const eff = Math.round(((1 + corr / 100) * (1 + pct / 100) - 1) * 100);
      const cell = el('span', 'dura-cell');
      cell.append(el('span', 'dura-k', label));
      cell.append(el('span', 'dura-v', eff.toLocaleString()));
      if (pct !== 0) {
        const tag = el('span', 'dura-up' + (pct < 0 ? ' down' : ''), '피해 ' + (pct > 0 ? '+' : '') + pct + '%');
        tag.title = `보정 ${corr} + 피해 ${pct >= 0 ? '+' : ''}${pct}% → 실효 보정 ${eff}`;
        cell.append(tag);
      }
      atk.append(cell);
    }
    body.append(atk);

    // 내구 지표 — 스탯 행들과 같은 흐름(마지막 행). 체크한 방어 스킬(피해경감)만큼 실효 HP 가 오른다.
    const duraCuts = damageCutsOf(state.equipped, { lv, skillMs: state.ms });
    const du = el('div', 'dura-row');
    du.append(el('span', 'dura-lb', '내구 지표'));
    for (const [dattr, label] of DURA_ATTRS) {
      const cell = el('span', 'dura-cell');
      cell.append(el('span', 'dura-k', label));
      cell.append(el('span', 'dura-v', enduranceOf(r.total, dattr, duraCuts).toLocaleString()));
      const pctCut = cutPctOf(duraCuts, dattr);
      if (pctCut) {
        // 태그는 실효HP 상승률이 아니라 '피해 감소율'(파츠·스킬의 실제 경감)을 보여 준다.
        const cut = el('span', 'dura-up', '피해 -' + pctCut + '%');
        cut.title = `실효 HP ×${(1 / staggerDmgFactor(duraCuts, dattr)).toFixed(3)} (피해 ${pctCut}% 경감)`;
        cell.append(cut);
      }
      du.append(cell);
    }
    body.append(du);

    // 누적치(스태거) 내성 — 머리줄은 **지금 이 구성**의 값이라 방어 스킬 체크를
    // 그대로 반영한다. 펴서 나오는 다섯 상황은 「이 기체가 그 상황에서 갖는 값」이라
    // 체크와 무관하다. 무장별 다운은 '피탄 시뮬'에서.
    {
      const stg = activeStaggerMods(state.ms, lv);
      const stgNow = Math.round(stg.threshold / stg.mult);
      const cats = staggerByCategory(state.ms, lv, bldIField);
      const head = el('button', 'dura-row stagger-row stg-head' + (bldStgOpen ? ' open' : ''));
      head.type = 'button';
      head.setAttribute('aria-expanded', bldStgOpen ? 'true' : 'false');
      head.append(el('span', 'stg-caret', bldStgOpen ? '▾' : '▸'));
      head.append(el('span', 'dura-lb', '누적치'));
      const scell = el('span', 'dura-cell');
      scell.append(el('span', 'dura-k', '내성'));
      scell.append(el('span', 'dura-v', stgNow + '%'));
      head.append(scell);
      const top = Math.max(...cats.map(c => c.value));
      head.append(el('span', 'stagger-detail',
        `임계 ${stg.threshold}%` + (stg.mult < 1 ? ` · 받는 누적 ×${+stg.mult.toFixed(3)}` : '')
        + (bldStgOpen ? '' : top > stgNow ? ` · 펴면 상황별 (최대 ${top}%)` : ' · 펴면 상황별')));
      head.onclick = () => { setBldStgOpen(!bldStgOpen); renderAll(); };
      body.append(head);

      const sgw = el('div', 'stg-cats mi-sglist');
      sgw.hidden = !bldStgOpen;
      // 머리줄(체크 반영)과 값이 다를 수 있다 — 왜 다른지 적어 두지 않으면 둘 중
      // 하나가 틀린 것으로 읽힌다.
      sgw.append(el('div', 'stg-cats-hint', '※ 아래 다섯 줄은 기체가 가진 값입니다 — 방어 스킬 체크와 무관'));
      if (cats.iField) {
        const b = el('button', 'mi-sg-btn' + (bldIField ? ' on' : ''), 'I필드');
        b.type = 'button';
        b.title = cats.iField.ko + ' — 빔이 그 부위에 맞았을 때만 걸립니다.'
          + String.fromCharCode(10)
          + '켜면 다섯 칸 모두에 반영합니다.';
        b.onclick = () => { setBldIField(!bldIField); renderAll(); };
        const bar = el('div', 'mi-sg-btns');
        bar.append(b);
        sgw.append(bar);
      }
      for (const c of cats) {
        const row = el('div', 'mi-sg' + (c.key === '최대' ? ' top' : ''));
        row.append(el('i', '', c.key));
        row.append(el('b', '', c.value + '%'));
        const by = el('span', 'mi-sg-by');
        for (const x of c.picks) {
          const chip = el('span', 'mi-sg-chip', x.ko);
          chip.title = x.ko + ' · ' + x.cond;
          by.append(chip);
        }
        row.append(by);
        sgw.append(row);
      }
      body.append(sgw);
    }

    // 슬러스터 지표 — 부스트 지속 · 완충 · OH 복귀. 지상/우주 각각(환경적성·강습 보정이 다르다).
    {
      const thr = r.total.thruster || 0;
      // 소수 한 자리로 통일한다 — 16.2 와 15.6 이 둘 다 '16초' 로 보이면 변화가 가려진다
      const sec = v => v == null ? '—' : (Math.round(v * 10) / 10).toFixed(1) + '초';
      for (const [env, label] of [['ground', '지상'], ['space', '우주']]) {
        if (env === 'ground' && state.ms['出撃_地上可'] === false) continue;
        if (env === 'space' && state.ms['出撃_宇宙可'] === false) continue;
        const m = thrusterMetrics(state.ms, thr, state.equipped, env,
          { lv, on: state.thrusterOn, form: state.form });
        if (!m) continue;
        const row = el('div', 'dura-row thr-row');
        const colKoTag = m.col === 'adapt' ? '적성' : m.col === 'assault' ? '강습' : null;
        const lb = el('span', 'dura-lb', '슬러스터 ' + label);
        // 어느 기준으로 낸 값인지 화면에 적는다 — 지상적성 기체는 OH 가 7 이 아니라 6.3초라
        // 근거가 안 보이면 혼자 다른 값처럼 읽힌다(툴팁은 폰에서 안 뜬다).
        if (colKoTag) lb.append(el('span', 'thr-col', colKoTag));
        row.append(lb);
        const cell = (k, v, base) => {
          const c = el('span', 'dura-cell');
          c.append(el('span', 'dura-k', k));
          c.append(el('span', 'dura-v', sec(v)));
          if (v != null && base != null && Math.abs(v - base) > 0.05) {
            const better = k === '풀회복' || k === 'OH복귀' ? v < base : v > base;
            c.append(el('span', better ? 'dura-up' : 'dura-down', (v > base ? '+' : '') + (Math.round((v - base) * 10) / 10) + '초'));
          }
          return c;
        };
        row.append(cell('부스트', m.boost, m.base.boost));
        row.append(cell('풀회복', m.full, m.base.full));
        row.append(cell('OH복귀', m.oh, m.base.oh));
        const ohLong = ohLongSkillOf(state.ms, lv);
        if (ohLong) row.append(el('span', 'thr-ohlong', ohLong + ' 후 ' + OH_LONG_SEC + '초'));
        const colKo = m.col === 'adapt' ? '환경적성' : m.col === 'assault' ? '강습 보정' : '표준';
        row.title = '위키 실측 기준(' + colKo + ')\n'
          + '· 부스트 지속 = (슬러스터 ' + thr + ' − 초기소비) ÷ 소비속도\n'
          + '· 풀회복 = 게이지 0 → 가득 (슬러스터 ÷ 5/초, 회복 파츠 반영)\n'
          + '· OH 복귀 = ' + m.base.oh + '초 × (1 − 단축 파츠)'
          + (m.fx.skill && m.fx.skill.used.length
              ? '\n· 스킬 반영: ' + m.fx.skill.used.map(x => skTr(x.name)
                  + ' ' + thrFxLabel(x) + (x.cond ? '(' + x.cond + ')' : '')).join(' · ')
              : '')
          + (m.fx.skill && m.fx.skill.capped && m.fx.skill.capped.length
              ? '\n※ ' + m.fx.skill.capped.map(k => THR_KEY_KO[k]).join('·') + ' 합이 너무 커 '
                + THR_CUT_MAX + '% 로 묶었습니다 — 동시에 성립하지 않는 상황을 함께 체크했을 수 있습니다.'
              : '')
          + (ohLong ? '\n※ ' + ohLong + ' 효과가 끝난 뒤에는 OH 복귀가 ' + OH_LONG_SEC
              + '초 (스킬 설명에 명시된 고정값 — 위 단축 파츠와 별개).' : '')
          + (isTankMs(state.ms) ? '\n※ 탱크형은 소비속도가 위키 미확정이라 부스트 지속을 내지 않는다.' : '');
        body.append(row);
      }
    }

    // 스러스터 스킬 — 상황 한정인 것만 체크로 켠다. 상시는 위 수치에 이미 들어가 있다.
    // 방어 스킬과 같은 방식이다: 자리를 아끼려고 접고, 접힌 채로도 몇 개 켰는지 적는다.
    {
      const all = thrusterSkillsOf(state.ms, lv, state.form);
      const conds = all.filter(x => x.cond);
      const always = all.filter(x => !x.cond);
      const unmod = thrusterUnmodelled(state.ms, lv, state.form);
      if (conds.length || always.length || unmod.length) {
        const condKeys = [...new Set(conds.map(thrKeyOf))];
        const onCount = condKeys.filter(k => state.thrusterOn.has(k)).length;
        const head = el('button', 'dura-row stg-head' + (thrSkillOpen ? ' open' : ''));
        head.type = 'button';
        head.setAttribute('aria-expanded', thrSkillOpen ? 'true' : 'false');
        head.append(el('span', 'stg-caret', thrSkillOpen ? '▾' : '▸'));
        head.append(el('span', 'dura-lb', '슬러스터 스킬'));
        head.append(el('span', 'stagger-detail',
          (always.length ? always.length + '개 상시 반영 중' : '')
          + (always.length && conds.length ? ' · ' : '')
          + (condKeys.length ? (onCount ? onCount + '개 체크됨' : condKeys.length + '개 · 체크 시 반영') : '')));
        head.onclick = () => { setThrSkillOpen(!thrSkillOpen); renderAll(); };
        body.append(head);

        const wrap = el('div', 'stagger-skills thr-skills');
        wrap.hidden = !thrSkillOpen;
        if (conds.length) wrap.append(el('span', 'stg-hint', '※ 지금 상황에 맞는 것만 체크하세요'));
        for (const x of always) {
          const lab = el('label', 'stg-chk on locked');
          lab.title = '조건 없이 늘 걸립니다';
          const box = el('input'); box.type = 'checkbox'; box.checked = true; box.disabled = true;
          lab.append(box, el('span', 'stg-nm', x.ko),
            el('span', 'stg-tag', thrFxLabel(x)),
            el('span', 'stg-cond', x.env ? (x.env === 'space' ? '우주' : '지상') : '상시'));
          wrap.append(lab);
        }
        // 같은 스킬·같은 상황의 효과는 **한 줄로 묶는다.** 예전에는 효과마다 한 줄이라
        // 같은 이름이 두세 줄 나왔고, 하나를 켜면 나머지도 같이 켜져 보였다.
        const byCond = new Map();
        for (const x of conds) {
          const k = thrKeyOf(x);
          if (!byCond.has(k)) byCond.set(k, { key: k, ko: x.ko, cond: x.cond, env: x.env, fx: [], seg: x.seg });
          byCond.get(k).fx.push(x);
        }
        for (const g of byCond.values()) {
          const on = state.thrusterOn.has(g.key);
          const lab = el('label', 'stg-chk' + (on ? ' on' : ''));
          lab.title = g.seg;
          const box = el('input'); box.type = 'checkbox'; box.checked = on;
          box.onchange = () => {
            box.checked ? state.thrusterOn.add(g.key) : state.thrusterOn.delete(g.key);
            renderAll();
          };
          lab.append(box, el('span', 'stg-nm', g.ko),
            el('span', 'stg-tag', g.fx.map(f => thrFxLabel(f)
              + (f.burst ? ' (' + f.burst + '초)' : '')).join(' · ')),
            el('span', 'stg-cond', g.cond + (g.env ? '·' + (g.env === 'space' ? '우주' : '지상') : '')));
          wrap.append(lab);
        }
        // 수치가 없어 못 넣는 것들 — 체크할 수 없다. 있다는 것만 알린다.
        for (const u of unmod) {
          const lab = el('div', 'stg-chk stg-unmod');
          lab.title = u.seg;
          lab.append(el('span', 'stg-nm', u.ko + (u.lv ? ' ' + u.lv : '')),
            el('span', 'stg-tag', '계산 안 함'),
            el('span', 'stg-cond', u.why));
          wrap.append(lab);
        }
        body.append(wrap);
      }
    }

    // 방어 스킬 체크박스 — 체크 시 위 내구 지표·누적치에 반영된다.
    // 스킬이 많은 기체는 이 목록만 300px 을 넘어, 위쪽 스탯을 보려면 계속 스크롤해야 했다.
    // 접었다 펼 수 있게 하고, 접힌 채로도 몇 개를 켜 뒀는지 머리줄에 적는다
    // (안 적으면 켜 둔 것을 잊고 잘못된 수치를 읽는다).
    const cl = staggerCheckList(state.ms, lv, () => renderAll());
    if (cl.count) {
      const sks = staggerSkillsOf(state.ms, lv);
      const onCount = sks.filter(x => x.cond === '상시' || state.staggerOn.has(x.name)).length;
      const head = el('button', 'dura-row stg-head' + (defSkillOpen ? ' open' : ''));
      head.type = 'button';
      head.setAttribute('aria-expanded', defSkillOpen ? 'true' : 'false');
      head.append(el('span', 'stg-caret', defSkillOpen ? '▾' : '▸'));
      head.append(el('span', 'dura-lb', '방어 스킬'));
      head.append(el('span', 'stagger-detail',
        onCount ? `${onCount}개 체크 — 내구·누적치에 반영 중` : `${cl.count}개 · 체크 시 내구·누적치 반영`));
      head.onclick = () => { setDefSkillOpen(!defSkillOpen); renderAll(); };
      body.append(head);
      cl.wrap.hidden = !defSkillOpen;
      body.append(cl.wrap);
    }
  }

  /** 상세 PNG용 무장 피해 목록 — renderWeapons 의 dmgCell 최종값(파츠·스킬·자세 반영)과 동일 계산. */
  function weaponDamageList() {
    const list = msWeapons();
    if (!list.length) return [];
    const r = stats();
    const corr = { shooting: r.total.shoot, melee: r.total.meleeCorrection };
    // 스킬을 뺀 값 — 스킬로 늘어난 몫만 따로 보여 주려고 화면 무장 표와 같게 구한다.
    const bareR = skillEffect() ? stats(null) : null;
    const corrBare = bareR ? { shooting: bareR.total.shoot, melee: bareR.total.meleeCorrection } : corr;
    const dmgKey = w => (w.attr === 'melee' || w.type === 'melee') ? 'melee' : 'shooting';
    const wm = D.weaponModsOf(C.partsAt(state.equipped, state.lateMode), state.ms ? msLevel(state.ms) : 1, state.ms && state.ms.属性, state.expansion);
    const sk = skillEffect();
    const postureEtc = w => {
      if (dmgKey(w) === 'melee') return 0;
      let e = 0;
      if (state.posture === 'crouch') e += D.ETC_ATTACK.crouch;
      else if (state.posture === 'prone') e += D.ETC_ATTACK.prone;
      if (state.scope) e += D.ETC_ATTACK.scope;
      return e;
    };
    const skEtc = w => (dmgKey(w) === 'shooting' && sk && sk.crouchPct && state.posture === 'crouch') ? sk.crouchPct / 100 : 0;
    const out = [];
    for (const w of list) {
      const lv = weaponLevel(w), d = lv ? w.levels[lv] : null;
      if (!d) continue;
      const info = w.info || {}, mods = w.mods || {};
      const f = (...names) => wField(d, info, ...names);
      const mult = fireMult(w);
      // 화면 무장 표(dmgCell)와 같은 분해 — 기본 위력 · 파츠분 · 스킬분.
      // 카드가 최종 합계 하나만 실어서, 파츠를 껴서 얼마나 올랐는지 이미지로는 알 수 없었다.
      const fin = (base, m) => {
        if (base == null) return null;
        const n = m ? m.n : 1;
        if (w.attr === 'shield' || w.type === 'shield') return { base, one: base, n, gain: 0, skillGain: 0, total: base * n };
        const kind = dmgKey(w) === 'melee' ? 'melee' : 'shoot';
        // 무장 표(dmgCell)와 **같은 함수**를 쓴다 — 따로 구현해 두었다가 카드만 어긋난 적이 있다
        const withoutSkill = weaponHitDamage(w, base, corrBare[dmgKey(w)] || 0, wm, [], postureEtc(w));
        const one = weaponHitDamage(w, base, corr[dmgKey(w)] || 0, wm, skillDmgPctList(kind), postureEtc(w) + skEtc(w));
        return { base, one, n, gain: withoutSkill - base, skillGain: one - withoutSkill, total: one * n };
      };
      // ⑤ 쿨타임 / 발사간격
      const cool = f(...intervalFields(w));   // 무장 표·DPS 와 같은 항목 순서
      // ⑥ 탄 / 히트율 (renderWeapons 와 동일 규칙)
      const ammo = f('弾数'), heat = f('ヒート率', 'ヒート率/フル', 'ヒート率/ノン'), ohShots = f('OHまでの弾数');
      const isEpack = D.isEpackMag(w), shieldHp = f('シールドHP', 'HP'), shieldSize = f('サイズ');
      let ammoStr;
      if (shieldHp || shieldSize) {
        const base = Number(shieldHp) || 0,
          bonus = shieldHp ? shieldHpBonus(wm, state.equipped, state.expansion, state.expLevel) : 0;
        ammoStr = shieldHp ? 'HP ' + (base + bonus).toLocaleString() : (shieldSize ? '크기 ' + shieldSize : '—');
      } else if (ammo) ammoStr = jaUnits(ammo);
      else if (isEpack && ohShots) { const mag = String(ohShots).match(/(\d+)\s*発/); ammoStr = mag ? mag[1] + '발' : jaUnits(ohShots); }
      else if (heat) ammoStr = heat;
      else ammoStr = '—';
      // ⑧ 리로드 / OH복귀
      const reload = f('リロード時間'), ohBack = f('OH復帰時間', 'OH復帰速度');
      let reloadStr;
      if (reload) reloadStr = jaUnits(D.shortenTimeText(reload, D.timeCutFor(wm, 'reloadTime', w)));
      else if (ohBack) reloadStr = jaUnits(D.shortenTimeText(ohBack, D.timeCutFor(wm, isEpack ? 'reloadTime' : 'weaponOH', w))) + (isEpack ? ' 리로드' : ' OH');
      else reloadStr = '—';

      out.push({
        name: T.weaponName(w.name), type: w.type, attr: weaponAttr(w),
        sec: w.type === 'shield' ? '실드' : w.section === '主兵装' ? '주무장' : w.section === '副兵装' ? '부무장' : '기타',
        // 유형은 '사용 방식'(type)이 아니라 '속성'(attr)이다 — 무장 표와 같은 기준을 쓴다.
        // 던지는 격투 무장처럼 type=shooting·attr=melee 인 것이 있어 둘이 갈린다.
        kind: ATTR_LABEL[weaponAttr(w)] || '기타',
        nc: fin(d.power, mult.nc), ch: fin(d.powerCharged, mult.ch),
        cool: cool ? jaUnits(cool) : '—',
        ammo: ammoStr,
        stagger: mods.stagger ? staggerKo(mods.stagger) : '—',
        range: f('射程') || '—',
        reload: reloadStr,
        // 고정 피해(소이)는 위력 칸과 별개로 들어가는 몫이라 카드에도 함께 실어야 오해가 없다
        fx: fixedDamageWithParts(w, state.equipped),
        debuffs: debuffsOf(w)
      });
    }
    return out;
  }

  /* ---------- PNG 이미지 배출 (현재 성능·구성 카드) ---------- */
  // 이미지는 data URI 로 인라인돼 있어(GBO2_IMAGES) file:// 에서도 캔버스 오염 없이 그릴 수 있다.
  // 좌: 기체 이미지 + 장착 파츠(썸네일) / 우: 성능표·내구·누적치·발동 스킬.
  /** 마지막으로 그린 카드의 무장표가 칸을 넘었는지. 검사 도구가 읽는다. */
  let cardFit = { over: 0, shrunk: 0, clipped: 0, widest: 0, worst: '' };

  async function exportPng(mode) {
    if (!state.ms) { toast('먼저 기체를 선택하세요'); return; }
    const m = state.ms, lv = msLevel(m);
    const r = stats();
    const bare = skillStatBonus() ? stats(null) : null;

    const cv = n => (getComputedStyle(document.documentElement).getPropertyValue(n) || '').trim();
    const CO = {
      bg: cv('--bg') || '#0f1013', panel: cv('--panel') || '#17191f', panel2: cv('--panel-2') || '#1e2129',
      line: cv('--line') || '#2e323d', text: cv('--text') || '#e8eaef', muted: cv('--muted') || '#8a91a0',
      dim: cv('--dim') || '#5a6070', ok: cv('--ok') || '#4ec97f', skill: cv('--skill') || '#c08bff',
      skill2: cv('--skill2') || '#2ee6d6', bad: cv('--bad') || '#ff6b6b', accent: cv('--accent') || '#ffc93c',
      info: cv('--info') || '#4aa3ff', close: cv('--close') || '#ff8a5b',
      mid: cv('--mid') || '#5bc0ff', long: cv('--long') || '#b78bff'
    };
    // 막대·수치 색은 현재 앱 성능표와 동일하게 — 소체=회색, 파츠증가=초록, 스킬=보라/청록, 초과=빨강, 상한근접=노랑
    const track = CO.panel2, slotOn = CO.info || '#4aa3ff';
    const ATTR_C = { '汎用': '#4aa3ff', '強襲': '#ff7a7a', '支援': '#6bd98a' };
    const attrC = ATTR_C[m.属性] || CO.muted;
    const F = "'Malgun Gothic', 'Segoe UI', system-ui, sans-serif";
    const skillCol = state.skillPicks.size > 1 ? CO.skill2 : CO.skill;

    // 상세 모드: 무장 피해 표. 컬럼이 많아 카드 폭을 넓힌다.
    const detail = mode === 'detail';
    const weapons = detail ? weaponDamageList() : [];
    const showW = detail && weapons.length > 0;
    if (detail && !weapons.length) toast('무장 정보가 없어 요약으로 저장합니다');

    // 카드가 메신저(카톡 등)를 지나면 긴 변이 1280 안팎으로 줄고 다시 압축된다.
    // 그때 글자가 살아남느냐는 「글자 크기 ÷ 카드 폭」 비율로 정해진다 — DPR 로는 안 바뀐다.
    // 그래서 글자를 키우고(FS) 그래프 바를 줄여 폭을 깎았다. 2400px 에서 13px 본문이
    // 1280 으로 줄면 14px 이 되어 뭉갰는데, 이 비율이면 19px 로 남는다.
    const PAD = 24, IP = 20, GAP = 20;
    let DPR = 3;                                  // 아래에서 폰 메모리에 맞춰 낮출 수 있다
    const FS = 1.2;                               // 카드 글자 배율
    const fnt = (px, w) => (w ? w + ' ' : '') + +(px * FS).toFixed(1) + 'px ' + F;
    const W = showW ? 1120 : 1040;  // 상세만 좁혔다 — 요약을 더 줄이면 그래프 바가 안 보인다
    const leftX = PAD, leftW = 396, rightX = PAD + leftW + GAP, rightW = W - PAD - rightX, panelTop = PAD;

    // 이미지 미리 로드 (data URI → onload 즉시지만 비동기라 await)
    // 사이트판은 파일을 따로 받으므로 없는 이미지가 404 가 된다 — 화면의 <img> 와 똑같이
    // 기본 이미지로 한 번 되짚는다(그러지 않으면 그 자리만 빈 채로 카드가 나간다).
    const load = (src, dir) => new Promise(res => {
      if (!src) return res(null);
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => {
        const fb = dir && defaultImg(dir);
        if (!fb || fb === src) return res(null);
        const im2 = new Image();
        im2.onload = () => res(im2); im2.onerror = () => res(null); im2.src = fb;
      };
      im.src = src;
    });
    const heroImg = await load(msImg(m.MS名), 'ms');
    const partItems = await Promise.all(state.equipped.map(async p => ({
      im: await load(partImg(p.name), 'parts'), name: T.partName(p.name),
      lv: (String(p.name).match(/LV\s*(\d+)/i) || [])[1] || ''
    })));

    const skills = activeSkills().map(s => s.nameKo);
    const alt = altModeOf(m);
    const stg = activeStaggerMods(m, lv);
    const sl = slots();
    const slotRows = [['근', sl.close, sl.maxClose], ['중', sl.mid, sl.maxMid], ['원', sl.long, sl.maxLong]];
    const expLabel = state.expansion === C.EXPANSION_NONE ? '없음'
      : (C.EXPANSION_LABEL[state.expansion] || state.expansion) + ' LV' + state.expLevel;
    const formLabel = (state.form !== 'normal' && alt) ? alt.label : null;
    // 주무장 LV 가 기체 LV 와 다를 때만 카드에 적는다.
    const wlvNote = wantWeaponLv() !== lv ? '주무장 LV' + wantWeaponLv() : '';

    const wrapLines = (ctx, text, font, maxW) => {
      ctx.font = font;
      const out = []; let line = '';
      for (const word of String(text).split(' ')) {
        const test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width > maxW && line) { out.push(line); line = word; } else line = test;
      }
      if (line) out.push(line);
      return out.length ? out : [''];
    };
    const clip = (ctx, t, maxW, font) => { ctx.font = font; if (ctx.measureText(t).width <= maxW) return t; let s = t; while (s && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1); return s + '…'; };

    let leftBottom = 0, rightBottom = 0;

    // 좌·우 패널 '내용'만 그린다(패널 배경은 오케스트레이터가 먼저 그림). draw=false 면 높이만 잰다.
    function content(ctx, draw) {
      const lt = (t, x, y, font, color, align) => { if (draw) { ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align || 'left'; ctx.fillText(t, x, y); ctx.textAlign = 'left'; } };
      const rt = (t, xR, y, font, color) => lt(t, xR, y, font, color, 'right');
      // 높이만 재는 1패스에서는 lt 가 폰트를 안 걸어, 그대로 measureText 하면 직전 폰트로 잰다.
      // 가로 배치에만 쓰여 결과는 같았지만, 나중에 세로 계산에 쓰면 조용히 어긋난다 — 여기서 막는다.
      const textW = (t, font, fallback) => { if (!draw) return fallback; ctx.font = font; return ctx.measureText(t).width; };
      const rule = (y, x0, x1) => { if (draw) { ctx.strokeStyle = CO.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, y + 0.5); ctx.lineTo(x1, y + 0.5); ctx.stroke(); } };
      const rrect = (x, y, w, h, rad) => { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, rad); else ctx.rect(x, y, w, h); };
      const box = (x, y, w, h, rad) => { if (draw) { ctx.fillStyle = CO.panel2; rrect(x, y, w, h, rad); ctx.fill(); ctx.strokeStyle = CO.line; ctx.lineWidth = 1; rrect(x + 0.5, y + 0.5, w, h, rad); ctx.stroke(); } };
      const fit = (im, x, y, w, h) => { if (!im || !draw) return; const s = Math.min(w / im.width, h / im.height); ctx.drawImage(im, x + (w - im.width * s) / 2, y + (h - im.height * s) / 2, im.width * s, im.height * s); };

      /* ═══ 좌측 패널 ═══ */
      const lx = leftX + IP, lR = leftX + leftW - IP;
      let ly = panelTop + IP;
      // 헤더: 썸네일 + 이름 + ★ + 코스트 뱃지
      const TH = 60;
      box(lx, ly, TH, TH, 8);
      fit(heroImg, lx + 2, ly + 2, TH - 4, TH - 4);
      const nx = lx + TH + 14;
      lt(clip(ctx, T.msName(m.MS名), lR - nx, fnt(17, '700')), nx, ly + 21, fnt(17, '700'), CO.text);
      lt('★'.repeat(msRarity(m)) || '', nx, ly + 44, fnt(13), CO.accent);
      if (draw) {
        ctx.font = fnt(13); const sw = ctx.measureText('★'.repeat(msRarity(m)) || '').width;
        const bt = T.attrName(m.属性) + ' ' + m.コスト;
        ctx.font = fnt(12, '700'); const bw = ctx.measureText(bt).width + 18;
        const bx = nx + sw + (sw ? 10 : 0), byy = ly + 33;
        ctx.fillStyle = attrC; rrect(bx, byy, bw, 20, 10); ctx.fill();
        ctx.fillStyle = '#10151c'; ctx.textAlign = 'left'; ctx.fillText(bt, bx + 9, byy + 14);
      }
      ly += TH + 14;
      const headTxt = '강화 ' + STAGE_LABEL[state.stage] + '    확장 ' + expLabel
        + (formLabel ? '    ' + formLabel : '');
      lt(headTxt, lx, ly + 4, fnt(12), CO.muted);
      // 주무장 LV 를 낮춰 둔 채 카드를 내보내면, 받아 본 사람은 기체 LV 로 읽는다.
      // 무장 위력만이 아니라 레벨링크 파츠가 기본값만 붙어 **성능 수치까지** 달라지므로
      // 요약 카드에도 반드시 적어야 한다. 기본값(기체와 같음)일 때는 적지 않는다 —
      // 늘 붙어 있으면 눈에 안 들어와 경고 구실을 못 한다.
      if (wlvNote) {
        lt(wlvNote, lx + textW(headTxt + '    ', fnt(12), 0), ly + 4, fnt(12, '700'), CO.accent);
      }
      ly += 16; rule(ly, lx, lR); ly += 14;

      // 파츠 슬롯 게이지 (근/중/원)
      lt('파츠 슬롯', lx, ly + 2, fnt(12, '700'), CO.muted); ly += 16;
      for (const [lb, used, max] of slotRows) {
        const rowY = ly;
        lt(lb, lx, rowY + 13, fnt(13), CO.text);
        lt(used + ' / ' + max, lx + 26, rowY + 13, fnt(13), used > max ? CO.bad : CO.muted);
        const bX = lx + 92, bW = lR - bX, bh = 12, bY = rowY + 2;
        const cells = Math.min(Math.max(max, used, 1), 20);
        const scale = cells / Math.max(max, used, 1);
        const filled = Math.round(used * scale), over = used > max;
        const cg = 2, cw = (bW - (cells - 1) * cg) / cells;
        if (draw) for (let i = 0; i < cells; i++) {
          ctx.fillStyle = i < filled ? (over ? CO.bad : slotOn) : track;
          ctx.fillRect(bX + i * (cw + cg), bY, cw, bh);
        }
        ly += 26;
      }
      ly += 4; rule(ly, lx, lR); ly += 12;

      // 장착 파츠 썸네일 그리드 (4열, LV 뱃지)
      lt('장착 파츠 ' + partItems.length, lx, ly + 2, fnt(12, '700'), CO.muted); ly += 16;
      if (!partItems.length) { lt('없음', lx, ly + 6, fnt(13), CO.dim); ly += 22; }
      else {
        const cols = 4, cg = 8, cw = (lR - lx - (cols - 1) * cg) / cols;
        const rows = Math.ceil(partItems.length / cols);
        partItems.forEach((it, i) => {
          const cx = lx + (i % cols) * (cw + cg), cy = ly + Math.floor(i / cols) * (cw + cg);
          box(cx, cy, cw, cw, 7);
          fit(it.im, cx + 3, cy + 3, cw - 6, cw - 6);
          if (it.lv && draw) {   // LV 뱃지 (우하단)
            ctx.font = fnt(10, '700'); const t = 'LV' + it.lv, w2 = ctx.measureText(t).width + 8;
            ctx.fillStyle = 'rgba(6,9,14,.82)'; rrect(cx + cw - w2 - 3, cy + cw - 17, w2, 14, 4); ctx.fill();
            ctx.fillStyle = CO.text; ctx.textAlign = 'left'; ctx.fillText(t, cx + cw - w2 + 1, cy + cw - 6);
          }
        });
        ly += rows * (cw + cg) - cg + 4;
      }
      leftBottom = ly;

      /* ═══ 우측 패널: 성능표 ═══ */
      const rxi = rightX + IP, rR = rightX + rightW - IP;
      let ry = panelTop + IP;
      const xTotalR = rxi + 168, xGainR = rxi + 254, barX = rxi + 268, barR = rR - 52, barW = barR - barX, xCapR = rR;
      lt('항목', rxi, ry + 11, fnt(11), CO.dim);
      rt('합계', xTotalR, ry + 11, fnt(11), CO.dim);
      rt('보정', xGainR, ry + 11, fnt(11), CO.dim);
      lt('그래프', barX, ry + 11, fnt(11), CO.dim);
      rt('상한', xCapR, ry + 11, fnt(11), CO.dim);
      ry += 18; rule(ry, rxi, rR); ry += 2;

      for (const k of C.STAT_KEYS) {
        const limit = r.currentLimits[k], raw = r.rawTotal[k], tot = r.total[k], soche = r.base[k];
        const skillGain = bare ? tot - bare.total[k] : 0;
        const gain = tot - soche, base = gain - skillGain;
        const over = limit !== Infinity && raw > limit ? raw - limit : 0;
        const scale = limit === Infinity ? Math.max(tot, soche, 1) * 1.15 : limit;
        const pct = v => Math.max(0, Math.min(1, v / scale));
        const baseW = pct(Math.min(soche, tot));
        const gainW = Math.min(1 - baseW, pct(Math.max(base, 0)));
        const skillW = Math.min(1 - baseW - gainW, pct(Math.max(skillGain, 0)));
        const atCap = limit !== Infinity && tot >= limit;
        const rowY = ry + 19;

        lt(C.STAT_LABEL[k], rxi, rowY, fnt(13), CO.text);
        rt((over ? '⚠ ' : '') + tot.toLocaleString(), xTotalR, rowY, fnt(15, '700'),
          over ? CO.close : atCap ? CO.accent : CO.text);
        if (draw) {   // 보정: 파츠(초록)+스킬(보라)
          ctx.textAlign = 'right'; let dx = xGainR;
          if (skillGain) { ctx.font = fnt(13, '700'); ctx.fillStyle = skillCol; ctx.fillText('+' + skillGain, dx, rowY); dx -= ctx.measureText('+' + skillGain).width + 5; }
          if (base !== 0) { ctx.font = fnt(13, '700'); ctx.fillStyle = base > 0 ? CO.ok : CO.bad; ctx.fillText((base > 0 ? '+' : '') + base.toLocaleString(), dx, rowY); }
          else if (!skillGain) { ctx.font = fnt(13); ctx.fillStyle = CO.dim; ctx.fillText('·', dx, rowY); }
          ctx.textAlign = 'left';
          // 막대: 회색 소체 + 초록 증가 + 보라 스킬, 트랙 위 (앱 성능표와 동일)
          const by = ry + 11, bh = 11;
          ctx.fillStyle = track; rrect(barX, by, barW, bh, 3); ctx.fill();
          let bx = barX; const seg = (w, c) => { if (w > 0.0005) { ctx.fillStyle = c; ctx.fillRect(bx, by, barW * w, bh); bx += barW * w; } };
          ctx.save(); rrect(barX, by, barW, bh, 3); ctx.clip();
          seg(baseW, CO.dim); seg(gainW, over ? CO.close : atCap ? CO.accent : CO.ok); seg(skillW, skillCol);
          ctx.restore();
          if (over) { ctx.font = fnt(10, '700'); ctx.fillStyle = '#fff'; ctx.textAlign = 'right'; ctx.fillText('OVER', barR - 4, by + 9); ctx.textAlign = 'left'; }
        }
        rt(limit === Infinity ? '—' : limit.toLocaleString(), xCapR, rowY, fnt(13), CO.dim);
        ry += 30;
      }

      ry += 2; rule(ry, rxi, rR); ry += 10;

      // 공격 지표 — 화면 성능표와 같은 '실효 보정'(보정에 피해% 를 접은 값).
      // 카드에 이 행이 아예 없어서, 파츠·스킬의 공격 % 효과가 이미지로는 보이지 않았다.
      {
        const ab = partAttackBonus(state.equipped, lv);
        lt('공격 지표', rxi, ry + 4, fnt(12, '700'), CO.muted);
        let ax = rxi + 78;
        for (const [key, lb, corr] of [['shoot', '사격', r.total.shoot], ['melee', '격투', r.total.meleeCorrection]]) {
          const mult = (1 + ab[key] / 100) * skillDmgPctList(key).reduce((s2, q) => s2 * (1 + q / 100), 1);
          const pct = Math.round((mult - 1) * 100);
          const eff = Math.round(((1 + corr / 100) * (1 + pct / 100) - 1) * 100);
          lt(lb, ax, ry + 4, fnt(12), CO.muted); ax += textW(lb, fnt(12), 26) + 5;
          const v = eff.toLocaleString();
          lt(v, ax, ry + 4, fnt(13, '700'), CO.info); ax += (draw ? ctx.measureText(v).width : 40) + 5;
          if (pct !== 0) {
            const tg = '피해 ' + (pct > 0 ? '+' : '') + pct + '%';
            lt(tg, ax, ry + 4, fnt(11, '700'), pct < 0 ? CO.bad : CO.ok);
            ax += (draw ? ctx.measureText(tg).width : 52) + 14;
          } else ax += 14;
        }
        ry += 24;
      }

      lt('내구 지표', rxi, ry + 4, fnt(12, '700'), CO.muted);
      let dx = rxi + 78;
      // 화면과 같이 피해경감(파츠 % · 체크한 방어 스킬)을 실효 HP 에 접는다.
      // 이게 빠져 있어서 경감 파츠를 껴도 카드의 내구 지표가 경감 전 값으로 나갔다.
      const pngCuts = damageCutsOf(state.equipped, { lv, skillMs: m });
      for (const [dattr, lb] of DURA_ATTRS) {
        lt(lb, dx, ry + 4, fnt(12), CO.muted); dx += textW(lb, fnt(12), 30) + 5;
        const cutPct = cutPctOf(pngCuts, dattr);
        const v = enduranceOf(r.total, dattr, pngCuts).toLocaleString();
        lt(v, dx, ry + 4, fnt(13, '700'), CO.info); dx += (draw ? ctx.measureText(v).width : 48) + 5;
        if (cutPct) {
          const tg = '피해 -' + cutPct + '%';
          lt(tg, dx, ry + 4, fnt(11, '700'), CO.ok);
          dx += (draw ? ctx.measureText(tg).width : 52) + 9;
        } else dx += 13;
      }
      ry += 24;
      lt('누적치', rxi, ry + 4, fnt(12, '700'), CO.muted);
      lt('내성 ' + Math.round(stg.threshold / stg.mult) + '%    임계 ' + stg.threshold + '%'
        + (stg.mult < 1 ? '    받는 누적 ×' + (+stg.mult.toFixed(3)) : ''), rxi + 78, ry + 4, fnt(13), CO.text);
      ry += 20;
      // 슬러스터 지표 — 성능표와 같은 값(부스트·풀회복·OH). 출격 가능한 환경만.
      {
        const thrV = r.total.thruster || 0;
        const sec1 = v => v == null ? '—' : (Math.round(v * 10) / 10).toFixed(1) + '초';
        for (const [env, lb] of [['ground', '지상'], ['space', '우주']]) {
          if (env === 'ground' && m['出撃_地上可'] === false) continue;
          if (env === 'space' && m['出撃_宇宙可'] === false) continue;
          const tm = thrusterMetrics(m, thrV, state.equipped, env,
            { lv, on: state.thrusterOn, form: state.form });
          if (!tm) continue;
          lt('슬러스터 ' + lb, rxi, ry + 4, fnt(12, '700'), CO.muted);
          lt('부스트 ' + sec1(tm.boost) + '    풀회복 ' + sec1(tm.full) + '    OH ' + sec1(tm.oh),
            rxi + 96, ry + 4, fnt(13), CO.text);   // '슬러스터 지상' 이 길어 78 이면 값과 붙는다
          ry += 20;
        }
      }
      if (skills.length) {
        ry += 8; rule(ry, rxi, rR); ry += 12;
        lt('발동 스킬', rxi, ry + 4, fnt(12, '700'), skillCol);
        const lines = wrapLines(ctx, skills.join('  ·  '), fnt(13), rR - (rxi + 78));
        lines.forEach((ln, i) => lt(ln, rxi + 78, ry + 4 + i * 19, fnt(13), CO.text));
        ry += Math.max(16, lines.length * 19);
      }
      rightBottom = ry;
    }

    // 1패스: 내용 높이 측정 (무장 패널은 전체 폭, 두 패널 아래)
    const measure = document.createElement('canvas').getContext('2d');
    content(measure, false);
    const panelH = Math.max(leftBottom, rightBottom) - panelTop + IP;
    const wpTop = panelTop + panelH + GAP;
    const wpRowH = 34, wpH = showW ? IP + 26 + 22 + weapons.length * wpRowH + IP - 8 : 0;
    const contentBottom = showW ? wpTop + wpH : panelTop + panelH;
    const footerY = contentBottom + 22;
    const H = Math.ceil(footerY + PAD - 6);

    // 2패스: 실제 렌더. 캔버스가 너무 크면 폰(WebView)에서 만들다 실패해
    // 빈 이미지가 나온다 — 픽셀 수에 상한을 두고 배율을 낮춘다.
    while (DPR > 2 && W * H * DPR * DPR > 12e6) DPR -= 0.5;
    const cvs = document.createElement('canvas');
    cvs.width = W * DPR; cvs.height = H * DPR;
    const ctx = cvs.getContext('2d');
    ctx.scale(DPR, DPR);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = CO.bg; ctx.fillRect(0, 0, W, H);
    // 패널 배경(둥근 모서리) 먼저
    const panelBg = (px, py, pw, ph) => {
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(px, py, pw, ph, 14); else ctx.rect(px, py, pw, ph);
      ctx.fillStyle = CO.panel; ctx.fill();
      ctx.strokeStyle = CO.line; ctx.lineWidth = 1; ctx.stroke();
    };
    panelBg(leftX, panelTop, leftW, panelH);
    panelBg(rightX, panelTop, rightW, panelH);
    if (showW) panelBg(PAD, wpTop, W - 2 * PAD, wpH);
    content(ctx, true);

    // 무장 피해 표 — 파츠 적용 무장표의 전체 컬럼
    if (showW) {
      const dtext = (t, x, y, font, color, align) => { ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align || 'left'; ctx.fillText(t, x, y); ctx.textAlign = 'left'; };
      const dclip = (t, maxW, font) => { ctx.font = font; if (ctx.measureText(t).width <= maxW) return t; let s = t; while (s && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1); return s + '…'; };
      cardFit = { over: 0, shrunk: 0, clipped: 0, widest: 0, worst: '' };
      const wx0 = PAD + IP, wR = W - PAD - IP;
      // 컬럼 x (좌측정렬: 구분·이름·유형 / 우측정렬: 나머지)
      // 폭에 대한 비율로 잡는다. 예전엔 1200px 를 전제한 고정 좌표라
      // 카드를 좁히자 사거리 열이 카드 밖으로 나갔다.
      const wW = wR - wx0, col = f => wx0 + wW * f;
      const cSec = wx0, dotX = col(.047), cName = col(.056), cType = col(.270);
      // 논차지·풀차지는 「기본 (+파츠) (+스킬)」 가 한 줄에 들어가야 해서 넓게 잡는다.
      /* 칸 배분은 **실측**으로 정했다. 932행(143기 표본)의 글자 폭을 재 보니
         쿨/발사는 118px 를 받고 최대 69px 만 쓰는데, 누적치는 80px 을 받고 최대 127px 이
         필요했다 — 47px 이 왼쪽 칸을 덮어 글자가 겹쳤다(사용자가 메타스[중장비]에서 발견).
           칸       지금  실제최대        고친 뒤
           쿨/발사   118   69            72
           탄/히트   115  116           118
           누적치     80  127           130
           사거리     95   72            76
           리로드    104  111           117
         남는 72px 을 모자란 55px 에 돌리면 표본은 전부 들어간다.
         표본 밖의 긴 꼬리(최대 40자)는 아래 dfit 이 줄이고 잘라 막는다. */
      const cNC = col(.425), cCH = col(.549), cCool = col(.6124), cAmmo = col(.7163),
        cStg = col(.8307), cRange = col(.8976), cRel = wR;
      /* 칸을 넘으면 **글자를 줄이고**, 그래도 넘으면 잘라 낸다.
         자르기만 하면 긴 값이 통째로 사라지고, 줄이기만 하면 40자짜리가 못 들어간다. */
      const dfit = (t, x, y, maxW, color, align) => {
        let px = 12;
        ctx.font = fnt(px);
        const want = ctx.measureText(t).width;
        while (px > 9 && ctx.measureText(t).width > maxW) { px -= 1; ctx.font = fnt(px); }
        const cut = ctx.measureText(t).width > maxW;
        const fit = cut ? dclip(t, maxW, fnt(px)) : t;
        /* 캔버스에 그린 글자는 밖에서 읽을 수 없다 — 겹침을 검사하려면 그리는 쪽이 적어 둬야 한다.
           over : 칸을 넘은 픽셀(0 이어야 한다) · shrunk/clipped : 줄이거나 자른 칸 수 */
        ctx.font = fnt(px);
        cardFit.over = Math.max(cardFit.over, Math.round(ctx.measureText(fit).width - maxW));
        if (px < 12) cardFit.shrunk++;
        if (cut) { cardFit.clipped++; cardFit.worst = cardFit.worst || t; }
        cardFit.widest = Math.max(cardFit.widest, Math.round(want));
        dtext(fit, x, y, fnt(px), color, align);
      };
      let wy = wpTop + IP + 4;
      dtext('무장 내역', wx0, wy + 8, fnt(13, '700'), CO.text);
      dtext('(피해량은 파츠·스킬·자세 반영)', wx0 + 82, wy + 8, fnt(11), CO.dim);
      if (wlvNote) {
        ctx.font = fnt(11);
        const nw = ctx.measureText('(피해량은 파츠·스킬·자세 반영)').width;
        dtext('· ' + wlvNote + ' (부무장은 기체 LV)', wx0 + 82 + nw + 8, wy + 8, fnt(11, '700'), CO.accent);
      }
      wy += 24;
      const hf = fnt(11);
      dtext('구분', cSec, wy + 8, hf, CO.dim);
      dtext('이름', cName, wy + 8, hf, CO.dim);
      dtext('유형', cType, wy + 8, hf, CO.dim);
      dtext('논차지', cNC, wy + 8, hf, CO.dim, 'right');
      dtext('풀차지', cCH, wy + 8, hf, CO.dim, 'right');
      dtext('쿨/발사', cCool, wy + 8, hf, CO.dim, 'right');
      dtext('탄/히트', cAmmo, wy + 8, hf, CO.dim, 'right');
      dtext('누적치', cStg, wy + 8, hf, CO.dim, 'right');
      dtext('사거리', cRange, wy + 8, hf, CO.dim, 'right');
      dtext('리로드/OH', cRel, wy + 8, hf, CO.dim, 'right');
      wy += 8; ctx.strokeStyle = CO.line; ctx.beginPath(); ctx.moveTo(wx0, wy + 0.5); ctx.lineTo(wR, wy + 0.5); ctx.stroke();
      wy += 4;
      const vf = fnt(12), vfb = fnt(12, '700');
      weapons.forEach((wp, i) => {
        const ry = wy + 16 + i * wpRowH;
        const tc = wp.attr === 'melee' ? CO.close : wp.attr === 'beam' ? CO.info
          : wp.attr === 'shield' ? CO.long : wp.attr === 'solid' ? CO.accent : CO.mid;
        dtext(wp.sec, cSec, ry, fnt(11), CO.muted);
        ctx.fillStyle = tc; ctx.beginPath(); ctx.arc(dotX, ry - 4, 3.5, 0, 7); ctx.fill();
        // 디버프는 이름 옆에, **고정 피해는 아랫줄에** — 화면 무장 표와 같은 배치다.
        // 예전엔 카드에서만 이름 옆에 붙여 두어, 소이 무장은 표기가 길어 이름이 잘렸다.
        const dbTag = (wp.debuffs || []).join(' · ');
        ctx.font = fnt(10);
        const tagW = dbTag ? ctx.measureText(dbTag).width + 6 : 0;
        const nmTxt = dclip(wp.name, cType - cName - 10 - tagW, vf);
        dtext(nmTxt, cName, ry, vf, CO.text);
        if (dbTag) {
          ctx.font = vf;
          dtext(dbTag, cName + ctx.measureText(nmTxt).width + 6, ry, fnt(10), CO.close);
        }
        if (wp.fx) {
          const hitTx = wp.fx.ranged ? wp.fx.hits + '~' + wp.fx.hitsMax : String(wp.fx.hits);
          const totTx = wp.fx.ranged
            ? wp.fx.total.toLocaleString() + '~' + wp.fx.totalMax.toLocaleString()
            : wp.fx.total.toLocaleString();
          dtext(wp.fx.hitsMax > 1
            ? '고정 ' + wp.fx.per.toLocaleString() + '×' + hitTx + ' = ' + totTx
            : '고정 ' + totTx, cName, ry + 12, fnt(10), CO.close);
        }
        dtext(wp.kind, cType, ry, vf, tc);
        // 피해 칸 — 화면 무장 표와 같이 「기본 (+파츠) (+스킬)」 로 쪼개 오른쪽 정렬로 쌓는다.
        // 조사·산탄·동시발사는 1발 값만으로는 세기를 못 재니 아래 줄에 전탄 합계를 적는다.
        const dmgAt = (v, x, bold) => {
          if (!v) { dtext('—', x, ry, vf, CO.dim, 'right'); return; }
          let rx = x;
          const seg = (t, font, col) => { dtext(t, rx, ry, font, col, 'right'); ctx.font = font; rx -= ctx.measureText(t).width + 3; };
          if (v.skillGain) seg('(' + (v.skillGain > 0 ? '+' : '') + v.skillGain.toLocaleString() + ')', fnt(10), skillCol);
          if (v.gain) seg('(' + (v.gain > 0 ? '+' : '') + v.gain.toLocaleString() + ')', fnt(10), v.gain > 0 ? CO.ok : CO.bad);
          seg(v.base.toLocaleString(), bold ? vfb : vf, CO.text);
          if (v.n > 1) {
            let sx = x;
            const sub = (t, col) => { dtext(t, sx, ry + 12, fnt(10), col, 'right'); ctx.font = fnt(10); sx -= ctx.measureText(t).width + 3; };
            if (v.skillGain) sub('(' + (v.skillGain > 0 ? '+' : '') + (v.skillGain * v.n).toLocaleString() + ')', skillCol);
            if (v.gain) sub('(' + (v.gain > 0 ? '+' : '') + (v.gain * v.n).toLocaleString() + ')', v.gain > 0 ? CO.ok : CO.bad);
            sub('전탄 ' + (v.base * v.n).toLocaleString() + ' ×' + v.n, CO.muted);
          }
        };
        dmgAt(wp.nc, cNC, true);
        dmgAt(wp.ch, cCH, false);
        const dim = t => (t === '—' ? CO.dim : CO.muted);
        /* 누적치·사거리는 「비집속 (집속)」 꼴이 많다 — 「15% x2발 x2발 (25% x2발 x4발)」.
           한 줄에 안 들어가면 **괄호를 아랫줄로 내린다.** 아랫줄은 이 칸에서 비어 있고,
           줄이거나 자르면 값이 사라지는데 내리면 그대로 다 보인다. */
        const dpair = (t, x, maxW, color) => {
          ctx.font = vf;
          // 괄호는 세 꼴이다 — （집속） · (집속) · 【집속】. 셋 다 아랫줄로 내린다.
          const m = /^(.*?)\s*([（(【].*[）)】])$/.exec(t);
          if (m && ctx.measureText(t).width > maxW) {
            dfit(m[1], x, ry, maxW, color, 'right');
            dfit(m[2], x, ry + 12, maxW, CO.dim, 'right');
          } else {
            dfit(t, x, ry, maxW, color, 'right');
          }
        };
        dpair(wp.cool, cCool, cCool - cCH - 6, dim(wp.cool));
        dpair(wp.ammo, cAmmo, cAmmo - cCool - 6, dim(wp.ammo));
        dpair(wp.stagger, cStg, cStg - cAmmo - 6, dim(wp.stagger));
        dpair(wp.range, cRange, cRange - cStg - 6, dim(wp.range));
        dpair(wp.reload, cRel, cRel - cRange - 6, dim(wp.reload));
      });
    }

    // 푸터
    ctx.fillStyle = CO.dim; ctx.font = fnt(11);
    ctx.textAlign = 'left'; ctx.fillText('GBO2 커스텀 파츠 시뮬레이터', PAD, footerY);
    ctx.textAlign = 'right'; ctx.fillText(new Date().toISOString().slice(0, 10), W - PAD, footerY);
    ctx.textAlign = 'left';

    // T.msName 은 이미 「… LV2」 로 끝난다 — 그대로 붙이면 「문 건담 LV2_LV2」 가 된다.
    const safe = T.msName(m.MS名).replace(/\s*LV\d+$/, '').replace(/[\\/:*?"<>|]/g, '')
      + '_LV' + lv + (showW ? '_상세' : '');
    // 안드로이드 앱(WebView)은 blob 다운로드가 동작하지 않아 파일이 저장되지 않는다.
    // → 네이티브 브리지로 base64 를 넘겨 기기 Download 폴더에 직접 저장한다(성공/실패 토스트는 네이티브가).
    // 예전엔 곧바로 내려받아, 어떤 카드가 나왔는지 파일을 열어 봐야 알 수 있었다.
    // 먼저 보여 주고 저장/복사를 고르게 한다.
    openPngPreview(cvs, safe);
  }

  /* ---------- 이미지 미리보기 ---------- */
  let pngShot = null;                       // { canvas, name }

  function openPngModal(open) {
    const m = document.getElementById('pngModal'), b = document.getElementById('pngModalBack');
    setModal(m, b, open);
    if (!open) { const box = document.getElementById('pngPreview'); if (box) box.innerHTML = ''; pngShot = null; }
  }

  function openPngPreview(cvs, name) {
    pngShot = { cvs, name };
    const box = $('#pngPreview');
    box.innerHTML = '';
    const img = el('img');
    img.src = cvs.toDataURL('image/png');
    img.alt = name;
    box.append(img);
    $('#pngNote').textContent = name + '.png · ' + cvs.width + '×' + cvs.height;
    $('#pngCopy').hidden = !((window.AndroidBridge && window.AndroidBridge.copyImage)
      || (navigator.clipboard && window.ClipboardItem));
    openPngModal(true);
  }

  /** 캔버스를 파일로 저장 — 안드로이드는 앱 브리지로 다운로드 폴더에 넣는다. */
  function savePngShot() {
    if (!pngShot) return;
    const { cvs, name } = pngShot;
    if (window.AndroidBridge && typeof window.AndroidBridge.saveImage === 'function') {
      try { window.AndroidBridge.saveImage(cvs.toDataURL('image/png'), name + '.png'); }
      catch (e) { toast('이미지 저장에 실패했습니다'); }
      return;
    }
    cvs.toBlob(blob => {
      if (!blob) { toast('이미지 생성에 실패했습니다'); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name + '.png';
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('이미지를 저장했습니다: ' + name + '.png');
    }, 'image/png');
  }

  /** 클립보드로 — 채팅창에 바로 붙여넣을 수 있다. 지원 안 하면 버튼 자체를 숨긴다. */
  function copyPngShot() {
    if (!pngShot) return;
    // 안드로이드 앱(WebView)은 navigator.clipboard 의 **이미지** 쓰기를 구현하지 않아
    // 웹 방식이 늘 실패했다(저장만 되던 이유). 앱에서는 네이티브 브리지를 쓴다.
    if (window.AndroidBridge && typeof window.AndroidBridge.copyImage === 'function') {
      try { window.AndroidBridge.copyImage(pngShot.cvs.toDataURL('image/png'), pngShot.name + '.png'); }
      catch (e) { toast('이미지 복사에 실패했습니다'); }
      return;
    }
    if (!navigator.clipboard || !window.ClipboardItem) { toast('이 브라우저는 이미지 복사를 지원하지 않습니다'); return; }
    pngShot.cvs.toBlob(async blob => {
      if (!blob) { toast('이미지 생성에 실패했습니다'); return; }
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        toast('이미지를 복사했습니다 — 붙여넣기로 바로 쓸 수 있습니다');
      } catch (e) {
        toast('복사가 막혀 있습니다 — 저장 후 쓰세요');
      }
    }, 'image/png');
  }

