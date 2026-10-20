  /* ui/12-hit-shared.js — 피해 · 경직 · 실드 공용 조각(대결과 함께 쓴다).
     tools/lib/uisrc.js 가 번호 순으로 이어 붙여 한 IIFE 로 감싼다(파일끼리 변수를 나눠 쓴다). */
  /* ---------- 피해·경직·실드 공용 조각 ----------
     한때 「피탄 시뮬레이터」 화면이 혼자 쓰던 것들인데, 그 화면을 대결 시뮬로 합치면서
     **판정과 문구만** 남겼다(2026-10-13). 화면을 그리는 코드는 여기 없다 —
     대결 시뮬(duel.js)이 교체 지점으로 이 함수들을 받아 쓴다.
     여기 둔 이유는 하나다: 같은 값을 두 군데서 세지 않는 것. */

  // 「이 무장 N발 버티기」 를 자동 구성 목표로 넘길 때 쓰는 축
  const EHP_AXIS = { solid: 'ehpSolid', beam: 'ehpBeam', melee: 'ehpMelee', shield: 'ehpMelee' };

  // 목표 발수 (0 이면 '지금 버티는 발수 +1' 을 기본값으로 쓴다).
  // 무장·적 기체를 바꾸면 비운다 — 다른 무장에 치던 발수가 그대로 남아 있으면
  // 새 무장의 기본값(현재 +1)이 안 나온다.
  let goalHits = 0;

  /**
   * 「이 무장 N발 버티기」 → 자동 구성 하한 목표. **피탄 시뮬과 대결 시뮬이 같이 쓴다.**
   * 두 군데에 두면 한쪽만 고쳐져 같은 무장이 화면마다 다른 목표를 건다.
   *   w       {name, attr}  어느 무장 기준인가
   *   dmg     한 방아쇠(전탄 명중) 피해 — 실효 HP 눈금
   *   hits    지금 버티는 발수 (기본값은 +1)
   *   needOf  n 발 버티는 데 드는 실효 HP (구간 무장은 쌓아서 센다)
   *   toHp    실효 HP → 기체 HP 눈금
   *   bands   대상 HP 구간이 있는 무장인가 (문구만 달라진다)
   *   after   목표를 건 뒤 이 화면을 닫는 법
   */
  function goalRowFor({ w, dmg, hits, needOf, toHp, bands, after }) {
    const wrap = el('div', 'goal-row');
    wrap.append(el('span', 'goal-lb', '버티기 목표'));
    const inp = el('input');
    inp.type = 'number'; inp.min = '1'; inp.max = '99';
    inp.value = String(goalHits || hits + 1);
    inp.oninput = () => { goalHits = Math.max(1, Number(inp.value) || 1); note(); };
    wrap.append(inp);
    wrap.append(el('span', 'goal-lb', '발'));

    const btn = el('button', 'btn-primary small', '자동 구성 목표로');
    btn.onclick = () => {
      const n = Math.max(1, Number(inp.value) || hits + 1);
      const key = EHP_AXIS[w.attr] || 'ehpSolid';
      const need = needOf(n);
      state.minimums[key] = need;
      // 어느 무장 기준인지 기억한다 — 관통·폭풍 경감처럼 그 무장에만 걸리는 파츠 경감을
      // 자동 구성도 같은 조건으로 재야 사용자가 본 숫자와 자를 맞출 수 있다.
      goalWeapon = w;
      // 손으로 목표 칸을 채운 것과 같은 취급 — 자동 구성이 「내 가중치」 를 1순위로 쓰게 한다
      state.weightsTouched = true;
      renderAutoGrid();
      if (after) after();
      openDrawer(true);
      toast(`${DERIVED_LABEL[key]} 하한 ${need.toLocaleString()} 으로 걸었습니다 — ${T.weaponName(w.name)} ${n}발 버티기`);
    };
    wrap.append(btn);

    const nt = el('span', 'goal-note');
    const note = () => {
      const n = Math.max(1, Number(inp.value) || hits + 1);
      const need = needOf(n);
      /* **HP 눈금으로 적는다** — 위 「격파까지」와 같은 자라야 둘을 견줄 수 있다.
         다만 자동 구성에 거는 값은 **실효 HP 그대로**다(그쪽 목표 칸이 실효 HP 축이라서).
         숫자가 둘이면 헷갈리므로, 실제로 걸리는 값은 뒤에 작게 밝혀 둔다. */
      const needHp = toHp ? toHp(need) : need;
      nt.textContent = '필요 HP ' + needHp.toLocaleString()
        + (bands ? ' (' + n + '발 누적 — 발마다 피해가 다릅니다)'
          : ' (1발 ' + (toHp ? toHp(dmg) : dmg).toLocaleString() + ' × ' + n + ')')
        + ' · 자동 구성에는 실효 HP ' + need.toLocaleString() + ' 로 걸립니다';
    };
    note();
    wrap.append(nt);
    return wrap;
  }

  /** 무장의 누적치(よろけ値) — 히트당 %와 1트리거 다발수(x7 등)를 읽는다.
   *
   *  배수가 **둘 붙는** 표기가 있다: 「20% x2発 x3射」 = 2발 동시 × 3사 = 6.
   *  첫 배수만 읽고 있어서 153 무장이 실제보다 낮게 나왔다. 더 나쁜 것은
   *  **같은 무장을 피해 쪽과 다르게 세고 있었다**는 점이다 — 같은 備考의
   *  「二発同時発射 x3回攻撃」을 피해는 2×3 = 6 으로 세는데 누적치는 2 로 셌다.
   *  (backlog 09-03 「같은 값을 양방향에서 다르게 세지 말 것」에 그대로 걸린다.)
   *
   *  괄호 안은 **집속값**이라 배수로 세면 안 된다 — 「5% x10（7% x10）」의 뒤쪽 x10 은
   *  집속 때의 배수지 비집속에 곱할 값이 아니다. 그래서 괄호를 먼저 지우고 센다.
   *  「7%（15HIT）」의 괄호도 같은 이유로 빠진다(그쪽은 경직까지 필요한 히트 수다). */
  function parseStagger(w) {
    let s = (w.mods && w.mods.stagger) || '';
    if (!s) { const note = (w.info && w.info['備考']) || ''; s = (note.match(/よろけ値[：:]\s*([^/]+)/) || [])[1] || ''; }
    const txt = String(s);
    const pm = txt.match(/(\d+(?:\.\d+)?)\s*%/);
    const bare = txt.replace(/[（(][^）)]*[）)]/g, '');        // 집속값(괄호)은 빼고 센다
    let pellets = 1;
    for (const m of bare.matchAll(/[x×]\s*(\d+)/g)) pellets *= Number(m[1]);
    return { pct: pm ? Number(pm[1]) : 0, pellets: pellets || 1 };
  }

  /**
   * 대상 HP 구간 무장의 **발마다 피해** 내역 — 「1발 100%→5,868 / 2발 76%→…」.
   * 「÷ 1발」은 구간 무장에서 거짓말이 된다(발마다 값이 다르다). 그래서 발마다 적는다.
   * **피탄 시뮬과 대결 시뮬이 같이 쓴다** — 한쪽만 안 적으면 그 화면은 발수의 근거가 없다.
   *   eff   실효 HP · bands  hpBonusOf(...).bands · dmgAt(left)  남은 실효 HP 에서의 피해
   *   toHp  실효 HP → 기체 HP 눈금 · hits  격파 발수
   */
  function hpBandWhy({ eff, bands, dmgAt, toHp, hits }) {
    if (!bands || hits == null) return '';
    const out = []; let left = eff;
    for (let i = 0; i < hits && i < 12; i++) {
      const d = dmgAt(left);
      out.push(`${i + 1}발 ${Math.round(left / eff * 100)}%→${(toHp ? toHp(d) : d).toLocaleString()}`);
      left -= d;
    }
    return ' · ' + out.join(' / ');
  }

  /** 구간을 **셈에 못 넣은** 무장에 붙이는 말. 숫자를 지어내지 않고 사실과 **어느 쪽으로
   *  틀리는지**를 적는다(파츠 쪽 UNMODELLED_FX 와 같은 원칙). 두 화면이 같이 쓴다. */
  const hpUnknownNote = why => ({ label: '※ 반영하지 않은 효과', value: '대상 HP 비례 추가 피해',
    note: why + ' — 실제로는 이 계산보다 더 아픕니다.' });

  /** 이 무장이 일으키는 반응 — '강경직' / '조건부 강경직' / '경직' / null.
   *  강경직 = 大よろけ / 強よろけ 유발 무장(위키 표기). 일반 경직은 よろけ.
   *  **피탄 시뮬과 대결 시뮬이 같이 쓴다** — 두 군데에 두면 한 화면만 옛 판정으로
   *  되돌아가도 아무도 안 운다(심어서 확인한 자리다). */
  function reactOf(w) {
    const note = (w && w.info && w.info['備考']) || '';
    const sTxt = String((w && w.mods && w.mods.stagger) || '') + ' ' + note;
    const s2 = stag2Of(sTxt);
    return s2 ? (s2.cond ? '조건부 강경직' : '강경직')
      : /よろけ有|ひるみ有|転倒|ダウン/.test(sTxt) ? '경직' : null;
  }

  /**
   * 「경직까지」 한 칸 — **히트 수**로 센다. 피탄 시뮬과 대결 시뮬이 같이 쓴다.
   * 「발」로 적으면 같은 화면의 두 '발'(격파 발수 / 경직 발수)이 서로 다른 뜻이 되어,
   * 산탄 무장 앞에서 실제보다 훨씬 버티는 것처럼 읽힌다. 그래서 히트로 적고,
   * 1발이 여러 히트인 무장만 뒤에 「→ 약 N발」을 덧붙인다.
   *   st   parseStagger(w)  {pct, pellets}
   *   mods activeStaggerMods(...)  {threshold, mults}
   */
  function staggerBox(st, mods) {
    const per = st.pct > 0 ? staggerPerHit(st.pct, mods.mults) : 0;
    const n = per > 0 ? Math.ceil(mods.threshold / per) : null;
    // 감소 스킬을 감소 큰 순으로 하나씩 곱하며 매번 내림한 과정 표기 (6% ×0.8 ×0.5 내림)
    const stepTxt = mods.mults.length ? ` (${st.pct}%${mods.mults.map(m => ' ×' + m).join('')} 내림)` : '';
    // n==null 은 "정보 없음"이 아니라 경직이 안 되는 경우다 — 누적치 0% 이거나 스킬 감소로 0.
    const value = n != null ? n + '히트' : (st.pct > 0 ? '경직 안 됨' : '—');
    const note = n != null
      ? `임계 ${mods.threshold}% ÷ 히트당 ${per}%${stepTxt}`
        + (st.pellets > 1 ? ` · 1발=${st.pellets}히트 → 약 ${Math.ceil(n / st.pellets)}발` : '')
      : (st.pct > 0 ? `누적치 ${st.pct}%${stepTxt} → 0 — 이 무장으론 경직 안 됨` : '누적치 0% (경직값 없음)');
    return { hits: n, perHit: per, value, note };
  }

  const pageIdOf = ms => (String(ms && ms.wiki_url || '').match(/pages\/(\d+)\.html/) || [])[1];

  /** 무장 레벨을 적 기체 LV 에 맞춘다 (그보다 높은 레벨은 안 쓰고, 없으면 가진 최저). */
  function weaponLvForMs(w, msLv) {
    const lvs = Object.keys(w.levels || {}).map(Number).sort((a, b) => a - b);
    if (!lvs.length) return null;
    const fit = lvs.filter(l => l <= msLv);
    return String(fit.length ? fit[fit.length - 1] : lvs[0]);
  }

  /** 적 기체가 그 LV 에서 실제로 쓰는 무장 목록 (위력·누적치를 그 레벨로). */
  /** 이 기체가 든 실드 — 그 LV 의 シールドHP + 실드 보강재·커넥팅 파츠. 실드가 없으면 null.
   *  실드 HP 자체는 무장 표에서 이미 쓰던 계산(D.weaponModsOf().shieldHp)을 그대로 쓴다. */
  function shieldOf(ms, msLv, equipped, expansion, expLevel) {
    const id = pageIdOf(ms), page = id && weaponData[id];
    if (!page) return null;
    const sh = (page.weapons || []).find(w => w.type === 'shield'
      && Object.values(w.levels || {}).some(d => d && d.raw && d.raw['シールドHP']));
    if (!sh) return null;
    const lvk = weaponLvForMs(sh, msLv);
    const d = lvk && sh.levels[lvk];
    const base = Number(d && d.raw && d.raw['シールドHP']) || 0;
    if (!base) return null;
    const bonus = shieldHpBonus(D.weaponModsOf(equipped || [], msLv, ms['属性']), equipped, expansion, expLevel);
    return { hp: base + bonus, base, bonus, name: T.weaponName(sh.name) };
  }

  /** 무장 하나가 실드에 주는 1히트 피해. 보정이 없거나 「？倍」면 null(계산 안 함).
   *  pct 는 공격하는 쪽 파츠의 「실드에 주는 피해 +N%」(탄약 강화 키트 등). */
  function shieldHit(dmg, sm, charged, pct) {
    if (!sm || sm.unknown) return null;
    const mult = charged ? sm.ch : sm.nc;
    if (mult == null) return null;
    return Math.floor(dmg * mult * (1 + (pct || 0) / 100));
  }

  /* 무장 **자체**가 상대 내성을 깎는다 — 「対象の耐ビーム補正を30%減でダメージ計算」.
     전수로 35 무장(33 기체)이고, 여태 계산 어디에도 안 들어갔다(사용자 지적).

     뜻은 위키 해설이 못 박아 둔다 — GP02[BB] 「射撃出力リミッター解除」 항:
       「命中時に対象の耐ビーム補正を30%減算した状態(対象耐ビーム補正70%の状態)で
         ダメージ計算を行う」
     **보정값의 70%** 이지 −30 이 아니다. 그래서 빼지 않고 곱한다.

     스킬 쪽(롱 레인지 어댑터 등)과 달리 **조건이 없다.** 원문이 「…でダメージ計算」이라
     그 무장으로 때리면 늘 걸린다 — 체크로 둘 이유가 없다.
     깎는 내성은 언제나 **그 무장의 속성**이다(35건 전수 확인, 어긋나는 건 0). */
  const FOE_ARMOR_W_RE = /(?:対象|敵機?)の?耐(実弾|ビーム|格闘)補正を?\s*(\d+)\s*[%％]\s*減/;

  /* 적 **실드를 무시**하는 무장 — 「攻撃対象のシールドHP無視」「…シールド無視」
     「…シールド貫通効果有」 세 가지로 적힌다. 전수로 24종이고 여태 반영되지 않았다.
     실드로 막는 상대라도 이 무장은 실드를 깨지 않고 바로 기체를 때린다.

     조건이 붙는 것이 있다 — F91 의 「集束時、攻撃対象のシールド無視」는 **집속했을 때만**이다.
     조각 단위로 보고 그 모드일 때만 인정한다.
     (FA엔게이지 [C플랜]의 「展開部に当たったシールドHP無視を無効化」처럼 **막는** 쪽도
      하나 있는데, 전개형 부무장이라 실드 계산이 보는 무장이 아니다 — 넣지 않는다.) */
  /* 「対象の」 없이 「シールド貫通効果有」 만 적은 무장이 6종 있다(섬광탄 4 · 무시카 · X3 건 모드의
     「シールドHP無視」). 예전 정규식은 「対象」 을 요구해 그 여섯을 못 잡았다(2026-10-16 전수 감사). */
  const SHIELD_IGNORE_RE = /(?:(?:攻撃)?対象の?)?シールド(?:HP)?を?(?:無視|貫通効果有)/;

  /* 무장 원문의 「スキル発動中、…」 — 그 「스킬」 이름은 원문에 없다. 기체마다 다르지만
     (최대 출력(K)·(T) · 아뢰야식 · NT-D(B) · NT-D 공명 · M 드라이브 · 트랜잠) **늘 원문에
     「対応兵装の性能変化」 라고 적힌 스킬**이다 — 해당 8기 전수 확인(2026-10-16).
     예전엔 셋이 제각각이었다: 내성 감소·실드 무시는 조건을 안 보고 **늘** 걸었고,
     완충재 무시는 「어느 스킬인지 모른다」 며 **아예** 뺐다. */
  const WEAPON_SKILL_RE = /(?:対応|一部)兵装の性能変化|スキルに対応した兵装/;
  function weaponSkillNames(ms) {
    if (!ms) return [];
    const out = new Set();
    for (const mo of msSkillsData[baseName(ms.MS名)] || []) for (const k of mo.skills || []) {
      if (WEAPON_SKILL_RE.test((k.desc || '') + ' / ' + (k.eff || ''))) out.add(k.name);
    }
    return [...out];
  }
  /** 대결 한쪽에서 그 「무장 성능 변화」 스킬이 켜졌는가 — 칩으로 켰거나, 트랜잠처럼 모드 단추(〜発動中)로 켰거나. */
  function weaponSkillOn(side) {
    const names = weaponSkillNames(side && side.ms);
    if (!names.length) return false;
    if (names.some(n => side.buffs && side.buffs.has(n))) return true;
    const alt = side.form === 'transform' && altModeOf(side.ms);
    return !!(alt && /発動中/.test(alt.key));
  }
  /** 조각의 조건이 지금 맞는가 — 「集束時」 는 집속했을 때만, 「スキル発動中」 은 그 스킬이 켜졌을 때만. */
  const segCondOk = (seg, charged, skillOn) =>
    !(/(?:^|[^非])集束時/.test(seg) && !charged) && !(/スキル発動中/.test(seg) && !skillOn);

  /** 이 무장이 적 실드를 무시하는가. charged 는 지금 집속 위력으로 세는 중인지. */
  function weaponIgnoresShield(w, charged, skillOn) {
    const note = (w && w.info && w.info['備考']) || '';
    for (const seg of String(note).split(/\s*\/\s*/)) {
      if (!SHIELD_IGNORE_RE.test(seg)) continue;
      if (/無効化/.test(seg)) continue;              // 막는다는 말이지 무시한다는 말이 아니다
      if (!segCondOk(seg, charged, skillOn)) continue;
      return true;
    }
    return false;
  }

  /** 이 무장이 적 내성을 몇 % 깎는가 — {pct, on, cond}. 없으면 null.
      조건(집속 시 · 스킬 발동 중)이 안 맞으면 on:false 로 돌려 계산식 칸에 「안 넣은 까닭」 을 적게 한다. */
  function weaponFoeArmorCut(w, charged, skillOn) {
    const note = (w && w.info && w.info['備考']) || '';
    for (const seg of String(note).split(/\s*\/\s*/)) {
      const m = FOE_ARMOR_W_RE.exec(seg);
      if (!m) continue;
      const cond = /スキル発動中/.test(seg) ? 'skill' : /(?:^|[^非])集束時/.test(seg) ? 'charged' : 'always';
      return { pct: Number(m[2]), on: segCondOk(seg, charged, skillOn), cond };
    }
    return null;
  }

  let duelSeedFp = null;   // 대결 왼쪽에 마지막으로 앉힌 앱 구성의 지문
  setTimeout(() => {
    if (!window.GBO2Duel) return;
    /* 접기 표시는 duel.js 가 버튼을 단 **뒤**에 붙여야 한다.(위 MOBILE_FOLD 와 짝)
       setTimeout(0) 으로는 일렀다 — duel.js 는 DOMContentLoaded 에서 버튼을 달고,
       이 파일이 먼저 실려 내 리스너가 먼저 돈다. `load` 는 그 뒤라 확실하다.
       안 붙이면 폰 파츠 화면에서 상단바가 **두 줄(91px)** 이 된다(topbar_check 가 잡았다). */
    window.addEventListener('load', () => {
      const dBtn = document.getElementById('duelBtn');
      if (dBtn) dBtn.classList.add('in-more');
      fitTopbar();
    }, { once: true });
    window.GBO2Duel.use({
      /* 변형 · 변신 · 시스템 발동(트랜잠) — 그 기체에 통상 말고 다른 모드가 있는가, 이름은 무엇인가.
         무장이 어느 모드에서 쓰이는가(＜変身時＞使用可 등). 판정은 앱의 altModeOf · weaponModeOf 한 곳
         — 무장 표의 「모든 상태 / 통상 / 변신 시」 칩과 같은 답을 쓴다(사용자 지적 2026-10-15:
         「변형 스킬을 켰을 때의 공격 수치가 반영이 안 됨」). */
      altMode: ms => altModeOf(ms),
      weaponMode: w => weaponModeOf(w),
      /* 방아쇠 한 번에 맞는 히트 수 — 무장표의 「전탄」과 같은 자. {nc,ch} 각각 null|{n}. */
      hitsPerTrigger: (wp, charged) => {
        const m = fireMult(wp.w);
        const c = charged ? (m.ch || m.nc) : m.nc;
        return (c && c.n) || 1;
      },
      /* 피해 경감 스킬 — 스킬 하나에 경감이 여럿이면 칩도 여럿.
         `ko` 는 staggerSkillsOf 가 이미 번역해 준다(skTr 를 두 번 부르지 않는다).
         form 은 그 쪽이 고른 모드(side.form) — 통상 / 변형·변신·시스템 발동. (예전엔 'normal' 로 박혀 있었다) */
      defSkills: side => staggerSkillsOf(side.ms, msLevel(side.ms), side.form || 'normal')
        .flatMap(sk => (sk.cuts || []).map((c, i) => ({
          name: sk.name + (i ? '#' + i : ''), ko: sk.ko || sk.name,
          scope: c.scope, pct: c.pct, always: sk.cond === '상시',
          tag: '피해 −' + c.pct + '%' + (c.scope === 'all' ? ''
            : ' (' + ({ solid: '실탄', beam: '빔', melee: '격투', shoot: '사격' }[c.scope] || c.scope) + ')')
        }))),
      /* 관통·폭풍 경감 — renderPietanOutgoing 이 넘기던 모양 그대로 */
      extraCuts: (A, B, wp) => conditionalPartCuts(B.parts,
        { name: wp.w.name, attr: wp.attr, type: wp.w.type, psycommu: !!wp.w.psycommu, note: wp.note }),
      /* 공중 격투 제어 — 판정은 **이 한 곳**(airMeleeOf)만 쓴다. 무장 상세의
         「공중 하격」 줄과 대결의 🛩 단추가 같은 답을 보게 한다.
         수치를 낼 수 없는 쪽(방향 배율이 위키에 없는 7기)은 null 을 돌려 단추가 안 나온다. */
      airMelee: (side, wp) => {
        if (!wp || !wp.melee || !airMeleeWeapon(wp.w)) return null;
        const a = airMeleeOf(side.ms, msLevel(side.ms), side.form || 'normal');
        const dir = airDirOf(wp.w, a);
        if (!a || !dir) return null;
        const has = (wp.variants || []).some(v => (v.direction || []).some(d => d.label === dir));
        if (!has) return null;
        return { pct: a.pct, dir, power: p => airPower(p, a.pct) };
      },
      /* 소이 등 고정 피해 — 보정도 경감도 안 받는 몫 */
      fixedDamage: (A, wp) => { const f = fixedDamageWithParts(wp.w, A.parts); return f ? f.total : 0; },
      /* 내구 지표 — 성능표와 **같은 함수**로 센다. durabilityOf 만 쓰면 파츠 피해 경감이
         빠져 같은 이름의 지표가 두 화면에서 갈린다(성능 24,572 · 여기 22,115 — 예전에
         피탄 시뮬이 그래서 틀렸고, 옮기면서 내가 같은 것을 다시 냈다. consistency_check 가 잡았다).
         방어 스킬은 그 쪽이 켠 것(side.defs)을 그대로 본다 — 화면의 체크와 같은 자. */
      /* st 는 대결이 센 그 쪽 스탯(스킬 버프까지 반영) — 스탯을 두 번 세지 않는다. */
      durability: (side, st) => DURA_ATTRS.map(([attr, , lb]) => {
        const cuts = damageCutsOf(side.parts, { lv: msLevel(side.ms), skillMs: side.ms, skills: side.defs, form: side.form || 'normal' });
        return { attr, ko: lb, value: enduranceOf(st, attr, cuts), cut: cutPctOf(cuts, attr) };
      }),
      /* 대결에서 「실드로 막음」을 켜면 무장 표의 🛡 보정 칩도 같이 켠다.
         스위치가 그 화면으로 옮겨졌으니 켜짐도 그쪽에서 받는다. */
      onShield: on => { showShieldMult = !!on; renderWeapons(); },
      /* 🛡 그 쪽이 든 실드와 HP. shieldOf 는 피탄 시뮬이 쓰던 그 함수다. */
      shield: side => shieldOf(side.ms, msLevel(side.ms), side.parts, side.exp, side.expLv),
      /* 무장 하나가 실드에 주는 한 히트 피해. 「실드 무시」는 발수를 세는 뜻이 없어 why 로 답한다.
         같은 이름 무장이라도 기체마다 표기가 있고 없고가 갈린다 — 남의 값을 빌려오지 않는다. */
      shieldHit: (wp, dmg, charged, atkParts, atk) => {
        if (weaponIgnoresShield(wp.w, charged, weaponSkillOn(atk))) return { hit: null, why: '실드 무시' };
        const sm = D.shieldMultOf(wp.w);
        const h = shieldHit(dmg, sm, charged, D.shieldDmgPctOf(atkParts || [], wp.attr));
        if (h == null) return { hit: null, why: sm && sm.unknown ? '보정 불명' : '표기 없음' };
        return { hit: h };
      },
      /* 경직까지 몇 발 — 누적치 임계 ÷ 히트당 누적치.
         감소 스킬은 감소가 큰 것부터 하나씩 곱하고 매번 내림한다(staggerPerHit).
         맞는 쪽이 켠 방어 스킬(side.defs)을 그대로 쓴다 — 화면의 체크와 같은 자. */
      /** 구간 무장의 발마다 피해 내역 — 발수의 근거다. 문구는 앱이 정한다. */
      bandWhy: info => hpBandWhy(info),
      /** 구간을 셈에 못 넣었을 때 붙이는 말 — 두 화면이 같은 문장을 쓴다. */
      bandUnknown: why => hpUnknownNote(why),
      /* 적 내성을 깎는 몫 — **무장과 스킬 둘 다**. 여럿이면 곱한다(빼지 않는다).
         대결은 여태 무장 것만 셌다 — 스킬이 깎는 몫(롱 레인지 어댑터·명경지수 등)이
         통째로 빠져 있었고 damage_path_check 가 잡았다. 판정·식은 앱 한 곳만 쓴다. */
      /** 「무장 성능 변화」 스킬이 켜졌는가 — 무장 원문의 「スキル発動中」 조건(완충재 무시 등). */
      weaponSkillOn: side => weaponSkillOn(side),
      /** 위키 미수록이면 빈칸 안내 문구 · 아니면 null */
      wikiPending: ms => (wikiPending(ms) ? WIKI_PENDING_TXT : null),
      /** 「4분 경과」 체크 — 한 판의 시간이라 대결 양쪽에 같이 건다 */
      lateMode: () => !!state.lateMode,
      /** 상대 내성만 깎는 스킬(명경지수 · 롱 레인지 어댑터 …) — 스탯 축이 없어 칩 목록에서 빠졌다.
          어느 무장에 걸리는지 원문으로 정해지는 것만 돌려준다(태클·카운터 전용은 안 준다). */
      foeArmorSkills: side => {
        if (!side.ms) return [];
        const out = [], seen = new Set();
        for (const mo of skillModesFor(msSkillsData[baseName(side.ms.MS名)] || [], side.form || 'normal')) {
          for (const k of mo.skills || []) {
            if (seen.has(k.name)) continue;
            seen.add(k.name);
            const f = foeArmorOf(k.name, side.ms, side.form || 'normal');
            if (f && f.scope) out.push({ name: k.name, ko: skTr(k.name),
              tag: f.list.map(x => '적 내' + ({ solid: '실탄', beam: '빔', melee: '격투' })[x.ax] + ' −' + x.pct + '%').join(' · ') });
          }
        }
        return out;
      },
      foeArmorCut: (side, wp, charged) => {
        const wf = weaponFoeArmorCut(wp.w, charged, weaponSkillOn(side));
        const wCut = wf && wf.on ? wf.pct : 0;
        const sCut = foeArmorCutOf([...side.buffs], wp.attr, side.ms, side.form || 'normal');
        const keep = (1 - wCut / 100) * (1 - sCut / 100);
        return { wCut, sCut, cut: Math.round((1 - keep) * 1000) / 10, keep, wf };
      },
      /** 무장이 일으키는 반응 — 두 화면이 같은 말을 하게 앱이 정한다. */
      react: wp => reactOf(wp.w),
      stagger: (side, wp) => {
        const st = parseStagger(wp.w);
        const mods = activeStaggerMods(side.ms, msLevel(side.ms), side.defs, side.form || 'normal');
        return staggerBox(st, mods);
      },
      /* 「이 무장 N발 버티기 → 자동 구성 목표로」.
         목표 칸·자동 구성·토스트가 전부 앱 안쪽이라 **줄 자체**를 앱이 만든다.
         피탄 시뮬이 쓰던 goalRowFor 를 그대로 부른다 — 자가 하나다. */
      goalRow: info => goalRowFor({
        /* 무장을 **통째로** 넘긴다. goalWeapon 은 자동 구성이 조건부 파츠 경감
           (관통·폭풍)을 다시 재는 데 쓰는데, 그 판정이 note·psycommu·type 을 본다.
           이름과 속성만 넘기면 자동 구성이 그 경감을 못 세어, 사용자가 본 실효 HP 와
           목표가 갈린다 — 실제로 34,315 vs 42,894 로 어긋났고 goalcond_check 가 잡았다. */
        w: { name: info.name, attr: info.attr, note: info.note,
          psycommu: info.psycommu, type: info.type, mods: info.mods },
        dmg: info.per, hits: info.hits, needOf: info.needOf,
        toHp: info.toHp, bands: info.bands, after: info.close
      }),
      /* 왼쪽 = 지금 편집 중인 구성. setMs 가 파츠를 비우므로 **그 뒤에** 넣는다(순서 주의).
         `left.ms 가 있으면 끝` 으로 두면 **처음 열 때 한 번만** 가져온다 — 대결을 먼저 열어
         본 다음 파츠를 끼우고 다시 열면 왼쪽이 옛 구성 그대로였다(파츠 4개를 끼웠는데
         대결은 3개로 셌다). 그래서 앱 구성의 지문을 적어 두고, **달라졌을 때만** 다시
         앉힌다 — 같으면 대결 안에서 내가 손본 왼쪽을 덮지 않는다.
         force 는 「⟳ 지금 편집 중인 구성 가져오기」 단추가 보내는 것으로, 지문을 무시한다. */
      seed: (left, setMs, force) => {
        if (!state.ms) return;
        const fp = [state.ms.MS名, state.stage, state.expansion, state.expLevel, state.form,
          state.equipped.map(p => p.name).join(',')].join('|');
        if (left.ms && !force && fp === duelSeedFp) return;
        duelSeedFp = fp;
        left.stage = state.stage;
        setMs(left, state.ms);
        left.parts = [...state.equipped];
        left.exp = state.expansion;
        left.expLv = state.expLevel;
        /* 앱에서 변신 화면을 보며 짠 구성이면 변신 모드로 가져온다 — 「지금 편집 중인 구성」 그대로.
           모드를 바꾸면 쓸 수 있는 무장이 달라지므로 첫 무장을 다시 고른다(setMs 와 같은 규칙). */
        const f = (state.form === 'transform' && altModeOf(state.ms)) ? 'transform' : 'normal';
        if (left.form !== f) {
          left.form = f;
          const ws = window.GBO2Duel.weaponsOf ? window.GBO2Duel.weaponsOf(left) : [];
          if (ws.length && !ws.some(x => x.key === left.wKey)) {
            left.wKey = ws[0].key; const m = ws[0].modes.find(x => x.ok); left.mode = m ? m.k : 'nc';
          }
        }
      }
    });
  }, 0);

