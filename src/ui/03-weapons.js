  /* ui/03-weapons.js — 무장 표 · 슬러스터 · DPS · 무장 상태(모드) · 공중 격투 제어.
     tools/lib/uisrc.js 가 번호 순으로 이어 붙여 한 IIFE 로 감싼다(파일끼리 변수를 나눠 쓴다). */
  /* ---------- 무장 ---------- */

  /** 표에서 그대로 가져온 표기를 한글로 바꾼다. (「即2発 フル1+即1」 같은 값까지) */
  const JA_UNIT = [
    ['発/分', '발/분'], ['フル', '풀'], ['ノン', '논'], ['即', '즉'],
    ['連続', '연속'], ['連', '연'], ['消費', '소비'], ['単発', '단발'],
    // 누적치 칸에 그대로 남아 있던 단위들 — 전수로 찾아 채웠다(腕 3 · 基 2 · 門 1 · 丁 1)
    ['下記参照', '아래 참조'], ['合計', '합계'],
    ['秒', '초'], ['発', '발'], ['射', '발'], ['分', '분'], ['時', '시'], ['回', '회'],
    ['腕', '팔'], ['基', '기'], ['門', '문'], ['丁', '정']
  ];
  /** 누적치 칸 전용 — 「x2発 x3射」의 射 는 **발사 횟수**다.
   *  글자 사전은 射 를 発 과 똑같이 「발」로 옮겨 「x2발 x3발」이 됐다 — 두 수가 뭐가 다른지
   *  알 수 없었다(사용자 지적). 여기서만 「사격」으로 갈라 준다.
   *  탄/히트 칸의 「2射OH」·「2連射OH」는 OH 까지의 **발수**라 「발」이 맞으므로 건드리지 않는다. */
  const staggerKo = s => jaUnits(String(s).replace(/([x×]\s*\d+)\s*射/g, '$1사격'));

  // 전각 괄호·중점은 그대로 두면 표에서 일본어처럼 보여 반각으로 맞춘다.
  const jaPunct = s => String(s)
    .replace(/（/g, '(').replace(/）/g, ')').replace(/・/g, '·').replace(/：/g, ':')
    .replace(/＋/g, '+').replace(/－/g, '-').replace(/％/g, '%').replace(/×/g, 'x');
  const jaUnits = s => jaPunct(JA_UNIT.reduce((t, [ja, ko]) => t.split(ja).join(ko), String(s)));

  /** 칩 안의 「/」에서 줄이 바뀌면 「180발/」+「분」, 「<통상시/」+「변형시>」가 된다.
   *  칩 전체를 nowrap 하면 50자짜리가 폰에서 넘치므로, 「/」 자리만 이음표로 묶는다.
   *  U+2060(word joiner)은 보이지 않고 폭도 없다. */
  const noKeepSlash = s => String(s).split('/').join('\u2060/\u2060');

  /** 자주 찾는 항목은 색으로 구분한다 — 목록이 길어 글자만으로는 안 보인다.
   *  문구가 조금씩 달라서(「집속 시 유닛 관통 효과 있음」·「집속시 유닛 관통 있음」)
   *  낱말 몇 개로 느슨하게 본다. 위에 있는 규칙이 이긴다. */
  const CHIP_RULES = [
    // 빨강 — 상대의 방어를 무시하거나 추가로 때리는 것. 가장 먼저 본다.
    ['wc-pierce', /완충재[^/]*무시|실드[^/]*무시|보정을[^/]*(?:감소|[0-9]+%)[^/]*계산|추가 대미지|고정 대미지|고정 피해|헤비 ?어택|다운/],
    // 초록 — 쏘는 동안 움직일 수 있거나 관통하는 것
    ['wc-move', /집속 중 이동|집속중 이동|유닛 관통|록온 후[^/]*이동 가능|이동 중 록온/],
    // 노랑·코랄 — 경직 단계
    ['wc-stag2', /강경직/],
    ['wc-stag', /경직/],
    // 파랑 — 사격 가능 여부
    ['wc-fire', /사격 가능/],
  ];
  // 「실드 HP 무시를 무효화」처럼 뒤집는 문구가 하나 있다 — 뜻이 정반대라 빨강을 빼야 한다.
  const CHIP_NEGATE = /(?:무시|대미지|다운)[^/]*(?:무효|막음|받지 않음)/;
  function noteChipCls(t) {
    for (const [cls, re] of CHIP_RULES) {
      if (!re.test(t)) continue;
      if (cls === 'wc-pierce' && CHIP_NEGATE.test(t)) continue;
      return ' ' + cls;
    }
    return '';
  }

  /** 표 열 이름에 공백 표기가 섞여 있어(OH復帰時間 / OH復帰 時間) 공백을 무시하고 찾는다. */
  function infoOf(info, ...names) {
    const flat = s => s.replace(/\s+/g, '');
    for (const n of names) {
      const key = Object.keys(info || {}).find(k => flat(k) === flat(n));
      const v = key && info[key];
      if (v && v !== '-') return v;
    }
    return null;
  }

  /**
   * 무장 항목 조회.
   * 추출 단계에서 레벨마다 값이 같으면 info(무장 공통), 다르면 levels[N].raw 로 나뉜다.
   * (예: 사거리가 레벨마다 늘어나는 무장은 raw 에 있다)
   * 어느 쪽에 있는지는 무장마다 다르므로 레벨값을 먼저 보고 없으면 공통값을 본다.
   */
  const wField = (lvl, info, ...names) =>
    infoOf(lvl && lvl.raw, ...names) || infoOf(info, ...names);

  /** 현재 기체의 무장 목록 (위키 페이지 ID 로 찾는다). */
  const weaponsOfMs = ms => {
    const id = ms && (String(ms.wiki_url || '').match(/pages\/(\d+)\.html/) || [])[1];
    const page = id && weaponData[id];
    return page ? page.weapons : [];
  };
  function msWeapons() { return state.ms ? weaponsOfMs(state.ms) : []; }

  /* 위키 미수록 — 무장도 스킬도 비어 있는 기체(2026-10-16). 갓 나온 기체는 위키에 페이지가 생기기 전이라
     무장 · 스킬 칸이 비는데, 빈칸만 보면 앱이 고장 난 것처럼 보인다(밴디트 LV1). 배포가 위키를 다시 찾아 채운다.
     위키 주소만으로 가리지 않는다 — 주소가 있어도 받기에 실패하면 똑같이 빈다. */
  const wikiPending = ms => !!ms && !weaponsOfMs(ms).length && !(msSkillsData[baseName(ms.MS名)] || []).length;
  const WIKI_PENDING_TXT = '위키에 아직 이 기체 페이지가 없어 무장 · 스킬이 비어 있습니다 — 위키에 올라오면 자동으로 채워집니다.';

  /**
   * 이 기체에서 「주무장」 자리를 지는 구분.
   *
   * 보통은 `主兵装` 이다. 그런데 **무장 선택형** 기체는 위키가 고를 수 있는 무장을 통째로
   * `その他` 아래 두어, 주무장이 하나도 없는 기체가 생긴다 — 겔구그G 가 그렇다(592 그룹 중
   * 이 하나뿐이고, `その他` 5건도 전부 이 기체 것이다). 그대로 두면 이 기체에서만 주무장 LV
   * 칸이 아무 일도 안 하고, 무장 구분도 「기타」로 뜬다.
   *
   * 데이터를 고쳐 `主兵装` 으로 바꾸지는 않는다 — 딸린 그레네이드까지 주무장이 되어
   * 원본에 없는 판정을 지어내는 셈이 된다. **주무장이 아예 없을 때만** 대신 세운다.
   */
  function mainSectionOf(ms) {
    const ws = ms ? weaponsOfMs(ms) : [];
    if (ws.some(w => w.section === '主兵装')) return '主兵装';
    if (ws.some(w => w.section === 'その他')) return 'その他';
    return null;
  }

  /** 고른 **주무장** LV — 고른 값이 있으면 그것, 없으면 기체 LV. */
  function wantWeaponLv() {
    const msLv = state.ms ? msLevel(state.ms) : 1;
    // 기체보다 높은 무장 LV 는 존재하지 않는다 — 기체를 바꿔 LV 가 내려가면 같이 내린다.
    return state.weaponLv != null ? Math.min(state.weaponLv, msLv) : msLv;
  }

  /**
   * 무장 레벨.
   *
   * **주무장만** 따로 고를 수 있다. 부무장(실드·기타 포함)은 늘 기체 LV 를 따라간다 —
   * 게임에서 따로 떼어 낮출 수 있는 것이 주무장뿐이고, 레벨링크 시스템 파츠가 보는
   * 것도 「機体と**主兵装**のLV」다.
   *
   * 고른 LV 보다 높은 무장 LV 는 쓰지 않고, 그보다 낮으면 가진 것 중 가장 높은 레벨을 쓴다.
   * (무장이 기체보다 적은 레벨만 가진 경우가 있다)
   */
  function weaponLevel(w) {
    const lvs = Object.keys(w.levels).map(Number).sort((a, b) => a - b);
    if (!lvs.length) return null;
    const msLv = state.ms ? msLevel(state.ms) : lvs[0];
    const want = w.section === mainSectionOf(state.ms) ? wantWeaponLv() : msLv;
    const fit = lvs.filter(l => l <= want);
    return String(fit.length ? fit[fit.length - 1] : lvs[0]);
  }

  /** 무장 LV 칸을 그린다. 기체가 LV1 뿐이면 고를 것이 없으므로 숨긴다. */
  function renderWeaponLvSeg() {
    const box = $('#weaponLv');
    if (!box) return;
    const msLv = state.ms ? msLevel(state.ms) : 1;
    box.innerHTML = '';
    // 주무장이랄 것이 없는 기체에서는 칸을 내밀지 않는다 — 눌러도 아무것도 안 바뀌는
    // 손잡이는 없느니만 못하다.
    if (!state.ms || msLv < 2 || !mainSectionOf(state.ms)) { box.hidden = true; return; }
    box.hidden = false;
    const cur = state.weaponLv;
    const mk = (v, label, title) => {
      const b = el('button', 'seg-btn' + (cur === v ? ' on' : ''), label);
      b.title = title;
      b.onclick = () => { state.weaponLv = v; renderAll(); };
      box.append(b);
    };
    const NL = String.fromCharCode(10);
    mk(null, '주무장 LV' + msLv, '기체와 같은 LV — 게임의 기본입니다');
    for (let l = msLv - 1; l >= 1; l--) {
      mk(l, 'LV' + l, '주무장만 LV' + l + ' 로 봅니다 (기체는 LV' + msLv + ' 그대로)' + NL
        + '부무장은 늘 기체 LV 를 따라갑니다' + NL
        + '레벨링크 시스템 파츠는 LV 가 어긋나면 기본값만 붙습니다');
    }
  }

  /* ---------- 슬러스터 지표 ---------- */
  // 표(위키 83 실측)·회복 상수·탱크 판정·파츠 소비경감은 core 에 있다.
  // 화면과 자동 구성이 같은 자를 써야 해서 옮겼다 — 셈이 두 군데면 갈라진다.
  const THRUSTER_TBL = C.THRUSTER_TBL;
  const THR_RECOVER = C.THR_RECOVER;
  const OH_SEC = 7, OH_SEC_GROUND_ADAPT = 6.3;   // 지상적성만 10% 짧다(우주적성은 효과 없음)
  // 부스트 계열 스킬은 '효과가 끝나면' 슬러스터 OH 복귀가 21초로 늘어난다(기본의 3배).
  // 스킬 설명에 「効果終了時のOH回復時間は21秒」 로 못박혀 있는 셋만 잡는다 — 합쳐 38기.
  // 발동 중에만 걸리는 값이라 지표를 갈아치우지 않고, 옆에 따로 적어 준다.
  const OH_LONG_SKILLS = ['EXブースト', 'オーバーブースト', 'シューティングブースト'];
  const OH_LONG_SEC = 21;
  const isTankMs = C.isTankMs;

  /** 이 기체 LV 에서 쓸 수 있는 '부스트 후 OH 21초' 스킬 이름(한글). 없으면 null. */
  function ohLongSkillOf(ms, lv) {
    if (!ms) return null;
    const modes = skillModesFor(msSkillsData[baseName(ms.MS名)] || []);
    const byName = new Map();
    for (const mo of modes) for (const sk of (mo.skills || [])) {
      if (!OH_LONG_SKILLS.includes(sk.name)) continue;
      if (!byName.has(sk.name)) byName.set(sk.name, []);
      byName.get(sk.name).push(sk);
    }
    for (const [name, cands] of byName) if (pickByMsLv(cands, lv)) return skTr(name);
    return null;
  }

  // 오버로드·사이코뮤 증폭장치는 '효과가 끝나면' 무장 OH 복귀가 2배가 된다.
  //   「※効果終了後、対象の全兵装は2倍のOH復帰時間が発生」
  // 스킬 이름이 아니라 이 문구로 잡는다 — 같은 오버로드라도 LV3(하이젠슬레이Ⅱ·라·양산형
  // 사이코 건담)은 2배 문구가 없어 해당되지 않는다.
  const OH_X2_RE = /効果終了後[^\/]*?2倍のOH復帰時間/;

  /**
   * 이 기체 LV 에서 '효과 후 OH 2배' 가 걸리는 스킬. 없으면 null.
   * psycommuOnly: 대상이 사이코뮤 무장뿐인 스킬(사이코뮤 증폭장치)인가.
   *   — 오버로드는 「全兵装のヒートゲージが全回復」 이라 전 무장,
   *     사이코뮤 증폭장치는 「発動中はサイコミュ兵装が強化される」 라 사이코뮤 무장만이다.
   */
  function weaponOhX2Of(ms, lv) {
    if (!ms) return null;
    const modes = skillModesFor(msSkillsData[baseName(ms.MS名)] || []);
    const byName = new Map();
    for (const mo of modes) for (const sk of (mo.skills || [])) {
      if (!OH_X2_RE.test(String(sk.desc || ''))) continue;
      if (!byName.has(sk.name)) byName.set(sk.name, []);
      byName.get(sk.name).push(sk);
    }
    for (const [name, cands] of byName) {
      const sk = pickByMsLv(cands, lv);
      if (sk) return { ko: skTr(name), psycommuOnly: /サイコミュ兵装/.test(String(sk.eff || '')) };
    }
    return null;
  }

  /** 슬러스터 관련 파츠 효과 — 회복속도%·OH단축%·소비경감%(초기/이동중). 모두 가산 중복. */
  /* ---------- 스러스터 스킬 ----------
   * 파츠(thrusterPartFx)는 이미 반영하는데 **스킬은 통째로 빠져 있었다.**
   * 축은 파츠와 같다 — 초기소비 / 계속소비 / 회복속도 / OH 복귀.
   *
   * 어려운 점은 수치가 아니라 **언제 걸리는가**다. 대부분이 상황 한정
   * (공중·태클·착지캔슬·발동중)이라 평지 고속이동에 일괄 적용하면 실제보다 좋게 나온다.
   * 그래서 원칙을 이렇게 세웠다: **모르면 「조건 있음」으로 둔다.**
   * 조건 있는 것은 사용자가 체크해야 걸리니 틀려도 수치가 부풀지 않지만,
   * 상시로 잘못 두면 아무도 모르게 좋게 나온다.
   *
   * 상시로 인정하는 모양은 원문을 직접 읽고 고른 둘뿐이다:
   *   A. 「高速移動開始時の…消費量を N% 軽減」 — 다른 말이 섞여 있어도 앞 절이 고속이동이다
   *      (変形機構最適化制御: 「高速移動開始時の…と変形時から…を 60% 軽減」)
   *   B. 「高速移動と…を使用した時」 — 고속이동 그 자체를 가리킨다
   *      (廃熱効率適正化: 「高速移動とジャンプを使用した時、初期消費量을 N% 軽減」)
   * 「宇宙において」처럼 환경을 가리는 말은 상시도 조건도 아니라 **환경축**으로 뺀다 —
   * 슬러스터 지표가 이미 지상·우주를 따로 내므로 그쪽에서 가린다. */

  const THR_COND = [
    [/空中|ジャンプ中|ジャンプ時|フライトモード|飛行/, '공중'],
    [/着地/, '착지캔슬'],
    [/変形時|変形中|変形する/, '변형중'],
    [/回避|ステップ/, '회피'],
    [/タックル/, '태클'],
    [/オーバーヒート時/, 'OH중'],
    [/発動|以下になった|スキル「[^」]+」|体勢中|状態から/, '발동중']
  ];
  const thrCondOf = seg => { for (const [re, ko] of THR_COND) if (re.test(seg)) return ko; return null; };
  const thrEnvOf = seg => /宇宙にお|宇宙での/.test(seg) ? 'space'
    : /地上にお|地上での/.test(seg) ? 'ground' : null;

  const THR_ALWAYS_START = /高速移動開始時[^。]{0,40}?消費量を\s*(\d+)\s*[%％]\s*軽減/;
  const THR_ALWAYS_USE = /高速移動と[^。]{0,12}を使用した時/;

  /* 태클·점프·낙하의 소비는 **한 번 드는 비용**이다 — 고속이동 중 초당 소비가 아니다.
     이것을 소비속도(cutRate)로 읽고 있었다. 전수로 일곱 곳:
       강화 태클 LV7/8/9 · 순간 분사 정밀 제어 LV1/2 · 퀵 부스트 LV4 · 어설트 부스터 LV4
     「태클」이나 「공중」을 체크하면 부스트 지속이 최대 1.67배(강화 태클 LV9)로 부풀었다.
     같은 줄에 高速移動 이 함께 적혀 있으면 이동 몫을 말하는 것이라 그대로 읽는다. */
  const THR_ACTION_ONLY = seg => /タックル|ジャンプ|落下/.test(seg) && !/高速移動/.test(seg);

  /** 한 조각에서 스러스터 효과 하나를 읽는다. 없으면 null. */
  function thrReadSeg(seg) {
    let m;
    if ((m = THR_ALWAYS_START.exec(seg))) return { key: 'cutInit', v: +m[1], always: true };
    /* 「量」이 붙기도 하고 안 붙기도 한다 — 전수로 세어 보니 **79 곳(33 종)** 이 量 없이
       적혀 있었고 통째로 새고 있었다(V2 의 「スラスター継続消費 －70%」가 그 하나다).
       「持続」도 같은 뜻으로 쓰인다(Hi-ν). 값이 여럿 붙은 줄(「－60%，－55%，－50%」)은
       어느 LV 것인지 알 수 없어 **읽지 않는다** — 지어내느니 「계산 안 함」으로 남긴다.
       ＋(늘어나는 쪽, 인터럽트 가드 등 8곳)도 읽지 않는다. 이 칸은 「경감」 축이라
       음수로 넣으면 화면에 「초기소비 -25%」로 나와 **줄어드는 것처럼 읽힌다.**
       방어 자세 중에 붙는 벌점이라 부스트 지속과 뜻이 겹치지도 않는다.
       대신 「계산 안 함」 줄에 늘어나는 값이라고 적어 보이기는 한다. */
    const MULTI = /[,，、]\s*[-－＋+]?\s*\d+\s*[%％]/;          // 값이 여럿인 줄
    const PLUS = /消費\s*[＋+]\s*\d+\s*[%％]/;                  // 늘어나는 쪽
    if (!MULTI.test(seg) && !PLUS.test(seg)) {
      if ((m = /初期消費量?[^\d]{0,12}(\d+)\s*[%％]\s*軽減/.exec(seg)))
        return { key: 'cutInit', v: +m[1], always: THR_ALWAYS_USE.test(seg) };
      if ((m = /初期消費量?\s*[-－]\s*(\d+)\s*[%％]/.exec(seg)))
        return { key: 'cutInit', v: +m[1], always: THR_ALWAYS_USE.test(seg) };
      if ((m = /(?:継続|持続)消費量?[^\d]{0,12}(\d+)\s*[%％]\s*軽減/.exec(seg)))
        return { key: 'cutRate', v: +m[1], always: THR_ALWAYS_USE.test(seg) };
      if ((m = /(?:継続|持続)消費量?\s*[-－]\s*(\d+)\s*[%％]/.exec(seg)))
        return { key: 'cutRate', v: +m[1], always: THR_ALWAYS_USE.test(seg) };
      /* 「高速移動開始時の…消費 －N%」 — 開始時 이므로 **초기소비**다.
         줄임말(スラ消費)만 잡고 있어서 정식 표기(スラスター消費)가 통째로 샜다.
         새면 아래 일반 폴백이 같은 줄을 **소비속도**로 읽고, 바로 다음 줄의
         「高速移動中のスラスター消費 －50%」와 값·조건이 같아 중복으로 접혀 사라진다 —
         ZERO 시스템은 두 줄이 다 적혀 있는데 화면에는 소비속도 하나만 떴다.
         ＺＥＲＯシステム(윙 제로·윙 제로【EW】)·ビーム・ローター（飛行） 셋이 그랬다. */
      if ((m = /高速移動開始時の(?:スラスター|スラ)消費(?:量)?\s*[-－]\s*(\d+)\s*[%％]/.exec(seg)))
        return { key: 'cutInit', v: +m[1], always: THR_ALWAYS_USE.test(seg) };
    }
    if ((m = /回復速度[^\d]{0,12}(\d+)\s*[%％]\s*(?:上昇|増加)/.exec(seg)) ||
        (m = /回復速度\s*[+＋]\s*(\d+)\s*[%％]/.exec(seg)))
      return { key: 'recover', v: +m[1], always: false };
    /* OH 복귀는 「短縮」으로도 「－N%」로도 적는다. 다만 **兵装** 이 낀 줄은 무장의 OH 지
       기체 스러스터의 OH 가 아니다 — 「対象兵装のリロード＆オーバーヒート復帰時間 －50%」를
       스러스터로 읽을 뻔했다. */
    if (!/兵装/.test(seg)) {
      if ((m = /オーバーヒート[^]{0,20}?回復時間[^\d]{0,12}(\d+)\s*[%％]\s*短縮/.exec(seg)))
        return { key: 'oh', v: +m[1], always: false };
      if ((m = /オーバーヒート(?:から)?(?:の)?(?:復帰|回復)時間\s*[-－]\s*(\d+)\s*[%％]/.exec(seg)))
        return { key: 'oh', v: +m[1], always: false };
    }
    /* 「…을 쓰기 시작할 때」 드는 몫은 초기소비다. 계속 소비(高速移動中)와 같은 축으로
       읽으면 한 스킬 안에서 55%+50% 처럼 더해져 100% 를 넘는다(空中制御プログラム LV4).

       같은 뜻을 데이터가 네 가지로 적는다 — 전수로 세어 확인했다:
         「使用したとき」175 · 「使用した時」67 · 「行った直後」13 · 「使用した際」1
       하나만 잡으면 나머지가 조용히 계속소비로 샌다(실제로 「行った直後」가 그랬다).
       ジャンプ時·タックル発生時 는 조건이 달라(점프·태클) 여기 넣지 않는다. */
    if ((m = /(?:使用した(?:とき|時|際)|行った直後)[^。]{0,16}?消費量[^\d]{0,8}(\d+)\s*[%％]\s*軽減/.exec(seg)))
      return { key: 'cutInit', v: +m[1], always: THR_ALWAYS_USE.test(seg) };
    /* 여기도 MULTI·PLUS 를 걸러야 한다. 위쪽 묶음만 감싸 두었더니 같은 스킬 안에서
       한 줄은 규칙을 지키고 한 줄은 어겼다 — 실드 부스터 제어 기구 개량형의
       「・高速移動開始時のスラ消費 －60%，－55%，－50%」는 안 읽으면서
       「・スラスター消費量 －35%，－30%，－25%」에서는 **가장 좋은 35%** 를 집었다.
       실드 매수로 변하는 값이라 어느 것인지 알 수 없다 — 지어내느니 「계산 안 함」이다. */
    if (!MULTI.test(seg) && !PLUS.test(seg) && !THR_ACTION_ONLY(seg)) {
      if ((m = /スラスター(?:の)?消費(?:量)?[^\d]{0,12}(\d+)\s*[%％]\s*軽減/.exec(seg)) ||
          (m = /スラスター消費(?:量)?\s*[-－]\s*(\d+)\s*[%％]/.exec(seg)))
        return { key: 'cutRate', v: +m[1], always: THR_ALWAYS_USE.test(seg) };
    }
    return null;
  }

  /** 「…速度 N倍」 — 배수로 적힌 상승.
   *
   *  사용자 지적: 특수 긴급 회피 제어는 「3秒間スラスター＆OH復帰速度 2.5倍」로
   *  **숫자가 분명히 적혀 있다.** 값이 없어 못 넣는 것이 아니었다.
   *  그리고 OH 복귀는 이미 파츠(냉각 계열)로 재고 있는 축이라, 같은 축에 얹으면 된다.
   *  다만 몇 초짜리라 늘 걸리지는 않으므로 **조건부(체크식)로만** 넣는다 —
   *  상시로 두면 아무도 모르게 좋게 나온다.
   *
   *  한 조각이 두 축을 함께 올린다(スラスター＝회복속도, OH＝복귀). 그래서 여럿을 낸다.
   *  「終了後は3倍程度の回復時間を必要とする」(오버부스트 종료 후 벌점)는 速度 가 아니라
   *  **時間** 이라 여기 걸리지 않는다 — 벌점을 상승으로 읽으면 거꾸로다. */
  function thrReadMult(seg) {
    const m = /(?:回復|復帰)速度\s*([\d.]+)\s*倍/.exec(seg);
    if (!m) return [];
    const x = Number(m[1]);
    if (!(x > 1)) return [];
    const head = seg.slice(0, m.index);          // 무엇의 속도인지는 앞쪽에 적힌다
    const sec = /([\d.]+)\s*秒間/.exec(seg);
    const burst = sec ? Number(sec[1]) : null;
    const out = [];
    // 회복 속도 N 배 = N 배 빨리 찬다 → +(N−1)×100 %
    if (/スラ/.test(head)) out.push({ key: 'recover', v: Math.round((x - 1) * 100), burst });
    // 복귀 속도 N 배 = 복귀 시간이 1/N → (1 − 1/N) 만큼 짧아진다
    if (/OH|オーバーヒート/.test(head)) out.push({ key: 'oh', v: Math.round((1 - 1 / x) * 100), burst });
    return out;
  }

  /* 게임 안 설명에는 값이 없는데 **위키 해설에는 있는** 스러스터 스킬.
     플랩 부스터가 그랬다 — 원문은 「スラスター消費量が増加する」(LV2 는 やや増加する)뿐이라
     읽을 숫자가 없어 「계산 안 함」에 남아 있었다. 위키 스킬 해설이 값을 적고 있다:
       LV1 「通常より消費が100%増加する。…8×200%＝毎秒16消費」
       LV2 「通常より消費が50%増加する。…8×150%＝毎秒12消費」
     지어낸 값이 아니라 출처가 있는 값이라 넣는다. 다만 **지상 고속이동 중에
     「점프/상승」을 누르고 있는 동안만** 걸리므로 상시로 두지 않는다 —
     체크식·지상 한정이다. 경감 축에 음수로 넣는다: 소비속도 ×(1 − v/100) 이라
     −100 이면 정확히 2배, −50 이면 1.5배가 되어 위키의 16/12 와 맞는다.
     다른 경감과는 곱으로 겹친다(stackCut) — 위키도 「他スキルの影響がない場合」이라 단서를 단다. */
  const THR_SKILL_WIKI = {
    'フラップ・ブースター': {
      LV1: { key: 'cutRate', v: -100, cond: '상승중', env: 'ground' },
      LV2: { key: 'cutRate', v: -50, cond: '상승중', env: 'ground' }
    }
  };

  /** 설명을 조각으로 나눈다. 불릿(・…)은 **직전 머리줄의 조건**을 물려받는다 —
   *  「発動中は」 다음 줄에 「・スラスター消費 －25%」가 오는 꼴이 아주 많다. */
  function thrSegments(blob) {
    const raw = String(blob).split(/[／]|\s\/\s|。|\n/).map(x => x.trim()).filter(Boolean);
    const out = [];
    let carried = null;
    for (const seg of raw) {
      const bullet = /^[・･]/.test(seg);
      const own = thrCondOf(seg);
      const hasNum = /\d+\s*[%％]/.test(seg);
      // 조건 없는 불릿은 상시가 아니라 **발동중**으로 본다. 이 글투에서 불릿은 늘
      // 어떤 머리줄 아래에 있고, 머리줄을 못 읽었다고 상시로 올리면 수치가 부푼다.
      const cond = own || carried || (bullet ? '발동중' : null);
      out.push({ seg, cond, env: thrEnvOf(seg) });
      if (!bullet) {
        if (own && (!hasNum || /[、,]$/.test(seg))) carried = own;
        else if (hasNum) carried = null;   // 조건과 값이 한 줄에 끝났다 — 다음 줄로 새지 않게
      }
    }
    return out;
  }

  /** 이 기체가 그 LV 에서 가진, 스러스터에 영향 주는 스킬 목록.
   *  각 항목 {name, ko, key, v, cond, env} — cond 가 null 이면 늘 걸린다. */
  function thrusterSkillsOf(ms, lv, form) {
    if (!ms) return [];
    const modes = skillModesFor(msSkillsData[baseName(ms.MS名)] || [], form);
    const groups = new Map();
    for (const mode of modes) for (const sk of (mode.skills || [])) {
      if (!groups.has(sk.name)) groups.set(sk.name, []);
      groups.get(sk.name).push(sk);
    }
    const out = [];
    for (const cands of groups.values()) {
      const sk = pickByMsLv(cands, lv);
      if (!sk) continue;
      const blob = ((sk.eff || '') + ' / ' + (sk.desc || '')).replace(/\s+/g, ' ');
      if (!/スラスター/.test(blob)) continue;
      const wiki = (THR_SKILL_WIKI[sk.name] || {})[sk.lv];
      if (wiki) {
        out.push({ name: sk.name, ko: skTr(sk.name), lv: sk.lv || '',
          key: wiki.key, v: wiki.v, cond: wiki.cond, env: wiki.env, seg: blob, burst: null });
        continue;                       // 원문에는 값이 없다 — 더 읽을 것이 없다
      }
      const seen = new Set();
      for (const { seg, cond, env } of thrSegments(blob)) {
        const solo = thrReadSeg(seg);
        const list = solo ? [solo] : thrReadMult(seg);   // % 로 못 읽으면 배수로 읽어 본다
        for (const r of list) {
          // 몇 초짜리는 **절대 상시가 아니다.** 조건을 못 읽었어도 체크식으로 둔다.
          const c = r.always ? null : (cond || (r.burst ? '발동중' : null));
          const sig = r.key + ':' + r.v + ':' + (c || '') + ':' + (env || '');
          if (seen.has(sig)) continue;
          seen.add(sig);
          out.push({ name: sk.name, ko: skTr(sk.name), lv: sk.lv || '',
            key: r.key, v: r.v, cond: c, env, seg, burst: r.burst || null });
        }
      }
    }
    return out;
  }

  /** 데이터 전체에서 「스러스터에 영향 준다」고 읽히는 스킬 이름 모음.
   *  부여(付与)로 붙는 것이 무엇인지 알아보려고 한 번만 만들어 둔다. */
  let thrNameSet = null;
  function thrusterSkillNames() {
    if (thrNameSet) return thrNameSet;
    thrNameSet = new Set();
    for (const forms of Object.values(msSkillsData || {}))
      for (const mo of (forms || []))
        for (const sk of (mo.skills || [])) {
          if (thrNameSet.has(sk.name)) continue;
          const blob = ((sk.eff || '') + ' / ' + (sk.desc || '')).replace(/\s+/g, ' ');
          if (!/スラスター/.test(blob)) continue;
          const readable = THR_SKILL_WIKI[sk.name]
            || thrSegments(blob).some(x => thrReadSeg(x.seg) || thrReadMult(x.seg).length);
          if (readable) thrNameSet.add(sk.name);
        }
    return thrNameSet;
  }

  const reEsc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /**
   * 스러스터를 건드린다고 **말은 하는데** 계산에 넣을 수치가 없는 스킬들.
   *
   * 왜 따로 내미는가 — V2 건담은 スラスター 가 들어간 스킬이 넷인데 칸에는 하나만 떴다.
   * 나머지 셋(플랩 부스터·특수 긴급 회피 제어·M 드라이브)은 「軽減される」「増加する」처럼
   * **몇 %인지 안 적혀 있어** 조용히 버려지고 있었다. 버리는 것 자체는 맞다 —
   * 없는 숫자를 지어내면 부스트 지속이 거짓이 된다. 틀린 것은 **말없이** 버린 쪽이다.
   * 그러면 쓰는 사람은 앱이 그 스킬을 아는지 모르는지 알 길이 없다.
   * 파츠 쪽 UNMODELLED_FX 와 같은 방식으로, 이름과 이유만 적어 둔다.
   */
  function thrusterUnmodelled(ms, lv, form) {
    if (!ms) return [];
    const modes = skillModesFor(msSkillsData[baseName(ms.MS名)] || [], form);
    const groups = new Map();
    for (const mode of modes) for (const sk of (mode.skills || [])) {
      if (!groups.has(sk.name)) groups.set(sk.name, []);
      groups.get(sk.name).push(sk);
    }
    // 수치를 읽어 낸 스킬은 이미 칸에 있다 — 그것들은 뺀다.
    const modelled = new Set(thrusterSkillsOf(ms, lv, form).map(x => x.name));
    const out = [];
    for (const cands of groups.values()) {
      const sk = pickByMsLv(cands, lv);
      if (!sk || modelled.has(sk.name)) continue;
      const blob = ((sk.eff || '') + ' / ' + (sk.desc || '')).replace(/\s+/g, ' ');
      if (!/スラスター/.test(blob)) continue;
      // 어느 쪽으로 움직이는지는 문구로 알 수 있다. 값만 없을 뿐이다.
      /* 「…速度 N倍」는 이제 읽어서 체크식으로 넣는다(특수 긴급 회피 제어).
         여기 남는 배수는 **반대쪽** — 오버부스트처럼 끝난 뒤 회복이 느려지는 벌점이다.
         (그쪽은 「효과 뒤 21초」로 따로 적고 있다.) 둘을 같은 말로 적으면 거짓이 된다. */
      const why = /(タックル|ジャンプ|落下)[^。\/]{0,24}消費量[^。\/]{0,12}軽減/.test(blob)
          && !/高速移動[^。\/]{0,24}消費/.test(blob)
          ? '태클·점프 **한 번**에 드는 몫이라 고속이동 지속에는 넣지 않습니다'
        : /[\d.]+\s*倍/.test(blob) && /(回復|復帰)時間/.test(blob)
          ? '효과가 끝난 뒤 회복이 **느려지는** 벌점이라 지속 지표에는 넣지 않습니다'
        : /消費\s*[＋+]\s*\d+\s*[%％]/.test(blob) ? '소비가 **늘어나는** 값이라 넣지 않습니다'
        : /[,，、]\s*[-－]?\s*\d+\s*[%％]/.test(blob) && /消費/.test(blob)
          // 값이 여러 개인 이유는 둘이다 — LV 별이거나, 실드 매수처럼 상황별이거나.
          // 원문이 이유를 적어 두면 그대로 옮긴다(「※シールド枚数により効果が変動」).
          ? (/枚数|所持数/.test(blob)
              ? '실드 매수에 따라 값이 달라져 어느 것인지 알 수 없습니다'
              : 'LV 마다 값이 여럿 적혀 있어 어느 것인지 알 수 없습니다')
        : /増加/.test(blob) ? '소비가 늘어난다고만 적혀 있고 값이 없습니다'
        : /回復速度|復帰速度/.test(blob) ? '회복·복귀가 빨라진다고만 적혀 있고 값이 없습니다'
        : /軽減|減少/.test(blob) ? '소비가 줄어든다고만 적혀 있고 값이 없습니다'
        : '수치가 적혀 있지 않습니다';
      out.push({ name: sk.name, ko: skTr(sk.name), lv: sk.lv || '', why, seg: blob.slice(0, 160),
        // 번역은 **문장 전체**가 열쇠라, 잘라 낸 조각으로는 사전을 못 찾는다 — 원문을 통째로 들고 온다
        src: { desc: sk.desc || '', eff: sk.eff || '' } });
    }

    /* 「스킬 X LVn 이 付与」 — 다른 스킬이 발동하면 **그때 붙는** 스킬이다.
       그 기체의 스킬 목록에는 없으니 위 훑기로는 존재조차 모른다.
       윙 건담 제로는 ZERO 시스템이 발동하면 플랩 부스터 LV2 가 붙어 **소비가 늘어나는데**
       화면에는 아무 말도 없었다(사용자 지적). 수치로는 못 넣는다 — 조건이 겹쳐 있어
       (ZERO 발동 중 **그리고** 상승 중) 체크 하나로 표현되지 않기 때문이다.
       대신 무엇이 언제 붙는지를 적는다. 이미 제 스킬로 가진 것(윙 제로【EW】의 플랩
       부스터)은 modelled 에 들어 있어 여기 두 번 나오지 않는다. */
    const said = new Set(out.map(x => x.name));
    for (const cands of groups.values()) {
      const host = pickByMsLv(cands, lv);
      if (!host) continue;
      const hostBlob = ((host.eff || '') + ' / ' + (host.desc || '')).replace(/\s+/g, ' ');
      if (!/付与/.test(hostBlob)) continue;
      for (const name of thrusterSkillNames()) {
        if (name === host.name || modelled.has(name) || said.has(name)) continue;
        const m = new RegExp(reEsc(name) + '\\s*(LV|Lv)\\s*(\\d+)[^。]{0,8}付与').exec(hostBlob);
        if (!m) continue;
        said.add(name);
        out.push({
          name, ko: skTr(name), lv: 'LV' + m[2],
          why: skTr(host.name) + (host.lv ? ' ' + host.lv : '') + ' 발동 중에만 붙습니다'
            + ' — 조건이 겹쳐 수치로는 넣지 않습니다',
          seg: m[0],
          src: { desc: host.desc || '', eff: host.eff || '' }
        });
      }
    }
    return out;
  }

  /** 체크 열쇠 — **이름이 아니라 「이름|조건」**이다.
   *  한 스킬이 조건이 다른 효과를 여럿 가진다(고성능 분사 제어 장치: 착지캔슬 초기소비 75%
   *  · 공중 초기소비 50% · 공중 소비속도 50%). 이름으로 묶으면 한 줄만 눌러도 셋이 다 켜져,
   *  동시에 성립하지 않는 상황이 합산된다 — 초기소비 125% 가 되어 부스트가 8.1 → 20.9초로
   *  튀었다(계산이 음수로 넘어간다). 상황 단위로 켠다. */
  const thrKeyOf = x => x.name + '|' + (x.cond || '');

  /** 경감·상승 합이 계산을 뒤집지 못하게 묶는다.
   *  소비를 100% 이상 줄이면 초기소비·소비속도가 음수가 되어 부스트 지속이 뒤집힌다.
   *  게임에 그런 값은 없으므로, 합이 그만큼 나오면 **화면에 묶였다고 적고** 95% 로 자른다
   *  (조용히 자르면 왜 다른지 알 수 없다). */
  const THR_CUT_MAX = 95;

  /** 켜 둔(또는 상시인) 스러스터 스킬만 모아 파츠와 같은 모양으로 낸다. */
  function thrusterSkillFx(ms, lv, env, on, form) {
    const fx = { cutInit: 0, cutRate: 0, recover: 0, oh: 0, mulInit: 1, mulRate: 1, used: [], capped: [] };
    for (const s of thrusterSkillsOf(ms, lv, form)) {
      if (s.env && s.env !== env) continue;                  // 환경이 다르면 안 걸린다
      if (s.cond && !(on && on.has(thrKeyOf(s)))) continue;   // 조건부는 그 상황을 체크해야 걸린다
      /* 소비가 **늘어나는** 값(플랩 부스터)은 「통상보다 100% 증가」= 지금 값의 2배라는 뜻이다.
         경감 합에 −100 으로 넣으면 다른 경감과 **더해져** 버린다 —
         S건담에서 능력 UP「ALICE」(50%)와 함께 켜면 −100+50 = −50 → 초당 12 가 되는데,
         배수로 보면 8 × 0.5 × 2 = 초당 8 이다. 실측으로 65기에서 겹칠 수 있었다.
         원문은 겹침 규칙을 적지 않지만 「통상보다」라는 말은 남은 값에 거는 배수를 가리킨다.
         그래서 경감은 경감끼리 더하고, 배수는 맨 마지막에 곱한다(파츠를 스킬 뒤에 곱하는 것과 같다). */
      if (s.v < 0 && (s.key === 'cutInit' || s.key === 'cutRate')) {
        fx[s.key === 'cutInit' ? 'mulInit' : 'mulRate'] *= 1 - s.v / 100;
      } else {
        fx[s.key] += s.v;
      }
      fx.used.push(s);
    }
    for (const k of ['cutInit', 'cutRate']) {
      if (fx[k] > THR_CUT_MAX) { fx.capped.push(k); fx[k] = THR_CUT_MAX; }
    }
    return fx;
  }

  const thrusterPartFx = C.thrusterPartFx;

  /**
   * 환경(지상/우주)별 슬러스터 지표.
   *   부스트 지속 = (스라값 − 초기소비) ÷ 소비속도
   *   완충 시간   = 스라값 ÷ 회복속도
   *   OH 복귀     = 기준초 × (1 − 단축%)
   * 소비속도는 2족 기준이라 탱크는 지속 시간을 내지 않는다(위키도 값에 ? 를 달아 뒀다).
   */
  function thrusterMetrics(ms, thrusterVal, equipped, env, skillOpt) {
    if (!ms || !thrusterVal) return null;
    const t = THRUSTER_TBL[env];
    const adapt = env === 'ground' ? ms['環境適正_地上'] : ms['環境適正_宇宙'];
    const col = adapt ? 'adapt' : (ms['属性'] === '強襲' ? 'assault' : 'std');
    const pfx = thrusterPartFx(equipped);
    // 스킬분 — 상시인 것과 사용자가 체크한 것만. 파츠와 같은 축이라 그대로 더한다.
    const sfx = skillOpt
      ? thrusterSkillFx(ms, skillOpt.lv, env, skillOpt.on, skillOpt.form)
      : { cutInit: 0, cutRate: 0, recover: 0, oh: 0, mulInit: 1, mulRate: 1, used: [] };
    /* 소비 경감은 파츠와 스킬이 **겹쳐 더해지지 않는다** — 스킬로 줄인 뒤 남은 값에서
       파츠가 또 줄인다(사용자 지적, 위키 코멘트도 같은 계산: 廃熱1 + 연소효율 = 0.9×0.9 = 0.81).
       더해 버리면 10%+10% = 20% 로 4%p 부풀고, **스킬로 이미 많이 줄인 기체일수록** 더 틀린다
       (70% 경감 기체에 10% 파츠: 더하면 80%, 실제는 73%). 회복·OH 축은 원문에 겹침 규칙이
       적혀 있지 않아 예전대로 둔다 — 모르는 것을 바꾸지는 않는다. */
    const stackCut = (a, b) => Math.round((1 - (1 - a / 100) * (1 - b / 100)) * 1000) / 10;
    const fx = {
      cutInit: stackCut(sfx.cutInit, pfx.cutInit), cutRate: stackCut(sfx.cutRate, pfx.cutRate),
      recover: pfx.recover + sfx.recover, oh: pfx.oh + sfx.oh,
      // 늘어나는 쪽은 경감을 다 매긴 **뒤에** 곱한다 (thrusterSkillFx 주석 참고)
      mulInit: sfx.mulInit || 1, mulRate: sfx.mulRate || 1,
      part: pfx, skill: sfx
    };
    const init = t.init[col] * (1 - fx.cutInit / 100) * fx.mulInit;
    const rate = t.rate[col] * (1 - fx.cutRate / 100) * fx.mulRate;
    const boost = (!isTankMs(ms) && thrusterVal > init && rate > 0)
      ? (thrusterVal - init) / rate : null;
    const full = thrusterVal / (THR_RECOVER * (1 + fx.recover / 100));
    const ohBase = (env === 'ground' && ms['環境適正_地上']) ? OH_SEC_GROUND_ADAPT : OH_SEC;
    return {
      boost, full, oh: ohBase * (1 - fx.oh / 100), col, fx,
      base: { boost: (!isTankMs(ms) && thrusterVal > t.init[col]) ? (thrusterVal - t.init[col]) / t.rate[col] : null,
        full: thrusterVal / THR_RECOVER, oh: ohBase }
    };
  }

  // 조사·산탄·동시발사 무장은 무장 표의 위력이 1히트/1발당 값이라, 備考의 배수를 읽어
  // 전탄(전히트) 명중 시 총 피해를 함께 보여 준다. (격투는 방향/연격으로 따로 표기)
  const CJK_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const cjkNum = s => (CJK_NUM[s] ?? Number(s));
  /** 한 번에 나가는 발수 — 「6発同時発射」「4発連続発射」「二発同時発射」. 없으면 1. */
  function shotCountOf(note) {
    const m = String(note).match(/([一二三四五六七八九十]|\d+)\s*発?\s*(?:同時|連続)発射/);
    return m ? Math.max(1, cjkNum(m[1])) : 1;
  }
  /** 연사 횟수 — 「2発同時発射 x2回攻撃」의 x2. 발사 표기가 있는 조각 안에서만 찾는다
   *  (「よろけ値：… x2射」에도 같은 꼴이 있어 note 전체에서 찾으면 오인한다). */
  function volleyCountOf(note) {
    const seg = String(note).split(' / ').find(s => /(?:同時|連続)発射/.test(s));
    const m = seg && seg.match(/[x×ｘ]\s*(\d+)\s*(?:回攻撃|射)/);
    return m ? Math.max(1, Number(m[1])) : 1;
  }
  // 동시발사(산탄) 배수를 모드별로 읽는다. 「非集束時N…」은 논차지만, 「集束時N…」은 풀차지만,
  // 접두가 없으면 두 모드 공통. (非集束時 이 集束時 를 부분포함하므로 非 를 먼저 가른다.)
  function fireMult(w) {
    const empty = { nc: null, ch: null };
    if (!w || w.type === 'melee') return empty;
    const note = (w.info && w.info['備考']) || '';
    // 조사(照射)·지속 폭발: 최대 N 히트 — 지속이라 두 칸 공통.
    // 히트 수만 읽고 끝내면 여러 발을 쏘는 무장의 몫이 통째로 빠진다(펀넬x6 조사 = 6발 × 5히트).
    // 발수는 두 가지로 적히는데 **같은 뜻**이라 하나만 센다:
    //   「最大5HIT x4」 — 괄호 안에 배수가 붙는 형(대함대공 미사일x4)
    //   「最大5ヒット」 + 다른 조각의 「6発同時発射」(펀넬x6 조사)
    // 둘 다 있는 무장은 앞의 배수가 곧 뒤의 발수라, 겹쳐 곱하면 4배로 부풀려진다.
    // 모드별로 히트 수가 다른 무장도 있다(「非集束時最大5ヒット / 集束時最大10ヒット」)
    // → 조각마다 접두를 보고 논차지/집속에 나눠 담는다. 접두가 없으면 두 모드 공통.
    {
      const shots = shotCountOf(note), volleys = volleyCountOf(note);
      let a = null, b = null, common = null;
      for (const seg of note.split(' / ')) {
        const m = seg.match(/最大\s*(\d+)\s*(?:ヒット|HIT)\s*(?:[x×ｘ]\s*(\d+))?/i);
        if (!m) continue;
        const hits = Number(m[1]);
        if (hits <= 0) continue;
        const mul = (m[2] ? Number(m[2]) : shots) * volleys;
        const n = hits * mul;
        if (n <= 1) continue;
        const cell = { n, label: mul > 1 ? mul + '발 ×' + hits + '히트' : '최대 ' + hits + '히트' };
        if (/非集束時/.test(seg)) a = cell;
        else if (/集束時/.test(seg)) b = cell;
        else common = cell;
      }
      if (common) { a = a || common; b = b || common; }
      if (a || b) return { nc: a, ch: b };
    }
    // 지속 조사의 범위 표기 「3～20ヒット」(G-바드 등) — 풀 지속 시 최대 타수를 쓴다
    const rg = /照射/.test(note) && note.match(/(\d+)\s*[～~]\s*(\d+)\s*(?:ヒット|HIT)/i);
    if (rg && Number(rg[2]) > 1) { const x = { n: Number(rg[2]), label: rg[1] + '~' + rg[2] + '히트' }; return { nc: x, ch: x }; }
    let nc = null, ch = null, both = null;
    for (const b of note.split(' / ')) {
      const m = b.match(/([一二三四五六七八九十]|\d+)発?同時発射/);  // 바르길은 「7同時発射」로 発 이 빠져 있다
      if (!m) continue;
      const proj = cjkNum(m[1]);
      const rep = b.match(/[x×]\s*(\d+)\s*(?:回攻撃|射)/);           // 같은 불릿 안의 「x3回攻撃」「x3射」 연사만
      const r = rep ? Number(rep[1]) : 1;
      const n = proj * r;
      if (n <= 1) continue;
      const cell = { n, label: rep ? proj + '발 ×' + r + '연사' : proj + '발 동시' };
      if (/非集束時/.test(b)) nc = cell;
      else if (/集束時/.test(b)) ch = cell;
      else both = cell;
    }
    if (both) { nc = nc || both; ch = ch || both; }   // 접두 없는 표기는 두 모드에 공통 적용
    return { nc, ch };
  }

  /**
   * 고정 피해 — 소이(焼夷) 계열이 명중 후 따로 넣는 피해. 「2700固定ダメージ(450x6HIT)」
   * 무장 표의 위력과는 **별개로 더해진다**(43종 중 34종은 위력과 1틱 값이 아예 다르다).
   * 이름 그대로 固定 이라 사격·격투 보정을 받지 않으므로, 위키 값을 그대로 쓴다.
   */
  function fixedDamageOf(w) {
    const note = (w && w.info && w.info['備考']) || '';
    const m = note.match(/(\d+)\s*固定ダメージ\s*[（(]\s*(\d+)\s*[x×ｘ]\s*(\d+)\s*HIT/i);
    if (!m) return null;
    return { total: Number(m[1]), per: Number(m[2]), hits: Number(m[3]) };
  }

  /**
   * 소이(焼夷) 효과를 키우는 파츠 — 고정 피해에 반영한다.
   *   특수 연소제      1틱 피해 +25% · 지속시간 +10%
   *   이레귤러 DBL 계열 지속시간 +10% (피해는 그대로)
   * 위키 5891 의 실측 34행으로 맞춰 본 결과 —
   *   1틱 피해 floor(×1.25) 32/34 일치(예외 2건은 ×1.10 로 측정돼 편차로 본다)
   *   히트 수 round(×지속배수) 46/56 일치. 위키도 「같은 지속시간이라도 늘기도 안 늘기도
   *   한다. 要検証」이라 적어 둔 부분이라, 늘어난 히트는 툴팁에서 불확실하다고 밝힌다.
   */
  function burnBoostOf(equipped) {
    let dmg = 1, dur = 1;
    for (const p of equipped || []) {
      const d = String(p.description || '');
      const m = d.match(/焼夷効果によって当てるダメージを\s*(\d+)\s*[%％]\s*増加/);
      if (m) dmg *= 1 + Number(m[1]) / 100;
      const t = d.match(/焼夷効果の継続時間を\s*(\d+)\s*[%％]\s*増加/)
        || d.match(/状態異常の継続時間を\s*(\d+)\s*[%％]\s*増加/);
      if (t) dur *= 1 + Number(t[1]) / 100;
    }
    return { dmg, dur };
  }

  /** 파츠를 반영한 고정 피해. base 가 없으면 null. */
  function fixedDamageWithParts(w, equipped) {
    const fx = fixedDamageOf(w);
    if (!fx) return null;
    const b = burnBoostOf(equipped);
    const per = Math.floor(fx.per * b.dmg);
    // 히트 수는 배율로 정해지지 않는다. 게임은 지속시간을 틱 간격으로 나눠 **내림**한다.
    //     히트 = floor(지속 ÷ 간격) + 1
    // 기본 히트가 h 라는 사실이 알려 주는 건 '지속÷간격 ∈ [h-1, h)' 구간뿐이라,
    // 여기에 지속 배율을 곱하면 결과가 두 정수에 걸친다. 그래서 한 값으로 찍지 않고
    // 범위로 낸다 — 위키 5891 실측 36건이 이 모델에 전건 부합한다.
    // (예전엔 round(h×배율) 로 찍었는데 36건 중 27건만 맞았다)
    let hits = Math.floor((fx.hits - 1) * b.dur) + 1;          // 최소
    let hitsMax = Math.floor((fx.hits - 1e-9) * b.dur) + 1;    // 최대
    let per2 = per, measured = false;
    // 위키 5891 에 **실제로 재 본 값**이 있고, 지금 낀 소이 파츠가 특수 연소제 하나뿐이면
    // 추정 대신 그 값을 쓴다(배율이 딱 dmg 1.25 · dur 1.1 이면 연소제 단독이다).
    // 그 표는 연소제 단독 열만 조건이 분명해서, 다른 조합에는 쓰지 않는다.
    const meas = w && w.mods && w.mods.burnSoi;
    if (meas && Math.abs(b.dmg - 1.25) < 1e-9 && Math.abs(b.dur - 1.1) < 1e-9) {
      per2 = meas[0]; hits = hitsMax = meas[1]; measured = true;
    }
    return { base: fx, per: per2, hits, hitsMax,
      total: per2 * hits, totalMax: per2 * hitsMax,
      ranged: hitsMax > hits, measured,
      boosted: per2 !== fx.per || hitsMax !== fx.hits };
  }

  /**
   * 상성(카테고리) 배율 — 카테고리 특공 프로그램은 우위일 때만 이 배율 자체를 올린다.
   * 위키 7000: 「数値はカテゴリ補正の130%に＋10%され、140%になる。実ダメージでいうと＋7～8%」
   * 우리 기본값이 advantage 0.3(=130%)이라 +0.1 하면 140% 가 된다.
   * 불리·동일 상성에는 효과가 없다(설명이 '有利カテゴリの敵機에' 로 한정).
   */
  function attrBonusOf(equipped, attr) {
    const base = D.ATTR_BONUS[attr] ?? 0;
    if (attr !== 'advantage') return base;
    const has = (equipped || []).some(p => /有利カテゴリの敵機に与えるダメージを増加/.test(String(p.description || '')));
    return has ? base + 0.1 : base;
  }

  /** 무장이 거는 디버프 — 계산엔 안 쓰고 표시만 한다(효과량이 위키에 수치로 없다). */
  const DEBUFF_RULES = [
    [/炎上/, '연소'],
    [/速度デバフ|移動速度低下|速度低下/, '속도↓'],
    [/スラスター消費量増加/, '슬러스터↑'],
    [/スラスターOH時間増加/, 'OH↑'],
    [/射撃補正低下/, '사격↓'],
    [/格闘補正低下/, '격투↓'],
    [/スタン/, '스턴']
  ];
  function debuffsOf(w) {
    const note = (w && w.info && w.info['備考']) || '';
    const out = [];
    for (const [re, label] of DEBUFF_RULES) if (re.test(note)) out.push(label);
    // 종류를 못 밝힌 「デバフ付与」 만 있는 경우 — 있다는 사실만 알린다
    if (!out.length && /デバフ/.test(note)) out.push('디버프');
    return out;
  }

  /* ---------- DPS(지속 화력) ---------- */
  // 위력 칸 아래에 초당 피해를 보여 준다. 기본 위력 기준(파츠·스킬 미반영)의 무장 비교용.
  //   순간 DPS = 1트리거 피해 ÷ 발사간격,  지속 DPS = 탄창분 피해 ÷ (탄창 소진 + 리로드/OH복귀)

  /**
   * 「쿨/발사」 칸에 쓸 항목 순서. 격투는 쿨타임이, 사격은 발사 간격이 실제 주기다.
   * 표시와 DPS 계산이 **같은 목록**을 봐야 한다 — 예전엔 표는 쿨타임을, DPS 는 발사 간격을
   * 먼저 보아, 둘 다 있는 무장에서 화면에 적힌 값과 DPS 의 근거가 서로 달랐다.
   */
  const intervalFields = w => ((w.type === 'melee' || w.attr === 'melee')
    ? ['クールタイム', '発射間隔', '発射速度', '発射間', '照射時間']
    : ['発射間隔', '発射速度', '発射間', 'クールタイム', '照射時間']);

  /** 발사간격(초/발). 「N秒」 또는 「N発/分」(RPM). 못 읽으면 0. */
  function shotInterval(w, d) {
    const src = wField(d, w.info || {}, ...intervalFields(w)) || '';
    const rpm = String(src).match(/([\d.]+)\s*発\s*[\/／]\s*分/);
    if (rpm && Number(rpm[1])) return 60 / Number(rpm[1]);
    const sec = String(src).match(/([\d.]+)\s*秒/);
    return sec ? Number(sec[1]) : 0;
  }
  /** 탄창(연속 발사 가능 수) — 실탄 弾数, 없으면 E팩/OH 의 「N発OH」. */
  function magazineOf(w, d) {
    const a = (d && d.raw && d.raw['弾数']) || (w.info && w.info['弾数']);
    let m = a && String(a).match(/(\d+)/);
    if (m) return Number(m[1]);
    const oh = w.info && w.info['OHまでの弾数'];
    m = oh && String(oh).match(/(\d+)\s*発/);
    return m ? Number(m[1]) : 0;
  }
  /** 리로드/OH복귀 초. */
  function reloadSecOf(w, d) {
    const r = (d && d.raw && d.raw['リロード時間'])
      || (w.info && (w.info['リロード時間'] || w.info['OH復帰時間'] || w.info['OH復帰速度']));
    const m = r && String(r).match(/([\d.]+)\s*秒/);
    return m ? Number(m[1]) : 0;
  }
  /** 위력 칸에 DPS 서브라인을 붙인다. 사격 무장만(격투 연격·실드·조사는 제외). */
  function appendDps(cell, w, d, m) {
    if (!d || !d.power) return;                 // 위력 0(센서·연막 등 유틸)은 DPS 없음
    if (w.type === 'shield' || w.type === 'melee' || w.attr === 'melee') return;
    if (/最大\s*\d+\s*ヒット|照射/.test((w.info && w.info['備考']) || '')) return;   // 조사류 제외
    const t = shotInterval(w, d);
    if (!t) return;
    const hits = m ? m.n : 1;
    const per = d.power * hits;                 // 1트리거(전탄) 피해
    const burst = per / t;
    const mag = magazineOf(w, d), reload = reloadSecOf(w, d);
    const sustained = (mag && reload) ? (per * mag) / (mag * t + reload) : burst;
    // 번개는 자동 구성 전용이다(사용자 결정 2026-10-15) — DPS 는 글자만.
    const sub = el('span', 'w-sub w-dps', 'DPS ' + Math.round(sustained).toLocaleString());
    // 소이 등 고정 피해는 DPS 에 넣지 않는다. 이 무장들은 0.15~0.3초 간격으로 쏘는데
    // 소이는 몇 초에 걸쳐 들어가, 트리거마다 더하면 실제보다 몇 배로 부풀려진다.
    // 겹치는지 갱신되는지가 자료에 없어 추정으로 숫자를 만들지 않고, 빠졌다는 사실만 밝힌다.
    // (한 발당 총 피해는 「위력순」 정렬에 반영돼 있고, 무장 표에 별도 줄로도 나온다)
    const fxDps = fixedDamageWithParts(w, state.equipped);
    sub.title = `순간 ${Math.round(burst).toLocaleString()} · 지속 ${Math.round(sustained).toLocaleString()}`
      + (mag && reload ? ` (탄창 ${mag}발 · ${+t.toFixed(2)}초/발 · 리로드 ${reload}초)` : ` (${+t.toFixed(2)}초/발)`)
      + ' · 기본 위력 기준(파츠·스킬 미반영)'
      + (fxDps ? `\n※ 고정 피해 ${fxDps.total.toLocaleString()} 는 DPS 에 안 들어간다 —`
        + `\n   연사 간격보다 지속이 길어 겹침·갱신 여부가 자료에 없다.` : '');
    cell.append(sub);
  }

  /**
   * 무장 한 발의 최종 피해 — 보정 → 자세·스코프 → 파츠 % → 스킬 %.
   * 무장 표·PNG 카드·정렬이 모두 이 함수를 쓴다. 예전엔 같은 계산이 세 곳에 따로 있어
   * 카드가 피해경감을 빼먹거나 정렬이 파츠를 통째로 무시하는 식으로 조용히 어긋났다.
   * @param {number|null} base 무장 표의 위력(논차지·집속)
   * @param {number} corr 사격/격투 보정
   * @param {object} wm D.weaponModsOf 결과
   * @param {number[]} [pcts] 곱연산으로 따로 얹을 피해 %(스킬 몫)
   * @param {number} [etc] 자세·스코프 등 ETCa
   */
  function weaponHitDamage(w, base, corr, wm, pcts, etc) {
    if (base == null) return null;
    // 실드(태클 등)의 피해는 고정 — 사격·격투 보정을 받지 않는다
    if (w.attr === 'shield' || w.type === 'shield') return base;
    const kind = (w.attr === 'melee' || w.type === 'melee') ? 'melee' : 'shoot';
    const raw = w.type === 'melee'
      ? D.meleeDamage(base, corr, { etcA: etc || 0 })
      : D.shootingDamage(base, corr, { etcA: etc || 0 });
    return D.applyDamagePct(raw, [D.damagePctFor(wm, w, kind), ...(pcts || [])]);
  }

  /** 무장 정렬 키 — 위력(전탄)·지속DPS·누적치. 값이 클수록 앞에 온다.
   *  ctx 를 주면 표에 **보이는 값**(파츠·스킬·자세 반영)으로 줄을 세운다. 예전엔 늘 기본 위력으로
   *  세워서, 실탄만 올려 주는 파츠를 끼우면 화면에 2,439 가 2,845 위에 놓이는 일이 있었다. */
  function weaponSortKey(w, metric, ctx) {
    const lv = weaponLevel(w), d = lv ? w.levels[lv] : null;
    if (!d) return -1;
    const mult = fireMult(w);
    const pellets = (mult.nc && mult.nc.n) || (mult.ch && mult.ch.n) || 1;
    if (metric === 'stagger') { const s = parseStagger(w); return (s.pct || 0) * (s.pellets || 1); }
    // 소이 등 고정 피해는 위력과 별개로 더 들어간다. 이걸 빼면 소이 무장이 실제보다
    // 약한 것으로 정렬돼 뒤로 밀린다(견부11연장 미사일[소이]은 고정 2,250 이 통째로 빠졌다).
    const fxSort = ctx ? fixedDamageWithParts(w, state.equipped) : fixedDamageOf(w);
    const hit = base => {
      if (base == null) return 0;
      if (!ctx) return base;
      const kind = (w.attr === 'melee' || w.type === 'melee') ? 'melee' : 'shoot';
      return weaponHitDamage(w, base, ctx.corr[kind], ctx.wm, ctx.skPcts(kind), ctx.etc(w)) || 0;
    };
    const power = Math.max(hit(d.power), hit(d.powerCharged)) * pellets + (fxSort ? fxSort.total : 0);
    if (metric === 'power') return power;
    if (metric === 'dps') {
      if (w.type === 'shield' || w.type === 'melee' || w.attr === 'melee') return 0;
      const t = shotInterval(w, d);
      if (!t) return 0;
      const per = (d.power || 0) * pellets;
      const mag = magazineOf(w, d), reload = reloadSecOf(w, d);
      return (mag && reload) ? (per * mag) / (mag * t + reload) : per / t;
    }
    return 0;
  }

  // 어느 상태의 무장을 볼지. 'all'(통상+변형) · 'normal' · 'alt'.
  // 보여 줄 줄을 고르는 값일 뿐이라 기체가 바뀌어도 그대로 둔다.
  let weaponMode = 'all';

  /* ---------- 무장의 상태(통상 / 변형·변신 …) ----------
     위키는 무장 備考 맨 앞에 ＜通常時＞·＜変形時＞·＜通常時/変形時＞ 처럼 적어 둔다.
     3,787종 중 392종(66기체)이 그렇고, 표기가 없는 무장은 어느 상태에서나 쓴다.
     같은 무장의 수치가 상태마다 달라지는 것이 아니라 **쓸 수 있느냐**의 문제라,
     보여 줄 줄을 고르는 필터로 충분하다 — 성능·스킬 쪽 모드와 값이 어긋날 일이 없다. */
  const W_MODE_RE = /^\s*[＜<]([^＞>]+)[＞>]/;
  function weaponModeOf(w) {
    const note = String((w.info && w.info['備考']) || '');
    const m = W_MODE_RE.exec(note);
    if (!m) return null;                       // 상태를 안 가리는 무장
    const parts = m[1].replace(/使用可$/, '').split(/[/／]/).map(x => x.trim()).filter(Boolean);
    return {
      normal: parts.some(x => /^通常/.test(x)),
      alt: parts.some(x => !/^通常/.test(x)),
      label: parts.map(x => SKILL_MODE_KO[x] || x.replace(/時$/, '')).join('/')
    };
  }
  /** 이 기체에 상태를 가리는 무장이 하나라도 있는가 — 없으면 칩을 띄울 이유가 없다. */
  const hasWeaponModes = list => (list || []).some(w => weaponModeOf(w));
  /** 지금 고른 상태에서 보여 줄 무장인가. 'all' 은 통상+변형을 합친 것이다. */
  function weaponInMode(w, mode) {
    if (mode === 'all') return true;
    const md = weaponModeOf(w);
    if (!md) return true;                      // 표기 없는 무장은 어느 쪽에서나 보인다
    return mode === 'normal' ? md.normal : md.alt;
  }
  /**
   * 「모든 상태 / 통상 / 변형 시」 칩을 그린다. 무장 표와 기체 정보가 같은 것을 쓴다.
   * @param {Element} box  칩을 담을 자리
   * @param {object} ms    기체 (라벨을 이 기체의 모드 이름으로 정한다)
   * @param {object[]} list 무장 목록
   * @param {string} cur   지금 고른 값
   * @param {(v:string)=>void} onPick
   */
  function renderWeaponModeSeg(box, ms, list, cur, onPick) {
    if (!box) return;
    box.innerHTML = '';
    const alt = altModeOf(ms);
    // 모드가 없거나, 상태를 가리는 무장이 없으면 고를 것이 없다.
    if (!alt || !hasWeaponModes(list)) { box.hidden = true; return; }
    box.hidden = false;
    const altLabel = /(중|시|후)$/.test(alt.label) ? alt.label : alt.label + ' 시';
    for (const [v, label] of [['all', '모든 상태'], ['normal', '통상'], ['alt', altLabel]]) {
      const b = el('button', 'seg-btn' + (cur === v ? ' on' : ''), label);
      b.onclick = () => onPick(v);
      box.append(b);
    }
  }

  /* ---------- 모드(변형·시스템발동 등) ---------- */
  // 変形(msData 변형 스탯)뿐 아니라, 変形 스탯이 없는 트랜잠(システム発動中) 기체도
  // override 의 _altMode(그 모드 스탯 절대값)로 통상/그 모드를 전환한다. 무장은 나누지 않는다.
  function altModeOf(ms) {
    if (!ms) return null;
    // 스킬 데이터에 통상 외 모드가 있으면 그 이름을 라벨로 쓴다(NT-D 계열은 '변신'이라 '변형'이 어색).
    const alt = (msSkillsData[baseName(ms.MS名)] || []).find(isAltSkillMode);
    if (C.hasTransform(ms)) return { key: (alt && alt.mode) || '変形時', label: (alt && SKILL_MODE_KO[alt.mode]) || '변형' };
    if (ms._altMode) return { key: ms._altMode.mode, label: ms._altMode.label };
    return null;
  }

  function renderWeapons() {
    const box = $('#weaponList');
    box.innerHTML = '';
    const all = msWeapons();
    // 「모든 상태」가 기본이다 — 통상+변형을 합쳐 보여 준다.
    renderWeaponModeSeg($('#weaponMode'), state.ms, all, weaponMode, v => {
      weaponMode = v;
      renderWeapons();
    });
    renderWeaponLvSeg();
    const list0 = all.filter(w => weaponInMode(w, weaponMode));
    $('#weaponCount').textContent = all.length
      ? (list0.length === all.length ? `${all.length}종` : `${list0.length} / ${all.length}종`)
      : '';

    if (!list0.length) {
      box.append(el('div', 'empty-state', wikiPending(state.ms) ? WIKI_PENDING_TXT : '이 기체의 무장 정보가 없습니다.'));
      return;
    }

    const r = stats();
    // 사격 무기는 사격 보정, 격투 무기는 격투 보정을 쓴다.
    // 단 부메랑·인컴·투척 소드처럼 "격투 판정" 사격무장(attr==melee)은 위력이 격투 보정을 받는다.
    const corr = { shooting: r.total.shoot, melee: r.total.meleeCorrection };
    const dmgKey = w => (w.attr === 'melee' || w.type === 'melee') ? 'melee' : 'shooting';
    // 스킬을 뺀 값도 함께 구해, 스킬로 늘어난 위력만 따로 보여 준다
    const sk = skillEffect();
    const bare = sk ? stats(null) : null;
    const corrBare = bare ? { shooting: bare.total.shoot, melee: bare.total.meleeCorrection } : corr;
    const sCls = skillCls();
    // 무장에 붙는 파츠 보정 (집속·리로드·OH·피해 %·실드 HP).
    // 효과마다 걸리는 무장 범위가 달라 무장별로 다시 뽑아 쓴다.
    const wm = D.weaponModsOf(C.partsAt(state.equipped, state.lateMode), state.ms ? msLevel(state.ms) : 1,
      state.ms && state.ms.属性, state.expansion);
    // 오버로드류 스킬을 쓴 뒤 무장 OH 가 2배가 되는 기체인가 (기체당 한 번만 판정)
    const ohX2 = weaponOhX2Of(state.ms, state.ms ? msLevel(state.ms) : 1);

    // 자세·스코프 보정 — 사격 판정 무장에만 (격투 판정이면 attr==melee 라 제외), (1+etcA) 로 곱해진다
    const postureEtcA = w => {
      if (dmgKey(w) === 'melee') return 0;
      let e = 0;
      if (state.posture === 'crouch') e += D.ETC_ATTACK.crouch;
      else if (state.posture === 'prone') e += D.ETC_ATTACK.prone;
      if (state.scope) e += D.ETC_ATTACK.scope;
      return e;
    };
    // 고정밀 포격 스킬 — 앉기·정지에서만 사격 피해 +N% (스킬 몫이라 보라로 나온다)
    const skEtcOf = w => (dmgKey(w) === 'shooting' && sk && sk.crouchPct && state.posture === 'crouch')
      ? sk.crouchPct / 100 : 0;

    // 정렬은 보정·파츠·스킬이 다 정해진 뒤에 한다 — 표에 **보이는 값**으로 줄을 세우기 위해서다
    const sortCtx = {
      corr: { shoot: corr.shooting, melee: corr.melee },
      wm,
      skPcts: kind => skillDmgPctList(kind),
      etc: w => postureEtcA(w) + skEtcOf(w)
    };
    const list = (state.weaponSort && state.weaponSort !== 'default')
      ? [...list0].sort((a, b) => weaponSortKey(b, state.weaponSort, sortCtx) - weaponSortKey(a, state.weaponSort, sortCtx))
      : list0;

    for (const w of list) {
      const lv = weaponLevel(w);
      const d = lv ? w.levels[lv] : null;
      if (!d) continue;

      const info = w.info || {};
      const mods = w.mods || {};
      const note = info['備考'] || '';
      const f = (...names) => wField(d, info, ...names);
      const a = corr[dmgKey(w)] || 0;
      const aBare = corrBare[dmgKey(w)] || 0;

      // 집속 링·화기 관제는 「ビーム射撃兵装」만 줄여 준다 — 격투 무장의 집속은 절댓값이다
      const chargeCut = mods.chargeTime && w.type === 'shooting' ? D.timeCutFor(wm, 'chargeTime', w) : 0;
      const chargeSec = mods.chargeTime ? D.shortenTime(mods.chargeTime, chargeCut) + '초' : '';
      const mustCharge = /集束必須/.test(note);

      const row = el('div', 'weapon');
      row.dataset.name = w.name;

      // ① 구분
      const mainSec = mainSectionOf(state.ms);
      row.append(el('span', 'w-sec' + (w.section === mainSec ? ' main' : ''),
        w.type === 'shield' ? '실드'
          : w.section === mainSec ? '주무장' : w.section === '副兵装' ? '부무장' : '기타'));

      // ② 이름 (격투/사격 점으로 구분)
      const mult = fireMult(w);              // 조사·산탄·동시발사 배수 (모드별)
      // 이름 칸은 두 줄이다 — 윗줄에 이름, 아랫줄에 고정 피해.
      // 한 줄에 다 붙이면 이름이 밀려 잘린다(소이 무장은 표기가 길다).
      const nm = el('span', 'w-nm');
      const nmTop = el('span', 'w-nm-top');
      nmTop.append(el('i', 'w-dot ' + w.type));
      nmTop.append(document.createTextNode(T.weaponName(w.name)));
      // 이름 옆 칩: 두 모드가 같으면 하나, 다르면 있는 쪽 (각 칸의 '전탄'이 정확히 보여 준다)
      const chip = (mult.nc && mult.ch && mult.nc.n === mult.ch.n) ? mult.nc : (mult.nc || mult.ch);
      if (chip) {
        const mc = el('span', 'w-mult', chip.label);
        /* 동시 발사 아이콘은 「N발 동시」 에만 — 같은 칸에 「최대 19히트」 · 「4발 ×4연사」 도 온다.
           히트에 붙이면 뜻이 틀리고, 연사에 붙이면 좁은 표(이름 칸 106px)에서 칩이 잘렸다(wsticky_check). */
        if (/발 동시/.test(chip.label)) ICON.prepend(mc, 'dual');
        nmTop.append(mc);
      }
      nm.append(nmTop);
      // 고정 피해(소이 등) — 위력과 별개로 더해지는 몫이라 안 보여 주면 무장이 실제보다 약해 보인다.
      // 소이는 한 방에 들어가지 않고 1틱씩 나눠 들어가므로 「1틱×히트 = 합계」 로 적는다.
      const fx = fixedDamageWithParts(w, state.equipped);
      if (fx) {
        const hitTx = fx.ranged ? fx.hits + '~' + fx.hitsMax : String(fx.hits);
        const totTx = fx.ranged
          ? fx.total.toLocaleString() + '~' + fx.totalMax.toLocaleString()
          : fx.total.toLocaleString();
        const sub = el('span', 'w-nm-sub');
        const c = el('span', 'w-fixed', fx.hitsMax > 1
          ? '고정 ' + fx.per.toLocaleString() + '×' + hitTx + ' = ' + totTx
          : '고정 ' + totTx);
        if (fx.boosted) c.append(el('i', 'w-fixed-up', ' +' + (fx.total - fx.base.total).toLocaleString()));
        c.title = `명중 후 고정 피해 ${totTx} (${fx.per}×${hitTx}히트)\n`
          + '보정을 받지 않는 고정값이라 위력 칸과 별도로 들어간다.'
          + (fx.boosted ? `\n\n파츠 미장착 시 ${fx.base.total.toLocaleString()} (${fx.base.per}×${fx.base.hits}히트)` : '')
          + (fx.measured ? `\n\n※ 위키에 실제로 재 본 값이 있어 그대로 썼다(5891 실측표).` : '')
          + (fx.ranged
            ? `\n\n※ 히트 수가 두 값에 걸친다. 게임은 지속시간을 틱 간격으로 나눠 내림하는데`
              + `\n   (히트 = floor(지속÷간격)+1), 무장별 지속시간이 위키에 없어 어느 쪽인지`
              + `\n   확정할 수 없다. 위키 실측 36건이 이 범위 안에 전부 들어온다.`
            : '');
        sub.append(c);
        nm.append(sub);
      }
      for (const d of debuffsOf(w)) {
        const c = el('span', 'w-debuff', d);
        c.title = '이 무장이 거는 디버프 — 효과량이 위키에 수치로 없어 표시만 한다.';
        nmTop.append(c);
      }
      /* 실드 보정 — 「실드로 막음」 을 켠 동안만 붙인다(뜻은 그대로다).
         스위치가 피탄 화면에서 **대결 화면**으로 옮겨졌으니 켜짐도 그쪽에서 받는다
         (duel.js 가 토글할 때 HOOK.onShield 로 알려 준다).
         표기가 아예 없는 무장(2,666종)엔 칩을 안 붙여 목록이 지저분해지지 않게 한다. */
      if (showShieldMult) {
        const sm = D.shieldMultOf(w);
        if (sm) {
          const txt = sm.unknown ? '?' : (sm.nc === sm.ch ? sm.nc : sm.nc + '→' + sm.ch) + '배';
          const lvl = sm.unknown ? '' : (sm.nc >= 1.2 ? ' hi' : sm.nc < 1 ? ' lo' : '');
          const c = el('span', 'w-shield' + lvl, '🛡' + txt);   // 윗줄(이름 옆)
          c.title = sm.unknown
            ? '실드 보정이 위키 미확인(？倍)이라 실드 계산을 하지 않는다.'
            : '실드에 맞았을 때 배율 — 실드 피해 = 기체에 줄 피해 × ' + sm.nc + '배'
              + (sm.nc !== sm.ch ? '\n집속 시 ' + sm.ch + '배' : '')
              + '\n실드로 받은 공격은 기체 HP 피해를 막는다(위키 83).';
          nmTop.append(c);
        }
      }
      nm.title = w.name;
      row.append(nm);

      // ②-b 무장 유형 (실탄/빔/격투/실드/기타) — 위키 무장표 속성과 동일
      const at = weaponAttr(w);
      const tyEl = el('span', 'w-type type-' + at, ATTR_LABEL[at]);
      ICON.prepend(tyEl, ICON.ATTR[at]);
      row.append(tyEl);

      /** 위력 한 칸 — 기본값 · 파츠 보정분(초록) · 스킬 발동분(보라). m: 이 칸(논차지/풀차지)의 동시발사 배수 */
      const dmgCell = (base, m) => {
        const cell = el('span', 'w-dmg');
        if (base == null) { cell.textContent = '—'; cell.classList.add('w-none'); return cell; }
        // 실드(태클 등)의 피해는 고정피해 — 격투·사격 보정을 받지 않는다
        if (w.attr === 'shield' || w.type === 'shield') {
          cell.textContent = base.toLocaleString();
          return cell;
        }
        const kind = dmgKey(w) === 'melee' ? 'melee' : 'shoot';   // 격투 판정이면 격투 피해 % 적용
        const baseEtc = postureEtcA(w);         // 자세·스코프 (스킬과 무관, 초록에 포함)
        const skEtc = skEtcOf(w);               // 고정밀 포격 (스킬 몫)
        // 파츠 %는 weaponHitDamage 안에서, 스킬 %는 곱연산으로 따로 얹는다
        const withoutSkill = weaponHitDamage(w, base, aBare, wm, [], baseEtc);
        const withSkill = weaponHitDamage(w, base, a, wm, skillDmgPctList(kind), baseEtc + skEtc);
        const gain = withoutSkill - base;
        const skillGain = withSkill - withoutSkill;

        cell.append(document.createTextNode(base.toLocaleString()));
        // 특화 프로그램은 반대쪽 무장을 깎으므로 감소분도 보여 준다
        if (gain) cell.append(el('span', gain > 0 ? 'w-gain' : 'w-loss',
          ' (' + (gain > 0 ? '+' : '') + gain.toLocaleString() + ')'));
        if (skillGain) cell.append(el('span', 's-gain' + sCls,
          ' (' + (skillGain > 0 ? '+' : '') + skillGain.toLocaleString() + ')'));
        // 조사·산탄·동시발사: 전탄(전히트) 명중 시 총 피해 = 1발 피해 × 배수.
        // 1발 칸과 같은 방식으로 — 기본×배수 · 파츠분(초록) · 스킬분(보라) 을 각각 표기한다.
        if (m) {
          const n = m.n;
          const sub = el('span', 'w-sub');
          sub.append(document.createTextNode('전탄 ' + (base * n).toLocaleString() + ' (×' + n + ')'));
          if (gain) sub.append(el('span', gain > 0 ? 'w-gain' : 'w-loss',
            ' (' + (gain > 0 ? '+' : '') + (gain * n).toLocaleString() + ')'));
          if (skillGain) sub.append(el('span', 's-gain' + sCls,
            ' (' + (skillGain > 0 ? '+' : '') + (skillGain * n).toLocaleString() + ')'));
          cell.append(sub);
        }
        return cell;
      };

      // ③ 논차지 · ④ 풀차지 (집속이 없으면 논차지 칸만 채운다) — 칸별 배수를 따로 준다
      const ncCell = dmgCell(d.power, mult.nc);
      appendDps(ncCell, w, d, mult.nc);          // 논차지 위력 아래 DPS 서브라인
      row.append(ncCell);
      const full = dmgCell(d.powerCharged, mult.ch);
      if (d.powerCharged != null && chargeSec) {
        full.append(el('span', 'w-sub', (mustCharge ? '필수 ' : '') + chargeSec
          + (chargeCut ? ' (-' + chargeCut + '%)' : '')));
      }
      row.append(full);

      // ⑤ 쿨타임 — 격투는 クールタイム, 사격은 같은 자리에 발사 간격을 보여 준다
      //    (위키가 「発射 間隔」처럼 공백을 넣기도 해 표기 변형을 모두 받는다)
      //    조사(照射) 무장은 두 항목이 다 없어 조사 시간으로 대신한다
      //    항목 순서는 DPS 계산(shotInterval)과 같은 목록을 쓴다
      row.append(el('span', 'w-col', jaUnits(f(...intervalFields(w)) || '—')));

      // ⑥ 탄 / 히트율 — 실탄은 탄수, 열무기는 히트율, 실드는 HP·크기
      // E팩 탄창식 빔(히트율 없이 OH復帰만)은 OHまでの弾数 가 곧 탄창 크기다.
      const ammo = f('弾数');
      const heat = f('ヒート率', 'ヒート率/フル', 'ヒート率/ノン');
      const ohShots = f('OHまでの弾数');
      const isEpack = D.isEpackMag(w);
      const shieldHp = f('シールドHP', 'HP'), shieldSize = f('サイズ');
      const ammoCell = el('span', 'w-col');
      if (shieldHp || shieldSize) {                       // 실드는 HP·크기가 핵심이다
        // 실드 보강재·커넥팅[범용Ⅱ형]은 실드 HP 를 올려 준다
        const base = Number(shieldHp) || 0;
        const bonus = shieldHp ? shieldHpBonus(wm, state.equipped, state.expansion, state.expLevel) : 0;
        ammoCell.append(document.createTextNode(shieldHp ? 'HP ' + (base + bonus).toLocaleString() : '—'));
        if (bonus) ammoCell.append(el('span', 'w-gain', ' (+' + bonus.toLocaleString() + ')'));
        if (shieldSize) ammoCell.append(el('span', 'w-sub', '크기 ' + shieldSize));
      } else if (ammo) ammoCell.append(document.createTextNode(jaUnits(ammo)));
      else if (isEpack && ohShots) {                      // E팩 탄창: 「6発OH」→ 탄수 6발
        const mag = String(ohShots).match(/(\d+)\s*発/);
        ammoCell.append(document.createTextNode(mag ? mag[1] + '발' : jaUnits(ohShots)));
      } else if (heat) {
        ammoCell.append(document.createTextNode(heat));
        if (ohShots) ammoCell.append(el('span', 'w-sub', jaUnits(ohShots)));
      } else ammoCell.textContent = '—';
      row.append(ammoCell);

      // ⑥ 누적치 (よろけ値)
      row.append(el('span', 'w-col', mods.stagger ? staggerKo(mods.stagger) : '—'));

      // ⑦ 사거리
      row.append(el('span', 'w-col', f('射程') || '—'));

      // ⑧ 리로드 / OH복귀 — 파츠로 줄어드는 만큼을 함께 보여 준다
      const reload = f('リロード時間');
      const ohBack = f('OH復帰時間', 'OH復帰速度');
      const last = el('span', 'w-col w-reload');   // 위치가 아니라 이름으로 찾게 한다(검사 도구가 쓴다)
      if (reload) {
        // 퀵 로더·대용량 보급 팩은 무장 종류를 가리지 않는다
        const cut = D.timeCutFor(wm, 'reloadTime', w);
        last.append(document.createTextNode(jaUnits(D.shortenTimeText(reload, cut))));
        if (cut) last.append(el('span', 'w-gain', ' (-' + cut + '%)'));
      } else if (ohBack) {
        // E팩 탄창식 빔은 OH 가 아니라 리로드 — 리로드 파츠(퀵로더 등)로 줄고 '리로드'로 표기한다.
        // 진짜 열무기만: 보조 제네레이터(빔)·대용량 보급 팩(전 무장)이 OH 복귀를 줄인다(슬러스터 OH 와 별개).
        const cut = D.timeCutFor(wm, isEpack ? 'reloadTime' : 'weaponOH', w);
        last.append(document.createTextNode(jaUnits(D.shortenTimeText(ohBack, cut))));
        if (cut) last.append(el('span', 'w-gain', ' (-' + cut + '%)'));
        last.append(el('span', 'w-sub', isEpack ? '리로드' : 'OH복귀'));
        // 오버로드·사이코뮤 증폭장치를 쓴 뒤에는 이 값이 2배가 된다. 발동 중에만 걸리는
        // 사후 대가라 표의 값을 갈아치우지 않고, 슬러스터 OH 처럼 옆에 따로 적는다.
        // (E팩 탄창식 빔은 「残弾式ビーム兵装非対応」 — 여기선 애초에 '리로드'로 나온다)
        if (!isEpack && ohX2 && (!ohX2.psycommuOnly || w.psycommu)) {
          const n = Number((String(ohBack).match(/([\d.]+)/) || [])[1]);
          const x2 = n ? Math.round(D.shortenTime(n, cut) * 2 * 10) / 10 : null;
          const tag = el('span', 'w-sub w-ohx2', ohX2.ko + ' 후 ' + (x2 != null ? x2 + '초' : '×2'));
          tag.title = ohX2.ko + ' 효과가 끝난 직후에는 이 무장의 OH 복귀가 2배가 됩니다.'
            + '\n(스킬 설명의 「효과 종료 후, 대상의 전 무장은 2배의 OH 복귀 시간이 발생」)'
            + (cut ? '\n※ 파츠 단축을 적용한 값의 2배로 적었습니다 — 단축이 이 2배에도 걸리는지는 자료에 없습니다.' : '');
          last.append(tag);
        }
      } else last.textContent = '—';
      row.append(last);

      // 누르면 위키 설명 전체를 펼친다
      row.onclick = () => toggleWeaponDetail(row, w, d, lv);
      box.append(row);
      // 파츠를 갈아 끼우면 목록을 다시 그리므로, 펼쳐 둔 무장은 여기서 되살린다
      if (state.openWeapons.includes(w.name)) openWeaponDetail(row, w, d, lv);
    }
    applyWeaponFold();
    markWeaponScroll();
  }

  /** 무장표가 가로로 넘치는가를 재서 표시를 켠다.
   *
   *  왜 재서 켜나 — 칸이 열 개라 좁은 화면에서만 넘친다(실측: 데스크톱 1500px·폰가로는 0,
   *  폰세로만 320px 넘침). 늘 켜 두면 안 넘치는 화면에도 그림자가 남아 군더더기가 된다.
   *  넘칠 때만 이름 칸을 왼쪽에 붙여, 옆으로 밀어도 **어느 무장 줄인지 잃지 않게** 한다. */
  let weaponScrollObs = null;
  function markWeaponScroll() {
    const box = $('#weaponList');
    if (!box) return;
    /* **넘치는 주체가 목록이 아닐 수 있다.**
       「크게 보기」에서는 무장표가 아래 시트(.build-weapons)에 담기는데, 목록 자체는
       1,120px 로 늘어나고 **시트가** 367px 만 보여 준다(넘침 771px — 넓게 보기의 두 배).
       목록만 재면 1,120/1,120 으로 「안 넘친다」가 나와, 크게 보기에서는 이름 고정이
       **아예 안 걸렸다**(사용자가 「여전히 불편」이라 한 것이 이것이다).
       그래서 위로 올라가며 **진짜 가로로 스크롤하는 조상**을 찾는다. */
    let n = box, over = false;
    while (n && n !== document.documentElement) {
      if (n.scrollWidth > n.clientWidth + 2) { over = true; break; }   // 2px 여유 — 반올림
      n = n.parentElement;
    }
    box.classList.toggle('can-x', over);

    /* 그리는 순간 한 번 재는 것으로는 안 된다 — 그때는 아직 최종 배치가 아니다
       (무장 칸이 접혀 있거나 화면이 아직 안 보이면 폭이 0 이라 「안 넘친다」로 나온다).
       실제로 그렇게 재서 폰 세로에서 320px 이 넘치는데도 표시가 안 켜졌다.
       크기가 바뀌는 **모든 순간**(펼치기·회전·패널 열림)에 다시 재도록 한 번만 달아 둔다.
       붙이는 것은 칸의 위치일 뿐 상자 크기를 바꾸지 않으므로 되먹임이 생기지 않는다. */
    if (!weaponScrollObs && window.ResizeObserver) {
      // 판정을 여기 **다시 적지 않는다** — 한쪽만 고치면 갈린다.
      // 실제로 그렇게 갈려, 스크롤 주체를 찾도록 고쳤는데도 크게 보기에서 안 켜졌다.
      weaponScrollObs = new ResizeObserver(() => markWeaponScroll());
      weaponScrollObs.observe(box);
    }
  }

  /** 무장 표의 열 이름을 한글로. 없는 이름은 원문을 그대로 쓴다. */
  const WCOL_LABEL = {
    '射程': '사거리', '弾数': '탄수', 'リロード時間': '리로드 시간', 'クールタイム': '쿨타임',
    'ヒート率': '히트율', 'ヒート率/ノン': '히트율(논차지)', 'ヒート率/フル': '히트율(풀차지)',
    'OHまでの弾数': 'OH까지 발수', 'OH復帰時間': 'OH 복귀 시간', 'OH復帰速度': 'OH 복귀 속도',
    '発射間隔': '발사 간격', '発射速度': '발사 속도', '切替時間': '전환 시간', '武装切替': '무장 전환',
    'DPS': 'DPS', 'HP': 'HP', 'シールドHP': '실드 HP', 'サイズ': '크기', 'リペア': '리페어(회복)'
  };
  const wcol = k => WCOL_LABEL[String(k).replace(/\s+/g, '')] || k;

  /**
   * 위키 설명문에 자주 나오는 표현을 한글로 바꾼다.
   * 사전에 없는 표현은 원문 그대로 두어 정보가 사라지지 않게 한다.
   */
  const NOTE_TERM = [
    // 사격 조건
    ['ジャンプ射撃可', '점프사격 가능'], ['ブースト射撃可', '부스트사격 가능'],
    ['空中射撃可', '공중사격 가능'], ['伏せ射撃可', '엎드려사격 가능'],
    ['移動射撃可能', '이동사격 가능'], ['移動射撃可', '이동사격 가능'],
    ['射撃時静止', '사격 시 정지'], ['水中時使用不可', '수중에서 사용 불가'],
    ['空中格闘制御', '공중격투 제어'], ['連撃不可', '연격 불가'], ['射出可', '사출 가능'],
    ['使用可', '사용 가능'], ['使用不可', '사용 불가'],
    // 집속
    ['集束時よろけ有', '집속 시 비틀 있음'], ['集束時ユニット貫通効果付与', '집속 시 유닛관통 부여'],
    ['集束中移動可', '집속 중 이동 가능'], ['集束必須', '집속 필수'], ['集束可', '집속 가능'],
    ['非集束時', '비집속 시'], ['集束時間', '집속 시간'], ['集束時', '집속 시'],
    // 상태 이상·효과
    ['大よろけ有', '대비틀 있음'], ['よろけ有', '비틀 있음'], ['ひるみ有', '움찔 있음'],
    ['ユニット貫通効果有', '유닛관통 있음'], ['爆風範囲有', '폭풍범위 있음'],
    ['照射攻撃', '조사공격'], ['妨害効果付与', '방해효과 부여'], ['照準誘導効果有', '조준유도 있음'],
    ['よろけ値', '누적치'], ['非集束', '비집속'],
    // 발사 방식
    ['二発同時発射', '2발 동시발사'], ['発同時発射', '발 동시발사'],
    ['発連続発射', '발 연속발사'], ['左右交互発射', '좌우 교대발사'],
    ['即撃ち', '즉시발사'], ['秒間', '초간'], ['回攻撃', '회 공격'],
    ['パック式弾数所持', '팩식 탄수 보유'], ['秒長押しでロックオン', '초 길게 눌러 록온'],
    ['高速移動中にロックオン', '고속이동 중 록온'], ['命中後', '명중 후'],
    // 보정
    ['局部補正', '국부 보정'], ['シールド補正', '실드 보정'], ['拠点補正', '거점 보정'],
    ['頭部・背部補正', '두부·배부 보정'], ['脚部・背部補正', '각부·배부 보정'],
    ['頭部補正', '두부 보정'], ['脚部補正', '각부 보정'], ['背部補正', '배부 보정'],
    ['耐ビーム補正', '내빔 보정'], ['耐実弾補正', '내실탄 보정'], ['耐格闘補正', '내격투 보정'],
    ['自動照準補正', '자동조준보정'],

    // 위키 備考 상용구
    ['格闘方向に関わらず強制ダウン', '격투 방향에 관계없이 강제 다운'],
    ['格闘方向によらず強制ダウン', '격투 방향에 관계없이 강제 다운'],
    ['かつ小数点以下切り捨てで計算', '이며 소수점 이하 버림으로 계산'],
    ['小数点以下切り捨て', '소수점 이하 버림'], ['自身のみが視認', '자신만 시인'],
    ['命中対象に炎上デバフ', '명중 대상에 화상 디버프'], ['炎上デバフ', '화상 디버프'],
    ['吹き飛ばしダウン', '날려버림 다운'], ['強制ダウン', '강제 다운'],
    ['ボタン押下で', '버튼을 눌러'], ['ボタンで任意解除', '버튼으로 임의 해제'],
    ['任意解除', '임의 해제'], ['使用後', '사용 후'], ['無効化', '무효화'],
    ['特殊緩衝材', '특수완충재'], ['特殊偽装', '특수위장'], ['阿頼耶識', '아라야식'],
    ['高速移動', '고속이동'], ['ブースト移動', '부스트 이동'], ['連動射撃', '연동사격'],
    ['高速機動射撃', '고속기동사격'], ['格闘優先度', '격투 우선도'], ['連撃補正', '연격 보정'],
    ['防御力上昇', '방어력 상승'], ['スピード低下', '스피드 저하'],
    ['レーダー阻害', '레이더 저해'], ['レーダー障害', '레이더 장애'],
    ['ビーム属性', '빔 속성'], ['実弾属性', '실탄 속성'], ['射撃属性', '사격 속성'],
    ['伏せ撃ち', '엎드려 사격'], ['振り回し', '휘두르기'], ['機体後方', '기체 후방'],
    ['着弾点', '착탄점'], ['着弾', '착탄'], ['射出直後', '사출 직후'], ['射出', '사출'],
    ['与ダメージ', '주는 피해'], ['与ダメ', '주는 피해'], ['被ダメ', '받는 피해'],
    ['以上の場合', '이상인 경우'], ['場合', '경우'], ['以上', '이상'], ['以下', '이하'],
    // 외래어
    ['マシンガン', '머신건'], ['ライフル', '라이플'], ['バズーカ', '바주카'],
    ['レーダー', '레이더'], ['スコープ', '스코프'], ['ステルス', '스텔스'],
    ['スポット', '스팟'], ['バースト', '버스트'], ['リアクション', '리액션'],
    ['カウンター', '카운터'], ['バリア', '배리어'], ['デバフ', '디버프'],
    ['ボタン', '버튼'], ['ヘビー', '헤비'], ['ダウン', '다운'], ['リロード', '리로드'],
    // 일반어
    ['不可能', '불가능'], ['不可', '불가'], ['可能', '가능'],
    ['攻撃', '공격'], ['発生', '발생'], ['曲射', '곡사'], ['単発', '단발'],
    ['弾数', '탄수'], ['消費', '소비'], ['持続', '지속'], ['射程', '사거리'],
    ['低減', '저감'], ['出力', '출력'], ['能力', '능력'], ['段階', '단계'],
    ['下格', '하격'], ['横格', '횡격'], ['連続', '연속'], ['維持', '유지'],
    ['累計', '누계'], ['飛行', '비행'], ['味方', '아군'], ['展開', '전개'],
    ['散弾', '산탄'], ['無視', '무시'], ['固定', '고정'], ['共通', '공통'],
    ['時間', '시간'], ['上昇', '상승'], ['追加', '추가'], ['阻害', '저해'],
    ['障害', '장애'], ['押下', '누름'], ['最長', '최장'], ['約', '약'],
    ['直後', '직후'], ['命中', '명중'], ['対象', '대상'], ['計算', '계산'],
    ['自身', '자신'], ['視認', '시인'], ['解除', '해제'], ['使用', '사용'],
    ['移動', '이동'], ['防御', '방어'], ['属性', '속성'], ['優先', '우선'],
    ['補正', '보정'], ['方向', '방향'], ['機体', '기체'], ['後方', '후방'],
    ['無効', '무효'], ['偽装', '위장'], ['緩衝材', '완충재'],
    ['能', '능'], ['改', '카이'], ['強', '강'], ['単', '단'], ['回', '회'],
    ['中', '중'], ['後', '후'], ['前', '전'], ['時', '시'], ['内', '내'],
    ['等', '등'], ['用', '용'], ['非', '비'], ['分', '분'], ['減', '감'],
    ['爆', '폭'], ['腕', '팔'], ['格', '격'], ['射', '사'], ['動', '동'],
    ['生', '생'], ['与', '주는'], ['無', '없음'],
    // 조사 — 남겨 두면 문장이 일본어로 보인다
    ['からの', '으로부터'], ['まで', '까지'], ['から', '부터'], ['ごと', '마다'],
    ['かつ', '이며'], ['など', '등'], ['ため', '위해'],
    ['を', '을'], ['が', '이'], ['は', '는'], ['の', '의'], ['に', '에'],
    ['で', '로'], ['と', '와'], ['や', '나'], ['も', '도'], ['り', ''], ['な', ''],

    ['狙撃', '저격'], ['砲撃', '포격'], ['迎撃', '요격'], ['爆撃', '폭격'],
    ['集束', '집속'], ['ジャンプ', '점프'], ['リミッター', '리미터'],
    ['敵機', '적기'], ['受けた', '받은'], ['入った', '들어간'], ['ずつ', '씩'],
    ['撃', '격'], ['系', '계'], ['点', '점'], ['闘', '투'], ['風', '풍'],
    ['自', '자'], ['空', '공'], ['同', '동'], ['行', '행'],
    // 기타
    ['スキル発動中', '스킬 발동 중'], ['スキル', '스킬'], ['武装', '무장'],
    ['通常時', '통상 시'], ['変形時', '변형 시'], ['変身時', '변신 시'],
    ['は機体', '는 기체'], ['依存', '의존'], ['に付属', '에 부속'], ['対応', '대응'],
    ['ダメージ計算', '피해 계산'], ['対象の', '대상의'], ['付与', '부여'],
    ['装備中', '장비 중'], ['シールドへの被ダメージ', '실드에 받는 피해'],
    ['被ダメージ', '받는 피해'], ['シールド', '실드'], ['ダメージ', '피해'],
    ['ヒット', '히트'], ['アタック', '어택'], ['ロックオン', '록온'],
    ['頭部', '두부'], ['脚部', '각부'], ['背部', '배부'], ['腕部', '완부'],
    ['最大', '최대'], ['倍率', '배율'], ['連射', '연사'], ['貫通', '관통'],
    ['拡張', '확장'], ['短縮', '단축'], ['増加', '증가'], ['軽減', '경감'],
    ['効果', '효과'], ['範囲', '범위'], ['威力', '위력'], ['装備', '장비'],
    ['倍', '배'], ['発', '발'], ['秒', '초'], ['有', '있음'], ['可', '가능']
  ];
  // 짧은 항목이 긴 말을 잘라먹지 않도록 항상 긴 표기부터 치환한다 (「不可」가 「不가능」이 되던 문제)
  const NOTE_SORTED = NOTE_TERM.slice().sort((a, b) => b[0].length - a[0].length);

  // 구두점·기호를 읽기 좋게 정리한다 (MT 결과·하드코딩 폴백 공통).
  // 남은 단위·카운터(초·배·발·회·분·연사·탄)는 한 글자라 안전하게 마지막에 옮긴다.
  const normNote = t => String(t)
    .replace(/秒/g, '초').replace(/倍/g, '배').replace(/発/g, '발').replace(/回/g, '회')
    .replace(/分/g, '분').replace(/射/g, '사').replace(/弾/g, '탄')
    .replace(/・/g, '·').replace(/：/g, ': ').replace(/、/g, ', ')
    .replace(/（/g, ' (').replace(/）/g, ') ')
    .replace(/［/g, ' [').replace(/］/g, '] ')
    .replace(/[「『]/g, ' “').replace(/[」』]/g, '” ')
    .replace(/＋/g, '+').replace(/－/g, '-').replace(/％/g, '%')
    .replace(/\s+/g, ' ')
    .replace(/\s+([),\]:;%·”])/g, '$1')
    .replace(/([(\[“])\s+/g, '$1')
    .replace(/\s*\/\s*/g, ' / ')
    .trim();

  // 온라인 MT 로 번역해 둔 備考 사전 (빌드 시 인라인). 없으면 아래 하드코딩 사전으로 폴백.
  const NOTE_MT = (window.GBO2_I18N && window.GBO2_I18N.weaponNote) || {};
  /** 하드코딩 사전 폴백 — MT 캐시에 없는 備考(오프라인 미번역분)용. */
  const noteFallback = s => {
    let t = String(s).replace(/可能/g, '可');   // 「〜可」와 「〜可能」을 한 표기로 모은다
    for (const [ja, ko] of NOTE_SORTED) t = t.split(ja).join(ja.length > 1 ? ' ' + ko + ' ' : ko);
    return T.weaponTerms(t);
  };
  /** 위키 備考를 한국어로. MT 번역 사전 우선, 없으면 하드코딩 폴백. */
  const noteText = s => (s ? normNote(NOTE_MT[s] != null ? NOTE_MT[s] : noteFallback(s)) : '');

  /** 누를 때마다 펼치거나 접는다. 열어 둔 무장은 state 에 남겨 다시 그려도 유지한다.
   *  여러 개를 한꺼번에 열 수 있다 — 무장끼리 견주려면 하나씩만 열려서는 안 된다. */
  function toggleWeaponDetail(row, w, d, lv) {
    const open = row.nextElementSibling && row.nextElementSibling.classList.contains('weapon-detail');
    if (open) {
      row.nextElementSibling.remove();
      row.classList.remove('open');
      state.openWeapons = state.openWeapons.filter(n => n !== w.name);
    } else {
      if (!state.openWeapons.includes(w.name)) state.openWeapons.push(w.name);
      openWeaponDetail(row, w, d, lv);
    }
  }

  /** 무장 행 아래에 위키의 설명과 표 값을 그대로 펼친다. */
  function openWeaponDetail(row, w, d, lv) {
    row.classList.add('open');
    // 격투 방향별 피해는 **장착 구성**(stats())에 묶여 있어 여기서만 붙는다.
    row.after(weaponDetailBox(w, d, lv, true));
  }

  /**
   * 무장 상세 — 파츠 화면의 무장 표와 기체 정보 칸이 **같은 것**을 쓴다.
   * 따로 만들면 같은 무장을 두 화면이 다르게 설명하게 된다.
   * @param {boolean} withMelee 격투 방향별 피해를 붙일지.
   *   그 표는 지금 장착한 구성의 격투 보정을 쓰므로(stats()), 구성이 없는
   *   기체 정보 칸에서는 붙이지 않는다.
   */
  function weaponDetailBox(w, d, lv, withMelee) {
    const box = el('div', 'weapon-detail');

    const head = el('div', 'wd-head');
    head.append(el('b', '', T.weaponName(w.name)));
    head.append(el('span', 'wd-ja', w.name));
    head.append(el('span', 'wd-tag', 'LV' + lv + ' · '
      + (w.type === 'shield' ? '실드 · 방어'
        : (w.section === '主兵装' ? '주무장' : '부무장') + ' · ' + (w.type === 'melee' ? '격투' : '사격'))));
    box.append(head);

    // 성격별로 묶어 보여 준다 — 한 덩어리로 나열하면 읽기 어렵다
    const groups = [
      ['위력', ['논차지 위력', '풀차지 위력', '집속 시간', '집속 배율', '누적치']],
      ['운용', ['쿨타임', '무장 전환', '전환 시간', '발사 간격', '발사 속도', 'DPS']],
      ['탄약·열', ['탄수', '리로드 시간', '히트율', '히트율(논차지)', '히트율(풀차지)',
        'OH까지 발수', 'OH 복귀 시간', 'OH 복귀 속도']],
      ['방어·보정', ['실드 HP', 'HP', '크기', '사거리', '실드 보정']]
    ];

    // 표시할 값을 한곳에 모은 뒤 그룹으로 나눈다
    const vals = new Map();
    const set = (k, v) => { if (v != null && v !== '' && v !== '-') vals.set(k, jaUnits(String(v))); };
    set('논차지 위력', d.power != null ? d.power.toLocaleString() : null);
    set('풀차지 위력', d.powerCharged != null ? d.powerCharged.toLocaleString() : null);
    for (const [k, v] of Object.entries(d.raw || {})) set(wcol(k), v);
    for (const [k, v] of Object.entries(w.info || {})) if (k !== '備考') set(wcol(k), v);
    const m = w.mods || {};
    set('집속 시간', m.chargeTime ? m.chargeTime + '초' : null);
    set('집속 배율', m.chargeRatio ? m.chargeRatio + '배' : null);
    set('누적치', m.stagger);
    set('실드 보정', m.shieldMod ? m.shieldMod + '배' : null);

    for (const [title, keys] of groups) {
      const rows = keys.filter(k => vals.has(k));
      if (!rows.length) continue;
      const sec = el('div', 'wd-sec');
      sec.append(el('div', 'wd-sec-lb', title));
      const grid = el('div', 'wd-grid');
      for (const k of rows) {
        const line = el('div', 'wd-row');
        line.append(wdKey(k));
        line.append(el('span', 'wd-v', vals.get(k)));
        grid.append(line);
        vals.delete(k);
      }
      sec.append(grid);
      box.append(sec);
    }
    // 어느 묶음에도 안 들어간 값은 마지막에 모아 둔다
    if (vals.size) {
      const sec = el('div', 'wd-sec');
      sec.append(el('div', 'wd-sec-lb', '기타'));
      const grid = el('div', 'wd-grid');
      for (const [k, v] of vals) {
        const line = el('div', 'wd-row');
        line.append(wdKey(k));
        line.append(el('span', 'wd-v', v));
        grid.append(line);
      }
      sec.append(grid);
      box.append(sec);
    }

    // 격투 무장: 방향별 피해 + 연격 보정 (격투보정·파츠·스킬 반영)
    if (withMelee && w.type === 'melee' && w.melee && d.power != null) box.append(meleeSection(w, d.power));

    // 위키 설명 원문 (계산에 안 들어가는 부가 효과까지 전부)
    if (w.info && w.info['備考']) {
      const note = el('div', 'wd-sec');
      note.append(el('div', 'wd-sec-lb', '위키 설명'));
      // 「 / 」로 이어 붙은 한 줄은 항목이 몇 개인지 세기 어렵다.
      // 원문이 이미 불릿 목록이므로 쪼개서 하나씩 칩으로 보여 준다.
      // 항목이 하나뿐이어도 칩으로 둔다. 예외를 두면 무장마다 생김새가 달라져
      // 「여기는 왜 다르지」가 된다. 한 항목짜리도 전부 짧은 불릿이다(중앙값 14자).
      const items = noteText(w.info['備考']).split(' / ').map(t => t.trim()).filter(Boolean);
      if (items.length) {
        const wrap = el('div', 'wd-note-chips');
        for (const t of items) {
          const c = el('span', 'wd-chip' + noteChipCls(t), noKeepSlash(t));
          ICON.prepend(c, chipIcon(t));
          wrap.append(c);
        }
        note.append(wrap);
      }
      box.append(note);
    }
    return box;
  }

  const MELEE_LABEL = {
    'N格': 'N격', '横格': '횡격', '下格': '하격', '特殊格闘': '특수격투', 'BD格': 'BD격',
    '1撃目': '1격', '2撃目': '2격', '3撃目': '3격', '4撃目': '4격', '5撃目': '5격'
  };
  const mLabel = s => MELEE_LABEL[s] || s;

  /**
   * 격투 무장의 방향별 피해와 연격 보정을 보여 준다.
   * 방향 피해 = 격투 피해(격투보정·파츠·스킬 반영)에 방향 배율(연타는 히트별)을 곱한 합.
   * 상태(기본/헤비어택/최대출력 등)가 여러 개면 각각 소제목을 달아 나눠 보여 준다.
   */
  /* ---------- 공중 격투 제어 ----------
     「空中格闘制御」 LV2 는 그 스킬로 하는 공중 격투의 **위력을 30% 올린다.**
     이 값은 앱에 통째로 없었다 — 올리는 축이 威力(위력)인데 skills.json 에는 위력 축이
     없어서, 스킬이 가진 수치가 전부 0 으로 담겨 목록에서 **버려졌다**(사용자 지적).

     버프 스킬 체크박스로 넣지 않는다. 그 칸은 **기체 전체**에 걸리는 값을 위한 것이고,
     이 효과는 ① 備考가 「スキル「空中格闘制御」対応」이라 밝힌 무장에만 ② 그 스킬로 하는
     공중 격투에만 걸린다. 격투 무장 전부에 +30% 를 얹으면 피해가 통째로 거짓이 된다
     (같은 함정을 적 내성 쪽에서 이미 밟았다 — FOE_SCOPE_MARK 주석).

     원문이 두 갈래다(전수 60기):
       ㉮ 「空中で下格闘攻撃を行うことができる」  53기
       ㉯ 「空中で連撃不能な特定の格闘攻撃」       7기(갓 · 윙 제로 · 프리덤 · 데스티니 · X1改 · 톨기스Ⅲ · 비기나 기나Ⅱ)
     예전엔 ㉯ 를 「방향을 모른다」 며 수치를 안 냈다 — 대결에 단추가 안 나와 +30% 가 **조용히 0** 이었다.
     **공중 격투는 입력 방향과 상관없이 하격으로 나간다**(사용자 확인 2026-10-16). 그래서 둘 다 下格 이다.
     위키 해설도 6기는 「空中で下格闘」 라고 적는다(톨기스Ⅲ 만 서술 없음).
     **예외는 무장 단위**로 AIR_DIR_EXCEPT 에 둔다 — 위키 해설이 다른 방향을 못 박은 것만(근거 문장과 함께).
     걸리는 무장은 備考에 「スキル「空中格闘制御」対応」 이 있는 것뿐이다 — 대응 표기 없는 무장은 안 올린다
     (델타 플러스는 스킬이 붙었지만 사벨에 대응 표기가 공식·위키 어디에도 없어 안 걸린다). */
  const AIR_SKILL = '空中格闘制御';
  /** 그 기체·LV 의 공중 격투 위력 상승. {pct, dir:'下格'|null} · 없으면 null. */
  function airMeleeOf(ms, lv, form) {
    const on = ms || state.ms;
    if (!on) return null;
    const modes = skillModesFor(msSkillsData[baseName(on.MS名)] || [], form || state.form);
    const cands = [];
    for (const mo of modes) for (const k of (mo.skills || [])) if (k.name === AIR_SKILL) cands.push(k);
    const sk = pickByMsLv(cands, lv || msLevel(on));
    if (!sk) return null;
    const blob = ((sk.eff || '') + ' / ' + (sk.desc || '')).replace(/\s+/g, ' ');
    const m = blob.match(/威力が\s*(\d+)\s*[%％]\s*上昇/);
    if (!m) return null;                                     // LV1 에는 위력 상승이 없다
    return { pct: Number(m[1]), dir: '下格' };
  }
  /* 공중 격투가 하격이 **아닌** 무장 — 위키 해설이 방향을 못 박은 것만 넣는다(60기 해설 전수 2026-10-16).
       X1改用スクリュー・ウェッブ — 「空中格闘ではどの方向にレバーを入力してもN格闘になる」(위키 X1改 무장 해설)
     조정으로 모션이 바뀌면 여기가 어긋난다 — 그때는 해설을 다시 읽을 것. */
  const AIR_DIR_EXCEPT = { 'X1改用スクリュー・ウェッブ': 'N格' };
  /** 그 무장의 공중 격투 방향 — 예외가 아니면 스킬이 말하는 방향(하격). */
  const airDirOf = (w, a) => (w && AIR_DIR_EXCEPT[w.name]) || (a && a.dir) || null;
  /* 원문(위키 표 備考)에 대응 표기가 **빠졌지만** 대응인 무장 — 근거와 함께만 넣는다.
       デルタプラス用ビーム・サーベル — 2026-08-27 조정으로 스킬이 붙었는데 공식 공지·위키 표 어디에도
         「対応」 표기가 없다. 기체의 격투 무장은 이 사벨 하나. 사용자 확인(2026-10-16): 「대응이 맞음」.
     위키가 나중에 표기를 넣으면 이 줄은 있으나 마나다(해는 없다). */
  const AIR_TAG_EXTRA = new Set(['デルタプラス用ビーム・サーベル']);
  /** 이 무장이 그 스킬에 대응하는가 — 備考가 그렇게 말할 때(또는 위 목록에 있을 때)만 인정한다. */
  const airMeleeWeapon = w => !!w && (AIR_TAG_EXTRA.has(w.name)
    || /スキル「空中格闘制御」対応/.test(String((w.info && w.info['備考']) || '')));
  /** 올라간 위력. 위력은 게임에서 정수라 내림한다(게임의 반올림 방식은 확인할 수 없어,
      라벨에 올라간 위력을 그대로 적어 가정이 보이게 한다). */
  const airPower = (power, pct) => Math.floor(Number(power) * (1 + pct / 100));

  function meleeSection(w, power) {
    const r = stats();
    const corr = r.total.meleeCorrection;
    const sk = skillEffect();
    const corrBare = sk ? stats(null).total.meleeCorrection : corr;
    const pct = D.damagePctFor(wm0(), w, 'melee');   // 파츠 피해 % (특화 프로그램 등, 한 배율)
    const skPcts = skillDmgPctList('melee');         // 스킬 피해 % — 스킬별 별도 곱연산

    const sec = el('div', 'wd-sec');
    sec.append(el('div', 'wd-sec-lb', '격투 방향별 피해'));

    const variants = w.melee.variants || [];
    const multi = variants.length > 1;
    for (const v of variants) {
      if (multi) sec.append(el('div', 'wd-var-lb', v.label));   // 상태 소제목
      const grid = el('div', 'wd-grid');
      for (const dir of v.direction) {
        const line = el('div', 'wd-row');
        line.append(el('span', 'wd-k', mLabel(dir.label) + '  ' + jaUnits(dir.raw)));
        // 히트별로 방향 배율을 적용해 합산 (하격 240%(120%x2) = 2히트)
        // 파츠 %는 한 배율, 스킬 %는 각각 곱연산으로 얹는다
        const withSkill = D.applyDamagePct(D.meleeDamage(power, corr, { ccd: dir.hits }), [pct, ...skPcts]);
        const without = sk ? D.applyDamagePct(D.meleeDamage(power, corrBare, { ccd: dir.hits }), pct) : withSkill;
        const cell = el('span', 'wd-v');
        cell.append(document.createTextNode(without.toLocaleString()));
        if (withSkill !== without) cell.append(el('span', 's-gain' + skillCls(),
          ' (+' + (withSkill - without).toLocaleString() + ')'));
        line.append(cell);
        grid.append(line);
      }
      sec.append(grid);
    }

    /* 공중 격투 제어 LV2 — 대응 무장에만, 그리고 수치를 낼 수 있을 때만 한 줄 더. */
    const air0 = airMeleeWeapon(w) ? airMeleeOf(state.ms, msLevel(state.ms), state.form) : null;
    const air = air0 && { ...air0, dir: airDirOf(w, air0) };
    if (air) {
      const v0 = variants[0];
      const dd = air.dir && v0 && (v0.direction || []).find(d => d.label === air.dir);
      if (dd) {
        const ap = airPower(power, air.pct);
        const grid = el('div', 'wd-grid');
        const line = el('div', 'wd-row air-melee');
        line.append(el('span', 'wd-k', '공중 ' + mLabel(air.dir)
          + '  ' + jaUnits(dd.raw) + ' · 위력 +' + air.pct + '% (' + power.toLocaleString()
          + '→' + ap.toLocaleString() + ')'));
        const withSkill = D.applyDamagePct(D.meleeDamage(ap, corr, { ccd: dd.hits }), [pct, ...skPcts]);
        const without = sk ? D.applyDamagePct(D.meleeDamage(ap, corrBare, { ccd: dd.hits }), pct) : withSkill;
        const cell = el('span', 'wd-v');
        cell.append(document.createTextNode(without.toLocaleString()));
        if (withSkill !== without) cell.append(el('span', 's-gain' + skillCls(),
          ' (+' + (withSkill - without).toLocaleString() + ')'));
        line.append(cell);
        grid.append(line);
        sec.append(grid);
      } else {
        sec.append(el('div', 'wd-air-note', '공중 격투 제어 — 공중 격투는 위력 +' + air.pct
          + '%. 위키에 그 공격의 방향 배율이 없어 피해는 내지 않습니다.'));
      }
    }

    if (w.melee.combo) {
      const cb = el('div', 'wd-combo');
      cb.append(el('span', 'wd-k', '연격 보정'));
      cb.append(el('span', '', w.melee.combo.map(c => mLabel(c.label) + ' ' + jaUnits(c.raw)).join(' · ')));
      sec.append(cb);
    }
    return sec;
  }

  /** 현재 장착 기준 파츠 무장 보정 (상세 패널에서도 쓴다). */
  const wm0 = () => D.weaponModsOf(C.partsAt(state.equipped, state.lateMode), state.ms ? msLevel(state.ms) : 1, state.ms && state.ms.属性, state.expansion);

