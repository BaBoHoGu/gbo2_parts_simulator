  /* ui/17-videos.js — 추천 영상.
     tools/lib/uisrc.js 가 번호 순으로 이어 붙여 한 IIFE 로 감싼다(파일끼리 변수를 나눠 쓴다). */
  /* ===================== 추천 영상 =====================
     유튜브에서 이 기체 영상을 받아 보여 준다. 서버(/api/videos)가 받아 걸러 둔 것을
     그대로 그린다 — 키도, 거르는 자도 서버에 있다(functions/lib/videos.js).

     절을 **기본으로 숨겨 둔다.** 이 앱은 file:// 로도 열리고 인터넷이 없을 수도 있다.
     그때 「불러오지 못했습니다」가 남아 있으면 앱이 고장 난 것처럼 보인다 —
     영상은 곁다리라 조용히 사라지는 쪽이 맞다.

     영상이 0개인 기체도 있다. 그때 **본체 영상으로 채우지 않는다**(사용자 결정 A):
     육전형 건담은 최근 영상이 전부 ［WR装備］ 판인데, 거기에 WR 영상을 띄우면
     사용자는 그것을 본체 영상으로 믿는다. 틀린 것보다 빈 것이 낫다. */

  /** 「93134」 → 「9.3만회」. 유튜브와 같은 꼴로 읽히게. */
  function viewsText(n) {
    const v = Number(n) || 0;
    if (v >= 100000000) return (v / 100000000).toFixed(1).replace(/\.0$/, '') + '억회';
    if (v >= 10000) return (v / 10000).toFixed(1).replace(/\.0$/, '') + '만회';
    return v.toLocaleString() + '회';
  }

  function renderInfoVideos() {
    const panel = $('#infoVidPanel'), box = $('#infoVids'), cnt = $('#infoVidCnt');
    if (!panel || !box || !infoMs) return;
    const want = baseName(infoMs.MS名);
    if (!S || !S.videos) { panel.hidden = true; return; }

    S.videos(want).then(res => {
      // 그 사이 다른 기체로 넘어갔으면 그리지 않는다 — 늦게 온 답이 새 화면을 덮는다
      if (!infoMs || baseName(infoMs.MS名) !== want) return;
      const list = (res && res.videos) || [];
      /* 못 받았거나·꺼져 있거나·서버가 유튜브에 거절당했으면 절째로 숨긴다.
         err 를 여기서 같이 숨기는 이유: 그때 빈 목록이 오는데, 그대로 그리면
         「최근 2년 영상이 없습니다」가 뜬다 — **고장을 사실로 적어 버린다.**
         실제로 키가 틀렸을 때 그렇게 보였다. 모르면 아무 말도 안 하는 게 맞다. */
      if (!res || !res.ok || res.off || res.err) { panel.hidden = true; return; }
      panel.hidden = false;
      box.innerHTML = '';
      // 개수는 **목록에서 뽑는다** — 손으로 적으면 거른 뒤의 수와 어긋난다
      cnt.textContent = list.length ? list.length + '개' : '';
      if (!list.length) {
        box.append(el('div', 'detail-empty', res.busy
          ? '오늘 받아 올 수 있는 만큼을 다 썼습니다 — 내일 다시 보입니다'
          : '최근 2년 영상이 없습니다'));
        return;
      }
      for (const v of list) {
        const a = el('a', 'mi-v');
        a.href = 'https://www.youtube.com/watch?v=' + encodeURIComponent(v.id);
        a.target = '_blank'; a.rel = 'noopener';
        const th = el('div', 'mi-v-th');
        const img = el('img'); img.src = 'https://i.ytimg.com/vi/' + encodeURIComponent(v.id) + '/mqdefault.jpg';
        img.alt = ''; img.loading = 'lazy';
        th.append(img);
        if (v.len) th.append(el('span', 'mi-v-len', v.len));
        const body = el('div', 'mi-v-body');
        body.append(el('div', 'mi-v-title', v.title || ''));
        const meta = el('div', 'mi-v-meta');
        meta.append(el('span', 'mi-v-ch', v.ch || ''));
        meta.append(el('span', 'mi-v-dot', '·'), el('span', null, viewsText(v.views)));
        // 올린 날짜는 서버가 ISO 로 준다 — 앱의 relTime 으로 적는다(한 자로 맞춘다)
        const at = v.at ? Date.parse(v.at) : NaN;
        if (!isNaN(at)) meta.append(el('span', 'mi-v-dot', '·'), el('span', null, relTime(at)));
        body.append(meta);
        a.append(th, body);
        box.append(a);
      }
    }).catch(() => { panel.hidden = true; });
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
    // 고를 수 있는 LV 범위가 기체 LV 에 달려 있다. 안 지우면 LV 를 내렸을 때 고른 값이
    // 범위 밖으로 남아, 동작은 「기체와 같음」인데 칸에는 아무것도 안 켜진 채가 된다.
    state.weaponLv = null;
    state.thrusterOn.clear();   // LV 이 바뀌면 스킬 구성도 바뀐다
    clearAutoResults();
    // LV 이 바뀌면 HP·내성이 통째로 달라져 목표 절댓값도 뜻을 잃는다
    const cleared = clearTargets();
    resetEnhance();             // 레벨이 바뀌면 슬롯도 바뀌므로 확장 스킬도 초기화한다
    renderAll();
    // 실제로 지운 것만 말한다 — 파츠가 없었는데 「장착 파츠를 초기화했습니다」 라고 하면 거짓말이다
    const wiped = [had && '장착 파츠', cleared && '자동 구성 목표'].filter(Boolean);
    if (wiped.length) toast('레벨을 변경해 ' + wiped.join('·') + '를 초기화했습니다');
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
    const alt = altModeOf(state.ms);
    if (!alt) {
      seg.hidden = true;
      state.form = 'normal';        // 모드 없는 기체로 옮겨가면 통상으로 되돌린다
      return;
    }
    seg.hidden = false;
    for (const [v, label] of [['normal', '통상'], ['transform', alt.label]]) {
      const b = el('button', 'seg-btn' + (state.form === v ? ' on' : ''), label);
      b.onclick = () => {
        state.form = v;
        [...seg.children].forEach(c => c.classList.remove('on'));
        b.classList.add('on');
        renderStats();
        renderWeapons();            // 사격·격투 보정이 바뀌면 무장 위력도 달라진다
        // 스킬 패널이 열려 있으면 같은 모드로 따라가게 한다(성능만 변신, 패널은 통상이 되던 문제)
        if (!document.getElementById('mskillInline').hidden) renderMskill();
      };
      seg.append(b);
    }
  }

  const skillDur = s => (s.forever ? '무제한' : s.secs ? s.secs + '초' : '시간 제한');

  /** 스킬 한 줄에 붙일 요약 — 「사격 +10 · 격투 +35 · 무제한 · HP 50% 이하」 */
  /* 스킬이 깎는 것이 **상대 기체의 내성**인 경우 — 「対象の耐実弾補正を 15%減 でダメージ計算」.
     내 스탯이 아니라 맞는 쪽 값을 건드리는 줄이라 스킬 표(skills.json)의 어느 축에도 안 담겼고,
     그래서 롱 레인지 어댑터는 칸에 「선회 +20」만 떴다 — 본체인 내실탄·내빔 15%減 둘이
     통째로 없는 것처럼 보였다(사용자 지적).
     수치로 반영하지 **못하는** 이유는 따로 있다: 이 앱의 피해 계산에는 상대가 없다
     (damage.js 머리말 — Def = 1, ETCb = 0 고정). 깎을 대상이 없으니 피해는 달라지지 않는다.
     없는 상대를 지어내 반영하느니, 그 효과가 있다는 것과 왜 수치에 안 들어가는지를 적는다.
     읽는 곳은 원문(ms_skills.json)이다 — skills.json 은 생성물이라 축이 없으면 담기지 않는다. */
  const FOE_ARMOR_KO = { '実弾': '내실탄', 'ビーム': '내빔', '格闘': '내격투' };
  const FOE_ARMOR_RE = /(?:対象|敵機?)の?耐(実弾|ビーム|格闘)補正を\s*(\d+)\s*[%％]\s*減/g;

  const FOE_ARMOR_AX = { '実弾': 'solid', 'ビーム': 'beam', '格闘': 'melee' };

  /* **어느 무장에 걸리는가** — 이것을 못 정하면 넣으면 안 된다.
     같은 「対象の耐格闘補正を N%減」이라도 걸리는 범위가 완전히 다르다:
       「格闘属性兵装による攻撃時」「格闘攻撃時」 → 격투 속성 무장 전부      (넣을 수 있다)
       「スナイプモード時」                      → 사격 속성 무장 전부      (넣을 수 있다)
       「ヘビーアタック時」「タックル」「カウンター」 → **무장 목록에 없는 동작** (넣으면 안 된다)
     마지막 것을 격투 무장 전부에 걸면 바이오센서(PΖΖ)의 70% 가 사벨에 붙어
     피해가 통째로 거짓이 된다. 못 정하는 것은 예전처럼 「적어만 두기」로 남긴다. */
  /* 범위는 **원문이 그렇게 적었을 때만** 인정한다(화이트리스트).
     「格闘」이 들어갔다고 격투 무장 전부로 읽으면 안 된다 — 「耐格闘補正」 자체에도 들어 있어
     블레이드 태클(태클 전용)·고성능 카운터(카운터 전용)가 격투 무장 전부로 잡혔다(실측).
     그 둘에 30%·50% 가 사벨에 붙으면 피해가 통째로 거짓이 된다. */
  const FOE_SCOPE_MARK = [
    [/ヘビーアタック|タックル|カウンター/, 'action'],                 // 무장 목록에 없는 동작
    [/スナイプモード/, ['solid', 'beam']],
    [/格闘属性兵装による攻撃時|格闘攻撃時|格闘兵装による攻撃|格闘兵装を当て/, ['melee']]
  ];
  const foeArmorScopeOf = seg => {
    for (const [re, v] of FOE_SCOPE_MARK) if (re.test(seg)) return v;
    return null;
  };

  /** 그 스킬이 깎는 적 내성. {list:[{ax,pct}], scope:[속성]|null, txt} · 없으면 null. */
  function foeArmorOf(name, ms, form) {
    const on = ms || state.ms;
    if (!on) return null;
    const modes = skillModesFor(msSkillsData[baseName(on.MS名)] || [], form || state.form);
    const cands = [];
    for (const mo of modes) for (const k of (mo.skills || [])) if (k.name === name) cands.push(k);
    const sk = pickByMsLv(cands, msLevel(on));
    if (!sk) return null;
    const blob = ((sk.desc || '') + ' / ' + (sk.eff || '')).replace(/\s+/g, ' ');
    const hit = new Map();
    let scope = null, decided = false;
    /* 불릿은 **앞 머리줄의 범위를 물려받는다** — 롱 레인지 어댑터가 그 꼴이다:
         「スナイプモード時、以下の効果を発動」   ← 머리줄이 범위를 정하고
         「・対象の耐実弾補正を 15%減」           ← 불릿에는 범위 표시가 없다
       스러스터 파서에서 이미 겪은 글투다. 불릿 자신이 범위를 적었으면 그쪽이 이긴다. */
    let carried = null;
    for (const part of blob.split(/\s*\/\s*/)) {
      const bullet = /^[・･]/.test(part);
      const own = foeArmorScopeOf(part);
      if (!bullet) carried = own;                  // 머리줄이 범위를 새로 정한다
      const found = [...part.matchAll(FOE_ARMOR_RE)];
      if (!found.length) continue;
      for (const m of found) hit.set(m[1], Number(m[2]));
      if (decided) continue;
      decided = true;
      const v = own || carried;
      scope = (v && v !== 'action') ? v : null;    // 못 정했거나 동작 한정이면 안 넣는다
    }
    if (!hit.size) return null;
    /* 수치 줄에도 머리줄에도 범위가 없으면 **같은 스킬의 다른 문장**에서 찾는다 — 추격 격투 보조
       프로그램은 수치가 「対象の耐格闘補正を 10%減」 한 줄뿐이고 범위는 설명문(「格闘兵装を当てると」)에
       있다. 다만 동작 한정(태클·카운터·헤비 어택)이 한 군데라도 있거나 범위가 둘로 갈리면 넣지 않는다. */
    if (!scope) {
      const marks = blob.split(/\s*\/\s*/).map(foeArmorScopeOf).filter(Boolean);
      const kinds = new Set(marks.map(v => (v === 'action' ? 'action' : v.join(','))));
      if (kinds.size === 1 && !kinds.has('action')) scope = marks[0];
    }
    const vals = [...new Set(hit.values())];
    const ko = [...hit.keys()].map(k => FOE_ARMOR_KO[k]);
    const txt = vals.length === 1
      ? ko.join('·') + ' −' + vals[0] + '%'
      : [...hit].map(([k, v]) => FOE_ARMOR_KO[k] + ' −' + v + '%').join(' · ');
    return {
      list: [...hit].map(([k, v]) => ({ ax: FOE_ARMOR_AX[k], pct: v })),
      scope,
      txt: '적 ' + txt + (scope
        ? ' — 스킬을 발동하면 대결의 격파 발수에 반영됩니다'
        : ' — 어느 무장에 걸리는지 원문으로 못 정해 수치에는 안 들어갑니다')
    };
  }

  /** 발동시킨 스킬들이 이 무장 속성의 적 내성을 몇 % 깎는가. 없으면 0. */
  /** 켠 스킬들이 **적 내성을 몇 % 깎는가.** 여럿이면 곱한다(빼지 않는다 —
   *  「N%減」은 보정값의 (100−N)% 상태라는 뜻이다).
   *  이름 목록·기체·모드를 받아 **대결 시뮬도 같은 함수를 쓴다** — 두 벌로 두면 갈린다. */
  function foeArmorCutOf(names, attr, ms, form) {
    let keep = 1;                     // 남는 비율 — 여럿이면 곱한다
    for (const n of names || []) {
      const f = foeArmorOf(n, ms, form);
      if (!f || !f.scope || !f.scope.includes(attr)) continue;
      for (const x of f.list) if (x.ax === attr) keep *= 1 - x.pct / 100;
    }
    return Math.round((1 - keep) * 1000) / 10;
  }
  const skillFoeArmorCut = attr => foeArmorCutOf(activeSkills().map(s => s.name), attr);

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
    const sg = n => (n > 0 ? '+' : '') + n;   // 음수(HADES 내성-5 등)는 부호 그대로
    if (e.armorRange && e.armorRange === e.armorBeam && e.armorBeam === e.armorMelee) num.push('내성 ' + sg(e.armorRange));
    else {
      if (e.armorRange) num.push('내실탄 ' + sg(e.armorRange));
      if (e.armorBeam) num.push('내빔 ' + sg(e.armorBeam));
      if (e.armorMelee) num.push('내격투 ' + sg(e.armorMelee));
    }
    if (e.speed) num.push('스피드 ' + sg(e.speed));
    if (e.hispeed) num.push('고속이동 ' + sg(e.hispeed));
    if (e.thruster) num.push('슬러스터 ' + sg(e.thruster));
    if (e.turn) num.push('선회 ' + sg(e.turn));
    if (e.hpUp) num.push('HP ' + sg(e.hpUp));
    const how = [skillDur(sk), sk.hp ? 'HP ' + sk.hp + '% 이하' : null, sk.manual ? '수동' : null]
      .filter(Boolean).join(' · ');
    const f = foeArmorOf(sk.name);
    return { num: num.join(' · ') || '—', how, foe: f && f.txt };
  }

  // 보정값은 damage.js 의 ETC_ATTACK 에서 그대로 가져온다 — 손으로 적어 두었더니
  // 실제 계산(+5%/+10%)과 라벨(+10%/+15%)이 갈려, 화면이 앱 자신과 다른 숫자를 말했다.
  const etcPct = v => '+' + Math.round(v * 100) + '%';
  const POSTURES = [['stand', '선 자세', '보정 없음'],
                    ['crouch', '앉기·정지', '사격 피해 ' + etcPct(D.ETC_ATTACK.crouch) + ' · 이동 불가'],
                    ['prone', '엎드리기', '사격 피해 ' + etcPct(D.ETC_ATTACK.prone) + ' · 이동 불가']];
  const SCOPE_TXT = '사격 피해 ' + etcPct(D.ETC_ATTACK.scope);

  /** 「자세 ▾」 버튼 라벨 — 기본(선 자세·스코프 꺼짐)이 아니면 켜진 색으로 보여 준다. */
  function updatePostureButton() {
    const cur = POSTURES.find(x => x[0] === state.posture) || POSTURES[0];
    const on = state.posture !== 'stand' || state.scope;
    $('#postureBtnText').textContent = cur[1] + (state.scope ? ' · 스코프' : '');
    $('#postureBox').classList.toggle('on', on);
    $('#postureBtn').title = cur[1] + ' — ' + cur[2] + (state.scope ? '\n스코프 조준 — ' + SCOPE_TXT : '');
  }

  /** 안전 영역(상태바·노치) 높이 — body 패딩으로 들어가 있다. fixed 메뉴를 그 아래로 밀 때 쓴다. */
  const safeTop = () => parseFloat(getComputedStyle(document.body).paddingTop) || 0;

  /** 자세(라디오) + 스코프(체크) 드롭다운. 성능의 스킬 메뉴와 같은 모양·조작.
   *  무장 머리(.w-tools)가 overflow:auto 라 안쪽에 두면 잘린다 — body 로 띄운다. */
  function openPostureMenu(btn) {
    document.querySelectorAll('.posture-menu').forEach(m => m.remove());
    const menu = el('div', 'skill-menu posture-menu');
    const mk = (type, name, checked, k, v, onChange) => {
      const item = el('label', 'skill-item');
      const inp = el('input');
      inp.type = type;
      if (name) inp.name = name;
      inp.checked = checked;
      inp.onchange = () => onChange(inp);
      item.append(inp);
      const tx = el('div');
      tx.append(el('span', 'k', k));
      tx.append(el('span', 'v', v));
      item.append(tx);
      return item;
    };
    for (const [val, label, desc] of POSTURES) {
      menu.append(mk('radio', 'posture', state.posture === val, label, desc, () => {
        state.posture = val;
        updatePostureButton();
        renderWeapons();            // 자세 보정은 무장 피해에만 영향
      }));
    }
    menu.append(el('div', 'skill-sep'));
    menu.append(mk('checkbox', null, state.scope, '스코프', SCOPE_TXT + ' (자세와 겹쳐 적용)', inp => {
      state.scope = inp.checked;
      updatePostureButton();
      renderWeapons();
    }));

    document.body.append(menu);
    const rc = btn.getBoundingClientRect();
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    menu.style.left = Math.max(6, Math.min(rc.left, window.innerWidth - mw - 8)) + 'px';
    const below = rc.bottom + 4;
    menu.style.top = (below + mh <= window.innerHeight - 8
      ? below                                             // 아래로 펼치는 게 기본
      : Math.max(safeTop() + 6, rc.top - mh - 4)) + 'px';  // 안 들어가면 위로
    menu.onclick = ev => ev.stopPropagation();
    setTimeout(() => document.addEventListener('click', function h(e) {
      if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', h); }
    }), 0);
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
      if (s.foe) tx.append(el('span', 'foe', s.foe));
      item.append(tx);
      menu.append(item);
    }
    updateSkillButton();
  }

  /** 때가 되면 바뀌는 파츠가 달려 있는가 — 그때만 「4분 경과」 칸을 보인다.
   *  안 달렸는데 보이면 아무 일도 안 하는 죽은 손잡이가 된다. */
  function renderLateBox() {
    const box = $('#lateBox'), chk = $('#lateChk'), lb = $('#lateLb');
    if (!box || !chk) return;
    const has = state.equipped.filter(p => C.MODE_PARTS && C.MODE_PARTS[p.name]);
    box.hidden = !has.length;
    // 파츠를 빼면 켜 둔 것도 되돌린다 — 안 그러면 안 보이는 체크가 수치를 바꾼다
    if (!has.length) { if (state.lateMode) { state.lateMode = false; chk.checked = false; } return; }
    chk.checked = !!state.lateMode;
    // 칸 이름은 파츠가 적어 둔 말을 그대로 쓴다 (새 파츠가 생겨도 여기를 안 고치게)
    if (lb) lb.textContent = C.MODE_PARTS[has[0].name].label;
    box.title = has.map(p => T.partName(p.name)).join(' · ')
      + ' — 켜면 그 시점의 효과로 바뀝니다(앞의 효과는 사라집니다)';
  }

  function renderAll() {
    renderHero();
    renderFormSeg();
    renderSkillControls();
    renderLateBox();
    renderLevelSwitch();
    // 기체 목록은 ① 선택 화면에서만 갱신 (파츠 장착 때마다 1,671기를 재정렬·재생성하지 않도록)
    if (state.view !== 'build') renderMsList();
    renderSlots();
    renderEquipped();
    renderStats();
    renderPartList();
    renderBannedCount();
    renderIncompleteNotice();
    renderDetail(state.detailPart);
    renderWeapons();
    if (!document.getElementById('mskillInline').hidden) renderMskill();
  }

  /** 무장·스킬 데이터가 아직 없는 기체(예: gbo2.jp 선패치·위키 미반영)면 상단에 붉은 경고를 띄운다. */
  function renderIncompleteNotice() {
    const box = $('#incompleteNotice');
    if (!box) return;
    if (!state.ms) { box.hidden = true; return; }
    const noWeapons = msWeapons().length === 0;
    const noSkills = !((msSkillsData[baseName(state.ms.MS名)] || []).some(m => (m.skills || []).length));
    if (noWeapons || noSkills) {
      const miss = [noWeapons && '무장', noSkills && '스킬'].filter(Boolean).join('·');
      box.textContent = `⚠ 이 기체는 ${miss} 정보가 아직 없습니다 — 추후 업데이트에서 반영될 예정입니다.`;
      box.hidden = false;
    } else {
      box.hidden = true;
    }
  }

